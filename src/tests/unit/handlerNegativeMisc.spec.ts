/**
 * Negative-path coverage for misc handlers — Issue #150.
 *
 * Targets:
 *  - prompt_review: empty/null/oversized/control-char inputs.
 *  - trace_dump:   path traversal, absolute-paths-outside-cwd.
 *
 * Both handlers had no dedicated runtime negative tests before this file.
 * (Branch-level note: `securityRegressionPr70.spec.ts` is contributed by
 * a sibling PR (#195) and does not exist on this branch yet — these tests
 * intentionally provide standalone runtime coverage that does not depend
 * on the merge order of that PR.)
 */
import { describe, it, expect } from 'vitest';
import path from 'path';

import { getHandler } from '../../server/registry';
import '../../services/handlers.prompt';
import '../../services/handlers.trace';

describe('Misc handler negative tests (#150)', () => {
  // ── prompt_review ────────────────────────────────────────────────────────

  describe('prompt_review', () => {
    it('handles missing prompt field without crashing (treats as empty)', async () => {
      const h = getHandler('prompt_review')!;
      const result = (await h({})) as { length: number; issues: unknown[]; summary: unknown };
      expect(result.length).toBe(0);
      expect(Array.isArray(result.issues)).toBe(true);
      expect(result.summary).toBeDefined();
    });

    it('handles non-string prompt (falsy-coerce path) without crashing', async () => {
      const h = getHandler('prompt_review')!;
      const result = (await h({ prompt: null as unknown as string })) as { length: number };
      expect(result.length).toBe(0);
    });

    it('rejects oversized prompt with truncated marker', async () => {
      const h = getHandler('prompt_review')!;
      const oversize = 'a'.repeat(10_001);
      const result = (await h({ prompt: oversize })) as {
        truncated?: boolean;
        message?: string;
        max?: number;
      };
      expect(result.truncated).toBe(true);
      expect(result.max).toBe(10_000);
      expect(result.message).toMatch(/too large/i);
    });

    it('strips null bytes (0x00) from input before review', async () => {
      const h = getHandler('prompt_review')!;
      const withNul = 'hello\x00world\x00';
      const result = (await h({ prompt: withNul })) as { length: number };
      // 'hello' (5) + 'world' (5) = 10 chars after \0 stripping
      expect(result.length).toBe(10);
    });

    it('returns valid shape for empty prompt', async () => {
      const h = getHandler('prompt_review')!;
      const result = (await h({ prompt: '' })) as {
        length: number;
        issues: unknown[];
        summary: unknown;
      };
      expect(result.length).toBe(0);
      expect(Array.isArray(result.issues)).toBe(true);
    });
  });

  // ── trace_dump ───────────────────────────────────────────────────────────

  describe('trace_dump', () => {
    it('rejects relative path that escapes cwd (../)', async () => {
      const h = getHandler('trace_dump')!;
      const result = (await h({ file: '../etc/passwd' })) as { error?: string };
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/working directory/i);
    });

    it('rejects deeply nested path-traversal', async () => {
      const h = getHandler('trace_dump')!;
      const result = (await h({ file: '../../../../tmp/escape.json' })) as { error?: string };
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/working directory/i);
    });

    it('rejects absolute path outside cwd', async ({ skip }) => {
      const h = getHandler('trace_dump')!;
      // pick a directory that is absolute and clearly outside cwd
      const escape = process.platform === 'win32'
        ? 'C:\\Windows\\Temp\\trace-escape.json'
        : '/tmp/trace-escape.json';
      const cwd = path.resolve(process.cwd());
      // Skip with a clear marker if cwd happens to contain the escape path
      // on this runner (e.g. cwd is C:\Windows\Temp\... on a Windows test
      // box). A silent `return` here would report a false-green.
      const resolved = path.resolve(escape);
      if (resolved === cwd || resolved.startsWith(cwd + path.sep)) {
        skip();
        return;
      }
      const result = (await h({ file: escape })) as { error?: string };
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/working directory/i);
    });
  });
});
