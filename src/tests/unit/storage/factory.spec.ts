/**
 * Unit tests for storage factory — Issue 4 (Node version check) + embedding store factory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('checkNodeVersion', () => {
  let checkNodeVersion: typeof import('../../../services/storage/factory').checkNodeVersion;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../../services/storage/factory.js');
    checkNodeVersion = mod.checkNodeVersion;
  });

  it('does not throw when current version meets minimum', () => {
    // Current Node version is >=22 (required by package.json), so 22.5.0 should pass
    expect(() => checkNodeVersion('22.5.0', 'test feature')).not.toThrow();
  });

  it('does not throw when current version exceeds minimum', () => {
    expect(() => checkNodeVersion('20.0.0', 'test feature')).not.toThrow();
  });

  it('throws clear error when version is below minimum', () => {
    // Use a version higher than any current Node
    expect(() => checkNodeVersion('99.0.0', 'future feature')).toThrow(
      /Node\.js 99\.0\.0\+ required for future feature/,
    );
  });

  it('throws error with upgrade guidance', () => {
    expect(() => checkNodeVersion('99.0.0', 'SQLite storage backend')).toThrow(
      /upgrade Node\.js or switch to the JSON storage backend/,
    );
  });

  it('handles minor version comparison correctly', () => {
    // Use current major + impossibly high minor to guarantee failure
    const major = process.versions.node.split('.')[0];
    expect(() => checkNodeVersion(`${major}.999.0`, 'test')).toThrow();
  });
});

describe('createEmbeddingStore', () => {
  let createEmbeddingStore: typeof import('../../../services/storage/factory').createEmbeddingStore;
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-factory-'));

    vi.doMock('../../../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({
        logging: { level: 'warn', verbose: false, json: false, sync: false, diagnostics: false, protocol: false, sentinelRequested: false },
        storage: { backend: 'json', sqlitePath: path.join(tmpDir, 'test.db') },
        semantic: { embeddingPath: path.join(tmpDir, 'embeddings.json') },
        index: { baseDir: tmpDir },
      }),
    }));

    const mod = await import('../../../services/storage/factory.js');
    createEmbeddingStore = mod.createEmbeddingStore;
  });

  it('returns JsonEmbeddingStore for json backend', () => {
    const store = createEmbeddingStore('json', path.join(tmpDir, 'embeddings.json'));
    expect(store).toBeDefined();
    expect(store.load).toBeTypeOf('function');
    expect(store.save).toBeTypeOf('function');
    expect(store.search).toBeTypeOf('function');
    expect(store.close).toBeTypeOf('function');
    // Verify it's the JSON variant by checking load returns null for missing file
    expect(store.load()).toBeNull();
    store.close();
  });

  it('falls back to JsonEmbeddingStore when sqlite-vec is unavailable', () => {
    // sqlite-vec won't be installed in test env, so it should fall back
    const store = createEmbeddingStore('sqlite', path.join(tmpDir, 'embeddings.json'));
    expect(store).toBeDefined();
    expect(store.load).toBeTypeOf('function');
    store.close();
  });

  it('returns JsonEmbeddingStore immediately when sqliteVecEnabled is explicitly false', async () => {
    // Re-mock with sqliteVecEnabled: false to exercise the early-exit path in factory.ts
    vi.resetModules();
    vi.doMock('../../../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({
        logging: { level: 'warn', verbose: false, json: false, sync: false, diagnostics: false, protocol: false, sentinelRequested: false },
        storage: { backend: 'sqlite', sqlitePath: path.join(tmpDir, 'test.db'), sqliteVecEnabled: false },
        semantic: { embeddingPath: path.join(tmpDir, 'embeddings.json') },
        index: { baseDir: tmpDir },
      }),
    }));
    const { createEmbeddingStore: createStoreDisabled } = await import('../../../services/storage/factory.js');
    const store = createStoreDisabled('sqlite', path.join(tmpDir, 'embeddings.json'));
    expect(store).toBeDefined();
    // When sqliteVecEnabled=false the factory skips sqlite-vec entirely and goes straight to JSON
    expect(store.load).toBeTypeOf('function');
    expect(store.load()).toBeNull(); // JsonEmbeddingStore returns null for missing file
    store.close();
  });
});

describe('parseStorageConfig sqliteVecEnabled auto-derive', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved['INDEX_SERVER_STORAGE_BACKEND'] = process.env.INDEX_SERVER_STORAGE_BACKEND;
    saved['INDEX_SERVER_SQLITE_VEC_ENABLED'] = process.env.INDEX_SERVER_SQLITE_VEC_ENABLED;
  });

  afterEach(() => {
    // Restore original env values
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  it('auto-enables sqliteVecEnabled when backend is sqlite and flag is unset', async () => {
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'sqlite';
    delete process.env.INDEX_SERVER_SQLITE_VEC_ENABLED;
    vi.resetModules();
    const { parseStorageConfig } = await import('../../../config/featureConfig.js');
    const cfg = parseStorageConfig();
    expect(cfg.sqliteVecEnabled).toBe(true);
    expect(cfg.backend).toBe('sqlite');
  });

  it('leaves sqliteVecEnabled false when backend is json and flag is unset', async () => {
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'json';
    delete process.env.INDEX_SERVER_SQLITE_VEC_ENABLED;
    vi.resetModules();
    const { parseStorageConfig } = await import('../../../config/featureConfig.js');
    const cfg = parseStorageConfig();
    expect(cfg.sqliteVecEnabled).toBe(false);
    expect(cfg.backend).toBe('json');
  });

  it('respects explicit INDEX_SERVER_SQLITE_VEC_ENABLED=0 to opt out even for sqlite backend', async () => {
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'sqlite';
    process.env.INDEX_SERVER_SQLITE_VEC_ENABLED = '0';
    vi.resetModules();
    const { parseStorageConfig } = await import('../../../config/featureConfig.js');
    const cfg = parseStorageConfig();
    expect(cfg.sqliteVecEnabled).toBe(false);
    expect(cfg.backend).toBe('sqlite');
  });
});
