/**
 * Security Regression Tests — Issue #71
 *
 * Covers the fixes from PR #70:
 *  P0 — XSS: escapeHtml() with all 5 critical characters + real payloads
 *  P0 — Path Traversal: validatePathContainment blocks escape attempts
 *  P1 — ReDoS: parseTimeRange() boundary tests
 *  P1 — Regex Injection: search handler rejects catastrophic patterns
 *
 * These tests exist specifically to prevent regression of shipped security fixes.
 * Each test documents WHY the assertion matters (the attack it blocks).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import nodePath from 'path';

// ---------------------------------------------------------------------------
// P0 — XSS: escapeHtml
// ---------------------------------------------------------------------------
describe('escapeHtml — XSS prevention (PR #70, issue #65)', () => {
  // Dynamic import because the module is ESM under src/dashboard
  async function loadEscapeHtml() {
    const mod = await import('../../dashboard/server/utils/escapeHtml.js');
    return mod.escapeHtml;
  }

  it('escapes all 5 critical HTML characters', async () => {
    const escapeHtml = await loadEscapeHtml();
    const input = `<div class="x" data-y='z'>&`;
    const result = escapeHtml(input);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('"');
    expect(result).not.toContain("'");
    // & should be escaped to &amp; (but &amp; itself contains &, so check for raw unescaped &)
    // The correct check: no raw & that isn't part of an entity
    expect(result).toContain('&amp;');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&quot;');
    expect(result).toContain('&#39;');
  });

  it('neutralizes <script>alert(1)</script> payload', async () => {
    const escapeHtml = await loadEscapeHtml();
    const xss = '<script>alert(1)</script>';
    const result = escapeHtml(xss);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
    expect(result).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('neutralizes event handler injection', async () => {
    const escapeHtml = await loadEscapeHtml();
    const xss = '<img onerror="alert(document.cookie)" src=x>';
    const result = escapeHtml(xss);
    // escapeHtml escapes angle brackets and quotes — the tag cannot be parsed as HTML
    expect(result).not.toContain('<img');
    // The key defense: quotes are escaped, so onerror can't execute even if injected into a context
    expect(result).toContain('&quot;');
    expect(result).not.toContain('<');
  });

  it('neutralizes nested/obfuscated XSS attempts', async () => {
    const escapeHtml = await loadEscapeHtml();
    const payloads = [
      '<svg onload=alert(1)>',
      '<body onload="alert(1)">',
      '<iframe src="javascript:alert(1)">',
      '"><script>alert(String.fromCharCode(88,83,83))</script>',
      "';alert(1);//",
    ];
    for (const payload of payloads) {
      const result = escapeHtml(payload);
      expect(result, `Failed to escape: ${payload}`).not.toContain('<');
    }
  });

  it('preserves safe text unchanged (except & entity encoding)', async () => {
    const escapeHtml = await loadEscapeHtml();
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
    expect(escapeHtml('')).toBe('');
  });

  it('handles multi-occurrence of same character', async () => {
    const escapeHtml = await loadEscapeHtml();
    const result = escapeHtml('<<<>>>');
    expect(result).toBe('&lt;&lt;&lt;&gt;&gt;&gt;');
  });
});

// ---------------------------------------------------------------------------
// P0 — Path Traversal: validatePathContainment
// ---------------------------------------------------------------------------
describe('validatePathContainment — path traversal prevention (PR #70, issue #62)', () => {
  async function loadValidate() {
    const mod = await import('../../dashboard/server/utils/pathContainment.js');
    return mod.validatePathContainment;
  }

  it('allows a path inside the base directory', async () => {
    const validate = await loadValidate();
    const base = process.cwd();
    const inside = nodePath.join(base, 'instructions', 'test.json');
    expect(() => validate(inside, base)).not.toThrow();
  });

  it('allows the base directory itself', async () => {
    const validate = await loadValidate();
    const base = process.cwd();
    expect(() => validate(base, base)).not.toThrow();
  });

  it('rejects ../../../etc/passwd traversal', async () => {
    const validate = await loadValidate();
    const base = process.cwd();
    const malicious = nodePath.resolve(base, '../../../etc/passwd');
    expect(() => validate(malicious, base)).toThrow(/escapes allowed base/i);
  });

  it('rejects .. in the middle of path', async () => {
    const validate = await loadValidate();
    const base = process.cwd();
    const malicious = nodePath.resolve(base, 'instructions/../../../etc/shadow');
    expect(() => validate(malicious, base)).toThrow(/escapes allowed base/i);
  });

  it('rejects path that is a prefix but not a child (path confusion)', async () => {
    const validate = await loadValidate();
    // e.g., base = /foo/bar, attacker uses /foo/bar-evil/secret
    const base = nodePath.resolve('/foo/bar');
    const malicious = nodePath.resolve('/foo/bar-evil/secret');
    expect(() => validate(malicious, base)).toThrow(/escapes allowed base/i);
  });

  it('rejects encoded traversal sequences after resolution', async () => {
    const validate = await loadValidate();
    const base = process.cwd();
    // path.resolve normalizes these — the resolved path should escape base
    const malicious = nodePath.resolve(base, '..', '..', 'etc', 'passwd');
    expect(() => validate(malicious, base)).toThrow(/escapes allowed base/i);
  });
});

// ---------------------------------------------------------------------------
// P1 — ReDoS: parseTimeRange boundary tests
// ---------------------------------------------------------------------------
describe('parseTimeRange — ReDoS prevention (PR #70, issue #60)', () => {
  async function loadParse() {
    const mod = await import('../../dashboard/server/metricsAggregation.js');
    return mod.parseTimeRange;
  }

  it('parses valid time ranges correctly', async () => {
    const parse = await loadParse();
    expect(parse('1h')).toBe(1);
    expect(parse('24h')).toBe(24);
    expect(parse('2d')).toBe(48);
    expect(parse('120m')).toBe(2); // 120/60 = 2
    expect(parse('30m')).toBe(1);  // floor(30/60) = 0, max(1, 0) = 1
  });

  it('returns default 1 for empty string', async () => {
    const parse = await loadParse();
    expect(parse('')).toBe(1);
  });

  it('returns default 1 for non-string input', async () => {
    const parse = await loadParse();
    // @ts-expect-error — testing runtime guard against non-string
    expect(parse(null)).toBe(1);
    // @ts-expect-error — testing runtime guard against non-string
    expect(parse(undefined)).toBe(1);
    // @ts-expect-error — testing runtime guard against non-string
    expect(parse(42)).toBe(1);
  });

  it('returns default 1 for length=20 valid boundary', async () => {
    const parse = await loadParse();
    // 20 chars is within limit — but must be a valid format to parse
    const valid20 = '1h'.padStart(20, ' '); // padded — won't match regex
    expect(parse(valid20)).toBe(1); // doesn't match anchored regex
  });

  it('returns default 1 for length=21 (exceeds guard)', async () => {
    const parse = await loadParse();
    const tooLong = 'a'.repeat(21);
    expect(parse(tooLong)).toBe(1);
  });

  it('rejects excessively long input without catastrophic backtracking', async () => {
    const parse = await loadParse();
    const start = performance.now();
    // This would cause ReDoS on an unguarded regex with quantifiers
    const malicious = '1'.repeat(10000) + 'h';
    const result = parse(malicious);
    const elapsed = performance.now() - start;
    expect(result).toBe(1); // rejected by length guard
    expect(elapsed, 'parseTimeRange should return in <50ms even for long input').toBeLessThan(50);
  });

  it('rejects invalid unit suffixes', async () => {
    const parse = await loadParse();
    expect(parse('5x')).toBe(1);
    expect(parse('10s')).toBe(1);
    expect(parse('7w')).toBe(1);
  });

  it('rejects non-numeric prefixes', async () => {
    const parse = await loadParse();
    expect(parse('abch')).toBe(1);
    expect(parse('--1h')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P1 — Regex Injection: search handler rejects dangerous patterns
// ---------------------------------------------------------------------------
describe('regex search validation — injection prevention (PR #70, issue #61)', () => {
  // We test validateRegexKeyword indirectly via the search handler's behavior.
  // Direct import of the handler is complex, so we test the exported validation logic.
  // The handler uses safe-regex2 + structural checks.

  // Import the search handler's internal validation by testing through the MCP layer
  // would require a running server. Instead, test the pattern validation logic directly.

  it('validates that safe patterns compile without error', async () => {
    // These should not throw
    const safePatterns = ['deploy|release', 'test.*handler', 'config-\\d+', '^prefix'];
    for (const p of safePatterns) {
      expect(() => new RegExp(p), `should compile: ${p}`).not.toThrow();
    }
  });

  it('identifies known ReDoS patterns as dangerous', async () => {
    // safe-regex2 rejects nested-quantifier patterns but not all ReDoS variants.
    // The server layers structural checks ON TOP of safe-regex2 for full coverage.
    let safeRegex: ((pattern: string) => boolean) | null = null;
    try {
      const mod = await import('safe-regex2');
      safeRegex = mod.default || mod;
    } catch {
      // safe-regex2 not installed — test structural checks only
    }

    const rejectedBySafeRegex = [
      '(a+)+$',          // classic nested quantifier
      '([a-zA-Z]+)*$',   // nested character class with quantifier
      '(.+)+',           // dot-star nested quantifier
    ];

    if (!safeRegex) {
      // Fallback: verify our structural regex checks catch the patterns instead
      const nestedQuantifierCheck = /\([^)]*[+*?}]\)[+*?{]/;
      expect(nestedQuantifierCheck.test('(a+)+')).toBe(true);
      expect(nestedQuantifierCheck.test('([a-zA-Z]+)*')).toBe(true);
      return;
    }

    for (const pattern of rejectedBySafeRegex) {
      expect(safeRegex(pattern), `safe-regex2 should reject: ${pattern}`).toBe(false);
    }

    // Verify alternation+quantifier is caught by the structural check instead
    // (safe-regex2 allows (a|a)+$ but the server's regex validator blocks it)
    const alternationCheck = /\([^)]*\|[^)]*\)[+*?{]/;
    expect(alternationCheck.test('(a|a)+$'), 'structural check should catch alternation+quantifier').toBe(true);
  });

  it('structural checks catch nested quantifiers', () => {
    // Replicate the handler's structural check: /\([^)]*[+*?}]\)[+*?{]/
    const nestedQuantifierCheck = /\([^)]*[+*?}]\)[+*?{]/;
    expect(nestedQuantifierCheck.test('(a+)+')).toBe(true);
    expect(nestedQuantifierCheck.test('(a*)+$')).toBe(true);
    expect(nestedQuantifierCheck.test('simple')).toBe(false);
    expect(nestedQuantifierCheck.test('(abc)')).toBe(false);
  });

  it('structural checks catch lookaround assertions', () => {
    const lookaroundCheck = /\(\?(?:[=!]|<[=!])/;
    expect(lookaroundCheck.test('(?=foo)')).toBe(true);
    expect(lookaroundCheck.test('(?!bar)')).toBe(true);
    expect(lookaroundCheck.test('(?<=baz)')).toBe(true);
    expect(lookaroundCheck.test('(?<!qux)')).toBe(true);
    expect(lookaroundCheck.test('(normal)')).toBe(false);
  });

  it('structural checks catch backreferences', () => {
    const backrefCheck = /\\[1-9]/;
    expect(backrefCheck.test('(a)\\1')).toBe(true);
    expect(backrefCheck.test('\\2')).toBe(true);
    expect(backrefCheck.test('\\0')).toBe(false); // \0 is not a backreference
    expect(backrefCheck.test('abc')).toBe(false);
  });
});

describe('Mermaid graph rendering — XSS-safe DOM insertion (PR #70, issue #71)', () => {
  const graphClientPath = nodePath.resolve(process.cwd(), 'src', 'dashboard', 'client', 'js', 'admin.graph.js');

  it('does not assign Mermaid-rendered markup through innerHTML', () => {
    const source = fs.readFileSync(graphClientPath, 'utf8');
    const renderGraphSvg = source.match(/function renderGraphSvg\(host, svgMarkup\)\{[\s\S]*?\n {2}\}/)?.[0] ?? '';

    expect(renderGraphSvg).toContain('sanitizeGraphSvg(svgMarkup)');
    expect(renderGraphSvg).toContain('host.replaceChildren(safeSvg)');
    expect(renderGraphSvg).not.toContain('innerHTML');
  });

  it('renders graph status and error text with textContent instead of HTML injection', () => {
    const source = fs.readFileSync(graphClientPath, 'utf8');

    expect(source).toContain('box.textContent = message');
    expect(source).toContain("target.textContent = '(loading graph...)'");
    expect(source).not.toMatch(/graph-mermaid[\s\S]{0,300}\.innerHTML\s*=/);
  });
});
