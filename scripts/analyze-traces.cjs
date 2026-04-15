#!/usr/bin/env node
// Trace log analyzer (CommonJS) - avoids TS ESLint project parsing issues.
const fs = require('fs');
const path = require('path');

function findTraceDir(){
  const candidates = [path.join(process.cwd(),'logs','trace'), path.join(process.cwd(),'logs')];
  for(const c of candidates){ try { if(fs.existsSync(c) && fs.statSync(c).isDirectory()) return c; } catch {/*ignore*/} }
  return null;
}

function listTraceFiles(dir){
  try { return fs.readdirSync(dir).filter(f=> f.startsWith('trace-') && (f.endsWith('.jsonl') || /\.jsonl\.\d+$/.test(f))).map(f=> path.join(dir,f)); } catch { return []; }
}

function parseLine(line){
  const m = line.match(/^(\[[^\]]+\])\s+(\{.*)$/);
  if(!m) return null;
  const label = m[1];
  try { const rec = JSON.parse(m[2]); return { label, rec }; } catch { return null; }
}

function analyzeFile(file){
  const content = fs.readFileSync(file,'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  const metrics = { file, totalLines: lines.length, parsed:0, labels:new Map(), byId:new Map(), anomalies:[], repairs:0, lateMaterializeGet:0, lateMaterializeAdd:0, dirs:new Set(), firstTs:null, lastTs:null };
  for(const line of lines){
    const parsed = parseLine(line);
    if(!parsed) continue;
    metrics.parsed++;
    const { label, rec } = parsed;
    const ts = rec?.t || Date.parse(rec?.ts || '') || null;
    if(ts){ if(!metrics.firstTs || ts < metrics.firstTs) metrics.firstTs = ts; if(!metrics.lastTs || ts > metrics.lastTs) metrics.lastTs = ts; }
    metrics.labels.set(label, (metrics.labels.get(label)||0)+1);
    const dir = rec?.data?.dir || rec?.data?.directory || rec?.data?.root; if(dir && typeof dir === 'string') metrics.dirs.add(dir);
    const id = rec?.data?.id; if(id && typeof id === 'string'){
      let arr = metrics.byId.get(id); if(!arr){ arr=[]; metrics.byId.set(id, arr); }
      arr.push({ label, t: ts, rec });
      if(label.includes('trace:add:skip') && rec?.data?.repaired) metrics.repairs++;
      if(label.includes('trace:get:late-materialize') && rec?.data?.repaired) metrics.lateMaterializeGet++;
      if(label.includes('trace:add:skip') && rec?.data?.repaired) metrics.lateMaterializeAdd++;
    }
  }
  for(const [id, events] of metrics.byId){
    const skipEvt = events.find(e=> e.label.includes('trace:add:skip'));
    if(skipEvt){
      const getMiss = events.find(e=> e.label.includes('trace:get') && !e.label.includes('late-materialize') && e.rec?.data?.found===false);
      if(getMiss && skipEvt.t && getMiss.t && getMiss.t >= skipEvt.t){
        const deltaMs = getMiss.t - skipEvt.t; if(deltaMs < 2000){ metrics.anomalies.push({ id, firstSkipTs: skipEvt.t, firstGetNotFoundTs: getMiss.t, deltaMs }); }
      }
    }
  }
  return metrics;
}

function formatDuration(ms){ return (ms/1000).toFixed(3)+'s'; }

function summarize(m){
  const durationMs = m.firstTs && m.lastTs ? (m.lastTs - m.firstTs) : 0;
  const topLabels = [...m.labels.entries()].sort((a,b)=> b[1]-a[1]).slice(0,10);
  return { file:m.file, totalLines:m.totalLines, parsed:m.parsed, durationMs, duration:formatDuration(durationMs), labelTop10:topLabels, distinctLabels:m.labels.size, dirs:[...m.dirs], anomalyCount:m.anomalies.length, anomalies:m.anomalies.slice(0,10), skipRepairs:m.repairs, lateMaterializeGet:m.lateMaterializeGet, lateMaterializeAdd:m.lateMaterializeAdd };
}

function main(){
  const args = process.argv.slice(2);
  let files = []; let limit=1; let jsonOut=false;
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--file'){ files.push(args[++i]); }
    else if(a==='--latest'){ const dir=findTraceDir(); if(dir){ const all=listTraceFiles(dir); all.sort((a,b)=> fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); if(all[0]) files.push(all[0]); } }
    else if(a==='--dir'){ const d=args[++i]; const all=listTraceFiles(d); all.sort((a,b)=> fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); files.push(...all); }
    else if(a==='--limit'){ limit = parseInt(args[++i],10)||limit; }
    else if(a==='--json'){ jsonOut=true; }
  }
  if(!files.length){ console.error('No trace files selected. Use --latest or --file.'); process.exit(1); }
  files = files.slice(0,limit);
  const results = files.map(f=> summarize(analyzeFile(f)));
  if(jsonOut){ console.log(JSON.stringify({ analyzed: results.length, results }, null, 2)); }
  else {
    for(const r of results){
      console.log('=== Trace Summary ===');
      console.log('file:', r.file);
      console.log('dirs:', r.dirs.join(',')||'(none)');
      console.log('lines(parsed/total):', r.parsed + '/' + r.totalLines);
      console.log('duration:', r.duration);
      console.log('distinctLabels:', r.distinctLabels);
      console.log('skipRepairs:', r.skipRepairs, 'lateMaterializeAdd:', r.lateMaterializeAdd, 'lateMaterializeGet:', r.lateMaterializeGet);
      console.log('anomalyCount:', r.anomalyCount);
      if(r.anomalies.length){ console.log('anomalies(sample):', r.anomalies); }
      console.log('topLabels:', r.labelTop10.map(([l,c])=> l+'='+c).join(', '));
    }
  }
}

if(require.main === module){ main(); }
