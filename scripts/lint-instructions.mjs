#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
// Load schema and prepare validator (warn-only for new constraints)
let schemaValidator = null;
try {
  const schemaPath = path.join(process.cwd(),'schemas','instruction.schema.json');
  if(fs.existsSync(schemaPath)){
    const schemaRaw = JSON.parse(fs.readFileSync(schemaPath,'utf8'));
    const ajv = new Ajv({ allErrors:true, strict:false });
    addFormats(ajv);
    schemaValidator = ajv.compile(schemaRaw);
  }
} catch { /* ignore schema load issues */ }

const base = path.join(process.cwd(), 'instructions');
let errors = 0; let warnings = 0;
function log(kind, id, msg){
  const line = `[${kind}] ${id}: ${msg}`;
  if(kind === 'ERROR') errors++; else if(kind === 'WARN') warnings++;
  console.error(line);
}
function sentenceCase(str){ if(!str) return str; return str[0].toUpperCase() + str.slice(1); }
function isAcronym(word){ return /^[A-Z]{2,}$/.test(word); }

for(const file of (fs.existsSync(base)? fs.readdirSync(base): [])){
  if(!file.endsWith('.json')) continue;
  const full = path.join(base,file);
  let raw; try { raw = JSON.parse(fs.readFileSync(full,'utf8')); } catch { log('ERROR', file, 'invalid json'); continue; }
  const id = raw.id || file;
  // Required governance fields (post 0.7.0) - treat missing as error
  for(const f of ['owner','status','version','priorityTier','classification']){
    if(!raw[f]) log('ERROR', id, `missing field ${f}`);
  }
  if(raw.status === 'deprecated' && !raw.deprecatedBy){ log('ERROR', id, 'deprecated without deprecatedBy'); }
  if(typeof raw.body === 'string' && raw.body.trim().length === 0) log('ERROR', id, 'empty body');
  if(raw.title && raw.title !== sentenceCase(raw.title)) log('WARN', id, 'title not sentence case');
  // All caps words heuristic
  if(typeof raw.body === 'string'){
    const shout = raw.body.split(/\s+/).filter(w => w.length > 3 && w === w.toUpperCase() && !isAcronym(w)).length;
    if(shout > 5) log('WARN', id, 'excessive ALLCAPS words');
  }
  // priorityTier validation
  if(typeof raw.priority === 'number'){
    const p = raw.priority;
    const expected = p <= 20 || ['mandatory','critical'].includes(raw.requirement)? 'P1': p <= 40? 'P2': p <= 70? 'P3': 'P4';
    if(raw.priorityTier && raw.priorityTier !== expected){ log('ERROR', id, `priorityTier mismatch (have ${raw.priorityTier} expected ${expected})`); }
  }
  // integrity quick check
  if(typeof raw.body === 'string' && raw.sourceHash){
    const hash = crypto.createHash('sha256').update(raw.body,'utf8').digest('hex');
    if(hash !== raw.sourceHash) log('ERROR', id, 'sourceHash mismatch');
  }
  // schema validation (warn mode for new tightened constraints)
  if(schemaValidator){
    const ok = schemaValidator(raw);
    if(!ok && Array.isArray(schemaValidator.errors)){
      for(const e of schemaValidator.errors){
        // Downgrade to WARN to avoid brittle failures during adoption of stricter schema
        log('WARN', id, `schema ${e.instancePath||'/'} ${e.message}`);
      }
    }
  }
}
if(errors){ console.error(`Failed with ${errors} errors, ${warnings} warnings.`); process.exit(1); }
console.error(`Passed with 0 errors, ${warnings} warnings.`);
