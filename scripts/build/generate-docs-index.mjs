#!/usr/bin/env node
/**
 * Generate `docs/docs_index.md` from the tracked file set (#586).
 *
 * The hand-maintained index had rotted to 28 dead references out of 45 rows
 * while 41 docs were reachable from nothing, because every rename had to be
 * mirrored by hand and nothing checked that it was. Deriving the file from
 * `git ls-files` removes the manual step; `scripts/governance/
 * check-docs-reachability.mjs` fails CI if it drifts anyway.
 *
 * Titles and one-line summaries come from each document's own first heading
 * and first prose line, so a doc describes itself and no second copy of its
 * description exists to go stale.
 *
 * Usage:
 *   node scripts/build/generate-docs-index.mjs        # write
 *   node scripts/build/generate-docs-index.mjs --check # diff only, exit 1 on drift
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { trackedFiles, docSummary } from '../governance/docs-graph.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = 'docs/docs_index.md';

/**
 * Path-pattern categories, first match wins.
 *
 * Pattern rules rather than a filename list on purpose: a new doc lands in a
 * sensible section without anyone editing this file, and a doc that matches
 * nothing falls to "Reference" instead of silently disappearing.
 */
const CATEGORIES = [
  [/^docs\/panels\//, 'Dashboard Panels'],
  [/^docs\/triage\//, 'Triage Records'],
  [/^docs\/migration\//, 'Migration Notes'],
  [/^docs\/diagrams\//, 'Diagrams'],
  [
    /^docs\/(architecture|multi_instance_design|graph|manifest|mcp-index-leader-follower-spec)\.md$/,
    'Architecture & Design',
  ],
  [
    /^docs\/(configuration|runtime_config_mapping|mcp_configuration|vscode_mcp|network-privacy)\.md$/,
    'Configuration',
  ],
  [
    /^docs\/(tools|TOOLS-GENERATED|knowledge_api_spec|messaging|client_scripts|graph)\.md$/,
    'API & Tools',
  ],
  [
    /^docs\/(quickstart|interactive_setup_walkthrough|copilot-cli-quick-setup-guide|gpt5_mcp_.*|powershell_mcp_guide|mcp_stdio_logging|agent_graph_instructions)\.md$/,
    'Guides & Integration',
  ],
  [
    /^docs\/(deployment|docker_deployment|publishing|release-checklist|versioning|migration|cert_init)\.md$/,
    'Release & Deployment',
  ],
  [
    /^docs\/(testing|testing_strategy|stress-testing|pr_review_checklist|benchmark-results)\.md$/,
    'Testing & Quality',
  ],
  [
    /^docs\/(security_guards|runtime_diagnostics|tracing|metrics_file_storage|dashboard)\.md$/,
    'Operations & Security',
  ],
  [
    /^docs\/(content_guidance|index_normalization|index_quality_gates|prompt_optimization|feedback_defect_lifecycle|use-cases|lifecycle-hooks)\.md$/,
    'Knowledge & Governance',
  ],
  [
    /^docs\/(project_prd|design_review_action_plan.*|mcp_migration_tracker|PR330-REMEDIATION)\.md$/,
    'Planning & Review',
  ],
  [/^specs\//, 'Specifications'],
  [/^[^/]+\.md$/, 'Repository Root'],
];

const SECTION_ORDER = [
  'Repository Root',
  'Architecture & Design',
  'API & Tools',
  'Configuration',
  'Guides & Integration',
  'Knowledge & Governance',
  'Operations & Security',
  'Testing & Quality',
  'Release & Deployment',
  'Dashboard Panels',
  'Planning & Review',
  'Specifications',
  'Migration Notes',
  'Triage Records',
  'Reference',
];

function categoryOf(rel) {
  for (const [re, label] of CATEGORIES) if (re.test(rel)) return label;
  return 'Reference';
}

const tracked = trackedFiles(repoRoot);

// Everything the index is responsible for linking.
const subjects = [...tracked]
  .filter(
    (f) =>
      f.endsWith('.md') &&
      f !== OUT &&
      (f.startsWith('docs/') || f.startsWith('specs/') || !f.includes('/')),
  )
  .sort();

if (subjects.length < 20) {
  console.error(
    `[docs-index] FAIL only ${subjects.length} candidate docs found; refusing to write a near-empty index.`,
  );
  process.exit(1);
}

const bySection = new Map();
for (const rel of subjects) {
  const section = categoryOf(rel);
  if (!bySection.has(section)) bySection.set(section, []);
  bySection.get(section).push(rel);
}

const sections = [...bySection.keys()].sort((a, b) => {
  const ia = SECTION_ORDER.indexOf(a);
  const ib = SECTION_ORDER.indexOf(b);
  return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
});

const lines = [];
lines.push('# Documentation Index');
lines.push('');
lines.push('<!-- GENERATED FILE — do not edit by hand.');
lines.push("     Source: `git ls-files` + each document's own first heading and first prose line.");
lines.push('     Regenerate: `npm run docs:index`   Verify: `npm run guard:docs` -->');
lines.push('');
lines.push(
  'Every tracked Markdown document in `docs/`, `specs/` and the repository root, with the title and',
);
lines.push(
  'summary each file gives itself. `npm run guard:docs` fails CI when a link here does not resolve',
);
lines.push(
  '(case-sensitively) or when a document under `docs/` is linked from neither this index nor',
);
lines.push('[README.md](../README.md).');
lines.push('');
lines.push(`Documents indexed: ${subjects.length}.`);
lines.push('');

for (const section of sections) {
  lines.push(`## ${section}`);
  lines.push('');
  lines.push('| Document | Summary |');
  lines.push('|----------|---------|');
  for (const rel of bySection.get(section)) {
    const { title, summary } = docSummary(path.join(repoRoot, rel));
    const href = path.relative('docs', rel).replace(/\\/g, '/');
    // Square brackets inside a link label terminate the label early, which
    // silently produced a non-link for `mcp_stdio_logging.md` (its title
    // contains `[warning] [server stderr]`) and made the doc read as orphaned.
    const label = (title || path.basename(rel))
      .replace(/\|/g, '\\|')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');
    lines.push(`| [${label}](${href}) | ${summary || '—'} |`);
  }
  lines.push('');
}

const output = lines.join('\n').replace(/\n+$/, '\n');
const outPath = path.join(repoRoot, OUT);
const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;

if (process.argv.includes('--check')) {
  if (existing !== output) {
    console.error('[docs-index] FAIL docs/docs_index.md is stale. Run `npm run docs:index`.');
    process.exit(1);
  }
  console.log(`[docs-index] OK index is current (${subjects.length} documents).`);
  process.exit(0);
}

fs.writeFileSync(outPath, output, 'utf8');
console.log(
  `[docs-index] wrote ${OUT}: ${subjects.length} documents across ${sections.length} sections.`,
);
