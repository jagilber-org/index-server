#!/usr/bin/env node
// Fail the build if any test files contain skipped tests (describe.skip / test.skip / it.skip or `.skip(` on a call)
// Allow explicit opt-out by adding the marker comment SKIP_OK on the same line for legitimate dynamic skips.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const TEST_DIR = join(ROOT, 'src', 'tests');
const offenders = [];
const patterns = [ /describe\.skip\s*\(/, /it\.skip\s*\(/, /test\.skip\s*\(/, /\.skip\s*\(/ ];

function walk(dir){
  for(const entry of readdirSync(dir)){
    const full = join(dir, entry);
    const st = statSync(full);
    if(st.isDirectory()) walk(full); else if(/\.spec\.ts$/.test(entry)) scan(full);
  }
}

function scan(file){
  const lines = readFileSync(file,'utf8').split(/\r?\n/);
  lines.forEach((line, idx)=>{
    if(line.includes('SKIP_OK')) return; // explicit allow marker
    if(patterns.some(p=> p.test(line))){
      offenders.push(`${file}:${idx+1}: ${line.trim()}`);
    }
  });
}

try {
  walk(TEST_DIR);
} catch (e){
  console.error('[skip-guard] ERROR scanning tests:', e.message);
  process.exit(1);
}

if(offenders.length){
  console.error('\n[skip-guard] Detected skipped tests (forbidden):');
  for(const o of offenders) console.error('  -', o);
  console.error('\nAdd SKIP_OK on the line if a temporary skip is absolutely required (prefer fixing instead).');
  process.exit(2);
} else {
  console.log('[skip-guard] OK: no skipped tests found.');
}
