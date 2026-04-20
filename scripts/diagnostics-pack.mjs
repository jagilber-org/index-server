#!/usr/bin/env node
/**
 * diagnostics-pack.mjs
 * Collects a structured triage bundle for CI failures (health or stress workflows).
 *
 * Actions:
 *  - Runs JSON-RPC calls (if dist server available): integrity_verify, instructions_governanceHash, instructions/export (summary only)
 *  - Captures environment snapshot (selected vars) and package version
 *  - Gathers recent *.log (truncated) and health_response.json if present
 *  - Writes bundle to diagnostics/pack.json and emits file list
 *
 * Exit: Never non-zero (defensive) unless a truly unexpected fatal error occurs.
 */
import fs from 'fs';
import { spawnSync } from 'child_process';

const OUT_DIR = 'diagnostics';
fs.mkdirSync(OUT_DIR, { recursive: true });

function log(m){ process.stdout.write(`[diagnostics-pack] ${m}\n`); }
function safeRpc(method, params){
  try {
    if(!fs.existsSync('dist/server/index-server.js')){ return { error: 'dist missing' }; }
    const payload = JSON.stringify({ jsonrpc:'2.0', id: Date.now(), method, params });
    const run = spawnSync('node', ['dist/server/index-server.js'], { input: payload, encoding: 'utf-8' });
    if(run.status !== 0){ return { error: `status ${run.status}`, stderr: run.stderr?.slice(0,400) }; }
    const parsed = JSON.parse(run.stdout || '{}');
    return parsed.result || { raw: parsed };
  } catch(err){ return { error: (err instanceof Error? err.message: String(err)) }; }
}

// Collect RPC summaries
const integrity = safeRpc('integrity_verify');
const governanceHash = safeRpc('instructions_governanceHash');
let exportSummary = safeRpc('instructions/export');
if(exportSummary?.items && Array.isArray(exportSummary.items)){
  exportSummary = {
    hash: exportSummary.hash,
    count: exportSummary.items.length,
    sample: exportSummary.items.slice(0,5).map(i=> ({ id: i.id, v: i.version }))
  };
}

// Capture recent logs (truncate to avoid huge artifacts)
function captureLogs(){
  const files = fs.readdirSync('.').filter(f=> f.endsWith('.log'));
  const out = {};
  for(const f of files){
    try {
      const data = fs.readFileSync(f,'utf-8');
      out[f] = data.split('\n').slice(-200).join('\n');
    } catch (err) {
      out[f] = `<<error reading log: ${(err instanceof Error? err.message: String(err))}>>`;
    }
  }
  return out;
}

// Health response if exists
let healthResponse; try { if(fs.existsSync('health_response.json')) healthResponse = JSON.parse(fs.readFileSync('health_response.json','utf-8')); } catch { /* ignore parse errors */ }

// Select environment snapshot
const ENV_KEYS = Object.keys(process.env).filter(k=> /^(INDEX_SERVER_|CI|GITHUB_|TEST_|VITEST_)/.test(k));
const envSnapshot = Object.fromEntries(ENV_KEYS.map(k=> [k, process.env[k]]));

// Package version
let pkg; try { pkg = JSON.parse(fs.readFileSync('package.json','utf-8')); } catch { /* ignore */ }

const pack = {
  generatedAt: new Date().toISOString(),
  version: pkg?.version,
  rpc: { integrity, governanceHash, exportSummary },
  env: envSnapshot,
  healthResponse,
  logs: captureLogs()
};

const outPath = `${OUT_DIR}/pack.json`;
try {
  fs.writeFileSync(outPath, JSON.stringify(pack, null, 2));
  log(`Wrote ${outPath}`);
} catch(err){
  log(`Failed to write pack: ${(err instanceof Error? err.message: String(err))}`);
  process.exitCode = 0; // do not fail workflow
}

// Emit index file list
try {
  const list = fs.readdirSync(OUT_DIR);
  fs.writeFileSync(`${OUT_DIR}/_index.txt`, list.join('\n'));
} catch { /* ignore directory listing errors */ }

log('Diagnostics collection complete.');
