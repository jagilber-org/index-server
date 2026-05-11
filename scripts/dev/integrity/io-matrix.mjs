#!/usr/bin/env node
/**
 * Ad-hoc disk<->server import/export matrix probe.
 *
 * Exercises the full IO matrix and asserts disk + server stay in lockstep:
 *
 *   1. Snapshot baseline disk + server counts.
 *   2. Export-A → file. Assert export count == server list count.
 *   3. Add N synthetic entries (all marked with a unique runTag for safe cleanup).
 *   4. Snapshot grown disk + server counts. Assert disk grew by N.
 *   5. Export-B → file. Assert export count == server list count == baseline + N.
 *   6. Remove the N synthetic entries from server.
 *   7. Snapshot post-remove disk + server. Assert disk shrunk by N back to baseline.
 *   8. Import the N synthetic entries from Export-B (mode=skip first).
 *      Assert ALL N come back, present on disk and listed by server.
 *   9. Verify each restored id matches by id + body length.
 *  10. Re-import same file with mode=skip again — should be a no-op (no growth).
 *  11. Cleanup the N synthetic entries (unless --keep), restore baseline.
 *
 * Outputs JSON summary; exits 0 if every step ok, 1 on any failure.
 *
 * Usage:
 *   node scripts/dev/lib/io-matrix.mjs --env-file .devsandbox/json/server.env [--count 3] [--id-prefix iom] [--keep]
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { startMcp } from '../transport/mcp-stdio.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args['env-file']) { console.error('--env-file <file> required'); process.exit(2); }
const envFile = resolve(args['env-file']);
if (!existsSync(envFile)) { console.error(`env file not found: ${envFile}`); process.exit(2); }
const COUNT = Math.max(1, parseInt(args.count || '3', 10));
const PREFIX = args['id-prefix'] || 'iom';
const KEEP = args.keep === 'true' || args.keep === true;

const env = parseEnvFile(envFile);
const distServer = resolve('dist/server/index-server.js');
const instructionsDir = env.INDEX_SERVER_DIR;
if (!instructionsDir) { console.error('INDEX_SERVER_DIR not in env file'); process.exit(2); }

const sandboxRoot = dirname(instructionsDir);
const exportsDir = join(sandboxRoot, 'exports');
mkdirSync(exportsDir, { recursive: true });
const runTag = Date.now().toString(36);
const exportA = join(exportsDir, `iomatrix-${runTag}-A-baseline.json`);
const exportB = join(exportsDir, `iomatrix-${runTag}-B-grown.json`);
const newIds = Array.from({ length: COUNT }, (_, i) => `${PREFIX}-${runTag}-${i + 1}`);

const out = {
  envFile, instructionsDir, exportsDir, runTag, count: COUNT,
  files: { exportA, exportB },
  newIds, steps: [], pass: true,
};
const step = (name, ok, detail) => {
  out.steps.push({ name, ok: !!ok, detail });
  if (!ok) out.pass = false;
};

const baselineUserFiles = listInstructionFiles(instructionsDir).filter(f => !f.startsWith('_'));
step('baseline:disk', true, { userFiles: baselineUserFiles.length });

const mcp = await startMcp({ env, distServer, cwd: process.cwd() });
try {
  // 1. baseline server count
  let baselineServer = await listCount(mcp);
  step('baseline:server', true, { total: baselineServer });

  // 2. Export A
  const exportAEntries = await exportAll(mcp);
  writeFileSync(exportA, JSON.stringify(exportAEntries, null, 2), 'utf8');
  step('export-A:count', exportAEntries.length === baselineServer, {
    exportCount: exportAEntries.length, serverCount: baselineServer, file: exportA,
  });

  // 3. Add N synthetic entries
  for (const id of newIds) {
    const entry = synthEntry(id);
    const r = await mcp.callTool('index_add', { entry, lax: true, overwrite: true });
    const p = parsePayload(r);
    step(`add:${id}`, !!(p?.success && (p.created || p.overwritten)), {
      created: p?.created, overwritten: p?.overwritten, error: p?.error,
    });
  }

  // 4. Disk + server grew by COUNT
  const grownUserFiles = listInstructionFiles(instructionsDir).filter(f => !f.startsWith('_'));
  step('after-add:disk-grew', grownUserFiles.length === baselineUserFiles.length + COUNT, {
    before: baselineUserFiles.length, after: grownUserFiles.length, expectedDelta: COUNT,
  });
  let grownServer = await listCount(mcp);
  step('after-add:server-grew', grownServer === baselineServer + COUNT, {
    before: baselineServer, after: grownServer, expectedDelta: COUNT,
  });

  // 5. Export B (grown set)
  const exportBEntries = await exportAll(mcp);
  writeFileSync(exportB, JSON.stringify(exportBEntries, null, 2), 'utf8');
  step('export-B:count', exportBEntries.length === grownServer, {
    exportCount: exportBEntries.length, serverCount: grownServer, file: exportB,
  });
  // Ensure export-B contains all newIds
  const exportBIds = new Set(exportBEntries.map(e => e.id));
  step('export-B:contains-all-new-ids', newIds.every(id => exportBIds.has(id)), {
    missing: newIds.filter(id => !exportBIds.has(id)),
  });

  // 6. Remove the N synthetic entries
  const remResp = await mcp.callTool('index_remove', { ids: newIds });
  const remP = parsePayload(remResp);
  step('remove:count', remP?.removed === COUNT, { removed: remP?.removed, ids: remP?.removedIds });

  // 7. Post-remove counts back to baseline
  const postRemoveUserFiles = listInstructionFiles(instructionsDir).filter(f => !f.startsWith('_'));
  step('after-remove:disk-restored', postRemoveUserFiles.length === baselineUserFiles.length, {
    expected: baselineUserFiles.length, actual: postRemoveUserFiles.length,
  });
  const postRemoveServer = await listCount(mcp);
  step('after-remove:server-restored', postRemoveServer === baselineServer, {
    expected: baselineServer, actual: postRemoveServer,
  });

  // 8. Import the raw export entries directly (mode=overwrite). With the
  //    single-source-of-truth schema refactor, index_import now partitions
  //    server-managed fields (schemaVersion, sourceHash, createdAt, updatedAt,
  //    usageCount, firstSeenTs, lastUsedAt, archivedAt) via splitEntry() and
  //    accepts the raw export shape. No client-side scrubbing required.
  const syntheticRaw = exportBEntries.filter(e => newIds.includes(e.id));
  step('import:input-count', syntheticRaw.length === COUNT, {
    expected: COUNT, actual: syntheticRaw.length,
    sampleRawKeys: syntheticRaw[0] ? Object.keys(syntheticRaw[0]) : [],
  });
  const impResp = await mcp.callTool('index_import', { entries: syntheticRaw, mode: 'overwrite' });
  const impP = parsePayload(impResp);
  step('import:executed', !!impP, { payload: impP });
  step('import:counts',
    (impP?.imported || 0) + (impP?.overwritten || 0) === COUNT,
    { imported: impP?.imported, overwritten: impP?.overwritten, skipped: impP?.skipped, errors: impP?.errors }
  );

  // Round-trip success probe: import the RAW (unstripped) export and confirm
  // the server accepts it cleanly. This locks in the SoT contract — any future
  // drift between export shape and import acceptance will fail this step.
  const rawProbeResp = await mcp.callTool('index_import', { entries: syntheticRaw, mode: 'overwrite' });
  const rawProbeP = parsePayload(rawProbeResp);
  const rawErrors = rawProbeP?.errors || [];
  step('bug-probe:export-roundtrip-succeeds',
    rawErrors.length === 0
    && (rawProbeP?.imported || 0) + (rawProbeP?.overwritten || 0) === COUNT,
    {
      imported: rawProbeP?.imported,
      overwritten: rawProbeP?.overwritten,
      errorCount: rawErrors.length,
      sampleError: rawErrors[0]?.error,
      note: 'asserts SoT contract: raw export entries (incl. server-managed fields) are accepted by index_import via splitEntry partitioning',
    });
  // Reuse the same shape for the idempotent re-import below.
  const syntheticOnly = syntheticRaw;

  // 9. Verify all N restored on disk and via server
  const restoredUserFiles = listInstructionFiles(instructionsDir).filter(f => !f.startsWith('_'));
  step('after-import:disk-grew', restoredUserFiles.length === baselineUserFiles.length + COUNT, {
    expected: baselineUserFiles.length + COUNT, actual: restoredUserFiles.length,
  });
  const restoredServer = await listCount(mcp);
  step('after-import:server-grew', restoredServer === baselineServer + COUNT, {
    expected: baselineServer + COUNT, actual: restoredServer,
  });
  for (const id of newIds) {
    const g = await mcp.callTool('index_dispatch', { action: 'get', id });
    const item = (parsePayload(g))?.item;
    const ok = item && item.id === id && typeof item.body === 'string' && item.body.length > 0;
    step(`verify-restored:${id}`, !!ok, ok ? { len: item.body.length } : { resp: parsePayload(g) });
  }

  // 10. Idempotent re-import (mode=skip) — should NOT grow because all ids already exist.
  const reResp = await mcp.callTool('index_import', { entries: syntheticOnly, mode: 'skip' });
  const reP = parsePayload(reResp);
  const reServer = await listCount(mcp);
  step('reimport:no-growth', reServer === baselineServer + COUNT, {
    expected: baselineServer + COUNT, actual: reServer,
    imported: reP?.imported, skipped: reP?.skipped,
  });

  // 11. Cleanup
  if (!KEEP) {
    const c = await mcp.callTool('index_remove', { ids: newIds });
    const cp = parsePayload(c);
    step('cleanup:remove', cp?.removed === COUNT, { removed: cp?.removed });
    const finalUserFiles = listInstructionFiles(instructionsDir).filter(f => !f.startsWith('_'));
    step('cleanup:disk-restored', finalUserFiles.length === baselineUserFiles.length, {
      expected: baselineUserFiles.length, actual: finalUserFiles.length,
    });
    const finalServer = await listCount(mcp);
    step('cleanup:server-restored', finalServer === baselineServer, {
      expected: baselineServer, actual: finalServer,
    });
  } else {
    step('cleanup:skipped', true, { reason: '--keep' });
  }
} finally {
  await mcp.close();
}

const summary = {
  total: out.steps.length,
  passed: out.steps.filter(s => s.ok).length,
  failed: out.steps.filter(s => !s.ok).length,
};
out.summary = summary;
console.log(JSON.stringify(out, null, 2));
process.exit(out.pass ? 0 : 1);

// ---------- helpers ----------
function synthEntry(id) {
  return {
    id,
    title: `IO matrix probe ${id}`,
    body: `Synthetic instruction for io-matrix.mjs. id=${id} created=${new Date().toISOString()} runTag=${runTag}.`,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['adhoc', 'io-matrix'],
    contentType: 'instruction',
  };
}
async function listCount(mcp) {
  const r = await mcp.callTool('index_dispatch', { action: 'list', limit: 1000 });
  const p = parsePayload(r);
  return extractItems(p).length;
}
async function exportAll(mcp) {
  const r = await mcp.callTool('index_dispatch', { action: 'export' });
  const p = parsePayload(r);
  // index_dispatch action=export returns { hash, count, items: [...] }.
  if (Array.isArray(p)) return p;
  if (Array.isArray(p?.items)) return p.items;
  if (Array.isArray(p?.entries)) return p.entries;
  if (Array.isArray(p?.instructions)) return p.instructions;
  return [];
}
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
      .map(d => d.name).sort();
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
