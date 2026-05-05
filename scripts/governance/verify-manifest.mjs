#!/usr/bin/env node
// Verify current instructions against generated manifest file.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const manifestPath = path.join(process.cwd(),'snapshots','index-manifest.json');
if(!fs.existsSync(manifestPath)){
  console.error('manifest missing');
  process.exit(2);
}
let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath,'utf8')); } catch{
  console.error('manifest invalid json');
  process.exit(3);
}
const map = new Map((manifest.entries||[]).map(e=>[e.id,e]));
const instructionsDir = path.join(process.cwd(),'instructions');

function isGovernanceSeed(fileName, full){
  const lowerBase = fileName.toLowerCase();
  if(/^(000-bootstrapper|001-lifecycle-bootstrap)/.test(lowerBase)) return true;
  if(lowerBase.includes('.governance.')) return true;
  if(lowerBase === 'constitution.json') return true;
  try {
    return /__GOVERNANCE_SEED__/.test(fs.readFileSync(full, { encoding: 'utf8', flag: 'r' }).slice(0, 200));
  } catch {
    return false;
  }
}

function isInstructionFile(fileName){
  if(!fileName.endsWith('.json')) return false;
  if(fileName === 'gates.json') return false;
  if(fileName.startsWith('_')) return false;
  if(fileName.startsWith('bootstrap.')) return false;
  return true;
}

let drift = 0; const diffs=[];
for(const f of (fs.existsSync(instructionsDir)? fs.readdirSync(instructionsDir): []).filter(isInstructionFile)){
  const full = path.join(instructionsDir,f);
  if(isGovernanceSeed(f, full)) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(full,'utf8'));
    if(!(typeof raw.id === 'string' && typeof raw.title === 'string' && typeof raw.body === 'string')) continue;
    const bodyHash = crypto.createHash('sha256').update(raw.body||'', 'utf8').digest('hex');
    if(!raw.id) continue;
    const entry = map.get(raw.id);
    if(!entry){ drift++; diffs.push({ id: raw.id, change: 'added' }); continue; }
    if(entry.sourceHash !== raw.sourceHash || entry.bodyHash !== bodyHash){ drift++; diffs.push({ id: raw.id, change: 'hash-mismatch' }); }
  } catch { /* skip */ }
}
for(const id of map.keys()){
  const file = path.join(instructionsDir, id + '.json');
  if(!fs.existsSync(file)){ drift++; diffs.push({ id, change: 'removed' }); }
}
if(drift){
  console.error('manifest drift detected', JSON.stringify({ drift, diffs },null,2));
  process.exit(5);
}
console.log('manifest verification passed');
