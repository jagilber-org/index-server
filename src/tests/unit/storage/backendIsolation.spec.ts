/**
 * Backend Isolation Guard Tests
 *
 * Verifies that mutation handlers respect the configured storage backend boundary:
 *   - SQLite mode: NO instruction .json files appear on disk
 *   - JSON mode: NO .db files appear on disk
 *
 * These are PHYSICAL on-disk checks that catch handlers bypassing the storage interface.
 * Constitution references: A-3 (IndexContext single source of truth), TS-6 (pipeline round-trips),
 * TS-9 (real production code), TS-11 (>=5 cases for complex paths).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig.js';
import { invalidate, ensureLoaded, writeEntry as ctxWriteEntry } from '../../../services/indexContext.js';
import { createStore } from '../../../services/storage/factory.js';
import type { IInstructionStore } from '../../../services/storage/types.js';
import type { InstructionEntry } from '../../../models/instruction.js';
import { getHandler } from '../../../server/registry.js';
import { forceBootstrapConfirmForTests } from '../../../services/bootstrapGating.js';

let hasSqlite = false;
// eslint-disable-next-line @typescript-eslint/no-require-imports
try { require('node:sqlite'); hasSqlite = true; } catch { /* node:sqlite not available */ }

// ── Infrastructure file allowlist (not instruction data) ─────────────────────
const INFRA_FILES = new Set([
  'bootstrap.confirmed.json',
  '_manifest.json',
  '_skipped.json',
]);

/**
 * Returns instruction .json files found on disk, excluding infrastructure files
 * and non-.json files like .index-version.
 */
function instructionJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f =>
    f.endsWith('.json') && !INFRA_FILES.has(f)
  );
}

/**
 * Returns all .db files found in the given directory tree.
 */
function dbFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) {
    if (f.endsWith('.db') || f.endsWith('.db-wal') || f.endsWith('.db-shm')) {
      result.push(f);
    }
  }
  return result;
}

function call(name: string, params: unknown): unknown {
  const handler = getHandler(name);
  if (!handler) throw new Error(`Handler ${name} not registered`);
  return handler(params);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1: SQLite mode — NO instruction .json files on disk
// ═══════════════════════════════════════════════════════════════════════════════

describe.skipIf(!hasSqlite)('Backend Isolation — SQLite mode (no instruction .json on disk)', () => {
  const TMP_ROOT = path.join(os.tmpdir(), `iso-sqlite-${Date.now()}`);
  const INST_DIR = path.join(TMP_ROOT, 'instructions');
  const DB_PATH = path.join(TMP_ROOT, 'isolation-test.db');
  const SNAP_PATH = path.join(TMP_ROOT, 'usage-snapshot.json');

  function getStore(): IInstructionStore {
    return createStore('sqlite', INST_DIR, DB_PATH);
  }

  /** Seed an entry via writeEntry (goes through store) */
  function seedEntry(id: string, overrides?: Partial<InstructionEntry>): void {
    const now = new Date().toISOString();
    ctxWriteEntry({
      id,
      title: `Test ${id}`,
      body: overrides?.body ?? `Body for ${id}`,
      priority: 50,
      categories: ['test'],
      primaryCategory: 'test',
      schemaVersion: '0.4.0',
      sourceHash: overrides?.sourceHash ?? 'seed-hash',
      createdAt: now,
      updatedAt: now,
      version: '1.0.0',
      ...overrides,
    } as InstructionEntry);
  }

  beforeAll(async () => {
    fs.mkdirSync(INST_DIR, { recursive: true });
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = INST_DIR;
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'sqlite';
    process.env.INDEX_SERVER_SQLITE_PATH = DB_PATH;
    process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = SNAP_PATH;
    process.env.INDEX_SERVER_FEATURES = 'usage';
    process.env.INDEX_SERVER_DISABLE_RATE_LIMIT = '1';
    reloadRuntimeConfig();
    await import('../../../services/handlers.instructions.js');
    forceBootstrapConfirmForTests('isolation-sqlite');
  });

  beforeEach(() => { invalidate(); });

  afterAll(() => {
    try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.INDEX_SERVER_STORAGE_BACKEND;
    delete process.env.INDEX_SERVER_SQLITE_PATH;
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MUTATION;
    delete process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH;
    delete process.env.INDEX_SERVER_FEATURES;
    delete process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
  });

  // ── Baseline ────────────────────────────────────────────────────────

  it('baseline: empty instructions dir has zero instruction .json files', () => {
    expect(instructionJsonFiles(INST_DIR)).toEqual([]);
  });

  // ── index_add ───────────────────────────────────────────────────────

  it('index_add does not create instruction .json file', async () => {
    const id = `iso-add-${Date.now()}`;
    await call('index_add', { entry: { id, title: `Add ${id}`, body: `Body ${id}` } });
    const leaked = instructionJsonFiles(INST_DIR);
    expect(leaked).toEqual([]);
    // Verify data IS in SQLite
    const store = getStore();
    expect(store.get(id)).not.toBeNull();
    store.close();
  });

  // ── index_import ────────────────────────────────────────────────────

  it('index_import does not create instruction .json files', async () => {
    const id = `iso-import-${Date.now()}`;
    await call('index_import', {
      entries: [{ id, title: `Import ${id}`, body: `Body ${id}`, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] }],
      mode: 'overwrite',
    });
    const leaked = instructionJsonFiles(INST_DIR);
    expect(leaked).toEqual([]);
    const store = getStore();
    expect(store.get(id)).not.toBeNull();
    store.close();
  });

  // ── index_remove ────────────────────────────────────────────────────

  it('index_remove does not leave or create instruction .json files', async () => {
    const id = `iso-remove-${Date.now()}`;
    seedEntry(id);
    invalidate();
    await call('index_remove', { ids: [id] });
    const leaked = instructionJsonFiles(INST_DIR);
    expect(leaked).toEqual([]);
  });

  // ── index_governanceUpdate ──────────────────────────────────────────

  it('index_governanceUpdate does not create instruction .json file', async () => {
    const id = `iso-patch-${Date.now()}`;
    seedEntry(id, { owner: 'original-owner' });
    invalidate();
    ensureLoaded();
    await call('index_governanceUpdate', { id, owner: 'new-owner' });
    const leaked = instructionJsonFiles(INST_DIR);
    expect(leaked).toEqual([]);
    const store = getStore();
    const updated = store.get(id);
    expect(updated).not.toBeNull();
    expect(updated!.owner).toBe('new-owner');
    store.close();
  });

  // ── index_enrich ────────────────────────────────────────────────────

  it('index_enrich does not create instruction .json files', async () => {
    const id = `iso-enrich-${Date.now()}`;
    seedEntry(id, { sourceHash: '', body: 'Enrich isolation body' });
    invalidate();
    ensureLoaded();
    await call('index_enrich', {});
    const leaked = instructionJsonFiles(INST_DIR);
    expect(leaked).toEqual([]);
  });

  // ── index_repair ────────────────────────────────────────────────────

  it('index_repair does not create instruction .json files', async () => {
    const id = `iso-repair-${Date.now()}`;
    seedEntry(id, { sourceHash: 'a'.repeat(64), body: 'Repair isolation body' });
    invalidate();
    ensureLoaded();
    await call('index_repair', {});
    const leaked = instructionJsonFiles(INST_DIR);
    expect(leaked).toEqual([]);
  });

  // ── index_groom ─────────────────────────────────────────────────────

  it('index_groom does not create instruction .json files', async () => {
    const id = `iso-groom-${Date.now()}`;
    seedEntry(id, { sourceHash: 'wrong-hash', categories: ['Test', 'TEST', 'test'], body: 'Groom isolation body' });
    invalidate();
    ensureLoaded();
    await call('index_groom', { mode: {} });
    const leaked = instructionJsonFiles(INST_DIR);
    expect(leaked).toEqual([]);
  });

  // ── index_normalize ─────────────────────────────────────────────────

  it('index_normalize does not create instruction .json files', async () => {
    const id = `iso-normalize-${Date.now()}`;
    // Write directly to store to bypass ClassificationService.normalize()
    const store = getStore();
    store.write({
      id,
      title: `Test ${id}`,
      body: 'Normalize isolation body',
      priority: 50,
      categories: ['test'],
      primaryCategory: 'test',
      schemaVersion: '0.4.0',
      sourceHash: 'a'.repeat(64),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 'not-semver',
    } as InstructionEntry);
    store.close();
    invalidate();
    ensureLoaded();
    await call('index_normalize', { dryRun: false });
    const leaked = instructionJsonFiles(INST_DIR);
    expect(leaked).toEqual([]);
  });

  // ── Aggregate stress check ──────────────────────────────────────────

  it('multiple mutations in sequence produce zero leaked .json files', async () => {
    const ts = Date.now();
    // add
    await call('index_add', { entry: { id: `iso-multi-add-${ts}`, title: 'Multi add', body: 'Multi body' } });
    // import
    await call('index_import', {
      entries: [{ id: `iso-multi-import-${ts}`, title: 'Multi import', body: 'Multi import body', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] }],
      mode: 'overwrite',
    });
    // governanceUpdate
    seedEntry(`iso-multi-patch-${ts}`, { owner: 'old' });
    invalidate(); ensureLoaded();
    await call('index_governanceUpdate', { id: `iso-multi-patch-${ts}`, owner: 'new' });
    // groom
    invalidate(); ensureLoaded();
    await call('index_groom', { mode: {} });
    // remove
    await call('index_remove', { ids: [`iso-multi-add-${ts}`] });

    const leaked = instructionJsonFiles(INST_DIR);
    expect(leaked).toEqual([]);

    // Verify surviving entries are in SQLite
    const store = getStore();
    expect(store.get(`iso-multi-import-${ts}`)).not.toBeNull();
    expect(store.get(`iso-multi-patch-${ts}`)).not.toBeNull();
    expect(store.get(`iso-multi-add-${ts}`)).toBeNull(); // removed
    store.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2: JSON mode — NO .db files on disk
// ═══════════════════════════════════════════════════════════════════════════════

describe('Backend Isolation — JSON mode (no .db files on disk)', () => {
  const TMP_ROOT = path.join(os.tmpdir(), `iso-json-${Date.now()}`);
  const INST_DIR = path.join(TMP_ROOT, 'instructions');
  const SNAP_PATH = path.join(TMP_ROOT, 'usage-snapshot.json');

  beforeAll(async () => {
    fs.mkdirSync(INST_DIR, { recursive: true });
    // Write .index-version so JsonFileStore.load() works
    fs.writeFileSync(path.join(INST_DIR, '.index-version'), '0', 'utf-8'); // lgtm[js/insecure-temporary-file] — test fixture inside per-test TMP_ROOT directory
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = INST_DIR;
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'json';
    delete process.env.INDEX_SERVER_SQLITE_PATH;
    process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = SNAP_PATH;
    process.env.INDEX_SERVER_FEATURES = 'usage';
    process.env.INDEX_SERVER_DISABLE_RATE_LIMIT = '1';
    reloadRuntimeConfig();
    await import('../../../services/handlers.instructions.js');
    forceBootstrapConfirmForTests('isolation-json');
  });

  beforeEach(() => { invalidate(); });

  afterAll(() => {
    try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.INDEX_SERVER_STORAGE_BACKEND;
    delete process.env.INDEX_SERVER_SQLITE_PATH;
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MUTATION;
    delete process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH;
    delete process.env.INDEX_SERVER_FEATURES;
    delete process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
  });

  // ── Baseline ────────────────────────────────────────────────────────

  it('baseline: no .db files exist before any operations', () => {
    expect(dbFiles(TMP_ROOT)).toEqual([]);
  });

  // ── index_add ───────────────────────────────────────────────────────

  it('index_add creates .json but no .db file', async () => {
    const id = `iso-json-add-${Date.now()}`;
    await call('index_add', { entry: { id, title: `Add ${id}`, body: `Body ${id}` } });
    expect(dbFiles(TMP_ROOT)).toEqual([]);
    // Verify instruction .json IS created on disk
    expect(fs.existsSync(path.join(INST_DIR, `${id}.json`))).toBe(true);
  });

  // ── index_import ────────────────────────────────────────────────────

  it('index_import creates .json but no .db file', async () => {
    const id = `iso-json-import-${Date.now()}`;
    await call('index_import', {
      entries: [{ id, title: `Import ${id}`, body: `Body ${id}`, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] }],
      mode: 'overwrite',
    });
    expect(dbFiles(TMP_ROOT)).toEqual([]);
    expect(fs.existsSync(path.join(INST_DIR, `${id}.json`))).toBe(true);
  });

  // ── index_remove ────────────────────────────────────────────────────

  it('index_remove removes .json and creates no .db file', async () => {
    const id = `iso-json-remove-${Date.now()}`;
    await call('index_add', { entry: { id, title: `Rm ${id}`, body: `Body ${id}` } });
    invalidate();
    await call('index_remove', { ids: [id] });
    expect(dbFiles(TMP_ROOT)).toEqual([]);
    expect(fs.existsSync(path.join(INST_DIR, `${id}.json`))).toBe(false);
  });

  // ── index_governanceUpdate ──────────────────────────────────────────

  it('index_governanceUpdate writes to .json and creates no .db file', async () => {
    const id = `iso-json-patch-${Date.now()}`;
    await call('index_add', { entry: { id, title: `Patch ${id}`, body: `Body ${id}` } });
    invalidate(); ensureLoaded();
    await call('index_governanceUpdate', { id, owner: 'test-owner' });
    expect(dbFiles(TMP_ROOT)).toEqual([]);
    const jsonPath = path.join(INST_DIR, `${id}.json`);
    expect(fs.existsSync(jsonPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(data.owner).toBe('test-owner');
  });

  // ── index_groom ─────────────────────────────────────────────────────

  it('index_groom writes to .json and creates no .db file', async () => {
    const id = `iso-json-groom-${Date.now()}`;
    await call('index_add', { entry: { id, title: `Groom ${id}`, body: `Body ${id}`, categories: ['A', 'a', 'A'] } });
    invalidate(); ensureLoaded();
    await call('index_groom', { mode: {} });
    expect(dbFiles(TMP_ROOT)).toEqual([]);
  });

  // ── Aggregate ───────────────────────────────────────────────────────

  it('multiple mutations in JSON mode produce zero .db files', async () => {
    const ts = Date.now();
    await call('index_add', { entry: { id: `iso-jm-add-${ts}`, title: 'JM add', body: 'JM body' } });
    await call('index_import', {
      entries: [{ id: `iso-jm-import-${ts}`, title: 'JM import', body: 'JM import body' }],
      mode: 'overwrite',
    });
    invalidate(); ensureLoaded();
    await call('index_governanceUpdate', { id: `iso-jm-add-${ts}`, owner: 'jm-owner' });
    invalidate(); ensureLoaded();
    await call('index_groom', { mode: {} });
    await call('index_remove', { ids: [`iso-jm-import-${ts}`] });

    expect(dbFiles(TMP_ROOT)).toEqual([]);
    // add entry still exists as .json
    expect(fs.existsSync(path.join(INST_DIR, `iso-jm-add-${ts}.json`))).toBe(true);
    // import entry removed
    expect(fs.existsSync(path.join(INST_DIR, `iso-jm-import-${ts}.json`))).toBe(false);
  });
});
