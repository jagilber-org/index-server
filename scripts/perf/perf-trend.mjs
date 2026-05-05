#!/usr/bin/env node
// Build performance-trend.json summarizing evolution of primary metrics over time.
// Usage: node scripts/perf-trend.mjs [--metric=p95]

import fs from 'fs';
import path from 'path';

function loadBaselines(){
  const dir = path.join(process.cwd(),'data');
  if(!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f=> f.startsWith('performance-baseline-') && f.endsWith('.json'))
    .map(f=> path.join(dir,f))
    .map(f=> { try { const d = JSON.parse(fs.readFileSync(f,'utf8')); return { file:f, ts: d.timestamp, data:d }; } catch { return null; } })
    .filter(Boolean)
    .sort((a,b)=> (a.ts||'').localeCompare(b.ts||''));
}

function main(){
  const args = process.argv.slice(2);
  let metric = 'p95';
  for(const a of args){ if(a.startsWith('--metric=')) metric = a.split('=')[1]; }
  const baselines = loadBaselines();
  if(!baselines.length){ console.log('[perf-trend] no baselines found'); return; }
  const toolSet = new Set();
  for(const b of baselines){ for(const t of Object.keys(b.data.samples||{})){ toolSet.add(t); } }
  const tools = Array.from(toolSet).sort();
  const series = {};
  for(const t of tools){ series[t] = []; }
  for(const b of baselines){
    for(const t of tools){
      const s = b.data.samples?.[t];
      if(s && s[metric] !== undefined){
        series[t].push({ ts: b.ts, value: s[metric] });
      }
    }
  }
  const out = { generatedAt: new Date().toISOString(), metric, points: series, count: baselines.length };
  const file = path.join(process.cwd(),'data','performance-trend.json');
  fs.writeFileSync(file, JSON.stringify(out,null,2));
  console.log('[perf-trend] wrote', file, 'metric='+metric, 'baselines='+baselines.length);
}

main();
