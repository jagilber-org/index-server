#!/usr/bin/env node
/**
 * Generates docs/TOOLS-GENERATED.md from the compiled registry (dist output).
 * Run after build: npm run build && npm run docs:tools
 */
import fs from 'fs';
import path from 'path';

/**
 * Escape a free-form string for safe rendering inside a single markdown
 * table cell. Addresses CodeQL js/incomplete-sanitization (alert #53,
 * issue #352): the previous inline `.replace(/\|/g,'\\|')` covered the
 * pipe delimiter but left newlines, HTML, and surrounding whitespace
 * able to break or escape the cell.
 *
 * Contract (pinned by src/tests/generateToolsDocSanitization.spec.ts):
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

const distRegistry = path.join(process.cwd(), 'dist', 'services', 'toolRegistry.js');
if(!fs.existsSync(distRegistry)){
  console.error('Build output not found. Run `npm run build` first.');
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getToolRegistry, REGISTRY_VERSION } = await import('file://' + distRegistry);
const entries = getToolRegistry();

const lines = [];
lines.push('# Generated Tool Registry');
lines.push('');
lines.push(`Registry Version: ${REGISTRY_VERSION}`);
lines.push('');
lines.push('| Method | Stable | Mutation | Description |');
lines.push('|--------|--------|----------|-------------|');
for(const e of entries){
  lines.push(`| ${escapeMarkdownTableCell(e.name)} | ${e.stable ? 'yes' : ''} | ${e.mutation ? 'yes' : ''} | ${escapeMarkdownTableCell(e.description)} |`);
}
lines.push('');
lines.push('## Schemas');
for(const e of entries){
  lines.push(`### ${e.name}`);
  lines.push('**Input Schema**');
  lines.push('```json');
  lines.push(JSON.stringify(e.inputSchema, null, 2));
  lines.push('```');
  if(e.outputSchema){
    lines.push('**Output Schema (Result)**');
    lines.push('```json');
    lines.push(JSON.stringify(e.outputSchema, null, 2));
    lines.push('```');
  }
  lines.push('');
}

const outPath = path.join(process.cwd(), 'docs', 'TOOLS-GENERATED.md');
fs.writeFileSync(outPath, lines.join('\n'));
console.error('Wrote', outPath);
