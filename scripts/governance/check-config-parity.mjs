#!/usr/bin/env node
/**
 * Configuration documentation parity gate (#588).
 *
 * Two failures, both directions:
 *
 *   1. UNDOCUMENTED — an `INDEX_SERVER_*` variable read by `src/` or
 *      `scripts/` that has no row in `docs/configuration.md`.
 *   2. DEAD — a variable documented in `docs/configuration.md` that no code
 *      path reads. These are worse than the first kind: an operator sets it,
 *      observes no error, and believes the setting took effect. Two of the
 *      nine found at the commit that added this gate were documented
 *      *authentication controls* with no enforcement anywhere
 *      (`INDEX_SERVER_AUTH_KEY`, `INDEX_SERVER_REQUIRE_AUTH_ALL`).
 *
 * Why a script and not a unit test: the same check has to run over `scripts/`,
 * which the vitest config does not compile, and `guard:env` already
 * established governance checks as npm scripts with enumerated baselines.
 *
 * Baseline: `config-parity-allowlist.json`, keyed per variable with a reason
 * each. It is a list of deliberate exclusions, not a waiver -- a new variable
 * must be documented or explicitly excluded with a stated reason, and the gate
 * fails on an allowlist entry that no longer applies, so the file cannot
 * quietly outlive its contents.
 *
 * Exit codes: 0 = OK, 1 = violations found or the gate cannot run.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = 'docs/configuration.md';
const ALLOWLIST = 'scripts/governance/config-parity-allowlist.json';

/** Extensions worth scanning for an env read. */
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs|ps1|psm1|sh)$/;

/**
 * Helpers in `src/config/configUtils.ts` and `src/utils/envUtils.ts` that take
 * a variable NAME as their first argument. A read through one of these is a
 * read; matching only `process.env.X` would miss most of the config layer and
 * report a clean parity that is not there.
 */
const NAME_TAKING_HELPERS =
  '(?:getBooleanEnv|numberFromEnv|optionalIntFromEnv|optionalNumberFromEnv|floatFromEnv|stringFromEnv|parseCsvEnv|setDefault)';

const PATTERNS = [
  // process.env.INDEX_SERVER_X / process.env['INDEX_SERVER_X']
  /process\.env\.(INDEX_SERVER_[A-Z0-9_]+)/g,
  /process\.env\[\s*['"`](INDEX_SERVER_[A-Z0-9_]+)['"`]\s*\]/g,
  // helper('INDEX_SERVER_X', ...)
  new RegExp(`${NAME_TAKING_HELPERS}\\(\\s*['"\`](INDEX_SERVER_[A-Z0-9_]+)['"\`]`, 'g'),
  // PowerShell: $env:INDEX_SERVER_X and [Environment]::GetEnvironmentVariable('INDEX_SERVER_X')
  /\$env:(INDEX_SERVER_[A-Z0-9_]+)/g,
  /GetEnvironmentVariable\(\s*['"](INDEX_SERVER_[A-Z0-9_]+)['"]/g,
  // A bare quoted name. Required, not optional: several variables are read
  // through an indirection that no `process.env.X` pattern can see --
  // `SESSION_PERSISTENCE_ENV_VARS` (`src/models/SessionPersistence.ts`) maps
  // eight of them in a const table, and `autoBackup.ts` binds its name to a
  // `const` first. Without this pattern the gate reports nine live variables
  // as dead, and a gate with false positives gets switched off.
  /['"`](INDEX_SERVER_[A-Z0-9_]+)['"`]/g,
];

/**
 * Files that LIST variable names as metadata without reading them. A name here
 * is a catalog entry, not a read -- counting it would defeat the whole check,
 * since `INDEX_SERVER_AUTH_KEY` appears in both of these and is enforced
 * nowhere.
 */
const CATALOG_ONLY = new Set([
  'src/services/handlers.dashboardConfig.ts',
  'src/services/mcpConfig/flagCatalog.ts',
  // This file. Its own comments quote `INDEX_SERVER_AUTH_KEY`,
  // `INDEX_SERVER_REQUIRE_AUTH_ALL` and a placeholder `INDEX_SERVER_X` while
  // explaining what it checks. Once committed it scanned itself and demanded
  // documentation for all three -- the gate's first real finding was against
  // the gate. Found by running it on the committed tree rather than the
  // working one, which is the only state CI ever sees.
  'scripts/governance/check-config-parity.mjs',
]);

function trackedCodeFiles() {
  const out = execFileSync('git', ['ls-files', '-z', 'src', 'scripts'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter((f) => f && CODE_EXT.test(f));
}

/**
 * Is this file a test, fixture or spec? Variables read only by tests are
 * excluded: documenting a harness knob as operator configuration is its own
 * kind of wrong.
 */
function isTestFile(rel) {
  return /(^|\/)(tests?|__tests__|__mocks__)\//.test(rel) || /\.(spec|test)\.[cm]?tsx?$/.test(rel);
}

const files = trackedCodeFiles();
if (files.length < 100) {
  console.error(
    `[config-parity] FAIL only ${files.length} code files found; refusing to report a clean result.`
  );
  process.exit(1);
}

/** name -> { prod: Set<file>, test: Set<file> } */
const reads = new Map();
for (const rel of files) {
  let text;
  try {
    text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  } catch {
    continue;
  }
  const bucket = isTestFile(rel) || CATALOG_ONLY.has(rel) ? 'test' : 'prod';
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const name = m[1];
      // `INDEX_SERVER_FLAG_`, `INDEX_SERVER_TEST_` and friends are prefix
      // strings used for matching, not variable names. Without this the gate
      // demands documentation for five things that do not exist.
      if (name.endsWith('_')) continue;
      if (!reads.has(name)) reads.set(name, { prod: new Set(), test: new Set() });
      reads.get(name)[bucket].add(rel);
    }
  }
}

const docPath = path.join(repoRoot, DOC);
if (!fs.existsSync(docPath)) {
  console.error(`[config-parity] FAIL ${DOC} not found.`);
  process.exit(1);
}
const docText = fs.readFileSync(docPath, 'utf8');

/**
 * The "Removed / not implemented" table lists variables that exist in the
 * wild -- in somebody's `mcp.json` -- but that no code reads. They are
 * documented so an operator learns the setting is inert, which is the opposite
 * of claiming it works, so they must not count as documented settings here.
 * Excluding the section rather than deleting the rows is deliberate: silently
 * dropping `INDEX_SERVER_AUTH_KEY` would leave every operator who already set
 * it none the wiser.
 */
const REMOVED_HEADING = '#### Removed / not implemented';
function stripRemovedSection(text) {
  const start = text.indexOf(REMOVED_HEADING);
  if (start === -1) return text;
  const rest = text.slice(start + REMOVED_HEADING.length);
  const next = rest.search(/^#{2,4} /m);
  return text.slice(0, start) + (next === -1 ? '' : rest.slice(next));
}

// Only table rows count as documentation. A variable named in prose is not a
// documented setting -- the whole point is that an operator can look it up
// with its default and scope.
const documented = new Set(
  [...stripRemovedSection(docText).matchAll(/^\|\s*`(INDEX_SERVER_[A-Z0-9_]+)`/gm)].map((m) => m[1])
);
if (documented.size < 50) {
  console.error(
    `[config-parity] FAIL only ${documented.size} documented rows parsed from ${DOC}; refusing to report a clean result.`
  );
  process.exit(1);
}

const allowPath = path.join(repoRoot, ALLOWLIST);
const allow = fs.existsSync(allowPath)
  ? JSON.parse(fs.readFileSync(allowPath, 'utf8'))
  : { undocumented: {}, dead: {} };

const prodRead = new Set([...reads.entries()].filter(([, v]) => v.prod.size > 0).map(([k]) => k));

const undocumented = [...prodRead].filter((n) => !documented.has(n)).sort();
const dead = [...documented].filter((n) => !prodRead.has(n)).sort();

const unexpectedUndocumented = undocumented.filter((n) => !(n in (allow.undocumented ?? {})));
const unexpectedDead = dead.filter((n) => !(n in (allow.dead ?? {})));

// A stale allowlist entry is a failure, not a courtesy. An exclusion that
// outlives the violation it excused is a waiver with extra steps (the rule
// guard:env's baseline already follows).
const staleUndocumented = Object.keys(allow.undocumented ?? {}).filter(
  (n) => !undocumented.includes(n)
);
const staleDead = Object.keys(allow.dead ?? {}).filter((n) => !dead.includes(n));

console.log(
  `[config-parity] scanned ${files.length} files — ${prodRead.size} INDEX_SERVER_* vars read in non-test code, ${documented.size} documented in ${DOC}`
);

let failed = false;

if (unexpectedUndocumented.length) {
  failed = true;
  console.error(`\n[config-parity] FAIL ${unexpectedUndocumented.length} variable(s) read but undocumented:\n`);
  for (const n of unexpectedUndocumented) {
    const where = [...reads.get(n).prod].slice(0, 3).join(', ');
    console.error(`  ${n}  (${where})`);
  }
  console.error(`\nAdd a row to ${DOC}, or an entry to ${ALLOWLIST} with a reason.`);
}

if (unexpectedDead.length) {
  failed = true;
  console.error(`\n[config-parity] FAIL ${unexpectedDead.length} variable(s) documented but read nowhere:\n`);
  for (const n of unexpectedDead) console.error(`  ${n}`);
  console.error(
    `\nA documented setting that nothing reads is worse than an undocumented one:\nthe operator sets it, sees no error, and believes it took effect.\nRemove the row, implement the variable, or allowlist it with a reason.`
  );
}

if (staleUndocumented.length || staleDead.length) {
  failed = true;
  console.error(`\n[config-parity] FAIL ${ALLOWLIST} has entries that no longer apply:\n`);
  for (const n of staleUndocumented) console.error(`  undocumented.${n} — now documented`);
  for (const n of staleDead) console.error(`  dead.${n} — now read by code`);
  console.error('\nDelete them. An allowlist that outlives its violations is a waiver.');
}

if (failed) process.exit(1);

const allowCount =
  Object.keys(allow.undocumented ?? {}).length + Object.keys(allow.dead ?? {}).length;
console.log(
  `[config-parity] OK ${prodRead.size} read / ${documented.size} documented, 0 unexplained gaps (${allowCount} allowlisted).`
);
