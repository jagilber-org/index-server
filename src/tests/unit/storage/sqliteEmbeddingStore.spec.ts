/**
 * SqliteEmbeddingStore-specific tests.
 *
 * Tests behavior unique to the sqlite-vec backed store:
 * - vec0 KNN search with real sqlite-vec
 * - Dimension mismatch error
 * - Transaction rollback on error
 * - WAL mode and metadata persistence
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { hasSqliteVec } from './sqliteVecAvailable.js';
import { SqliteEmbeddingStore } from '../../../services/storage/sqliteEmbeddingStore.js';
import type { EmbeddingCacheData } from '../../../services/storage/types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-emb-'));
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  // Run cleanups in reverse order (close stores before removing dirs)
  for (const fn of cleanups.splice(0).reverse()) {
    try { fn(); } catch { /* ignore cleanup errors */ }
  }
});

function createStore(dims: number = 4): { store: SqliteEmbeddingStore; tmpDir: string } {
  const tmpDir = makeTmpDir();
  const store = new SqliteEmbeddingStore(path.join(tmpDir, 'test.db'), dims);
  cleanups.push(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  return { store, tmpDir };
}

describe.skipIf(!hasSqliteVec)('SqliteEmbeddingStore-specific', () => {
  it('vec0 KNN returns correct ordering for known vectors', () => {
    const { store } = createStore(3);
    store.save({
      indexHash: 'h1',
      modelName: 'test',
      embeddings: {
        'exact': [1, 0, 0],
        'close': [0.9, 0.1, 0],
        'far': [0, 0, 1],
      },
    });

    const results = store.search(new Float32Array([1, 0, 0]), 3);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe('exact');
    expect(results[0].distance).toBeCloseTo(0, 3);
    expect(results[1].id).toBe('close');
    expect(results[2].id).toBe('far');
  });

  it('search() with limit smaller than total returns only limit results', () => {
    const { store } = createStore(2);
    store.save({
      indexHash: 'h',
      embeddings: {
        'a': [1, 0],
        'b': [0, 1],
        'c': [0.5, 0.5],
      },
    });
    const results = store.search(new Float32Array([1, 0]), 1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
  });

  it('save() throws on dimension mismatch', () => {
    const { store } = createStore(4);
    expect(() =>
      store.save({
        indexHash: 'h',
        embeddings: { 'bad': [1, 2] }, // 2 dims, store expects 4
      }),
    ).toThrow(/dimension mismatch/i);
  });

  it('failed save rolls back — no partial data', () => {
    const { store } = createStore(3);
    // First, save valid data
    store.save({
      indexHash: 'good',
      embeddings: { 'valid': [1, 2, 3] },
    });

    // Attempt save with bad data — should throw and rollback
    expect(() =>
      store.save({
        indexHash: 'bad',
        embeddings: { 'ok': [4, 5, 6], 'wrong-dim': [1, 2] },
      }),
    ).toThrow(/dimension mismatch/i);

    // Original data should still be intact
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.indexHash).toBe('good');
    expect(loaded!.embeddings['valid']).toBeDefined();
    expect(loaded!.embeddings['ok']).toBeUndefined();
  });

  it('persists across close and reopen', () => {
    const tmpDir = makeTmpDir();
    const dbPath = path.join(tmpDir, 'persist.db');
    cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    const store1 = new SqliteEmbeddingStore(dbPath, 3);
    store1.save({
      indexHash: 'h1',
      modelName: 'persist-model',
      embeddings: { 'inst-1': [1, 2, 3] },
    });
    store1.close();

    const store2 = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => store2.close());
    const loaded = store2.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.indexHash).toBe('h1');
    expect(loaded!.modelName).toBe('persist-model');
    expect(loaded!.embeddings['inst-1']).toBeDefined();
  });

  it('close() is idempotent', () => {
    const { store } = createStore(2);
    store.close();
    expect(() => store.close()).not.toThrow();
  });

  it('empty search returns empty array', () => {
    const { store } = createStore(3);
    const results = store.search(new Float32Array([1, 0, 0]), 5);
    expect(results).toHaveLength(0);
  });

  it('search with negative limit returns empty', () => {
    const { store } = createStore(3);
    store.save({ indexHash: 'h', embeddings: { 'a': [1, 0, 0] } });
    const results = store.search(new Float32Array([1, 0, 0]), -1);
    expect(results).toHaveLength(0);
  });
});
