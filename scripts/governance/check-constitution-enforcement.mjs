#!/usr/bin/env node
/**
 * check-constitution-enforcement.mjs — #585
 *
 * The constitution declared 84 rules, 56 of them at `severity: error`, and
 * nothing checked that any of them were enforced by anything. 32 rules carried
 * an empty `enforcedBy` and six more named script paths that had moved months
 * earlier (`scripts/crawl-logs.mjs` -> `scripts/diagnostics/crawl-logs.mjs`,
 * and so on) -- which violates TG-2 by the constitution's own text.
 *
 * The strongest existing guard, VA-2 (`precommit.yml`, `sync-constitution
 * -Check`), verifies that constitution.md matches constitution.json. It does
 * not check that anything in either is true.
 *
 * This script asserts the falsification bar from #585:
 *
 *   no `severity: error` rule may have an empty `enforcedBy`, or name a path
 *   that does not exist.
 *
 * plus two things that bar implies but does not say:
 *
 *   - "Code review" is not enforcement. An error rule with no path-shaped
 *     enforcer must say so explicitly with `"enforcement": "review"`, and its
 *     id must appear in REVIEW_ENFORCED below. That list is a ratchet: a rule
 *     that gains a real enforcer must leave it, and a new review-only error
 *     rule cannot be added without editing this file. Without this, the bar
 *     is satisfied by pasting "Code review" into all 32 empty fields.
 *   - The CQ-1 ratchet in eslint.config.mjs must stay tight -- see below.
 *
 * Exit 0 = clean, 1 = violations. Prints what it scanned either way, so a
 * zero-rule parse is visible rather than indistinguishable from a clean pass.
 */
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { skipOnPublishedMirror } from '../lib/published-mirror.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONSTITUTION_JSON = join(ROOT, 'constitution.json');
const ESLINT_CONFIG = join(ROOT, 'eslint.config.mjs');
const MARKDOWN_OUTPUTS = [
  join(ROOT, 'constitution.md'),
  join(ROOT, '.specify', 'memory', 'constitution.md'),
];

/**
 * Error-severity rules with no mechanical enforcement, enumerated (#585).
 *
 * Rules of it: this list only shrinks. A rule leaves it by gaining a real
 * enforcer -- a script, workflow or spec that FAILS when the rule is broken.
 * Leaving a stale id here is a failure, not a shrug: the guard reports it.
 *
 * These are genuinely review-enforced today. Each would need a scanner that
 * does not exist yet: "every new feature has tests" (TS-6), "every module has
 * one responsibility" (CQ-2), "no circular imports" (CQ-4, needs an import
 * graph walk), "no swallowed exceptions" (CQ-6 -- `no-empty` passes on the
 * 390 comment-only catch blocks in this repo, so it does not count).
 */
const REVIEW_ENFORCED = new Set([
  'SH-4', 'SH-5', 'SH-6', 'SH-7',
  'AR-1',
  'A-3', 'A-5', 'A-7',
  'OB-3',
  'TS-6', 'TS-7', 'TS-8', 'TS-9', 'TS-10', 'TS-11', 'TS-12',
  'PB-1',
  'CQ-2', 'CQ-3', 'CQ-4', 'CQ-6',
  'DI-1', 'DI-2',
]);

/*
 * This guard has no jurisdiction over a published mirror.
 *
 * `New-CleanRoomCopy.ps1` strips `.instructions/`, `.specify/`, `.squad/` and
 * `.github/copilot-instructions.md` per `.publish-exclude`, then drops a
 * `.publish-manifest.json` that exists only in the mirror. Those stripped paths
 * are exactly what most `enforcedBy` entries name, so `enforcerExists()` returns
 * false for all of them and the guard reports ~50 violations plus 8 rules
 * falsely demoted to "prose only" (ratchet reads 31 against a baseline of 23).
 *
 * Every one of those is an artifact of publication, not an enforcement gap: the
 * enforcers exist and are checked in the source repo, which is where this guard
 * runs for real. Reporting them in the mirror is the guard describing its own
 * amputation. The sentinel is absent from the source repo, so the full check
 * still runs — and can still fail — everywhere it means anything.
 */
if (skipOnPublishedMirror(ROOT, 'constitution-guard',
  'Enforcer paths under .instructions/, .specify/, .squad/ and .github/ are stripped by .publish-exclude and cannot resolve here.')) {
  process.exit(0);
}

const errors = [];
const notes = [];

// ── constitution.json ────────────────────────────────────────────────
if (!existsSync(CONSTITUTION_JSON)) {
  console.error('[constitution-guard] constitution.json not found — nothing to check.');
  process.exit(1);
}
const constitution = JSON.parse(readFileSync(CONSTITUTION_JSON, 'utf8'));

const rules = [];
for (const [article, body] of Object.entries(constitution.articles ?? {})) {
  for (const rule of body.rules ?? []) rules.push({ article, ...rule });
}

// Vacuity anchor. Every check below iterates `rules`; if the shape of
// constitution.json ever changes, all of them pass on an empty array.
if (rules.length === 0) {
  console.error('[constitution-guard] Parsed 0 rules from constitution.json — the file shape changed and this guard is vacuous.');
  process.exit(1);
}

/** A string is an enforcer path if it looks like one, not prose. */
function isPathShaped(entry) {
  return /[\\/]/.test(entry) || /\.(ps1|mjs|cjs|js|ts|json|md|ya?ml)$/.test(entry);
}

/** `scripts/*` and `.instructions/*` are directory globs, not files. */
function enforcerExists(entry) {
  const globIndex = entry.indexOf('*');
  const target = globIndex === -1 ? entry : entry.slice(0, globIndex).replace(/\/$/, '');
  return target.length > 0 && existsSync(join(ROOT, target));
}

let pathEnforcerCount = 0;
let errorRuleCount = 0;
const reviewSeen = new Set();

for (const rule of rules) {
  const declared = Array.isArray(rule.enforcedBy) ? rule.enforcedBy : [];
  const pathEntries = declared.filter(isPathShaped);
  pathEnforcerCount += pathEntries.length;

  for (const entry of pathEntries) {
    if (!enforcerExists(entry)) {
      errors.push(`${rule.id} (${rule.article}): enforcedBy names '${entry}', which does not exist. TG-2 requires helper-script moves to update dependent guidance in the same change.`);
    }
  }

  if (rule.severity !== 'error') continue;
  errorRuleCount++;

  if (declared.length === 0) {
    errors.push(`${rule.id} (${rule.article}): severity 'error' with an empty enforcedBy. Give it a real enforcer, or demote it and mark "enforcement": "review".`);
    continue;
  }

  const hasLivePath = pathEntries.some(enforcerExists);
  if (hasLivePath) {
    if (REVIEW_ENFORCED.has(rule.id)) {
      errors.push(`${rule.id}: listed in REVIEW_ENFORCED but now has a real enforcer (${pathEntries.join(', ')}). Remove it from the list — a stale entry is a waiver with extra steps.`);
    }
    if (rule.enforcement === 'review') {
      errors.push(`${rule.id}: marked "enforcement": "review" but names a real enforcer (${pathEntries.join(', ')}). Drop the marker.`);
    }
    continue;
  }

  // No live path enforcer: must be declared review-only AND enumerated.
  reviewSeen.add(rule.id);
  if (rule.enforcement !== 'review') {
    errors.push(`${rule.id} (${rule.article}): severity 'error' but enforcedBy is prose only (${declared.join(', ')}). "Code review" is not a gate — add a real enforcer or set "enforcement": "review".`);
  }
  if (!REVIEW_ENFORCED.has(rule.id)) {
    errors.push(`${rule.id}: a new review-only error rule. Add a real enforcer, or add '${rule.id}' to REVIEW_ENFORCED in ${'scripts/governance/check-constitution-enforcement.mjs'} with a reason — the list is meant to shrink.`);
  }
}

for (const id of REVIEW_ENFORCED) {
  if (!reviewSeen.has(id)) {
    errors.push(`REVIEW_ENFORCED lists '${id}', which is no longer a review-only error rule (it was enforced, demoted or removed). Delete the entry.`);
  }
}

// ── version coherence ────────────────────────────────────────────────
// constitution.md said "(constitution v2.9.0)" while constitution.json was
// 2.10.0, because the version was restated inside the description string and
// nothing compared the two.
const version = constitution.version;
const embedded = /constitution v(\d+\.\d+\.\d+)/i.exec(constitution.description ?? '');
if (embedded && embedded[1] !== version) {
  errors.push(`constitution.json description says "constitution v${embedded[1]}" but version is ${version}.`);
}
for (const mdPath of MARKDOWN_OUTPUTS) {
  if (!existsSync(mdPath)) continue;
  const md = readFileSync(mdPath, 'utf8');
  if (!md.includes(`**Version**: ${version}`)) {
    errors.push(`${mdPath.replace(ROOT, '.')} does not carry "**Version**: ${version}" — run 'node sync-constitution.cjs'.`);
  }
  const mdEmbedded = /constitution v(\d+\.\d+\.\d+)/i.exec(md);
  if (mdEmbedded && mdEmbedded[1] !== version) {
    errors.push(`${mdPath.replace(ROOT, '.')} mentions "constitution v${mdEmbedded[1]}" but constitution.json is ${version}.`);
  }
}

// ── CQ-1 ratchet freshness ───────────────────────────────────────────
// CQ-1's enforcer is eslint.config.mjs. The five per-file `max-lines` caps
// there are pinned to each file's exact length so an oversized file cannot
// grow. If a file SHRINKS and its cap is left behind, the cap silently turns
// into headroom — the same rusting that makes a baseline a waiver.
if (existsSync(ESLINT_CONFIG)) {
  const config = readFileSync(ESLINT_CONFIG, 'utf8');
  const overrides = [...config.matchAll(/files:\s*\['([^']+)'\]\s*,\s*rules:\s*\{\s*'max-lines':\s*\['error',\s*\{\s*max:\s*(\d+)/g)];

  // `max:\s*1000` without the delimiter also matches `max: 100000` — a cap
  // loosened by two zeros would have passed. Caught while falsifying.
  if (!/'max-lines':\s*\['error',\s*\{\s*max:\s*1000\s*[,}]/.test(config)) {
    errors.push("eslint.config.mjs no longer carries the CQ-1 global 'max-lines' cap of 1000 — CQ-1 has nothing enforcing it.");
  }
  if (overrides.length === 0) {
    notes.push('eslint.config.mjs declares no per-file max-lines override — nothing to ratchet.');
  }
  for (const [, file, cap] of overrides) {
    const full = join(ROOT, file);
    if (!existsSync(full)) {
      errors.push(`eslint.config.mjs pins max-lines for '${file}', which no longer exists. Drop the override.`);
      continue;
    }
    const actual = readFileSync(full, 'utf8').split('\n').length - (readFileSync(full, 'utf8').endsWith('\n') ? 1 : 0);
    if (actual < Number(cap)) {
      errors.push(`${file} is now ${actual} lines but eslint.config.mjs still caps it at ${cap}. Tighten the cap to ${actual} — a ratchet that does not follow the file down is headroom.`);
    }
  }
  notes.push(`CQ-1 ratchet: ${overrides.length} per-file cap(s) checked against the files on disk.`);
}

// ── report ───────────────────────────────────────────────────────────
console.log(`[constitution-guard] constitution v${version}: ${rules.length} rule(s), ${errorRuleCount} at severity 'error', ${pathEnforcerCount} path-shaped enforcer reference(s), ${reviewSeen.size} error rule(s) review-enforced (baseline ${REVIEW_ENFORCED.size}).`);
for (const note of notes) console.log(`[constitution-guard] ${note}`);

if (errors.length) {
  console.error('\n[constitution-guard] Violations:');
  for (const e of errors) console.error('  - ' + e);
  console.error('\nA rule nothing can fail is documentation, not governance. Fix the enforcer, fix the path, or demote the rule and say so in its text.');
  process.exit(1);
}
console.log('[constitution-guard] OK');
