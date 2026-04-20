#!/usr/bin/env node
// Validate all instruction JSON files contain governance fields after bootstrap.
import fs from 'fs';
import path from 'path';

const required = ['version','status','owner','priorityTier','classification','lastReviewedAt','nextReviewDue','changeLog','semanticSummary'];
const dir = path.join(process.cwd(),'instructions');
let failures = 0;
const reports = [];
if(!fs.existsSync(dir)){
  console.error('instructions directory missing');
  process.exit(1);
}
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))){
  if(f==='gates.json') continue;
  // Skip metadata files that are not instructions
  if(f.startsWith('_') || f.startsWith('bootstrap.')) continue;
  const full = path.join(dir,f);
  try {
    const raw = JSON.parse(fs.readFileSync(full,'utf8'));
    const missing = required.filter(k => !(k in raw));
    if(missing.length){
      failures++;
      reports.push({ file:f, missing });
    }
  } catch(e){
    failures++;
    reports.push({ file:f, error: e.message || String(e) });
  }
}
if(failures){
  console.error('governance validation failed', JSON.stringify(reports,null,2));
  process.exit(2);
} else {
  console.log('governance validation passed');
}
