#!/usr/bin/env node
/**
 * Dev-server import/export helper.
 *
 * Spawns a short-lived MCP stdio child against a profile sandbox and either
 *   - exports all instructions to a JSON file (action=export), or
 *   - imports a JSON file via index_import (mode=skip|overwrite).
 *
 * Verifies success by re-listing afterwards.
 *
 * Usage:
 *   node scripts/dev/lib/io-helper.mjs export --env-file <env> --out <file>
 *   node scripts/dev/lib/io-helper.mjs import --env-file <env> --in <file> [--mode overwrite|skip]
 */
import fs from 'node:fs';
import path from 'node:path';
import { startMcp, parseToolPayload } from '../transport/mcp-stdio.mjs';

const action = process.argv[2];
function getArg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const ENV_FILE = getArg('--env-file');
const IN_FILE = getArg('--in');
const OUT_FILE = getArg('--out');
const LOG_FILE = getArg('--log-file');
const MODE = getArg('--mode', 'skip');

if (!ENV_FILE || !['export', 'import'].includes(action)) {
  console.error('io-helper: usage: <export|import> --env-file <env> [--out <f> | --in <f> --mode skip|overwrite]');
  process.exit(2);
}

function loadEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('='); if (eq < 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}
const profileEnv = loadEnvFile(ENV_FILE);
const DIST = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
if (!fs.existsSync(DIST)) { console.error('dist server missing; run npm run build'); process.exit(2); }

const logSink = LOG_FILE ? fs.createWriteStream(LOG_FILE, { flags: 'a' }) : null;
function log(level, kind, payload) {
  const line = `${new Date().toISOString()} [${level}] [io] ${kind}${payload !== undefined ? ' ' + JSON.stringify(payload) : ''}`;
  process.stderr.write(line + '\n');
  if (logSink) logSink.write(line + '\n');
}

(async () => {
  const mcp = await startMcp({ env: profileEnv, distServer: DIST, initTimeoutMs: 12000 });
  try {
    if (action === 'export') {
      log('act', 'export', { out: OUT_FILE });
      const resp = await mcp.callTool('index_dispatch', { action: 'export' }, 30000);
      const payload = parseToolPayload(resp);
      const entries = Array.isArray(payload) ? payload :
                      Array.isArray(payload?.entries) ? payload.entries :
                      Array.isArray(payload?.instructions) ? payload.instructions :
                      Array.isArray(payload?.items) ? payload.items : null;
      if (!entries) {
        log('FAIL', 'export-shape', { payload });
        process.exit(1);
      }
      fs.writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2), 'utf8');
      log('pass', 'export-written', { count: entries.length, out: OUT_FILE });
      process.stdout.write(JSON.stringify({ action: 'export', count: entries.length, out: OUT_FILE }) + '\n');
    } else {
      const raw = fs.readFileSync(IN_FILE, 'utf8');
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) { log('FAIL', 'import-shape', { hint: 'file must be JSON array of entries' }); process.exit(1); }
      log('act', 'import', { in: IN_FILE, count: entries.length, mode: MODE });
      const resp = await mcp.callTool('index_import', { entries, mode: MODE }, 60000);
      const payload = parseToolPayload(resp);
      log('info', 'import-result', { error: resp?.error, payload });

      // Verify by listing
      const list = await mcp.callTool('index_dispatch', { action: 'list' }, 30000);
      const lp = parseToolPayload(list);
      const present = countIds(lp);
      log('pass', 'import-verified', { totalInIndex: present });
      process.stdout.write(JSON.stringify({ action: 'import', requested: entries.length, mode: MODE, indexCount: present }) + '\n');
    }
  } catch (e) {
    log('FAIL', 'exception', { message: String(e?.message || e) });
    process.exit(1);
  } finally {
    await mcp.close();
    if (logSink) logSink.end();
  }
})();

function countIds(payload) {
  if (!payload) return 0;
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload.ids)) return payload.ids.length;
  if (Array.isArray(payload.entries)) return payload.entries.length;
  if (Array.isArray(payload.items)) return payload.items.length;
  if (typeof payload.count === 'number') return payload.count;
  return 0;
}
