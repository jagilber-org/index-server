/**
 * Regression tests for issue #352 / CodeQL alert #53 (js/incomplete-sanitization).
 *
 * Origin: 15-alert security wave on jagilber-org/index-server mirror.
 * Owner (red phase): Tank.  Owner (green phase): Trinity.
 *
 * Constitution refs:
 *   TS-8  — TDD red/green NON-NEGOTIABLE
 *   TS-9  — every bug fix MUST start with a failing regression test
 *   TS-12 — at least 5 cases per regression
 *
 * Target: scripts/build/generate-tools-doc.mjs line 26
 *   `${e.description.replace(/\|/g,'\\|')}`
 *
 * The current single-replace covers ONE meta-character (|), missing:
 *   - backslash before pipe (\\| can re-emerge after escaping)
 *   - embedded newlines (break the markdown row)
 *   - HTML / control characters in descriptions
 *   - leading / trailing whitespace
 *
 * RED state: the script does not export the escape function, so the test
 * imports a helper Trinity must extract during the green phase. Until that
 * extraction happens, this suite fails with an import error — that IS the
 * red. Trinity's green task: refactor `generate-tools-doc.mjs` to export
 * `escapeMarkdownTableCell` (and use it inline) so this suite turns green.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

// Trinity's green-phase contract: scripts/build/generate-tools-doc.mjs must
// export `escapeMarkdownTableCell(text: string): string`. Until then this
// dynamic import resolves but the symbol is `undefined`, and every assertion
// below fails — the desired RED state.
const SCRIPT_URL = pathToFileURL(
  path.resolve(__dirname, '..', '..', 'scripts', 'build', 'generate-tools-doc.mjs')
).href;

let escapeMarkdownTableCell: ((text: string) => string) | undefined;
beforeAll(async () => {
  try {
    const mod = await import(SCRIPT_URL);
    escapeMarkdownTableCell = mod.escapeMarkdownTableCell;
  } catch {
    escapeMarkdownTableCell = undefined;
  }
});

const ROW = (cell: string) => `| name | yes | yes | ${cell} |`;

describe('#352 incomplete-sanitization regression (generate-tools-doc.mjs markdown cell)', () => {
  it('exports escapeMarkdownTableCell (Trinity green-phase contract)', () => {
    expect(
      typeof escapeMarkdownTableCell,
      'generate-tools-doc.mjs must export `escapeMarkdownTableCell` — extract it from the inline .replace() at line 26'
    ).toBe('function');
  });

  const cases: Array<{ name: string; input: string; mustContainEscaped?: string; mustNotContain?: string[] }> = [
    // (1) literal pipe — the original case the .replace() already handles
    {
      name: 'literal pipe',
      input: 'splits | columns',
      mustContainEscaped: 'splits \\| columns',
    },
    // (2) backslash before pipe — naive .replace(/\|/g, '\\|') turns "\|" into
    // "\\|" which renders as literal backslash + pipe, AND the trailing pipe
    // is still treated as a cell separator by some markdown engines.
    {
      name: 'backslash-pipe \\|',
      input: 'foo \\| bar',
      mustNotContain: ['foo \\| bar |'], // raw input must not survive un-double-escaped
    },
    // (3) embedded newline — breaks markdown table into 2 rows
    {
      name: 'embedded newline',
      input: 'line one\nline two',
      mustNotContain: ['\n'],
    },
    // (4) carriage return + newline (Windows-style)
    {
      name: 'CRLF newline',
      input: 'line one\r\nline two',
      mustNotContain: ['\n', '\r'],
    },
    // (5) HTML tag — should be escaped/encoded so it renders literally and
    // does not introduce executable markup in any downstream renderer.
    {
      name: 'HTML <script>',
      input: 'unsafe <script>alert(1)</script>',
      mustNotContain: ['<script>', '</script>'],
    },
    // (6) leading + trailing whitespace
    {
      name: 'leading/trailing whitespace',
      input: '   padded   ',
      mustNotContain: ['   padded   '],
    },
    // (7) multi-line + pipes combined (real-world worst case)
    {
      name: 'multi-line with pipes',
      input: 'first | row\nsecond | row',
      mustNotContain: ['\n'],
    },
    // (8) backticks (could break code-fence rendering inside cells)
    {
      name: 'backticks',
      input: 'inline `code` sample',
      mustNotContain: ['\n', '\r'], // at minimum no row-breakers
    },
  ];

  for (const c of cases) {
    it(`sanitizes: ${c.name}`, () => {
      expect(escapeMarkdownTableCell, 'helper must exist (see first test)').toBeTypeOf('function');
      const out = escapeMarkdownTableCell!(c.input);
      // Universal invariants for every cell
      expect(out, 'no raw newlines allowed in a single table row').not.toMatch(/[\r\n]/);
      const row = ROW(out);
      // Row must remain a single physical line
      expect(row.split(/\r?\n/).length).toBe(1);
      if (c.mustContainEscaped) {
        expect(out).toContain(c.mustContainEscaped);
      }
      if (c.mustNotContain) {
        for (const banned of c.mustNotContain) {
          expect(out).not.toContain(banned);
        }
      }
    });
  }

  it('idempotent: escape(escape(x)) === escape(x) for safe inputs', () => {
    expect(escapeMarkdownTableCell).toBeTypeOf('function');
    const safe = 'plain description text';
    expect(escapeMarkdownTableCell!(escapeMarkdownTableCell!(safe))).toBe(escapeMarkdownTableCell!(safe));
  });

  it('handles empty + non-string defensively', () => {
    expect(escapeMarkdownTableCell).toBeTypeOf('function');
    expect(escapeMarkdownTableCell!('')).toBe('');
    // @ts-expect-error -- defensive contract: passing non-string should not throw
    expect(() => escapeMarkdownTableCell!(undefined)).not.toThrow();
    // @ts-expect-error -- defensive contract
    expect(() => escapeMarkdownTableCell!(null)).not.toThrow();
  });
});
