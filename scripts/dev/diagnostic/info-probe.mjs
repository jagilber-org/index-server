#!/usr/bin/env node
/**
 * Ad-hoc info probe — reports instruction count + server config from a
 * profile sandbox. Spawns a short-lived MCP child against the same env file
 * the running dev-server uses (no port collision: stdio transport).
 *
 * Usage:
 *   node scripts/dev/lib/info-probe.mjs --env-file .devsandbox/json/server.env
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startMcp } from '../transport/mcp-stdio.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args['env-file']) { console.error('--env-file <file> required'); process.exit(2); }
const envFile = resolve(args['env-file']);
if (!existsSync(envFile)) { console.error(`env file not found: ${envFile}`); process.exit(2); }

const env = parseEnvFile(envFile);
const distServer = resolve('dist/server/index-server.js');

const out = { envFile, config: {}, instructions: {} };

// Surface key config from env (what the server was started with)
const CONFIG_KEYS = [
  'INDEX_SERVER_STORAGE_BACKEND',
  'INDEX_SERVER_INSTRUCTIONS_DIR',
  'INDEX_SERVER_DATA_DIR',
  'INDEX_SERVER_FEEDBACK_DIR',
  'INDEX_SERVER_LOG_DIR',
  'INDEX_SERVER_SQLITE_PATH',
  'INDEX_SERVER_SQLITE_WAL',
  'INDEX_SERVER_SQLITE_MIGRATE_ON_START',
  'INDEX_SERVER_SEMANTIC_ENABLED',
  'INDEX_SERVER_EMBEDDING_PATH',
  'INDEX_SERVER_SEMANTIC_CACHE_DIR',
  'INDEX_SERVER_SEMANTIC_DEVICE',
  'INDEX_SERVER_DASHBOARD_PORT',
  'INDEX_SERVER_LEADER_PORT',
  'INDEX_SERVER_DASHBOARD_HOST',
  'INDEX_SERVER_IDLE_KEEPALIVE_MS',
];
for (const k of CONFIG_KEYS) if (env[k] !== undefined) out.config[k] = env[k];

const mcp = await startMcp({ env, distServer, cwd: process.cwd() });
try {
  // List all instructions (paged: ask for big page)
  const listResp = await mcp.callTool('index_dispatch', { action: 'list', limit: 1000 });
  const listPayload = parsePayload(listResp);
  const items = extractItems(listPayload);
  out.instructions.total = listPayload?.total ?? listPayload?.totalMatches ?? items.length;
  out.instructions.returned = items.length;
  out.instructions.byContentType = countBy(items, x => x.contentType || x.content_type || '(unknown)');
  out.instructions.firstFewIds = items.slice(0, 10).map(x => x.id || x.instructionId).filter(Boolean);

  // Capabilities (server-reported config surface)
  try {
    const capResp = await mcp.callTool('index_dispatch', { action: 'capabilities' });
    out.capabilities = parsePayload(capResp);
  } catch (e) { out.capabilities = { error: String(e?.message || e) }; }

  // Health
  try {
    const healthResp = await mcp.callTool('health_check', {});
    out.health = parsePayload(healthResp);
  } catch (e) { out.health = { error: String(e?.message || e) }; }
} finally {
  await mcp.close();
}

console.log(JSON.stringify(out, null, 2));
process.exit(0);

// ---------- helpers ----------
function parseArgs(argv) {
  const out = {}; for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; if (!a.startsWith('--')) continue;
    const k = a.slice(2); const v = (i + 1 < argv.length && !argv[i+1].startsWith('--')) ? argv[++i] : 'true';
    out[k] = v;
  } return out;
}
function parseEnvFile(file) {
  const txt = readFileSync(file, 'utf8'); const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  } return env;
}
function parsePayload(resp) {
  const text = resp?.result?.content?.[0]?.text;
  if (!text) return resp;
  try { return JSON.parse(text); } catch { return text; }
}
function extractItems(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p;
  if (Array.isArray(p.items)) return p.items;
  if (Array.isArray(p.results)) return p.results;
  if (Array.isArray(p.entries)) return p.entries;
  return [];
}
function countBy(arr, fn) {
  const o = {}; for (const x of arr) { const k = fn(x); o[k] = (o[k] || 0) + 1; } return o;
}
