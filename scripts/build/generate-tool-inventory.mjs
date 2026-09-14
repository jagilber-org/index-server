#!/usr/bin/env node
/**
 * Regenerate the two hand-maintained copies of the tool registry (#587):
 *
 *   - the "Tool Inventory" table in `docs/tools.md`
 *   - `docs/diagrams/tool-tier-architecture.mmd`
 *
 * Both claimed to describe the registry and did not. The table said it was
 * "generated from the live tool registry" while being edited by hand, and had
 * drifted to 45 rows against 65 registered tools, with 5 rows carrying the
 * wrong classification or tier. The diagram still named six `feedback_*` tools
 * that have not been registered since the feedback rip-down (#111).
 *
 * Only the region between the GENERATED markers is rewritten; the surrounding
 * prose in `docs/tools.md` is hand-written and stays that way.
 *
 * Usage:
 *   node scripts/build/generate-tool-inventory.mjs           # write
 *   node scripts/build/generate-tool-inventory.mjs --check    # exit 1 on drift
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { escapeMarkdownTableCell } from './markdown-cell.mjs';

// Pin every ambient gate, so the artifact does not depend on the shell that
// produced it. Diagnostics and messaging read env at module load, so these
// must be set before the dynamic import below.
process.env.INDEX_SERVER_STRESS_DIAG = '1';
process.env.INDEX_SERVER_MESSAGING_ENABLED = '1';
delete process.env.INDEX_SERVER_FLAG_TOOLS_EXTENDED;
delete process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN;

const repoRoot = process.cwd();
const distRegistry = path.join(repoRoot, 'dist', 'services', 'toolRegistry.js');
if (!fs.existsSync(distRegistry)) {
  console.error('[tool-inventory] Build output not found. Run `npm run build` first.');
  process.exit(1);
}
const { getToolRegistry } = await import(pathToFileURL(distRegistry).href);
// The tier tuple is imported, never retyped: `contentTypeSourceOfTruth.spec.ts`
// fails any file that hand-copies it, and it is right to -- a second list of
// tiers here is exactly the kind of copy that produced the drift this script
// exists to remove.
const distEnums = path.join(repoRoot, 'dist', 'services', 'protocolEnums.js');
const { TOOL_TIERS } = await import(pathToFileURL(distEnums).href);
const MAX_TIER = TOOL_TIERS[TOOL_TIERS.length - 1];

const entries = getToolRegistry({ tier: MAX_TIER });
if (entries.length < 20) {
  console.error(
    `[tool-inventory] FAIL registry returned ${entries.length} tools; refusing to write a near-empty inventory.`
  );
  process.exit(1);
}

const counts = Object.fromEntries(TOOL_TIERS.map((t) => [t, 0]));
for (const e of entries) counts[e.tier] = (counts[e.tier] ?? 0) + 1;
const countSummary = TOOL_TIERS.map((t) => `${t} ${counts[t]}`).join(', ');

const BEGIN = '<!-- BEGIN GENERATED: tool inventory (npm run docs:tools) -->';
const END = '<!-- END GENERATED: tool inventory -->';

function classification(e) {
  const bits = [];
  if (e.stable) bits.push('stable');
  if (e.mutation) bits.push('mutation');
  return bits.join(', ') || '—';
}

function inventoryBlock() {
  const out = [BEGIN];
  out.push('');
  out.push(`> **${entries.length} registered tools** — ${countSummary}.`);
  out.push('>');
  out.push(
    `> Generated from \`src/services/toolRegistry.ts\` at the **${MAX_TIER}** tier, which is the`
  );
  out.push(
    '> full declared surface. `npm run contract:tools` fails when this table drifts from'
  );
  out.push('> the registry. Use `meta_tools` for the runtime view of a specific server.');
  out.push('>');
  out.push(
    '> `stable` and `mutation` are the registry visibility/gating contract, not a claim'
  );
  out.push(
    '> about persistence side effects. `feedback_submit` is `stable` and `core` so agents'
  );
  out.push(
    '> can always report issues even though it writes. The three `diagnostics_*` tools are'
  );
  out.push(
    '> `mutation` *and* gated at registration on `INDEX_SERVER_STRESS_DIAG=1` or'
  );
  out.push(
    '> `INDEX_SERVER_DEBUG=1`; without one of those they are not registered at all. The'
  );
  out.push(
    '> eleven `messaging_*` tools are likewise gated on `INDEX_SERVER_MESSAGING_ENABLED=1`'
  );
  out.push('> and documented in [messaging.md](messaging.md).');
  out.push('');
  out.push('| Tool Name | Classification | Tier | Description |');
  out.push('|-----------|---------------|------|-------------|');
  for (const e of entries) {
    out.push(
      `| \`${e.name}\` | ${classification(e)} | ${e.tier} | ${escapeMarkdownTableCell(e.description)} |`
    );
  }
  out.push('');
  out.push(END);
  return out.join('\n');
}

/** Group name for a tool inside its tier subgraph. */
function group(name) {
  const prefix = name.split('_')[0];
  return prefix === name ? 'other' : prefix;
}

function diagram() {
  const out = [];
  // Frontmatter must be the very first thing in the file -- a leading `%%`
  // comment makes Mermaid treat the `---` as a horizontal rule and drop the
  // layout config silently.
  out.push('---');
  out.push('config:');
  out.push('    layout: elk');
  out.push('---');
  out.push('%% GENERATED FILE — do not edit by hand.');
  out.push('%% Source: src/services/toolRegistry.ts. Regenerate: npm run docs:tools');
  out.push('graph TD');
  // Labels derive from the canonical tuple; nothing here restates the tiers.
  const tiers = TOOL_TIERS.map((t) => [t, t[0].toUpperCase() + t.slice(1)]);
  for (const [tier, label] of tiers) {
    const inTier = entries.filter((e) => e.tier === tier);
    out.push(`    subgraph ${label}["${label} Tier (${inTier.length})"]`);
    out.push('        direction TB');
    const groups = new Map();
    for (const e of inTier) {
      const g = group(e.name);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(e.name);
    }
    // Sort singletons by the tool name they display rather than by their
    // prefix, so the rendered order reads alphabetically.
    const ordered = [...groups.entries()].sort((a, b) =>
      (a[1].length === 1 ? a[1][0] : a[0]).localeCompare(b[1].length === 1 ? b[1][0] : b[0])
    );
    for (const [g, names] of ordered) {
      if (names.length === 1) {
        out.push(`        ${names[0]}["${names[0]}"]`);
        continue;
      }
      out.push(`        subgraph ${label}_${g}["${g}_*"]`);
      for (const n of names) out.push(`            ${n}["${n}"]`);
      out.push('        end');
    }
    out.push('    end');
    out.push('');
  }
  out.push('    Client["MCP Client"] --> Core');
  out.push('    Client -.->|"INDEX_SERVER_FLAG_TOOLS_EXTENDED=1"| Extended');
  out.push('    Client -.->|"INDEX_SERVER_FLAG_TOOLS_ADMIN=1"| Admin');
  out.push('');
  out.push('    style Core fill:#238636,stroke:#1a7f37,stroke-width:2px,color:#fff');
  out.push('    style Extended fill:#1f6feb,stroke:#0550ae,stroke-width:2px,color:#fff');
  out.push('    style Admin fill:#bf5b00,stroke:#953800,stroke-width:2px,color:#fff');
  out.push('    style Client fill:#57606a,stroke:#424a53,stroke-width:2px,color:#fff');
  out.push('');
  return out.join('\n');
}

const toolsMdPath = path.join(repoRoot, 'docs', 'tools.md');
const toolsMd = fs.readFileSync(toolsMdPath, 'utf8');
const start = toolsMd.indexOf(BEGIN);
const end = toolsMd.indexOf(END);
if (start === -1 || end === -1) {
  console.error(
    `[tool-inventory] FAIL docs/tools.md is missing the generated-region markers.\n  expected: ${BEGIN}\n            ${END}`
  );
  process.exit(1);
}
const nextToolsMd = toolsMd.slice(0, start) + inventoryBlock() + toolsMd.slice(end + END.length);

const mmdPath = path.join(repoRoot, 'docs', 'diagrams', 'tool-tier-architecture.mmd');
const nextMmd = diagram();

const targets = [
  [toolsMdPath, nextToolsMd],
  [mmdPath, nextMmd],
];

if (process.argv.includes('--check')) {
  const stale = targets.filter(
    ([p, next]) => !fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== next
  );
  if (stale.length) {
    console.error('[tool-inventory] FAIL stale generated artifact(s):');
    for (const [p] of stale) console.error(`  ${path.relative(repoRoot, p)}`);
    console.error('Run `npm run docs:tools`.');
    process.exit(1);
  }
  console.log(
    `[tool-inventory] OK inventory and diagram match the registry (${entries.length} tools).`
  );
  process.exit(0);
}

for (const [p, next] of targets) fs.writeFileSync(p, next, 'utf8');
console.log(
  `[tool-inventory] wrote docs/tools.md inventory and tool-tier-architecture.mmd: ${entries.length} tools (${countSummary}).`
);
