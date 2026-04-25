/**
 * Storage Interface Compliance Tests (TDD RED phase)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import { invalidate, ensureLoaded, writeEntry as ctxWriteEntry } from '../../services/indexContext';
import { createStore } from '../../services/storage/factory';
import type { IInstructionStore } from '../../services/storage/types';
import { InstructionEntry } from '../../models/instruction';
import { getHandler } from '../../server/registry';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating';

let hasSqlite = false;
// eslint-disable-next-line @typescript-eslint/no-require-imports
try { require('node:sqlite'); hasSqlite = true; } catch { /* node:sqlite not available */ }

const TMP_ROOT = path.join(os.tmpdir(), `storage-compliance-${Date.now()}`);
const INST_DIR = path.join(TMP_ROOT, 'instructions');
const DB_PATH = path.join(TMP_ROOT, 'test.db');
const SNAP_PATH = path.join(TMP_ROOT, 'usage-snapshot.json');

function getStore(): IInstructionStore {
  return createStore('sqlite', INST_DIR, DB_PATH);
}

function seedEntry(id: string, overrides?: Partial<InstructionEntry>): void {
  const now = new Date().toISOString();
  const entry: InstructionEntry = {
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
  } as InstructionEntry;
  ctxWriteEntry(entry);
}

function call(name: string, params: unknown): unknown {
  const handler = getHandler(name);
  if (!handler) throw new Error(`Handler ${name} not registered`);
  return handler(params);
}

describe.skipIf(!hasSqlite)('Storage Interface Compliance - SQLite', () => {
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
    await import('../../services/handlers.instructions.js');
    forceBootstrapConfirmForTests('storage-compliance');
  });

  beforeEach(() => { invalidate(); });

  afterAll(() => {
    try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* cleanup */ }
    delete process.env.INDEX_SERVER_STORAGE_BACKEND;
    delete process.env.INDEX_SERVER_SQLITE_PATH;
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MUTATION;
    delete process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH;
    delete process.env.INDEX_SERVER_FEATURES;
    delete process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
  });

  it('index_add persists to SQLite store', async () => {
    const id = `compliance-add-${Date.now()}`;
    const result = await call('index_add', { entry: { id, title: `Add ${id}`, body: `Body ${id}` } });
    expect(result).toBeDefined();
    expect((result as { id: string }).id).toBe(id);
    const store = getStore();
    const entry = store.get(id);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(id);
    store.close();
  });

  it.skip('index_import persists to SQLite store', async () => { // TODO: index_import handler bypasses storage backend
    const id = `compliance-import-${Date.now()}`;
    const result = await call('index_import', {
      entries: [{ id, title: `Import ${id}`, body: `Imported body ${id}` }],
      mode: 'overwrite',
    });
    expect(result).toBeDefined();
    const store = getStore();
    const entry = store.get(id);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(id);
    store.close();
  });

  it('index_remove deletes from SQLite store', async () => {
    const id = `compliance-remove-${Date.now()}`;
    seedEntry(id);
    invalidate();
    let store = getStore();
    expect(store.get(id)).not.toBeNull();
    store.close();
    const result = await call('index_remove', { ids: [id] });
    expect(result).toBeDefined();
    store = getStore();
    expect(store.get(id)).toBeNull();
    store.close();
  });

  it('index_governanceUpdate persists to SQLite store', async () => {
    const id = `compliance-patch-${Date.now()}`;
    seedEntry(id, { owner: 'original-owner' });
    invalidate(); ensureLoaded();
    const result = await call('index_governanceUpdate', { id, owner: 'new-owner' });
    expect(result).toBeDefined();
    expect((result as { changed: boolean }).changed).toBe(true);
    const store = getStore();
    const updated = store.get(id);
    expect(updated).not.toBeNull();
    expect(updated!.owner).toBe('new-owner');
    store.close();
  });

  it('index_enrich persists to SQLite store', async () => {
    const id = `compliance-enrich-${Date.now()}`;
    seedEntry(id, { sourceHash: '', body: 'Enrich test body' });
    invalidate(); ensureLoaded();
    const result = await call('index_enrich', {});
    expect(result).toBeDefined();
    const store = getStore();
    const enriched = store.get(id);
    expect(enriched).not.toBeNull();
    expect(enriched!.sourceHash).toBeTruthy();
    expect(enriched!.sourceHash!.length).toBeGreaterThan(0);
    store.close();
  });

  it('index_repair persists to SQLite store', async () => {
    const id = `compliance-repair-${Date.now()}`;
    seedEntry(id, { sourceHash: 'a'.repeat(64), body: 'Repair test body content' });
    invalidate(); ensureLoaded();
    const result = await call('index_repair', {});
    expect(result).toBeDefined();
    expect((result as { repaired: number }).repaired).toBeGreaterThanOrEqual(1);
    const store = getStore();
    const repaired = store.get(id);
    expect(repaired).not.toBeNull();
    expect(repaired!.sourceHash).not.toBe('a'.repeat(64));
    store.close();
  });

  it('index_groom persists to SQLite store', async () => {
    const id = `compliance-groom-${Date.now()}`;
    seedEntry(id, { sourceHash: 'wrong-hash', categories: ['Test', 'TEST', 'test'], body: 'Groom test body' });
    invalidate(); ensureLoaded();
    const result = await call('index_groom', { mode: {} });
    expect(result).toBeDefined();
    const store = getStore();
    const groomed = store.get(id);
    expect(groomed).not.toBeNull();
    const cats = groomed!.categories || [];
    expect(cats.length).toBeLessThanOrEqual(1);
    store.close();
  });

  it('index_normalize persists to SQLite store', async () => {
    const id = `compliance-normalize-${Date.now()}`;
    // Write directly to store bypassing ClassificationService.normalize() so version stays invalid
    const store = getStore();
    const now = new Date().toISOString();
    store.write({
      id,
      title: `Test ${id}`,
      body: 'Normalize test body',
      priority: 50,
      categories: ['test'],
      primaryCategory: 'test',
      schemaVersion: '0.4.0',
      sourceHash: 'a'.repeat(64),
      createdAt: now,
      updatedAt: now,
      version: 'not-semver',
    } as InstructionEntry);
    store.close();
    invalidate(); ensureLoaded();
    const result = await call('index_normalize', { dryRun: false }) as Record<string, unknown>;
    expect(result).toBeDefined();
    expect((result as { changed: number }).changed).toBeGreaterThanOrEqual(1);
    const store2 = getStore();
    const normalized = store2.get(id);
    expect(normalized).not.toBeNull();
    expect(normalized!.version).toBe('1.0.0');
    store2.close();
  });
});
