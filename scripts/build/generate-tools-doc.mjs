#!/usr/bin/env node
/**
 * Generates docs/TOOLS-GENERATED.md from the compiled registry (dist output).
 * Run after build: npm run build && npm run docs:tools
 *
 * Emitted at the **admin** tier (#587). It was previously generated at
 * `extended`, so all 31 admin tools -- every `bootstrap_*`, `manifest_*`,
 * `diagnostics_*`, `index_archive*` and `trace_dump` -- were absent from the
 * one file titled "Generated Tool Registry", and the file said nothing about
 * being a partial view. A reference that silently omits half the surface is
 * worse than one that is obviously incomplete.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// Re-exported so `src/tests/generateToolsDocSanitization.spec.ts` keeps
// resolving the symbol through this module; the implementation moved to a
// side-effect-free file so other generators can import it without triggering
// a write of docs/TOOLS-GENERATED.md.
export { escapeMarkdownTableCell } from './markdown-cell.mjs';
import { escapeMarkdownTableCell } from './markdown-cell.mjs';

// Pin all ambient gates so the generated artifact is environment-independent.
// Tier is pinned via the explicit { tier } option; diagnostics and messaging
// read env vars at module load time, so they must be set before the import.
process.env.INDEX_SERVER_STRESS_DIAG = '1';
process.env.INDEX_SERVER_MESSAGING_ENABLED = '1';

const distRegistry = path.join(process.cwd(), 'dist', 'services', 'toolRegistry.js');
if(!fs.existsSync(distRegistry)){
  console.error('Build output not found. Run `npm run build` first.');
  process.exit(1);
}
const { getToolRegistry, REGISTRY_VERSION } = await import(pathToFileURL(distRegistry).href);
// Tier tuple imported, never retyped (see contentTypeSourceOfTruth.spec.ts).
const distEnums = path.join(process.cwd(), 'dist', 'services', 'protocolEnums.js');
const { TOOL_TIERS } = await import(pathToFileURL(distEnums).href);
const MAX_TIER = TOOL_TIERS[TOOL_TIERS.length - 1];
const entries = getToolRegistry({ tier: MAX_TIER });

const counts = Object.fromEntries(TOOL_TIERS.map(t => [t, 0]));
for(const e of entries) counts[e.tier] = (counts[e.tier] ?? 0) + 1;
const countSummary = TOOL_TIERS.map(t => `${t} ${counts[t]}`).join(', ');

const lines = [];
lines.push('# Generated Tool Registry');
lines.push('');
lines.push(`Registry Version: ${REGISTRY_VERSION}`);
lines.push('');
lines.push(`Tier: **${MAX_TIER}** — the full declared surface, ${entries.length} tools (${countSummary}).`);
lines.push('A running server advertises fewer: `core` only, unless `INDEX_SERVER_FLAG_TOOLS_EXTENDED=1`');
lines.push('or `INDEX_SERVER_FLAG_TOOLS_ADMIN=1` is set. Tiers control what `tools/list` shows, not what');
lines.push('may be called. The `diagnostics_*` tools additionally require `INDEX_SERVER_STRESS_DIAG=1` or');
lines.push('`INDEX_SERVER_DEBUG=1`, and the `messaging_*` tools `INDEX_SERVER_MESSAGING_ENABLED=1`; without');
lines.push('those they are not registered at all, at any tier.');
lines.push('');
lines.push('| Method | Tier | Stable | Mutation | Description |');
lines.push('|--------|------|--------|----------|-------------|');
for(const e of entries){
  lines.push(`| ${escapeMarkdownTableCell(e.name)} | ${escapeMarkdownTableCell(e.tier)} | ${e.stable ? 'yes' : ''} | ${e.mutation ? 'yes' : ''} | ${escapeMarkdownTableCell(e.description)} |`);
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
const output = lines.join('\n');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
  if (current !== output) {
    console.error('[tools-doc] FAIL docs/TOOLS-GENERATED.md is stale. Run `npm run docs:tools`.');
    process.exit(1);
  }
  console.error(`[tools-doc] OK docs/TOOLS-GENERATED.md matches the registry (${entries.length} tools).`);
  process.exit(0);
}

fs.writeFileSync(outPath, output);
console.error('Wrote', outPath);
