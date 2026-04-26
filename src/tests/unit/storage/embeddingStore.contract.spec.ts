/**
 * Contract tests for IEmbeddingStore implementations.
 *
 * Parameterized: run against JsonEmbeddingStore (SqliteEmbeddingStore added when sqlite-vec is available).
 * Defines the behavioral contract that any embedding storage backend must satisfy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonEmbeddingStore } from '../../../services/storage/jsonEmbeddingStore.js';
import { SqliteEmbeddingStore } from '../../../services/storage/sqliteEmbeddingStore.js';
import { hasSqliteVec } from './sqliteVecAvailable.js';
import type { IEmbeddingStore, EmbeddingCacheData } from '../../../services/storage/types.js';

// ── Test Fixtures ────────────────────────────────────────────────────────────

/** Compare vectors with float32 tolerance (sqlite stores float32, not float64). */
function expectVecClose(actual: number[], expected: number[], precision = 5): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], precision);
  }
}

function makeCacheData(overrides?: Partial<EmbeddingCacheData>): EmbeddingCacheData {
  return {
    indexHash: 'hash-v1',
    modelName: 'test-model',
    entryHashes: { 'inst-1': 'sha-1', 'inst-2': 'sha-2' },
    embeddings: {
      'inst-1': [0.1, 0.2, 0.3],
      'inst-2': [0.4, 0.5, 0.6],
    },
    ...overrides,
  };
}

// ── Parameterized Contract Suite ─────────────────────────────────────────────

interface StoreFactory {
  name: string;
  create: () => { store: IEmbeddingStore; cleanup: () => void };
}

const backends: StoreFactory[] = [
  {
    name: 'JsonEmbeddingStore',
    create: () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-contract-'));
      const filePath = path.join(tmpDir, 'embeddings.json');
      const store = new JsonEmbeddingStore(filePath);
      return {
        store,
        cleanup: () => {
          store.close();
          fs.rmSync(tmpDir, { recursive: true, force: true });
        },
      };
    },
  },
  // SqliteEmbeddingStore will be added here when sqlite-vec is available
  {
    name: 'SqliteEmbeddingStore',
    create: () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-sqlite-contract-'));
      const dbPath = path.join(tmpDir, 'test-embeddings.db');
      const store = new SqliteEmbeddingStore(dbPath, 3);
      return {
        store,
        cleanup: () => {
          store.close();
          fs.rmSync(tmpDir, { recursive: true, force: true });
        },
      };
    },
  },
];

for (const backend of backends) {
  describe.skipIf(backend.name === 'SqliteEmbeddingStore' && !hasSqliteVec)(`IEmbeddingStore contract: ${backend.name}`, () => {
    let store: IEmbeddingStore;
    let cleanup: () => void;

    beforeEach(() => {
      ({ store, cleanup } = backend.create());
    });

    afterEach(() => {
      cleanup();
    });

    // ── save() + load() roundtrip ──────────────────────────────────────

    it('save() then load() roundtrips vectors correctly', () => {
      const data = makeCacheData();
      store.save(data);

      const loaded = store.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.indexHash).toBe('hash-v1');
      expect(loaded!.modelName).toBe('test-model');
      expectVecClose(loaded!.embeddings['inst-1'], [0.1, 0.2, 0.3]);
      expectVecClose(loaded!.embeddings['inst-2'], [0.4, 0.5, 0.6]);
    });

    it('load() returns null when no data exists', () => {
      expect(store.load()).toBeNull();
    });

    it('save() preserves modelName and entryHashes', () => {
      const data = makeCacheData({
        modelName: 'custom-model',
        entryHashes: { 'inst-1': 'hash-a', 'inst-2': 'hash-b' },
      });
      store.save(data);

      const loaded = store.load();
      expect(loaded!.modelName).toBe('custom-model');
      expect(loaded!.entryHashes).toEqual({ 'inst-1': 'hash-a', 'inst-2': 'hash-b' });
    });

    it('save() with empty embeddings map succeeds', () => {
      const data = makeCacheData({ embeddings: {} });
      store.save(data);

      const loaded = store.load();
      expect(loaded).not.toBeNull();
      expect(Object.keys(loaded!.embeddings)).toHaveLength(0);
    });

    // ── isStale via indexHash comparison ────────────────────────────────

    it('detects stale data when indexHash differs', () => {
      const data = makeCacheData({ indexHash: 'old-hash' });
      store.save(data);

      const loaded = store.load();
      expect(loaded!.indexHash).toBe('old-hash');
      // Caller compares loaded.indexHash !== currentIndexHash
      expect(loaded!.indexHash !== 'new-hash').toBe(true);
    });

    it('detects fresh data when indexHash matches', () => {
      const data = makeCacheData({ indexHash: 'current-hash' });
      store.save(data);

      const loaded = store.load();
      expect(loaded!.indexHash !== 'current-hash').toBe(false);
    });

    // ── search() KNN ───────────────────────────────────────────────────

    it('search() returns nearest vectors sorted by distance', () => {
      const data = makeCacheData({
        embeddings: {
          'close': [1.0, 0.0, 0.0],
          'medium': [0.7, 0.7, 0.0],
          'far': [0.0, 0.0, 1.0],
        },
      });
      store.save(data);

      const query = new Float32Array([1.0, 0.0, 0.0]);
      const results = store.search(query, 3);

      expect(results).toHaveLength(3);
      // Closest should be 'close' (distance ≈ 0)
      expect(results[0].id).toBe('close');
      expect(results[0].distance).toBeCloseTo(0, 1);
      // Farthest should be 'far' (distance ≈ 1)
      expect(results[results.length - 1].id).toBe('far');
    });

    it('search() with limit=0 returns empty', () => {
      const data = makeCacheData();
      store.save(data);

      const results = store.search(new Float32Array([1, 0, 0]), 0);
      expect(results).toHaveLength(0);
    });

    it('search() on empty store returns empty', () => {
      const results = store.search(new Float32Array([1, 0, 0]), 10);
      expect(results).toHaveLength(0);
    });

    // ── Overwrite and prune ────────────────────────────────────────────

    it('overwriting existing embedding for same ID succeeds', () => {
      store.save(makeCacheData({
        embeddings: { 'inst-1': [0.1, 0.2, 0.3] },
      }));

      store.save(makeCacheData({
        embeddings: { 'inst-1': [0.9, 0.8, 0.7] },
      }));

      const loaded = store.load();
      expectVecClose(loaded!.embeddings['inst-1'], [0.9, 0.8, 0.7]);
    });

    it('deleted instruction ID is absent after save without it', () => {
      store.save(makeCacheData({
        embeddings: { 'keep': [1, 2, 3], 'remove': [4, 5, 6] },
      }));

      // Save again without 'remove'
      store.save(makeCacheData({
        embeddings: { 'keep': [1, 2, 3] },
      }));

      const loaded = store.load();
      expect(loaded!.embeddings['keep']).toBeDefined();
      expect(loaded!.embeddings['remove']).toBeUndefined();
    });
  });
}
