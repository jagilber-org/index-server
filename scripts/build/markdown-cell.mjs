/**
 * Markdown table-cell escaping, extracted from `generate-tools-doc.mjs` (#587)
 * so a second generator can use it without executing that script's top-level
 * side effects (it writes `docs/TOOLS-GENERATED.md` on import).
 *
 * Contract is unchanged and still pinned by
 * `src/tests/generateToolsDocSanitization.spec.ts`, which imports the symbol
 * through `generate-tools-doc.mjs`; that module re-exports this one.
 *
 * Escape a free-form string for safe rendering inside a single markdown table
 * cell. Addresses CodeQL js/incomplete-sanitization (alert #53, issue #352):
 * the previous inline `.replace(/\|/g,'\\|')` covered the pipe delimiter but
 * left newlines, HTML, and surrounding whitespace able to break or escape the
 * cell.
 *
 *   - null / undefined / non-string → ''
 *   - trim leading/trailing whitespace
 *   - encode HTML angle brackets (so `<script>` renders literally)
 *   - collapse CR / LF / CRLF to `<br>` so the row stays one physical line
 *   - escape `|` to `\|` so it does not act as a column separator
 *   - idempotent for inputs that contain none of the above meta-chars
 *
 * @param {unknown} text
 * @returns {string}
 */
export function escapeMarkdownTableCell(text) {
  if (text === null || text === undefined) return '';
  let s = typeof text === 'string' ? text : String(text);
  s = s.trim();
  // Encode HTML angle brackets BEFORE we inject our own `<br>` markers,
  // otherwise the injected `<br>` would itself get re-encoded.
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Collapse any newline sequence to a markdown line-break tag so the
  // table row stays on one physical line.
  s = s.replace(/\r\n|\r|\n/g, '<br>');
  // Escape the markdown cell separator.
  s = s.replace(/\|/g, '\\|');
  return s;
}
