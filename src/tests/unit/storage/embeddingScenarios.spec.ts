/**
 * Scenario tests for embedding workflows.
 *
 * End-to-end scenarios testing real-world usage patterns:
 * - Config-driven backend selection
 * - Incremental update via IEmbeddingStore
 * - Backend swap (JSON → SQLite migration)
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonEmbeddingStore } from '../../../services/storage/jsonEmbeddingStore.js';
import { SqliteEmbeddingStore } from '../../../services/storage/sqliteEmbeddingStore.js';
import { hasSqliteVec } from './sqliteVecAvailable.js';
import { migrateJsonEmbeddingsToStore } from '../../../services/storage/migrationEngine.js';
import type { EmbeddingCacheData } from '../../../services/storage/types.js';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch { /* */ } } });

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-scenario-'));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

describe.skipIf(!hasSqliteVec)('Embedding scenario tests', () => {
  it('Scenario: start with JSON, migrate to SQLite, verify search works', () => {
    const tmpDir = makeTmpDir();
    const jsonPath = path.join(tmpDir, 'embeddings.json');
    const dbPath = path.join(tmpDir, 'embeddings.db');

    // Phase 1: Store embeddings in JSON
    const jsonStore = new JsonEmbeddingStore(jsonPath);
    jsonStore.save({
      indexHash: 'v1',
      modelName: 'test',
      entryHashes: { 'a': 'h-a', 'b': 'h-b', 'c': 'h-c' },
      embeddings: {
        'a': [1, 0, 0],
        'b': [0, 1, 0],
        'c': [0, 0, 1],
      },
    });
    jsonStore.close();

    // Phase 2: Migrate to SQLite
    const sqliteStore = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => sqliteStore.close());
    const result = migrateJsonEmbeddingsToStore(jsonPath, sqliteStore);
    expect(result.migrated).toBe(3);

    // Phase 3: Verify data and search
    const loaded = sqliteStore.load();
    expect(loaded!.indexHash).toBe('v1');
    expect(Object.keys(loaded!.embeddings)).toHaveLength(3);

    const searchResults = sqliteStore.search(new Float32Array([1, 0, 0]), 2);
    expect(searchResults).toHaveLength(2);
    expect(searchResults[0].id).toBe('a');
  });

  it('Scenario: incremental update preserves existing and adds new', () => {
    const tmpDir = makeTmpDir();
    const dbPath = path.join(tmpDir, 'incr.db');
    const store = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => store.close());

    // Initial save
    store.save({
      indexHash: 'v1',
      modelName: 'model-1',
      entryHashes: { 'inst-1': 'h1' },
      embeddings: { 'inst-1': [1, 0, 0] },
    });

    // Update: add new entry, keep existing
    store.save({
      indexHash: 'v2',
      modelName: 'model-1',
      entryHashes: { 'inst-1': 'h1', 'inst-2': 'h2' },
      embeddings: { 'inst-1': [1, 0, 0], 'inst-2': [0, 1, 0] },
    });

    const loaded = store.load();
    expect(loaded!.indexHash).toBe('v2');
    expect(Object.keys(loaded!.embeddings)).toHaveLength(2);
  });

  it('Scenario: pruning removes deleted instructions', () => {
    const tmpDir = makeTmpDir();
    const dbPath = path.join(tmpDir, 'prune.db');
    const store = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => store.close());

    // Save 3 entries
    store.save({
      indexHash: 'v1',
      embeddings: {
        'keep-1': [1, 0, 0],
        'keep-2': [0, 1, 0],
        'remove': [0, 0, 1],
      },
    });

    // Save without 'remove'
    store.save({
      indexHash: 'v2',
      embeddings: {
        'keep-1': [1, 0, 0],
        'keep-2': [0, 1, 0],
      },
    });

    const loaded = store.load();
    expect(Object.keys(loaded!.embeddings)).toHaveLength(2);
    expect(loaded!.embeddings['remove']).toBeUndefined();

    // Search should not return removed entry
    const results = store.search(new Float32Array([0, 0, 1]), 5);
    expect(results.every(r => r.id !== 'remove')).toBe(true);
  });

  it('Scenario: both backends give same search ordering', () => {
    const tmpDir = makeTmpDir();
    const jsonPath = path.join(tmpDir, 'cmp.json');
    const dbPath = path.join(tmpDir, 'cmp.db');

    const data: EmbeddingCacheData = {
      indexHash: 'cmp',
      embeddings: {
        'near': [0.9, 0.1, 0],
        'mid': [0.5, 0.5, 0],
        'far': [0, 0, 1],
      },
    };

    const jsonStore = new JsonEmbeddingStore(jsonPath);
    jsonStore.save(data);
    const jsonResults = jsonStore.search(new Float32Array([1, 0, 0]), 3);
    jsonStore.close();

    const sqliteStore = new SqliteEmbeddingStore(dbPath, 3);
    sqliteStore.save(data);
    const sqliteResults = sqliteStore.search(new Float32Array([1, 0, 0]), 3);
    sqliteStore.close();

    // Both should return same ordering
    expect(jsonResults.map(r => r.id)).toEqual(sqliteResults.map(r => r.id));
  });
});
