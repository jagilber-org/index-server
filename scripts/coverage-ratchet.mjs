#!/usr/bin/env node
/**
 * Coverage Ratchet
 * Compares current coverage summary (from coverage/coverage-final.json) against stored baseline file.
 * Baseline file: coverage-baseline.json { "statements": number, "branches": number, "functions": number, "lines": number }
 * Fails build if any metric drops below baseline - ALLOWED_DROP tolerance (default 0) or below HARD_MIN if provided via env.
 * If improved beyond +IMPROVEMENT_THRESHOLD (default 0.25) for all metrics, updates baseline file (unless READONLY) and exits 0.
 */
import fs from 'fs';

const BASELINE_PATH = 'coverage-baseline.json';
const SUMMARY_PATH = 'coverage/coverage-final.json';
const IMPROVEMENT_THRESHOLD = parseFloat(process.env.COVERAGE_RATCHET_THRESHOLD || '0.25');
const ALLOWED_DROP = parseFloat(process.env.COVERAGE_ALLOWED_DROP || '0');
const HARD_MIN = parseFloat(process.env.INDEX_SERVER_COVERAGE_HARD_MIN || '0');
const READONLY = process.env.COVERAGE_READONLY === '1';

function log(m){ process.stdout.write(`[coverage-ratchet] ${m}\n`); }

if(!fs.existsSync(SUMMARY_PATH)){
  log(`Missing coverage summary at ${SUMMARY_PATH}`);
  process.exit(1);
}
const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH,'utf-8'))['total'];
if(!summary){
  log('Invalid coverage-final.json structure: no total block.');
  process.exit(1);
}
const metrics = {
  statements: summary.statements.pct,
  branches: summary.branches.pct,
  functions: summary.functions.pct,
  lines: summary.lines.pct
};

let baseline;
if(fs.existsSync(BASELINE_PATH)){
  baseline = JSON.parse(fs.readFileSync(BASELINE_PATH,'utf-8'));
  log(`Loaded baseline: ${JSON.stringify(baseline)}`);
} else {
  log('No existing baseline detected. Creating initial baseline.');
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(metrics, null, 2));
  process.exit(0);
}

// Evaluate drop / improvement
const drops = [];
const improvements = [];
for(const k of Object.keys(metrics)){
  const current = metrics[k];
  const base = baseline[k];
  if(typeof base !== 'number') continue;
  if(current + ALLOWED_DROP < base){
    drops.push({ metric: k, base, current});
  } else if(current > base + IMPROVEMENT_THRESHOLD){
    improvements.push({ metric: k, base, current});
  }
  if(HARD_MIN && current < HARD_MIN){
    drops.push({ metric: k, base: base ?? 'n/a', current, hardMin: HARD_MIN });
  }
}

if(drops.length){
  log(`Coverage regression detected: ${JSON.stringify(drops)}`);
  process.exit(2);
}

if(improvements.length){
  if(READONLY){
    log(`Improvements detected but READONLY set; not updating baseline: ${JSON.stringify(improvements)}`);
  } else {
    const newBaseline = {...baseline};
    for(const imp of improvements){ newBaseline[imp.metric] = metrics[imp.metric]; }
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2));
    log(`Baseline updated with improvements: ${improvements.map(i=>i.metric).join(', ')}`);
  }
}
log('Coverage ratchet success.');
process.exit(0);
