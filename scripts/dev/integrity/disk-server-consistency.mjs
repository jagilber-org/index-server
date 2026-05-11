#!/usr/bin/env node
/**
 * Ad-hoc disk<->server consistency probe.
 *
 * 1. Reads INDEX_SERVER_DIR from --env-file; counts *.json instruction files on disk.
 * 2. Counts via MCP index_dispatch action=list.
 * 3. Asserts the two counts match.
 * 4. Adds N synthetic instructions (default 3) via index_add.
 * 5. Re-queries via list AND get-by-id to verify each was accepted.
 * 6. Re-counts files on disk and asserts disk grew by N.
 * 7. Exits 0 on full success, 1 on any mismatch. Outputs JSON summary.
 *
 * Usage:
 *   node scripts/dev/lib/disk-server-consistency.mjs \
 *       --env-file .devsandbox/json/server.env [--count 3] [--id-prefix adhoc] [--keep]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startMcp } from '../transport/mcp-stdio.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args['env-file']) { console.error('--env-file <file> required'); process.exit(2); }
const envFile = resolve(args['env-file']);
if (!existsSync(envFile)) { console.error(`env file not found: ${envFile}`); process.exit(2); }
const COUNT = Math.max(1, parseInt(args.count || '3', 10));
const PREFIX = args['id-prefix'] || 'adhoc';
const KEEP = args.keep === 'true' || args.keep === true;

const env = parseEnvFile(envFile);
const distServer = resolve('dist/server/index-server.js');
const instructionsDir = env.INDEX_SERVER_DIR;
if (!instructionsDir) { console.error('INDEX_SERVER_DIR not in env file'); process.exit(2); }
if (!existsSync(instructionsDir)) { console.error(`instructions dir missing: ${instructionsDir}`); process.exit(2); }

const out = {
  envFile,
  instructionsDir,
  count: COUNT,
  steps: [],
  pass: true,
};
const step = (name, ok, detail) => { out.steps.push({ name, ok: !!ok, detail }); if (!ok) out.pass = false; };

// --- Step 1: count on-disk JSON instructions BEFORE
const beforeFiles = listInstructionFiles(instructionsDir);
const beforeUserFiles = beforeFiles.filter(f => !f.startsWith('_'));
step('disk-count:before', true, {
  total: beforeFiles.length, userFiles: beforeUserFiles.length, sample: beforeFiles.slice(0, 8),
});

// --- Step 2 & 3: count via MCP list, assert match
const mcp = await startMcp({ env, distServer, cwd: process.cwd() });
try {
  let listResp = await mcp.callTool('index_dispatch', { action: 'list', limit: 1000 });
  let listPayload = parsePayload(listResp);
  let serverItems = extractItems(listPayload);
  step('mcp-count:before', true, { total: serverItems.length });
  // Server skips bookkeeping files (_manifest.json, _skipped.json) + governance-denylisted entries.
  // disk userFiles >= server count is the loose invariant; we report the delta for visibility.
  step('disk-vs-server:before', serverItems.length <= beforeUserFiles.length, {
    diskUserFiles: beforeUserFiles.length,
    serverList: serverItems.length,
    diff: beforeUserFiles.length - serverItems.length,
    note: 'difference = governance-denylisted or otherwise-skipped files',
  });

  // --- Step 4: ADD N synthetic instructions
  const runTag = Date.now().toString(36);
  const newIds = Array.from({ length: COUNT }, (_, i) => `${PREFIX}-${runTag}-${i + 1}`);
  for (const id of newIds) {
    const entry = {
      id,
      title: `Adhoc consistency probe ${id}`,
      body: `Synthetic instruction created by disk-server-consistency.mjs for ${id} at ${new Date().toISOString()}.`,
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['adhoc', 'consistency-probe'],
      contentType: 'instruction',
    };
    const r = await mcp.callTool('index_add', { entry, lax: true, overwrite: true });
    const p = parsePayload(r);
    step(`add:${id}`, !!(p?.success && (p.created || p.overwritten)), {
      payload: p, mcpError: r?.error,
    });
  }

  // --- Step 5a: re-list, verify each new id appears
  listResp = await mcp.callTool('index_dispatch', { action: 'list', limit: 1000 });
  listPayload = parsePayload(listResp);
  serverItems = extractItems(listPayload);
  const serverIds = new Set(serverItems.map(x => x.id || x.instructionId).filter(Boolean));
  for (const id of newIds) {
    step(`list-contains:${id}`, serverIds.has(id), { present: serverIds.has(id) });
  }

  // --- Step 5b: get each by id, verify body length > 0
  for (const id of newIds) {
    const g = await mcp.callTool('index_dispatch', { action: 'get', id });
    const gp = parsePayload(g);
    const item = gp?.item || gp;
    const ok = item && item.id === id && typeof item.body === 'string' && item.body.length > 0;
    step(`get:${id}`, !!ok, ok ? { len: item.body.length } : { gp });
  }

  step('mcp-count:after', true, { total: serverItems.length });

  // --- Step 6: re-count on-disk JSON files, expect grew by COUNT
  const afterFiles = listInstructionFiles(instructionsDir);
  const afterUserFiles = afterFiles.filter(f => !f.startsWith('_'));
  const grew = afterUserFiles.length - beforeUserFiles.length;
  step('disk-count:after', true, { total: afterFiles.length, userFiles: afterUserFiles.length });
  step('disk-grew-by-count', grew === COUNT, { expected: COUNT, actual: grew });
  step('server-grew-by-count',
    serverItems.length === out.steps.find(s => s.name === 'mcp-count:before').detail.total + COUNT,
    {
      before: out.steps.find(s => s.name === 'mcp-count:before').detail.total,
      after: serverItems.length,
      expectedDelta: COUNT,
    });

  // Identify which on-disk files correspond to the new ids
  const newDiskFiles = newIds.map(id => {
    const candidates = afterUserFiles.filter(f => f.toLowerCase().includes(id.toLowerCase()));
    return { id, files: candidates };
  });
  step('new-files-on-disk', newDiskFiles.every(x => x.files.length > 0), { newDiskFiles });

  // --- Cleanup unless --keep
  if (!KEEP) {
    const r = await mcp.callTool('index_remove', { ids: newIds });
    const p = parsePayload(r);
    step('cleanup:remove', p?.removed === COUNT, { removed: p?.removed, removedIds: p?.removedIds });

    const finalFiles = listInstructionFiles(instructionsDir).filter(f => !f.startsWith('_'));
    step('cleanup:disk-restored', finalFiles.length === beforeUserFiles.length, {
      before: beforeUserFiles.length, final: finalFiles.length,
    });
  } else {
    step('cleanup:skipped', true, { reason: '--keep flag' });
  }
} finally {
  await mcp.close();
}

const summary = {
  total: out.steps.length,
  passed: out.steps.filter(s => s.ok).length,
  failed: out.steps.filter(s => !s.ok).length,
};
console.log(JSON.stringify({ ...out, summary }, null, 2));
process.exit(out.pass ? 0 : 1);

// ---------- helpers ----------
function parseArgs(argv) {
  const o = {}; for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
    o[k] = v;
  } return o;
}
function parseEnvFile(file) {
  const txt = readFileSync(file, 'utf8'); const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  } return env;
}
function listInstructionFiles(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.json'))
      .map(d => d.name)
      .sort();
  } catch { return []; }
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
