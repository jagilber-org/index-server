#!/usr/bin/env node
/**
 * Executes ONLY the fast test suites by enumerating all spec files and excluding slowTests list.
 * This is more reliable than multiple --exclude flags (which can be brittle with path resolution).
 */
import { readdirSync, statSync } from 'fs';
import { spawn } from 'child_process';
import { slowTests, isSlowTest, normalizeSpecPath } from './slow-tests.mjs';
import path from 'path';

function walk(dir) {
  const entries = readdirSync(dir);
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (e.endsWith('.spec.ts')) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

const allSpecs = walk('src/tests');
const configExcludedSpecs = new Set([
  'src/tests/coverageLift.performanceBaseline.spec.ts',
  'src/tests/phase1/toolTierFlags.red.spec.ts',
  'src/tests/phase1/toolTierFiltering.red.spec.ts',
  'src/tests/phase2/bootstrapConsolidation.red.spec.ts',
  'src/tests/phase2/feedbackSubmitOnly.red.spec.ts',
  'src/tests/phase2/manifestDispatchActions.red.spec.ts',
].map(normalizeSpecPath));
const isolatedSpecs = [
  'src/tests/dashboardApiRateLimit.spec.ts',
  'src/tests/dashboardSyntheticSecurity.spec.ts',
  'src/tests/securityHeaders.spec.ts',
  'src/tests/syntheticActivityLogging.spec.ts',
  'src/tests/toolLogging.spec.ts',
  'src/tests/validateSecurityHeadersTls.spec.ts',
  'src/tests/unit/dashboard/instructions.archive.routes.spec.ts',
  'src/tests/unit/embeddingsStatusRoute.spec.ts',
  'src/tests/unit/httpTransport.spec.ts',
  'src/tests/unit/npmPackReadiness.spec.ts',
  'src/tests/unit/serverIndex.p1.spec.ts',
  'src/tests/unit/transportScenarios.spec.ts',
  'src/tests/unit/issue592UndeclaredToolCallability.spec.ts',
].map(normalizeSpecPath);
const fastSpecs = allSpecs.filter(f => !isSlowTest(f) && !configExcludedSpecs.has(normalizeSpecPath(f)) && !isolatedSpecs.includes(normalizeSpecPath(f)));

if (fastSpecs.length === 0) {
  console.error('No fast tests discovered (unexpected)');
  process.exit(1);
}

// Provide summary output
console.log(`Discovered ${allSpecs.length} spec files; excluding ${slowTests.length} slow and ${configExcludedSpecs.size} config-excluded => running ${fastSpecs.length + isolatedSpecs.length} fast specs.`);

// Safety net: ensure none of the enumerated fast specs are actually tagged slow (defensive in case list drift)
const leaked = fastSpecs.filter(f => slowTests.includes(normalizeSpecPath(f)));
if (leaked.length) {
  console.error('[test:fast] Detected slow tests leaking into fast set:', leaked);
  process.exit(1);
}

const childEnv = {
  ...process.env,
  INDEX_SERVER_MUTATION: '1',
  INDEX_SERVER_DASHBOARD: '0',
  INDEX_SERVER_AUTO_BACKUP: '0',
};
const vitestBin = path.resolve('node_modules', 'vitest', 'vitest.mjs');

function runVitest(specs, { fileParallelism = false } = {}) {
  const args = [vitestBin, 'run'];
  if (!fileParallelism) args.push('--fileParallelism=false');
  args.push(...specs);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: childEnv });
    child.on('exit', code => resolve(code ?? 1));
  });
}

// Stateful HTTP/TLS fixtures run first, each in its own process. They bind real
// sockets and are sensitive to machine load, so they must not run while the main
// 300-file process is still tearing down.
//
// The lane used to `process.exit()` on the first isolated failure, so the
// 355-file main batch never started and the visible result was "1 failed, 23
// passed" with zero evidence about the other ~3,400 tests (#576). A lane that
// hides the suite it exists to run is worse than a slow one: failures are
// collected and reported together, and the exit code is decided at the end.
const failures = [];

for (const spec of isolatedSpecs) {
  console.log(`[test:fast] Running stateful spec in a fresh process: ${spec}`);
  const isolatedCode = await runVitest([spec]);
  if (isolatedCode !== 0) failures.push({ stage: `isolated: ${spec}`, code: isolatedCode });
}

// The main batch runs with file parallelism. `--fileParallelism=false` applied
// to it only because this helper was shared with the isolated stage, which is
// single-spec and so unaffected by the flag either way. The stateful HTTP/TLS
// specs that actually need isolation already run in their own processes above,
// which is what makes this safe.
//
// Measured: 559.8s serial -> 193.0s parallel, with byte-identical results
// (360 files passed / 3 skipped, 3501 tests passed / 19 skipped).
//
// This is a SPEED change, not a fix for the `Timeout calling "onTaskUpdate"`
// harness error in #576. That error survived the 2.9x reduction in wall-clock,
// which falsifies the duration hypothesis. See docs/testing_strategy.md.
const mainCode = await runVitest(fastSpecs, { fileParallelism: true });
if (mainCode !== 0) failures.push({ stage: `main batch (${fastSpecs.length} specs)`, code: mainCode });

if (failures.length) {
  console.error(`\n[test:fast] FAILED — ${failures.length} stage(s):`);
  for (const f of failures) console.error(`  - ${f.stage} (exit ${f.code})`);
  console.error('\nEvery stage ran; the list above is complete, not the first failure.');
  process.exit(failures[0].code);
}

console.log(`[test:fast] PASS — ${isolatedSpecs.length} isolated spec(s) + ${fastSpecs.length} main specs, all stages run.`);
