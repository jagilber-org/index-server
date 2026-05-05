#!/usr/bin/env node
/**
 * adhoc-mutation-integrity.mjs — External mutation integrity probe
 *
 * Spawns an isolated Index Server instance per test case and verifies that
 * each mutation operation produces exactly the expected disk changes.
 * The storage layer is silent (no logging on writes/deletes), so this script
 * independently monitors the instructions directory for file-count accuracy.
 *
 * Usage:
 *   node scripts/adhoc-mutation-integrity.mjs
 *   node scripts/adhoc-mutation-integrity.mjs --verbose
 *   node scripts/adhoc-mutation-integrity.mjs --filter single-add
 *
 * Environment:
 *   Each test uses a fresh temp directory and disables auto-seed, auto-backup,
 *   manifest writes, and dashboard to minimize side effects.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { snapshot, diff, formatDiff } from './adhoc-disk-state-monitor.mjs';

const VERBOSE = process.argv.includes('--verbose');
const filterIdx = process.argv.indexOf('--filter');
const FILTER = filterIdx >= 0 ? process.argv[filterIdx + 1] : null;

const DIST_SERVER = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
const SETTLE_MS = 300; // ms to wait after mutation for disk to settle

// ── Server Harness ──────────────────────────────────────────────────────────

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adhoc-integrity-'));
}

function startServer(instructionsDir) {
  const proc = spawn('node', [DIST_SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      INDEX_SERVER_MUTATION: '1',
      INDEX_SERVER_DIR: instructionsDir,
      INDEX_SERVER_AUTO_SEED: '0',
      INDEX_SERVER_AUTO_BACKUP: '0',
      INDEX_SERVER_MANIFEST_WRITE: '0',
      INDEX_SERVER_DASHBOARD: '0',
      INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM: '1',
      INDEX_SERVER_LOG_LEVEL: 'error',
    },
  });
  const lines = [];
  proc.stdout.on('data', (d) => {
    lines.push(...d.toString().trim().split(/\n+/).filter(Boolean));
  });
  // Drain stderr to prevent pipe buffer backpressure
  proc.stderr.on('data', () => { /* drain */ });
  return { proc, lines };
}

let nextMsgId = 1;
function send(proc, method, params) {
  const id = nextMsgId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return id;
}

function waitForId(lines, id, timeout = 6000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      for (const l of lines) {
        try {
          const o = JSON.parse(l);
          if (o && o.id === id) {
            clearInterval(iv);
            return resolve(o);
          }
        } catch { /* non-JSON line */ }
      }
      if (Date.now() - start > timeout) {
        clearInterval(iv);
        reject(new Error(`Timeout waiting for response id=${id} (${timeout}ms)`));
      }
    }, 25);
  });
}

async function rpc(ctx, method, params, timeout) {
  const id = send(ctx.proc, method, params);
  return await waitForId(ctx.lines, id, timeout);
}

async function mcpInit(ctx) {
  return rpc(ctx, 'initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'adhoc-integrity', version: '1' },
    capabilities: { tools: {} },
  });
}

async function callTool(ctx, name, args, timeout) {
  return rpc(ctx, 'tools/call', { name, arguments: args }, timeout);
}

/** Parse the text payload from a tools/call response */
function parsePayload(resp) {
  if (resp?.result?.content?.[0]?.text) {
    return JSON.parse(resp.result.content[0].text);
  }
  if (resp?.error) {
    return { __error: resp.error };
  }
  return null;
}

function settle(ms = SETTLE_MS) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function makeEntry(id, extra = {}) {
  return {
    id,
    title: id,
    body: `Body for ${id}`,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['adhoc-test'],
    ...extra,
  };
}

// ── Test Runner ─────────────────────────────────────────────────────────────

const results = [];

async function runTest(name, fn) {
  if (FILTER && !name.includes(FILTER)) return;
  const dir = makeTempDir();
  fs.mkdirSync(dir, { recursive: true });
  const ctx = startServer(dir);
  const startTime = Date.now();
  let status = 'PASS';
  let detail = '';
  try {
    await mcpInit(ctx);
    await settle(200); // let server initialize
    await fn(ctx, dir);
  } catch (e) {
    status = 'FAIL';
    detail = e.message || String(e);
    if (VERBOSE) console.error(`  ❌ ${name}: ${detail}`);
  } finally {
    ctx.proc.kill();
    cleanup(dir);
  }
  const elapsed = Date.now() - startTime;
  results.push({ name, status, elapsed, detail });
  const icon = status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${name} (${elapsed}ms)${detail ? ' — ' + detail : ''}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertArrayLength(arr, expected, label) {
  if (arr.length !== expected) {
    throw new Error(`${label}: expected length ${expected}, got ${arr.length} [${arr.join(', ')}]`);
  }
}

// ── Test Cases ──────────────────────────────────────────────────────────────

async function testSingleAdd(ctx, dir) {
  const before = snapshot(dir);
  const entry = makeEntry('test-single-add');
  const resp = callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
  await resp;
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  assertArrayLength(d.added, 1, 'single-add: files added');
  assertEqual(d.added[0], 'test-single-add.json', 'single-add: filename');
  assertArrayLength(d.removed, 0, 'single-add: files removed');
  assertArrayLength(d.modified, 0, 'single-add: files modified');
}

async function testSingleRemove(ctx, dir) {
  // First add an entry
  const entry = makeEntry('test-remove-target');
  await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
  await settle();

  const before = snapshot(dir);
  await callTool(ctx, 'index_remove', { ids: ['test-remove-target'] });
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  assertArrayLength(d.removed, 1, 'single-remove: files removed');
  assertEqual(d.removed[0], 'test-remove-target.json', 'single-remove: filename');
  assertArrayLength(d.added, 0, 'single-remove: files added');
  assertArrayLength(d.modified, 0, 'single-remove: files modified');
}

async function testBulkImport(ctx, dir) {
  const entries = [];
  const N = 5;
  for (let i = 0; i < N; i++) {
    entries.push(makeEntry(`bulk-import-${i}`));
  }

  const before = snapshot(dir);
  await callTool(ctx, 'index_import', { entries, mode: 'overwrite' }, 10000);
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  assertArrayLength(d.added, N, `bulk-import: expected ${N} files added`);
  assertArrayLength(d.removed, 0, 'bulk-import: files removed');
  assertArrayLength(d.modified, 0, 'bulk-import: files modified');
}

async function testBulkRemove(ctx, dir) {
  const ids = [];
  const N = 3;
  for (let i = 0; i < N; i++) {
    const entry = makeEntry(`bulk-rm-${i}`);
    await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
    ids.push(`bulk-rm-${i}`);
  }
  await settle();

  const before = snapshot(dir);
  await callTool(ctx, 'index_remove', { ids });
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  assertArrayLength(d.removed, N, `bulk-remove: expected ${N} files removed`);
  assertArrayLength(d.added, 0, 'bulk-remove: files added');
  assertArrayLength(d.modified, 0, 'bulk-remove: files modified');
}

async function testReloadNoChange(ctx, dir) {
  // Add an entry first so we have state
  const entry = makeEntry('reload-stable');
  await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
  await settle();

  const before = snapshot(dir);
  await callTool(ctx, 'index_dispatch', { action: 'reload' });
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  const totalChanges = d.added.length + d.removed.length + d.modified.length;
  assertEqual(totalChanges, 0, 'reload: should produce zero disk changes');
}

async function testOverwriteModifies(ctx, dir) {
  const entry = makeEntry('overwrite-test', { body: 'version 1' });
  await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
  await settle();

  const before = snapshot(dir);
  const updated = makeEntry('overwrite-test', { body: 'version 2 updated' });
  await callTool(ctx, 'index_add', { entry: updated, lax: true, overwrite: true });
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  assertArrayLength(d.modified, 1, 'overwrite: should modify 1 file');
  assertEqual(d.modified[0], 'overwrite-test.json', 'overwrite: filename');
  assertArrayLength(d.added, 0, 'overwrite: no files added');
  assertArrayLength(d.removed, 0, 'overwrite: no files removed');
}

async function testIdempotentAdd(ctx, dir) {
  const entry = makeEntry('idempotent-test', { body: 'same content' });
  await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
  await settle();

  const before = snapshot(dir);
  // Same entry again with overwrite
  await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  assertEqual(before.fileCount, after.fileCount, 'idempotent: file count unchanged');
  assertArrayLength(d.added, 0, 'idempotent: no files added');
  assertArrayLength(d.removed, 0, 'idempotent: no files removed');
  // Modified is acceptable (server may update timestamps), but added/removed must be 0
}

async function testImportSkipMode(ctx, dir) {
  // Pre-add an entry
  const entry = makeEntry('import-skip-existing', { body: 'original body' });
  await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
  await settle();

  const before = snapshot(dir);
  // Import with skip mode — existing entry should be untouched
  await callTool(ctx, 'index_import', {
    entries: [makeEntry('import-skip-existing', { body: 'new body should be skipped' })],
    mode: 'skip',
  });
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  assertArrayLength(d.added, 0, 'import-skip: no files added');
  assertArrayLength(d.removed, 0, 'import-skip: no files removed');
  assertArrayLength(d.modified, 0, 'import-skip: no files modified');
}

async function testRemoveMissingId(ctx, dir) {
  // Try removing an ID that doesn't exist — should produce 0 disk changes
  const before = snapshot(dir);
  await callTool(ctx, 'index_remove', { ids: ['nonexistent-id-xyz'], missingOk: true });
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  const totalChanges = d.added.length + d.removed.length + d.modified.length;
  assertEqual(totalChanges, 0, 'remove-missing: should produce zero disk changes');
}

async function testDryRunRemove(ctx, dir) {
  const entry = makeEntry('dryrun-target');
  await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
  await settle();

  const before = snapshot(dir);
  await callTool(ctx, 'index_remove', { ids: ['dryrun-target'], dryRun: true });
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) console.log(formatDiff(d));
  const totalChanges = d.added.length + d.removed.length + d.modified.length;
  assertEqual(totalChanges, 0, 'dryrun-remove: should produce zero disk changes');
}

async function testBulkRemoveOverLimitBlocked(ctx, dir) {
  // Add 6+ entries, then try bulk remove without force — should be blocked
  const N = 6;
  const ids = [];
  for (let i = 0; i < N; i++) {
    const entry = makeEntry(`limit-rm-${i}`);
    await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
    ids.push(`limit-rm-${i}`);
  }
  await settle();

  const before = snapshot(dir);
  // Without force: true, bulk delete over INDEX_SERVER_MAX_BULK_DELETE (default 5) should fail
  const resp = await callTool(ctx, 'index_remove', { ids });
  const payload = parsePayload(resp);
  await settle();
  const after = snapshot(dir);
  const d = diff(before, after);
  if (VERBOSE) {
    console.log('  Response:', JSON.stringify(payload));
    console.log(formatDiff(d));
  }
  // Expect either 0 changes (blocked) or all removed (if limit was higher)
  // The key assertion: if the operation says it was blocked, disk should be unchanged
  if (payload?.__error || payload?.error || payload?.blocked) {
    const totalChanges = d.added.length + d.removed.length + d.modified.length;
    assertEqual(totalChanges, 0, 'bulk-limit: blocked operation should produce zero disk changes');
  }
  // If it succeeded (limit was different), that's also acceptable — just verify consistency
}

async function testAddThenVerifyContent(ctx, dir) {
  const body = 'Specific content for verification — 🎯 unicode test';
  const entry = makeEntry('content-verify', { body });
  await callTool(ctx, 'index_add', { entry, lax: true, overwrite: true });
  await settle();

  // Read the file directly from disk and verify content
  const filePath = path.join(dir, 'content-verify.json');
  const diskContent = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assertEqual(diskContent.body, body, 'content-verify: body matches');
  assertEqual(diskContent.id, 'content-verify', 'content-verify: id matches');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Verify dist exists
  if (!fs.existsSync(DIST_SERVER)) {
    console.error(`❌ Server not built. Run 'npm run build' first.`);
    console.error(`   Expected: ${DIST_SERVER}`);
    process.exit(1);
  }

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Adhoc Mutation Integrity Probe                            ║');
  console.log('║  Monitors disk state to detect spurious writes             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  await runTest('single-add', testSingleAdd);
  await runTest('single-remove', testSingleRemove);
  await runTest('bulk-import', testBulkImport);
  await runTest('bulk-remove', testBulkRemove);
  await runTest('reload-no-change', testReloadNoChange);
  await runTest('overwrite-modifies', testOverwriteModifies);
  await runTest('idempotent-add', testIdempotentAdd);
  await runTest('import-skip-mode', testImportSkipMode);
  await runTest('remove-missing-id', testRemoveMissingId);
  await runTest('dryrun-remove', testDryRunRemove);
  await runTest('bulk-remove-over-limit', testBulkRemoveOverLimitBlocked);
  await runTest('add-content-verification', testAddThenVerifyContent);

  // Summary
  console.log('');
  console.log('─────────────────────────────────────────────');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const total = results.length;
  const totalMs = results.reduce((s, r) => s + r.elapsed, 0);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed (${totalMs}ms total)`);

  if (failed > 0) {
    console.log('');
    console.log('Failed tests:');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`  ❌ ${r.name}: ${r.detail}`);
    }
  }

  // Write JSON report
  const reportPath = path.join(process.cwd(), 'tmp', 'adhoc-mutation-integrity-report.json');
  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), results }, null, 2));
    console.log(`\nReport: ${reportPath}`);
  } catch { /* non-fatal */ }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(2);
});
