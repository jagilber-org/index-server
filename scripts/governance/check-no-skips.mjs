#!/usr/bin/env node
// Fail the build if any test files contain skipped tests (describe.skip / test.skip / it.skip, `.skip(`, `.skipIf(`, or `.runIf(` on a call)
// Allow explicit opt-out by adding the marker comment SKIP_OK on the same line for legitimate dynamic skips.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const TEST_DIR = join(ROOT, 'src', 'tests');
const offenders = [];
let waivedCount = 0;
const patterns = [ /describe\.skip(If)?\s*\(/, /it\.skip(If)?\s*\(/, /test\.skip(If)?\s*\(/, /\.skip(If)?\s*\(/, /\.runIf\s*\(/ ];

function walk(dir){
  for(const entry of readdirSync(dir)){
    const full = join(dir, entry);
    const st = statSync(full);
    if(st.isDirectory()) walk(full); else if(/\.spec\.ts$/.test(entry)) scan(full);
  }
}

// The waiver must appear in a COMMENT on the line, not anywhere on it (#582).
// The old `line.includes('SKIP_OK')` meant a test whose *title* mentioned the
// marker waived itself -- `it.skip('a skip with no SKIP_OK waiver', ...)` was
// scanned and passed. Measured across src/tests: all 69 existing waivers are
// `// SKIP_OK` comments, so tightening this waives nothing that was waived
// before.
function isWaived(line){
  const marker = line.indexOf('SKIP_OK');
  if(marker === -1) return false;
  const lineComment = line.indexOf('//');
  const blockComment = line.indexOf('/*');
  const commentStart = [lineComment, blockComment].filter(i => i !== -1).sort((a,b)=>a-b)[0];
  return commentStart !== undefined && commentStart < marker;
}

function scan(file){
  const lines = readFileSync(file,'utf8').split(/\r?\n/);
  lines.forEach((line, idx)=>{
    if(isWaived(line)){ waivedCount++; return; } // explicit allow marker
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
  console.log(`[skip-guard] OK: 0 unwaived skip sites found (${waivedCount} waived via SKIP_OK).`);
}
