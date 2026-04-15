#!/usr/bin/env node
/* eslint-disable */
// Coverage gate with dual-threshold ratchet strategy.
// Historical context:
//   Original static gate at 80% created persistent noise (baseline ~46%).
//   Strategy: adopt realistic hard minimum (current ratchet 50%) + advisory target (60%).
//   We only raise COVERAGE_HARD_MIN after sustained improvement (>= target for a period or
//   manual ratchet decision post new lightweight tests). This script reads env vars so CI
//   can evolve thresholds without code changes.
// Defaults purposely conservative here (50) but CI always sets explicit env values.
import fs from 'fs';

const reportPath = 'coverage/coverage-final.json';
if(!fs.existsSync(reportPath)){
  console.error('[coverage-check] coverage-final.json missing; skipping gate');
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(reportPath,'utf8'));
let total = { lines:{ covered:0, pct:0, total:0 } };
// Istanbul JSON: each file has statementMap, s (counts), branchMap, b (counts) etc.
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
const pct = totalLines? (covered/totalLines)*100: 0;
// Support dual gate via env:
// INDEX_SERVER_COVERAGE_HARD_MIN: failing threshold (default 50; CI should override explicitly)
// INDEX_SERVER_COVERAGE_TARGET: advisory target (logs warning if not met)
const hardMin = Number(process.env.INDEX_SERVER_COVERAGE_HARD_MIN || 50);
const target = Number(process.env.INDEX_SERVER_COVERAGE_TARGET || hardMin);
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
