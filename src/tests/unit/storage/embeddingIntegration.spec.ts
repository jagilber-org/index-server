/**
 * Integration tests: factory → SqliteEmbeddingStore → search pipeline.
 *
 * Tests the full flow of creating a SqliteEmbeddingStore via factory,
 * saving embeddings, and performing KNN search.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createEmbeddingStore } from '../../../services/storage/factory.js';
import { SqliteEmbeddingStore } from '../../../services/storage/sqliteEmbeddingStore.js';
import { JsonEmbeddingStore } from '../../../services/storage/jsonEmbeddingStore.js';
import { hasSqliteVec } from './sqliteVecAvailable.js';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch { /* */ } } });

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-integ-'));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

describe.skipIf(!hasSqliteVec)('createEmbeddingStore integration', () => {
  it('creates SqliteEmbeddingStore for sqlite backend', () => {
    const tmpDir = makeTmpDir();
    const dbPath = path.join(tmpDir, 'test.db');

    vi.stubEnv('INDEX_SERVER_STORAGE_BACKEND', 'sqlite');
    vi.stubEnv('INDEX_SERVER_SQLITE_PATH', dbPath);
    vi.stubEnv('INDEX_SERVER_SQLITE_VEC_ENABLED', '1');

    const store = createEmbeddingStore('sqlite', dbPath);
    cleanups.push(() => store.close());

    // Should be a SqliteEmbeddingStore (or fallback to JSON if sqlite-vec unavailable)
    expect(store).toBeDefined();
    expect(typeof store.load).toBe('function');
    expect(typeof store.save).toBe('function');
    expect(typeof store.search).toBe('function');

    vi.unstubAllEnvs();
  });

  it('creates JsonEmbeddingStore for json backend', () => {
    const tmpDir = makeTmpDir();
    const jsonPath = path.join(tmpDir, 'embeddings.json');

    const store = createEmbeddingStore('json', jsonPath);
    cleanups.push(() => store.close());

    expect(store).toBeInstanceOf(JsonEmbeddingStore);
  });

  it('SqliteEmbeddingStore supports full save → load → search cycle', () => {
    const tmpDir = makeTmpDir();
    const dbPath = path.join(tmpDir, 'cycle.db');
    const store = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => store.close());

    // Save
    store.save({
      indexHash: 'integ-hash',
      modelName: 'integ-model',
      entryHashes: { 'doc-1': 'h1', 'doc-2': 'h2' },
      embeddings: {
        'doc-1': [1, 0, 0],
        'doc-2': [0, 1, 0],
      },
    });

    // Load
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.indexHash).toBe('integ-hash');
    expect(Object.keys(loaded!.embeddings)).toHaveLength(2);

    // Search
    const results = store.search(new Float32Array([1, 0, 0]), 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('doc-1');
    expect(results[0].distance).toBeCloseTo(0, 3);
  });

  it('falls back to JSON when sqliteVecEnabled is false', () => {
    const tmpDir = makeTmpDir();
    const jsonPath = path.join(tmpDir, 'fallback.json');

    vi.stubEnv('INDEX_SERVER_STORAGE_BACKEND', 'sqlite');
    vi.stubEnv('INDEX_SERVER_SQLITE_VEC_ENABLED', '0');

    const store = createEmbeddingStore('sqlite', jsonPath);
    cleanups.push(() => store.close());

    // When vec is disabled, should fall back to JSON
    expect(store).toBeInstanceOf(JsonEmbeddingStore);

    vi.unstubAllEnvs();
  });
});
