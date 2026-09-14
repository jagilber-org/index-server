#!/usr/bin/env ts-node
/**
 * Enforcement script to prevent ad-hoc process.env access outside the approved configuration layer.
 *
 * Policy:
 *  - All new environment variable reads must flow through src/config/runtimeConfig.ts
 *  - Allowed direct usages (bootstrap/infra):
 *      - src/config/runtimeConfig.ts (the loader itself)
 *      - vite/vitest config files (coverage instrumentation edge cases)
 *      - playwright.config.ts (external tool integration)
 *      - scripts/ and deployment scripts (initial process wiring)
 *  - Temporary grace: tests may still set process.env (writes) for simulation, but reads should prefer getRuntimeConfig().
 *  - Reads of process.env in tests are flagged unless on allowlist or clearly writing only (assignment LHS or delete operator).
 *
 * Exit codes:
 *  0 = OK
 *  1 = Violations found
 */
import fs from 'fs';
import path from 'path';

interface Violation { file: string; line: number; code: string; reason: string; key: string; }

/**
 * A permanently exempted read: one that cannot be routed through the config
 * layer for a structural reason, with that reason written down.
 *
 * Separate from `entries` on purpose. `entries` is a work queue that must reach
 * zero; `exempt` is a set of decisions. Collapsing them would let unfinished
 * work hide behind the word "exempt", and the guard rejects a key that appears
 * in both.
 */
interface ExemptEntry { key: string; reason: string; }

interface BaselineDoc { comment?: string; entries?: string[]; exempt?: ExemptEntry[]; }

// Pre-existing violations, enumerated rather than waived by file. Whole-file
// allowlisting would let NEW reads hide inside a file that already had one;
// keying on <repo-relative path>::<VAR> means adding a variable to
// activityLog.ts still fails while its six known reads stay green.
//
// This is a ratchet: an entry here that is no longer violated is itself a
// failure, so the baseline cannot silently rot into a permanent waiver.
// Line numbers are deliberately not part of the key -- they drift on every
// unrelated edit above them.
const BASELINE_FILE = path.join(__dirname, 'config-usage-baseline.json');

// This file lives in scripts/governance/, so the repo root is two levels up.
// It was one ('..'), which resolved to scripts/ and made scanDirs point at the
// nonexistent scripts/src. main() skipped it silently and reported success
// having scanned zero files -- see the files.length assertion in main().
const repoRoot = path.resolve(__dirname, '..', '..');

// Directories to scan
const scanDirs = [
  path.join(repoRoot, 'src'),
];

// File allowlist, matched against POSIX-normalised paths (see toPosix). These
// were written with escaped backslashes and so only ever matched on Windows;
// on a Linux runner the loader itself would have been reported as a violation.
const allowPatterns = [
  // The configuration layer itself. Reading process.env is its entire job, so
  // flagging it is a category error -- the policy is that code OUTSIDE this
  // layer must go through it. Only runtimeConfig.ts was listed, but the layer
  // has since grown to featureConfig, serverConfig, configUtils,
  // dashboardConfig, runtimeOverrides and pathResolution (44 reads between
  // them). Listing the directory keeps the guard honest as the layer evolves,
  // rather than re-flagging every new file in it.
  /src\/config\//,
  // Tests, per the "temporary grace" already stated in the policy header
  // above. 80 reads today; these are simulation scaffolding, and blocking on
  // them would keep this guard unenforceable for the foreseeable future --
  // which is the exact failure mode #579 is about.
  // TODO(guard-allowlist): narrow as suites migrate to getRuntimeConfig().
  /src\/tests\//,
  /vitest\.config\.ts$/,
  /playwright\.config\.ts$/,
];

/** Normalise to forward slashes so allowlist regexes are platform-agnostic. */
function toPosix(file: string): string { return file.split(path.sep).join('/'); }

// Regex to find process.env usages
const envRegex = /process\.env\.([A-Z0-9_]+)/g;

// Allowed variable name prefixes (temporary grace for legacy tests/utilities).
// TODO(guard-allowlist): reduce this list as files migrate to runtimeConfig.
const varAllowPrefixes: string[] = [
  'NODE_',           // Node built-ins like NODE_ENV
  'INDEX_SERVER_TEST_',       // Test-only handshake timing overrides
  'TEST_',           // Legacy test dirs / wait helpers
  'INDEX_SERVER_DASHBOARD_',  // Dashboard integration tests
  'INDEX_SERVER_RUN_',        // Feature-gated red suites
  'SKIP_',           // CI skip toggles
  'DIST_',           // Dist readiness tuning
  'FEEDBACK_',       // Feedback subsystem harness
];

// Explicitly allowed variable names that do not fit the prefix matrix.
const varAllowExact = new Set<string>([
  'CI',
  'INDEX_SERVER_DIR',
  'TEST_INDEX_SERVER_DIR',
  'HANDSHAKE_HARD_FAIL_MS',
  'INDEX_SERVER_MUTATION',
  'INDEX_SERVER_FORCE_REBUILD',
  'INDEX_SERVER_DASHBOARD',
  'VITEST_MAX_WORKERS',
  // `VITEST` is a fact about the process, not a setting, and it must never
  // become a runtime-config key (#611). A config key is writable through the
  // dashboard overrides overlay, so an admin-config write could tell a
  // production server it is a test run -- and `activityLog.isEnabled()` uses
  // exactly that predicate to switch activity telemetry OFF. The sniff is
  // consolidated in `isTestEnvironment()` (src/utils/envUtils.ts); read it from
  // there rather than adding another raw read.
  'VITEST',
]);

function isAllowFile(file: string): boolean {
  const posix = toPosix(file);
  return allowPatterns.some(r => r.test(posix));
}

function walk(dir: string, out: string[]){
  for(const entry of fs.readdirSync(dir)){
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if(stat.isDirectory()){
      // Skip node_modules, dist, snapshots, data, logs
      if(/node_modules|dist|snapshots|data|logs|backup/i.test(full)) continue;
      walk(full, out);
    } else if(/\.(ts|js)$/.test(entry)) {
      out.push(full);
    }
  }
}

function analyzeFile(file: string): Violation[] {
  if(isAllowFile(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const violations: Violation[] = [];
  lines.forEach((line, idx) => {
    if(!line.includes('process.env')) return;
    // Prose is not a read. Doc comments name the variables they describe --
    // `envUtils.ts` alone contributed 2 of the 19 reported occurrences from a
    // single JSDoc block -- which inflated the count and meant tidying a
    // comment could change a governance number. Only whole-line comments are
    // skipped, so a real read with a trailing `// note` is still classified.
    const lead = line.trimStart();
    if(lead.startsWith('//') || lead.startsWith('*') || lead.startsWith('/*')) return;
    let m: RegExpExecArray | null;
    envRegex.lastIndex = 0;
    while((m = envRegex.exec(line))){
      const varName = m[1];
      const before = line.slice(0, m.index);
      const after = line.slice(m.index + m[0].length);
      // Classify per occurrence, not per line. The previous check tested the
      // whole line and returned, so `process.env.A = process.env.B` suppressed
      // the READ of B along with the write to A.
      //
      // `=(?!=)` rather than `=`: the old pattern also matched `==` and `===`,
      // so every comparison against an env var was misread as a write and the
      // line was skipped entirely. Compound assignment (`+=`, `??=`, ...) is
      // still a write; `!=`, `>=`, `<=` are not.
      if(/^\s*(?:\+|-|\*|\/|%|\*\*|\|\||&&|\?\?)?=(?!=)/.test(after)) continue;
      if(/delete\s+$/.test(before)) continue;
      if(varAllowExact.has(varName)) continue;
      if(varAllowPrefixes.some(prefix => varName.startsWith(prefix))) continue;
      // Suggest consolidated alternative naming if not obviously consolidated.
      const suggestion = `Route '${varName}' through runtimeConfig (INDEX_SERVER_* consolidated vars) or add allowlist justification.`;
      const rel = toPosix(path.relative(repoRoot, file));
      violations.push({ file, line: idx+1, code: line.trim(), reason: suggestion, key: `${rel}::${varName}` });
    }
  });
  return violations;
}

function main(){
  const files: string[] = [];
  const missingDirs: string[] = [];
  for(const d of scanDirs){
    if(fs.existsSync(d)) walk(d, files);
    else missingDirs.push(d);
  }

  // A guard that scans nothing must not report success. The repoRoot bug above
  // made scanDirs point at a nonexistent directory, fs.existsSync() skipped it
  // without a word, and this script printed "passed" having read zero files --
  // for long enough that 27 violations accumulated behind it. An empty scan is
  // now a failure, and a missing scan directory is named rather than ignored.
  if(missingDirs.length){
    console.error(`\nConfiguration Usage Enforcement Failed: scan directory not found\n`);
    for(const d of missingDirs) console.error(`  missing: ${d}`);
    console.error('\nThis is a bug in the guard, not in the code under test.');
    process.exit(1);
  }
  if(files.length === 0){
    console.error('\nConfiguration Usage Enforcement Failed: scanned 0 files\n');
    console.error(`  scanDirs: ${scanDirs.join(', ')}`);
    console.error('\nA guard that inspects nothing cannot fail, so it must not pass.');
    process.exit(1);
  }

  const allViolations: Violation[] = [];
  for(const f of files){
    allViolations.push(...analyzeFile(f));
  }

  const baselineDoc: BaselineDoc = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    : { entries: [] };
  const pending: string[] = baselineDoc.entries ?? [];
  const exempt: ExemptEntry[] = baselineDoc.exempt ?? [];

  // An exemption without a stated reason is indistinguishable from an
  // oversight, and it is the thing a reviewer would have to take on faith. The
  // guard will not accept one.
  const unjustified = exempt.filter(e => !e || typeof e.key !== 'string' || !e.key.trim() || typeof e.reason !== 'string' || e.reason.trim().length < 20);
  if(unjustified.length){
    console.error(`\nConfiguration Usage Enforcement Failed: ${unjustified.length} exemption(s) without a written justification\n`);
    for(const e of unjustified) console.error(`  ${(e && e.key) || '<missing key>'}: reason must be a string of at least 20 characters`);
    console.error('\nAn exemption nobody explained is a waiver, not a decision.');
    process.exit(1);
  }

  const exemptKeys = exempt.map(e => e.key);
  const overlap = exemptKeys.filter(k => pending.includes(k));
  if(overlap.length){
    console.error(`\nConfiguration Usage Enforcement Failed: ${overlap.length} key(s) in BOTH entries and exempt\n`);
    for(const k of overlap) console.error(`  ${k}`);
    console.error('\nA key is either work still to do or a permanent decision; it cannot be both.');
    process.exit(1);
  }

  const baseline = [...pending, ...exemptKeys];
  const baselineSet = new Set(baseline);

  // `--write-baseline` regenerates the file from the current tree. Intended for
  // the initial capture and for tightening after a batch of fixes; it is not
  // wired into any npm script, so it cannot be reached by accident from CI.
  if(process.argv.includes('--write-baseline')){
    // Existing exemptions survive a regeneration -- they are decisions with
    // written reasons, and silently demoting them to the work queue would
    // discard the reasoning and reopen settled questions.
    const exemptSet = new Set(exemptKeys);
    const entries = Array.from(new Set(allViolations.map(v => v.key))).filter(k => !exemptSet.has(k)).sort();
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({
      ...baselineDoc,
      entries,
      ...(exempt.length ? { exempt } : {}),
    }, null, 2) + '\n');
    console.log(`Wrote ${entries.length} baseline entries (+${exempt.length} exempt) to ${BASELINE_FILE}`);
    return;
  }

  const unbaselined = allViolations.filter(v => !baselineSet.has(v.key));
  const seen = new Set(allViolations.map(v => v.key));
  const stale = baseline.filter(k => !seen.has(k));

  if(unbaselined.length){
    console.error(`\nConfiguration Usage Enforcement Failed: ${unbaselined.length} new violation(s)\n`);
    for(const v of unbaselined){
      console.error(`${v.file}:${v.line}\n  ${v.code}\n  -> ${v.reason}\n`);
    }
    console.error('Route these through runtimeConfig. Do NOT add them to config-usage-baseline.json -- it is a ratchet that only shrinks.');
    process.exit(1);
  }

  if(stale.length){
    console.error(`\nConfiguration Usage Enforcement Failed: ${stale.length} stale baseline entry(s)\n`);
    for(const k of stale) console.error(`  fixed, now remove from config-usage-baseline.json: ${k}`);
    console.error('\nA baseline that outlives the violations it records becomes a permanent waiver.');
    process.exit(1);
  }

  // Report occurrences AND unique keys. Reporting only occurrences is how #611
  // came to be filed as "the 19 baselined reads" against a 16-entry baseline:
  // the baseline is keyed `<path>::<VAR>`, so a variable read twice in one file
  // is two occurrences and one entry. The two numbers are both right and they
  // are not the same number, so the guard now says which is which.
  const uniqueKeys = new Set(allViolations.map(v => v.key)).size;
  if(allViolations.length){
    console.log(`Configuration usage enforcement passed (${files.length} files scanned; ${allViolations.length} read(s) across ${uniqueKeys} baselined key(s) -- ${pending.length} pending, ${exempt.length} permanently exempt -- 0 new).`);
  } else {
    console.log(`Configuration usage enforcement passed (${files.length} files scanned, no disallowed direct process.env reads).`);
  }
}

if(require.main === module){
  main();
}
