#!/usr/bin/env node
/**
 * baseline-sentinel.mjs
 * Maintains and verifies a sentinel SHA256 hash of INTERNAL-BASELINE.md.
 * Usage:
 *  node scripts/baseline-sentinel.mjs update   # updates stored hash
 *  node scripts/baseline-sentinel.mjs verify   # exits non-zero if hash mismatch
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const baselineFile = 'INTERNAL-BASELINE.md';
const sentinelFile = '.baseline.sentinel';

function hash(content){
  return createHash('sha256').update(content,'utf8').digest('hex');
}

function update(){
  if(!existsSync(baselineFile)){
    console.error('Baseline file missing; cannot update sentinel');
    process.exit(1);
  }
  const h = hash(readFileSync(baselineFile,'utf8'));
  writeFileSync(sentinelFile, h + '\n', 'utf8');
  console.log('Baseline sentinel updated:', h);
}

function verify(){
  if(!existsSync(baselineFile) || !existsSync(sentinelFile)){
    console.error('Missing baseline or sentinel file');
    process.exit(1);
  }
  const expected = readFileSync(sentinelFile,'utf8').trim();
  const current = hash(readFileSync(baselineFile,'utf8'));
  if(expected !== current){
    console.error('Baseline sentinel mismatch. Expected', expected, 'current', current);
    console.error('Require formal BASELINE-CR: change request to refresh sentinel.');
    process.exit(2);
  }
  console.log('Baseline sentinel verify: OK');
}

const mode = process.argv[2];
if(mode === 'update') update();
else if(mode === 'verify') verify();
else {
  console.error('Usage: node scripts/baseline-sentinel.mjs <update|verify>');
  process.exit(1);
}
