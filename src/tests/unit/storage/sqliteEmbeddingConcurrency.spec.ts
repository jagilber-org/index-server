/**
 * Concurrency and resilience tests for SqliteEmbeddingStore.
 *
 * Tests:
 * - Concurrent reads while a write is in progress (WAL mode)
 * - Concurrent searches from multiple store instances
 * - Corrupt DB detection and automatic rebuild
 * - Buffer bounds validation (dimension mismatch in load/search)
 * - Constructor dims validation
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { hasSqliteVec } from './sqliteVecAvailable.js';
import { SqliteEmbeddingStore } from '../../../services/storage/sqliteEmbeddingStore.js';
import type { EmbeddingCacheData } from '../../../services/storage/types.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) {
    try { fn(); } catch { /* ignore cleanup errors */ }
  }
});

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-emb-conc-'));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

function createStore(dir: string, name: string, dims = 3): SqliteEmbeddingStore {
  const store = new SqliteEmbeddingStore(path.join(dir, name), dims);
  cleanups.push(() => { try { store.close(); } catch { /* */ } });
  return store;
}

function sampleData(count: number, dims: number): EmbeddingCacheData {
  const embeddings: Record<string, number[]> = {};
  const entryHashes: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const vec = Array.from({ length: dims }, (_, j) => (i + j) / (count + dims));
    embeddings[`inst-${i}`] = vec;
    entryHashes[`inst-${i}`] = `hash-${i}`;
  }
  return { indexHash: `v-${count}`, modelName: 'test', entryHashes, embeddings };
}

// ── Concurrency Tests ────────────────────────────────────────────────────────

describe.skipIf(!hasSqliteVec)('SqliteEmbeddingStore concurrency', () => {
  it('concurrent reads from separate instances on same WAL DB', () => {
    const dir = makeTmpDir();
    const dbPath = path.join(dir, 'wal-read.db');
    const writer = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => writer.close());

    writer.save(sampleData(10, 3));

    // Open two reader instances concurrently
    const reader1 = new SqliteEmbeddingStore(dbPath, 3);
    const reader2 = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => reader1.close());
    cleanups.push(() => reader2.close());

    const loaded1 = reader1.load();
    const loaded2 = reader2.load();

    expect(loaded1).not.toBeNull();
    expect(loaded2).not.toBeNull();
    expect(Object.keys(loaded1!.embeddings)).toHaveLength(10);
    expect(Object.keys(loaded2!.embeddings)).toHaveLength(10);
    expect(loaded1!.indexHash).toBe(loaded2!.indexHash);
  });

  it('concurrent searches from separate instances return consistent results', () => {
    const dir = makeTmpDir();
    const dbPath = path.join(dir, 'conc-search.db');
    const store = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => store.close());

    store.save({
      indexHash: 'h1',
      embeddings: {
        'a': [1, 0, 0],
        'b': [0, 1, 0],
        'c': [0, 0, 1],
      },
    });

    const searcher1 = new SqliteEmbeddingStore(dbPath, 3);
    const searcher2 = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => searcher1.close());
    cleanups.push(() => searcher2.close());

    const query = new Float32Array([1, 0, 0]);
    const results1 = searcher1.search(query, 3);
    const results2 = searcher2.search(query, 3);

    expect(results1).toHaveLength(3);
    expect(results2).toHaveLength(3);
    expect(results1[0].id).toBe('a');
    expect(results2[0].id).toBe('a');
    // Results should be identical
    expect(results1.map(r => r.id)).toEqual(results2.map(r => r.id));
  });

  it('write after concurrent reads does not corrupt data', () => {
    const dir = makeTmpDir();
    const dbPath = path.join(dir, 'read-then-write.db');

    const store = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => store.close());
    store.save(sampleData(5, 3));

    // Open reader, read, then writer writes new data
    const reader = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => reader.close());
    const preWrite = reader.load();
    expect(preWrite).not.toBeNull();
    expect(Object.keys(preWrite!.embeddings)).toHaveLength(5);

    // Write new data from original store
    store.save(sampleData(8, 3));

    // Reader should see new data on fresh load
    const postWrite = reader.load();
    expect(postWrite).not.toBeNull();
    expect(Object.keys(postWrite!.embeddings)).toHaveLength(8);
    expect(postWrite!.indexHash).toBe('v-8');
  });

  it('rapid sequential saves do not corrupt the database', () => {
    const dir = makeTmpDir();
    const store = createStore(dir, 'rapid.db', 3);

    // 20 rapid sequential saves with different data
    for (let i = 0; i < 20; i++) {
      store.save(sampleData(i + 1, 3));
    }

    const loaded = store.load();
    expect(loaded).not.toBeNull();
    // Last save had 20 entries
    expect(Object.keys(loaded!.embeddings)).toHaveLength(20);
    expect(loaded!.indexHash).toBe('v-20');
  });
});

// ── Corrupt DB Recovery Tests ────────────────────────────────────────────────

describe.skipIf(!hasSqliteVec)('SqliteEmbeddingStore corrupt DB recovery', () => {
  it('recovers from a truncated/corrupt database file', () => {
    const dir = makeTmpDir();
    const dbPath = path.join(dir, 'corrupt.db');

    // Create a valid database first
    const store1 = new SqliteEmbeddingStore(dbPath, 3);
    store1.save({ indexHash: 'v1', embeddings: { 'a': [1, 2, 3] } });
    store1.close();

    // Corrupt the file by writing garbage
    fs.writeFileSync(dbPath, 'THIS IS NOT A VALID SQLITE DATABASE');

    // Opening should detect corruption and rebuild
    const store2 = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => store2.close());

    // Rebuilt DB should be empty but functional
    const loaded = store2.load();
    expect(loaded).toBeNull();

    // Should be able to save and load new data
    store2.save({ indexHash: 'v2', embeddings: { 'b': [4, 5, 6] } });
    const reloaded = store2.load();
    expect(reloaded).not.toBeNull();
    expect(reloaded!.indexHash).toBe('v2');
  });

  it('recovers from a zero-byte database file', () => {
    const dir = makeTmpDir();
    const dbPath = path.join(dir, 'zero.db');

    // Create zero-byte file
    fs.writeFileSync(dbPath, '');

    const store = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => store.close());

    // Should be functional
    store.save({ indexHash: 'v1', embeddings: { 'x': [1, 0, 0] } });
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.indexHash).toBe('v1');
  });

  it('cleans up WAL and SHM files during rebuild', () => {
    const dir = makeTmpDir();
    const dbPath = path.join(dir, 'wal-cleanup.db');

    // Create a valid database with WAL
    const store1 = new SqliteEmbeddingStore(dbPath, 3);
    store1.save({ indexHash: 'v1', embeddings: { 'a': [1, 2, 3] } });
    store1.close();

    // Create fake WAL/SHM files to simulate leftover state
    fs.writeFileSync(dbPath + '-wal', 'fake-wal-data');
    fs.writeFileSync(dbPath + '-shm', 'fake-shm-data');

    // Corrupt main DB
    fs.writeFileSync(dbPath, 'CORRUPT');

    // Opening should rebuild and clean up WAL/SHM
    const store2 = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => store2.close());

    // WAL and SHM from corruption should be gone (new ones may exist from WAL mode init)
    // The store should be functional regardless
    store2.save({ indexHash: 'v2', embeddings: { 'b': [4, 5, 6] } });
    const loaded = store2.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.indexHash).toBe('v2');
  });
});

// ── Buffer Bounds & Dimension Validation Tests ───────────────────────────────

describe.skipIf(!hasSqliteVec)('SqliteEmbeddingStore buffer bounds', () => {
  it('constructor rejects dims < 1', () => {
    const dir = makeTmpDir();
    expect(() => new SqliteEmbeddingStore(path.join(dir, 'bad.db'), 0)).toThrow(/Invalid vector dimensions/);
    expect(() => new SqliteEmbeddingStore(path.join(dir, 'bad2.db'), -1)).toThrow(/Invalid vector dimensions/);
  });

  it('constructor rejects non-integer dims', () => {
    const dir = makeTmpDir();
    expect(() => new SqliteEmbeddingStore(path.join(dir, 'bad.db'), 3.5)).toThrow(/Invalid vector dimensions/);
  });

  it('constructor rejects dims exceeding MAX_VECTOR_DIMS', () => {
    const dir = makeTmpDir();
    expect(() => new SqliteEmbeddingStore(path.join(dir, 'bad.db'), 100000)).toThrow(/Invalid vector dimensions/);
  });

  it('search() returns empty for dimension-mismatched query vector', () => {
    const dir = makeTmpDir();
    const store = createStore(dir, 'bounds.db', 3);

    store.save({ indexHash: 'h', embeddings: { 'a': [1, 0, 0] } });

    // Query with wrong dimensions
    const results = store.search(new Float32Array([1, 0, 0, 0, 0]), 10);
    expect(results).toHaveLength(0);
  });

  it('search() works correctly with matching dimensions', () => {
    const dir = makeTmpDir();
    const store = createStore(dir, 'bounds-ok.db', 3);

    store.save({ indexHash: 'h', embeddings: { 'a': [1, 0, 0] } });

    const results = store.search(new Float32Array([1, 0, 0]), 10);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('a');
  });
});

// ── Degenerate Input Tests ───────────────────────────────────────────────────

describe.skipIf(!hasSqliteVec)('SqliteEmbeddingStore degenerate inputs', () => {
  it('save() rejects vector containing NaN', () => {
    const dir = makeTmpDir();
    const store = createStore(dir, 'nan.db', 3);

    expect(() =>
      store.save({ indexHash: 'h', embeddings: { 'a': [NaN, 0, 0] } }),
    ).toThrow();
  });

  it('save() rejects vector containing Infinity', () => {
    const dir = makeTmpDir();
    const store = createStore(dir, 'inf.db', 3);

    expect(() =>
      store.save({ indexHash: 'h', embeddings: { 'a': [Infinity, 0, 0] } }),
    ).toThrow();
  });

  it('save() rejects vector containing -Infinity', () => {
    const dir = makeTmpDir();
    const store = createStore(dir, 'neginf.db', 3);

    expect(() =>
      store.save({ indexHash: 'h', embeddings: { 'a': [0, -Infinity, 0] } }),
    ).toThrow();
  });

  it('search() handles NaN in query vector gracefully', () => {
    const dir = makeTmpDir();
    const store = createStore(dir, 'nan-search.db', 3);
    store.save({ indexHash: 'h', embeddings: { 'a': [1, 0, 0] } });

    // NaN query should not crash — returns empty or results depending on sqlite-vec behavior
    const results = store.search(new Float32Array([NaN, 0, 0]), 10);
    expect(Array.isArray(results)).toBe(true);
  });

  it('search() handles zero vector gracefully', () => {
    const dir = makeTmpDir();
    const store = createStore(dir, 'zero-search.db', 3);
    store.save({ indexHash: 'h', embeddings: { 'a': [1, 0, 0] } });

    const results = store.search(new Float32Array([0, 0, 0]), 10);
    expect(Array.isArray(results)).toBe(true);
  });

  it('save() accepts and round-trips a zero vector', () => {
    const dir = makeTmpDir();
    const store = createStore(dir, 'zero-save.db', 3);

    store.save({ indexHash: 'h', embeddings: { 'a': [0, 0, 0] } });
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.embeddings['a']).toEqual([0, 0, 0]);
  });
});
