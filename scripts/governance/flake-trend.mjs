#!/usr/bin/env node
/**
 * Flake Trend Aggregator
 *
 * Purpose:
 *  - Append current run's flake sentinel classification into a historical log
 *  - Maintain rolling window (default 50 entries) for trend analysis
 *  - Produce aggregate metrics snapshot for quick consumption by CI or dashboards
 *
 * Inputs:
 *  - test-results/flaky-tests.json (produced by flake-sentinel)
 *  - test-results/results.json (optional; for total test file count context)
 * Environment:
 *  - FLAKE_TREND_MAX (optional) max history length (default 50)
 *  - GITHUB_RUN_ID / GITHUB_SHA / GITHUB_REF for provenance (auto-captured if present)
 *
 * Outputs:
 *  - test-results/flake-history.jsonl (JSON lines, one per run)
 *  - test-results/flake-trend-summary.json (aggregate metrics over window)
 *
 * Exit Code:
 *  - Always 0 (non-enforcing; purely observational)
 */
import fs from 'fs';

const FLAKE_TESTS_PATH = 'test-results/flaky-tests.json';
const RESULTS_PATH = 'test-results/results.json';
const HISTORY_PATH = 'test-results/flake-history.jsonl';
const SUMMARY_PATH = 'test-results/flake-trend-summary.json';
const MAX = parseInt(process.env.FLAKE_TREND_MAX || '50', 10);

function log(msg){ process.stdout.write(`[flake-trend] ${msg}\n`); }

if(!fs.existsSync(FLAKE_TESTS_PATH)){
  log('No flaky-tests.json present; nothing to record. Exiting.');
  process.exit(0);
}

let flakyData;
try {
  flakyData = JSON.parse(fs.readFileSync(FLAKE_TESTS_PATH, 'utf-8'));
} catch(e){
  log(`Failed parsing ${FLAKE_TESTS_PATH}: ${e}`);
  process.exit(0);
}

let resultsData = {};
if(fs.existsSync(RESULTS_PATH)){
  try {
    resultsData = JSON.parse(fs.readFileSync(RESULTS_PATH,'utf-8'));
  } catch (e) {
    // Non-fatal: results context is optional
    log(`Warning: unable to parse ${RESULTS_PATH}: ${e.message}`);
  }
}

const timestamp = new Date().toISOString();
const entry = {
  ts: timestamp,
  sha: process.env.GITHUB_SHA || null,
  ref: process.env.GITHUB_REF || null,
  runId: process.env.GITHUB_RUN_ID || null,
  flakyCount: (flakyData.flaky || []).length,
  hardFailCount: (flakyData.hard || []).length,
  reruns: flakyData.reruns || 0,
  flakyFiles: (flakyData.flaky || []).map(f=>f.file),
  hardFiles: (flakyData.hard || []).map(f=>f.file),
  totalTests: resultsData.totalTests || null,
  totalFailedInitial: resultsData.totalFailed || null
};

fs.mkdirSync('test-results', { recursive: true });
fs.appendFileSync(HISTORY_PATH, JSON.stringify(entry) + '\n');

// Load back rolling window
const lines = fs.readFileSync(HISTORY_PATH, 'utf-8').trim().split(/\r?\n/).filter(Boolean);
const recent = lines.slice(-MAX).map(l=>{ try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const aggregate = {
  window: recent.length,
  maxWindow: MAX,
  from: recent[0]?.ts || null,
  to: recent[recent.length-1]?.ts || null,
  flakyRuns: recent.filter(r=> r.flakyCount>0).length,
  totalFlakyOccurrences: recent.reduce((a,r)=> a + r.flakyCount, 0),
  totalHardFailures: recent.reduce((a,r)=> a + r.hardFailCount, 0),
  distinctFlakyFiles: Array.from(new Set(recent.flatMap(r=> r.flakyFiles))),
  persistentHardFiles: Array.from(new Set(recent.flatMap(r=> r.hardFiles))),
  recentEntries: recent.slice(-5) // last 5 for quick glance
};

fs.writeFileSync(SUMMARY_PATH, JSON.stringify(aggregate, null, 2));

log(`Recorded flake stats. Window size=${aggregate.window}; flakyRuns=${aggregate.flakyRuns}; distinctFlakyFiles=${aggregate.distinctFlakyFiles.length}`);
process.exit(0);
