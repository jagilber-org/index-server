#!/usr/bin/env node
/**
 * normalize-instructions.js
 * Idempotent normalization pass for instruction JSON files.
 * - Ensures semantic version string (defaults to 1.0.0 if missing/invalid)
 * - Recomputes SHA256 body hash and updates sourceHash when body changed or mismatch
 * - Normalizes priorityTier casing (P1..P4)
 * - Adds createdAt/updatedAt if absent (ISO UTC now) but does NOT mutate existing timestamps
 * - Leaves governance fields untouched if present
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.cwd();
const DIRS = ['instructions','devinstructions']
  .map(d => path.join(ROOT, d))
  .filter(d => fs.existsSync(d));

function sha256(s){return crypto.createHash('sha256').update(s,'utf8').digest('hex');}
function isSemver(v){return /^\d+\.\d+\.\d+$/.test(v);}
function normTier(t){
  if (!t) return t;
  const u = t.toUpperCase();
  return ['P1','P2','P3','P4'].includes(u) ? u : t;
}

let changed = 0, scanned = 0, fixedHash = 0, fixedVersion = 0, fixedTier = 0, addedTimestamps = 0;

for (const dir of DIRS) {
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    const full = path.join(dir, file);
    scanned++;
    let raw = fs.readFileSync(full, 'utf8');
    let data;
    try { data = JSON.parse(raw); } catch { continue; }
    let modified = false;
    if (typeof data.body === 'string') {
      const h = sha256(data.body);
      if (data.sourceHash !== h) { data.sourceHash = h; modified = true; fixedHash++; }
    }
    if (!isSemver(data.version)) { data.version = '1.0.0'; modified = true; fixedVersion++; }
    const tier = normTier(data.priorityTier);
    if (tier !== data.priorityTier) { data.priorityTier = tier; modified = true; fixedTier++; }
    const now = new Date().toISOString();
    if (!data.createdAt) { data.createdAt = now; modified = true; addedTimestamps++; }
    if (!data.updatedAt) { data.updatedAt = now; modified = true; addedTimestamps++; }
    if (modified) {
      fs.writeFileSync(full, JSON.stringify(data, null, 2)+"\n", 'utf8');
      changed++;
    }
  }
}

const summary = { scanned, changed, fixedHash, fixedVersion, fixedTier, addedTimestamps };
console.log(JSON.stringify({ level:'info', event:'normalize-summary', ...summary }, null, 2));
