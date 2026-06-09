/**
 * Regression tests for issue #352 / CodeQL alerts #31, #32, #44 (js/regex-injection).
 *
 * Origin: 15-alert security wave on jagilber-org/index-server mirror.
 * Owner (red phase): Tank.  Owner (green phase, if needed): Trinity.
 *
 * Constitution refs:
 *   TS-8  — TDD red/green NON-NEGOTIABLE
 *   TS-9  — every bug fix MUST start with a failing regression test
 *   TS-12 — at least 5 cases per regression
 *
 * Theory of the test
 * ------------------
 * src/services/handlers.search.ts compiles user-supplied regex patterns at three
 * sites (orig CodeQL alert lines 258/259, 375, 464/465). All three sites route
 * through `compileSafeUserRegex` (src/services/searchRegex.ts) which calls
 * `validateRegexKeyword` first — that is the single trusted construction site.
 *
 * If the mitigation holds, these tests turn GREEN and document that #31/#32/#44
 * can be dismissed as mitigated. If ANY assertion fails, that failure is the
 * RED state Trinity must turn green by hardening either the validator or the
 * caller pipeline.
 *
 * Mocks: indexContext is mocked locally (mirrors search.spec.ts pattern) so the
 * test exercises real handler code paths without loading a real index from disk.
 */

import { describe, it, expect, vi } from 'vitest';
import { compileSafeUserRegex, MAX_REGEX_PATTERN_LENGTH } from '../services/searchRegex';
import { handleInstructionsSearch } from '../services/handlers.search';
import type { InstructionEntry } from '../models/instruction';

// ---------------------------------------------------------------------------
// Fixture index — minimal payload so handleInstructionsSearch can run without
// touching disk. The body intentionally contains characters that would be
// problematic if interpreted as a regex meta-pattern.
// ---------------------------------------------------------------------------
const mockInstructions: InstructionEntry[] = [
  {
    id: 'sec-001',
    title: 'Adversarial regex target',
    body: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa! ' +
          'literal characters: ( ) [ ] { } * + ? . ^ $ | \\',
    priority: 1,
    audience: 'all',
    requirement: 'recommended',
    categories: ['security', 'regex'],
    contentType: 'instruction',
    sourceHash: 'h1',
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
];

vi.mock('../services/indexContext', () => ({
  ensureLoaded: () => ({ list: mockInstructions, hash: 'sec-test-hash' }),
}));

// ---------------------------------------------------------------------------
// Adversarial payloads. Each one targets a different family of regex-injection
// or ReDoS failure mode. Per TS-12 we provide ≥5 cases.
// ---------------------------------------------------------------------------
const ADVERSARIAL_PATTERNS: Array<{ name: string; pattern: string; expectRejected: boolean }> = [
  // Catastrophic backtracking — classic nested-quantifier ReDoS.
  { name: 'nested-quantifier (a+)+', pattern: '(a+)+', expectRejected: true },
  { name: 'nested-quantifier (a*)* ', pattern: '(a*)*', expectRejected: true },
  // Evil alternation with quantifier.
  { name: 'alternation-with-quantifier (a|aa)+', pattern: '(a|aa)+', expectRejected: true },
  // Lookaround (explicitly rejected by validator).
  { name: 'lookahead (?=abc)', pattern: '(?=abc)', expectRejected: true },
  { name: 'negative-lookbehind (?<!a)', pattern: '(?<!a)', expectRejected: true },
  // Backreference (explicitly rejected).
  { name: 'backreference \\1', pattern: '(.)\\1', expectRejected: true },
  // Unbalanced / syntactically invalid pattern.
  { name: 'unbalanced bracket [abc', pattern: '[abc', expectRejected: true },
  // Length cap.
  {
    name: 'over-length pattern',
    pattern: 'a'.repeat(MAX_REGEX_PATTERN_LENGTH + 1),
    expectRejected: true,
  },
  // Benign patterns — must still compile cleanly.
  { name: 'benign literal', pattern: 'hello', expectRejected: false },
  { name: 'benign character class', pattern: 'Type[Ss]cript', expectRejected: false },
  { name: 'benign alternation', pattern: 'map|filter|reduce', expectRejected: false },
];

describe('#352 regex-injection regression (handlers.search.ts via compileSafeUserRegex)', () => {
  describe('compileSafeUserRegex (trust gate)', () => {
    for (const c of ADVERSARIAL_PATTERNS) {
      it(`${c.expectRejected ? 'REJECTS' : 'accepts'}: ${c.name}`, () => {
        if (c.expectRejected) {
          expect(() => compileSafeUserRegex(c.pattern, '')).toThrow();
        } else {
          const re = compileSafeUserRegex(c.pattern, '');
          expect(re).toBeInstanceOf(RegExp);
        }
      });
    }

    it('never throws SyntaxError — wraps malformed input as a controlled Error', () => {
      // The validator catches RegExp construction errors and re-throws as plain
      // Error('Invalid regex pattern ...'). A bare SyntaxError would mean the
      // injection reached the engine unguarded.
      for (const c of ADVERSARIAL_PATTERNS.filter(p => p.expectRejected)) {
        let thrown: unknown;
        try { compileSafeUserRegex(c.pattern, ''); } catch (e) { thrown = e; }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).constructor.name).not.toBe('SyntaxError');
      }
    });

    it('bounded execution time on 10k-char adversarial input', () => {
      // For patterns the validator ACCEPTS, compiled regex must still execute
      // in <100ms on a 10k char input. Catches future loosening of the
      // validator that would let a ReDoS pattern through.
      const benign = ADVERSARIAL_PATTERNS.filter(p => !p.expectRejected);
      const haystack = 'a'.repeat(10_000) + '!';
      for (const c of benign) {
        const re = compileSafeUserRegex(c.pattern, 'g');
        const start = performance.now();
        haystack.match(re);
        const elapsed = performance.now() - start;
        expect(elapsed, `${c.name} took ${elapsed.toFixed(2)}ms`).toBeLessThan(100);
      }
    });
  });

  describe('handleInstructionsSearch — adversarial regex keyword input', () => {
    it('rejects ReDoS patterns with a controlled error response (no engine crash)', async () => {
      // mode='regex' is the user-facing entry that funnels into
      // compileSafeUserRegex. A rejected pattern must throw a controlled
      // Error or return a structured failure — NOT a SyntaxError, NOT hang.
      const start = performance.now();
      await expect(
        handleInstructionsSearch({ keywords: ['(a+)+'], mode: 'regex' })
      ).rejects.toThrow(/backtracking|invalid|catastrophic|nested|rejected/i);
      const elapsed = performance.now() - start;
      expect(elapsed, `validator must short-circuit fast (was ${elapsed}ms)`).toBeLessThan(500);
    });

    it('rejects lookaround in regex mode', async () => {
      await expect(
        handleInstructionsSearch({ keywords: ['(?=abc)'], mode: 'regex' })
      ).rejects.toThrow(/lookaround|rejected|invalid/i);
    });

    it('rejects over-length regex pattern', async () => {
      const huge = 'a'.repeat(MAX_REGEX_PATTERN_LENGTH + 5);
      await expect(
        handleInstructionsSearch({ keywords: [huge], mode: 'regex' })
      ).rejects.toThrow(/exceed|ReDoS|length/i);
    });

    it('does NOT treat special chars as regex in keyword mode (escape path)', async () => {
      // Line 375: `new RegExp(escapeRegex(keyword), regexFlags)`. Adversarial
      // special chars must be neutralized before reaching the engine.
      const result = await handleInstructionsSearch({
        keywords: ['.*?'],
        mode: 'keyword',
      });
      // No instruction contains literal ".*?", so result set should be empty
      // and the call must NOT throw and must NOT hang.
      expect(result.results).toEqual([]);
    });

    it('deterministic — same adversarial-but-benign pattern returns identical results across runs', async () => {
      const params = { keywords: ['Type[Ss]cript|regex'], mode: 'regex' as const };
      const a = await handleInstructionsSearch(params);
      const b = await handleInstructionsSearch(params);
      expect(a.results.map(r => r.instructionId)).toEqual(b.results.map(r => r.instructionId));
    });

    it('bounded total runtime for adversarial-but-valid pattern on full index', async () => {
      // End-to-end sanity: full handler invocation with a pattern that the
      // validator accepts must complete fast even with regex special chars.
      const start = performance.now();
      await handleInstructionsSearch({ keywords: ['a{1,5}'], mode: 'regex' });
      const elapsed = performance.now() - start;
      expect(elapsed, `handler took ${elapsed.toFixed(2)}ms`).toBeLessThan(1000);
    });
  });
});
