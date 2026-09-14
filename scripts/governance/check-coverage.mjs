#!/usr/bin/env node
/* eslint-disable */
// Coverage gate with dual-threshold ratchet strategy.
// Historical context:
//   Original static gate at 80% created persistent noise (baseline ~46%).
//   Strategy: adopt realistic hard minimum + advisory target, raised only after
//   sustained improvement.
//
// Thresholds live in coverage-thresholds.json -- ONE place (#584). They used to
// be passed as env vars from package.json, which failed twice over:
//   1. `coverage:ci` set COVERAGE_HARD_MIN / COVERAGE_TARGET while this script
//      read INDEX_SERVER_COVERAGE_HARD_MIN / _TARGET. The names never matched,
//      so the CI values were silently ignored.
//   2. Even matched names would not have worked. The script was invoked as
//      `cross-env VARS npm run coverage:core && ... && node check-coverage.mjs`
//      -- cross-env scopes its variables to the command it wraps, so the third
//      command in the chain never saw them at all.
// The header used to claim "CI always sets explicit env values". It never did.
//
// Env still overrides, for ad-hoc local runs and for falsifying this gate.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const thresholdsFile = path.join(here, 'coverage-thresholds.json');

const reportPath = 'coverage/coverage-final.json';
if(!fs.existsSync(reportPath)){
  // Previously `process.exit(0)` with "skipping gate". A coverage gate that
  // passes when the coverage run produced nothing cannot fail for the one
  // reason it exists -- if report generation breaks, the gate goes green.
  // Opt out explicitly when that is genuinely intended.
  if(process.env.INDEX_SERVER_COVERAGE_ALLOW_MISSING === '1'){
    console.error('[coverage-check] coverage-final.json missing; skipped (INDEX_SERVER_COVERAGE_ALLOW_MISSING=1)');
    process.exit(0);
  }
  console.error(`[coverage-check] FAIL ${reportPath} missing -- the coverage run produced no report.`);
  console.error('[coverage-check] This is a broken coverage run, not a passing gate.');
  console.error('[coverage-check] Set INDEX_SERVER_COVERAGE_ALLOW_MISSING=1 only if a report is genuinely not expected.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(reportPath,'utf8'));
// IstanbulJSON: each file has statementMap, s (counts), branchMap, b (counts) etc.
// We'll compute lines from statement counts as approximation (already used by report).
let covered=0, totalLines=0;
for(const file of Object.keys(data)){
  const f = data[file];
  if(!f || !f.statementMap) continue;
  const sCounts = f.s || {};
  for(const key of Object.keys(sCounts)){
    totalLines++;
    if(sCounts[key] > 0) covered++;
  }
}
if(totalLines === 0){
  // Same class of hole as a missing report: an empty report yields pct=0, and a
  // 0 >= 0 comparison would have looked like a pass under a 0 threshold.
  console.error('[coverage-check] FAIL coverage report contains no statements -- nothing was measured.');
  process.exit(1);
}
const pct = (covered/totalLines)*100;

// Thresholds: file is the single source of truth, env overrides for ad-hoc runs.
//   INDEX_SERVER_COVERAGE_HARD_MIN  failing threshold
//   INDEX_SERVER_COVERAGE_TARGET    advisory target (warns, does not fail)
let fileThresholds = {};
if(fs.existsSync(thresholdsFile)){
  fileThresholds = JSON.parse(fs.readFileSync(thresholdsFile,'utf8'));
} else {
  console.error(`[coverage-check] FAIL ${thresholdsFile} missing -- thresholds are not defined anywhere.`);
  process.exit(1);
}
const hardMin = Number(process.env.INDEX_SERVER_COVERAGE_HARD_MIN ?? fileThresholds.hardMin);
const target = Number(process.env.INDEX_SERVER_COVERAGE_TARGET ?? fileThresholds.target ?? hardMin);
if(!Number.isFinite(hardMin)){
  console.error('[coverage-check] FAIL hardMin is not a number; check coverage-thresholds.json.');
  process.exit(1);
}
if(pct < hardMin){
  console.error(`[coverage-check] FAIL lines=${pct.toFixed(2)} < hardMin=${hardMin}`);
  process.exit(1);
}
if(pct < target){
  console.warn(`[coverage-check] WARN lines=${pct.toFixed(2)} < target=${target} (>= hardMin=${hardMin})`);
  process.exitCode = 0;
} else {
  console.log(`[coverage-check] PASS lines=${pct.toFixed(2)} >= target=${target}`);
}
