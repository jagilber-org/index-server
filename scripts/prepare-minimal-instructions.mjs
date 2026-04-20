#!/usr/bin/env node
/**
 * prepare-minimal-instructions.mjs
 *
 * Creates a lightweight copy of the instructions directory containing only a
 * deterministic minimal subset required for multi‑client reproduction tests.
 * This avoids modifying any test code while allowing performance runs with a
 * smaller Index when desired.
 *
 * Usage:
 *   node scripts/prepare-minimal-instructions.mjs \
 *     --source ./instructions \
 *     --target ./tmp/instructions-minimal \
 *     --include github-mermaid-dark-theme-quick-guide-2025 unrelated-developer-urls \
 *     [--force]
 *
 * Environment override:
 *   If TEST_INDEX_SERVER_DIR is not set, you can export it to point tests at the
 *   target directory after creation:
 *     set TEST_INDEX_SERVER_DIR=... (Windows pwsh)
 *
 * Default include set matches IDs used in feedbackReproduction.multiClient.spec.ts.
 */
import fs from 'fs';
import path from 'path';

function parseArgs(){
  const args = process.argv.slice(2);
  const opts = { source: 'instructions', target: 'tmp/instructions-minimal', include: [], force: false };
  for(let i=0;i<args.length;i++){
    const a = args[i];
    if(a==='--source') opts.source = args[++i];
    else if(a==='--target') opts.target = args[++i];
    else if(a==='--include'){ while(args[i+1] && !args[i+1].startsWith('--')) opts.include.push(args[++i]); }
    else if(a==='--force'){ opts.force = true; }
    else { opts.include.push(a); }
  }
  if(opts.include.length===0){
    opts.include = [ 'github-mermaid-dark-theme-quick-guide-2025', 'unrelated-developer-urls' ];
  }
  return opts;
}

function main(){
  const { source, target, include, force } = parseArgs();
  const absSource = path.resolve(source);
  const absTarget = path.resolve(target);
  if(!fs.existsSync(absSource)){
    console.error(`[prepare-minimal-instructions] Source directory missing: ${absSource}`);
    process.exit(2);
  }
  if(fs.existsSync(absTarget)){
    if(!force){
      console.log(`[prepare-minimal-instructions] Target exists (use --force to overwrite): ${absTarget}`);
    } else {
      fs.rmSync(absTarget,{recursive:true,force:true});
    }
  }
  fs.mkdirSync(absTarget,{recursive:true});
  const files = fs.readdirSync(absSource).filter(f=>f.endsWith('.json'));
  let copied = 0;
  for(const f of files){
    try {
      const full = path.join(absSource,f);
      const raw = JSON.parse(fs.readFileSync(full,'utf8'));
      const id = raw.id;
      if(include.includes(id)){
        fs.copyFileSync(full, path.join(absTarget,f));
        copied++;
      }
    } catch { /* ignore malformed */ }
  }
  // Always include gates.json if present (baseline governance) without counting toward copied set
  if(fs.existsSync(path.join(absSource,'gates.json'))){
    try { fs.copyFileSync(path.join(absSource,'gates.json'), path.join(absTarget,'gates.json')); } catch { /* ignore */ }
  }
  console.log(JSON.stringify({ source:absSource, target:absTarget, requested:include.length, copied }, null, 2));
}

if(import.meta.url === `file://${process.argv[1].replace(/\\/g,'/')}`){
  main();
}
