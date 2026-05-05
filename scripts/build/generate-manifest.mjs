#!/usr/bin/env node
// Generate Index manifest including body hashes, governance hash, and timestamp.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const instructionsDir = path.join(process.cwd(),'instructions');
const snapshotDir = path.join(process.cwd(),'snapshots');
if(!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir,{recursive:true});

function isInstructionFile(fileName){
  if(!fileName.endsWith('.json')) return false;
  if(fileName === 'gates.json') return false;
  if(fileName.startsWith('_')) return false;
  if(fileName.startsWith('bootstrap.')) return false;
  return true;
}

const entries = [];
for(const f of (fs.existsSync(instructionsDir)? fs.readdirSync(instructionsDir): []).filter(isInstructionFile)){
  const full = path.join(instructionsDir,f);
  try {
    const raw = JSON.parse(fs.readFileSync(full,'utf8'));
    const bodyHash = crypto.createHash('sha256').update(raw.body||'', 'utf8').digest('hex');
    if(!raw.id) continue;
    entries.push({ id: raw.id, sourceHash: raw.sourceHash, bodyHash, owner: raw.owner||'unowned', priorityTier: raw.priorityTier||'P4', version: raw.version||'1.0.0' });
  } catch { /* skip */ }
}
entries.sort((a,b)=> a.id.localeCompare(b.id));
// Governance hash (metadata projection only)
function project(e){
  return { id:e.id, owner:e.owner, priorityTier:e.priorityTier, version:e.version };
}
const govHash = crypto.createHash('sha256');
for(const e of entries){ govHash.update(JSON.stringify(project(e))+'\n'); }
const governanceHash = govHash.digest('hex');
const manifest = { generatedAt: new Date().toISOString(), count: entries.length, governanceHash, entries };
fs.writeFileSync(path.join(snapshotDir,'index-manifest.json'), JSON.stringify(manifest,null,2));
console.log('manifest generated', manifest.count, 'entries');
