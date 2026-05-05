#!/usr/bin/env node
// Compare the two most recent performance baseline files in data/ and report drift.
// Usage: node scripts/perf-compare.mjs [--thresholdPct=20] [--primaryMetric=p95]
// Exits non-zero if any monitored tool exceeds threshold regression.

import fs from 'fs';
import path from 'path';

function readBaselines(){
  const dir = path.join(process.cwd(),'data');
  if(!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f=> f.startsWith('performance-baseline-') && f.endsWith('.json'));
  const metas = [];
  for(const f of files){
    try { const full = path.join(dir,f); const raw = JSON.parse(fs.readFileSync(full,'utf8')); metas.push({ file: full, ts: raw.timestamp, data: raw }); } catch { /* ignore bad file */ }
  }
  metas.sort((a,b)=> (a.ts||'').localeCompare(b.ts||''));
  return metas;
}

function pctChange(oldV, newV){ if(oldV===0) return newV===0?0:Infinity; return ((newV-oldV)/oldV)*100; }

function main(){
  const args = process.argv.slice(2);
  let thresholdPct = 20; // default 20% regression tolerance
  let primaryMetric = 'p95';
  for(const a of args){
    if(a.startsWith('--thresholdPct=')) thresholdPct = parseFloat(a.split('=')[1]);
    if(a.startsWith('--primaryMetric=')) primaryMetric = a.split('=')[1];
  }
  const baselines = readBaselines();
  if(baselines.length < 2){
    console.log('[perf-compare] Need at least two baseline files to compare. Skipping.');
    return;
  }
  const prev = baselines[baselines.length-2];
  const latest = baselines[baselines.length-1];
  console.log('[perf-compare] Previous:', prev.file);
  console.log('[perf-compare] Latest  :', latest.file);
  const prevSamples = prev.data.samples || {};
  const latestSamples = latest.data.samples || {};
  const tools = Array.from(new Set([...Object.keys(prevSamples), ...Object.keys(latestSamples)])).sort();
  let regressions = 0;
  const report = [];
  for(const t of tools){
    const p = prevSamples[t];
    const l = latestSamples[t];
    if(!p || !l){
      report.push({ tool: t, status:'missing', note: !p? 'no-prev':'no-latest' });
      continue;
    }
    const oldV = p[primaryMetric];
    const newV = l[primaryMetric];
    const deltaPct = pctChange(oldV,newV);
    const regressed = deltaPct > thresholdPct;
    if(regressed) regressions++;
    report.push({ tool: t, metric: primaryMetric, old: oldV, new: newV, deltaPct: +deltaPct.toFixed(2), status: regressed? 'REGRESSION':'ok' });
  }
  console.log('[perf-compare] Metric:', primaryMetric, 'Threshold %:', thresholdPct);
  for(const r of report){
    if(r.status==='missing') console.log(`[perf][${r.tool}] missing (${r.note})`);
    else console.log(`[perf][${r.tool}] ${r.status} old=${r.old} new=${r.new} deltaPct=${r.deltaPct}`);
  }
  const summary = { thresholdPct, primaryMetric, regressions, compared: report.length, timestamp: new Date().toISOString(), files: { prev: prev.file, latest: latest.file }, report };
  const outFile = path.join(process.cwd(),'data', 'performance-drift-latest.json');
  fs.writeFileSync(outFile, JSON.stringify(summary,null,2));
  console.log('[perf-compare] wrote', outFile);
  if(regressions>0){
    console.error(`[perf-compare] FAIL: ${regressions} regressions exceed ${thresholdPct}% threshold.`);
    process.exit(2);
  } else {
    console.log('[perf-compare] PASS: no regressions.');
  }
}

main();
