#!/usr/bin/env node
/**
 * Documentation reachability gate (#586).
 *
 * Two failures, one gate:
 *
 *   1. DEAD REFERENCE — a relative path referenced by `docs/docs_index.md`
 *      (or by `README.md`) that does not exist, matched case-sensitively.
 *   2. ORPHAN — a tracked markdown file under `docs/` reachable from neither
 *      README nor the index, so nothing in the doc set links to it.
 *
 * Why case sensitivity is load-bearing: before this gate, `docs_index.md`
 * carried 28 SCREAMING-KEBAB references (`TOOLS.md`, `SECURITY-GUARDS.md`,
 * `GRAPH.md`) for files that are lowercase_underscore per constitution G-6.
 * On the maintainer's Windows filesystem every one of those answers
 * `fs.existsSync() === true`, so any check written against the filesystem
 * would have reported a clean index for months. Resolution here goes through
 * the exact-case `git ls-files` set instead, which is identical on every OS.
 *
 * Baseline at the commit that added this gate: 28 dead references and 41
 * orphans, both driven to 0 in the same PR.
 *
 * Exit codes: 0 = OK, 1 = violations found or the gate cannot run.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { trackedFiles, markdownRefs, resolveRef, existsTracked, docFiles } from './docs-graph.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const indexRel = 'docs/docs_index.md';
const readmeRel = 'README.md';

const tracked = trackedFiles(repoRoot);

// A gate that silently scans nothing is worse than no gate (#579). Refuse to
// pass when the inputs are missing or the tracked set is implausibly small.
if (tracked.size < 50) {
  console.error(
    `[docs-reachability] FAIL git ls-files returned ${tracked.size} paths; refusing to report a clean result.`,
  );
  process.exit(1);
}
for (const rel of [indexRel, readmeRel]) {
  if (!tracked.has(rel)) {
    console.error(`[docs-reachability] FAIL ${rel} is not tracked; the gate has nothing to check.`);
    process.exit(1);
  }
}

const sources = [
  { rel: indexRel, codeSpans: true },
  { rel: readmeRel, codeSpans: false },
];

const dead = [];
const reachable = new Set();

for (const src of sources) {
  const abs = path.join(repoRoot, src.rel);
  for (const ref of markdownRefs(abs, { codeSpans: src.codeSpans })) {
    const resolved = resolveRef(repoRoot, abs, ref.target);
    if (resolved === null) {
      dead.push({
        ...ref,
        src: src.rel,
        reason: 'escapes the repository root',
      });
      continue;
    }
    if (!existsTracked(tracked, resolved)) {
      dead.push({
        ...ref,
        src: src.rel,
        reason: `no tracked path \`${resolved}\``,
      });
      continue;
    }
    reachable.add(resolved);
  }
}

const docs = docFiles(tracked);
const orphans = docs.filter((d) => d !== indexRel && !reachable.has(d));

console.log(
  `[docs-reachability] scanned ${sources.length} entry point(s) over ${docs.length} tracked docs/**/*.md`,
);

let failed = false;

if (dead.length) {
  failed = true;
  console.error(`\n[docs-reachability] FAIL ${dead.length} dead reference(s):\n`);
  for (const d of dead) console.error(`  ${d.src}:${d.line}  ${d.raw}  — ${d.reason}`);
  console.error(
    '\nFix the reference, or if the file was renamed, run `npm run docs:index` to regenerate.',
  );
}

if (orphans.length) {
  failed = true;
  console.error(
    `\n[docs-reachability] FAIL ${orphans.length} orphaned doc(s) — linked from neither ${readmeRel} nor ${indexRel}:\n`,
  );
  for (const o of orphans) console.error(`  ${o}`);
  console.error('\nRun `npm run docs:index` to add them, or delete the doc if it is dead.');
}

if (failed) {
  // Written to help the next agent: an unreachable doc is not a cosmetic
  // problem. `docs/messaging.md` was the only documentation of 11 messaging
  // tools and was reachable from nothing for months.
  process.exit(1);
}

console.log(`[docs-reachability] OK 0 dead references, 0 orphans across ${docs.length} docs.`);
