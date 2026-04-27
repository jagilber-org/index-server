/**
 * Tests for embedding migration: JSON → IEmbeddingStore.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { migrateJsonEmbeddingsToStore } from '../../../services/storage/migrationEngine.js';
import { JsonEmbeddingStore } from '../../../services/storage/jsonEmbeddingStore.js';
import { SqliteEmbeddingStore } from '../../../services/storage/sqliteEmbeddingStore.js';
import { hasSqliteVec } from './sqliteVecAvailable.js';
import type { EmbeddingCacheData } from '../../../services/storage/types.js';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch { /* */ } } });

function makeTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-migrate-'));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

function writeJsonEmbeddings(dir: string, data: EmbeddingCacheData): string {
  const fp = path.join(dir, 'embeddings.json');
  fs.writeFileSync(fp, JSON.stringify(data), 'utf-8');
  return fp;
}

describe.skipIf(!hasSqliteVec)('migrateJsonEmbeddingsToStore', () => {
  it('migrates JSON embeddings to SqliteEmbeddingStore', () => {
    const tmpDir = makeTmpDir();
    const jsonPath = writeJsonEmbeddings(tmpDir, {
      indexHash: 'hash-v1',
      modelName: 'test-model',
      entryHashes: { 'a': 'sha-a', 'b': 'sha-b' },
      embeddings: { 'a': [1, 0, 0], 'b': [0, 1, 0] },
    });

    const dbPath = path.join(tmpDir, 'target.db');
    const target = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => target.close());

    const result = migrateJsonEmbeddingsToStore(jsonPath, target);
    expect(result.migrated).toBe(2);
    expect(result.error).toBeUndefined();

    const loaded = target.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.indexHash).toBe('hash-v1');
    expect(Object.keys(loaded!.embeddings)).toHaveLength(2);
  });

  it('migrates JSON embeddings to JsonEmbeddingStore (self-copy)', () => {
    const tmpDir = makeTmpDir();
    const srcPath = writeJsonEmbeddings(tmpDir, {
      indexHash: 'h2',
      embeddings: { 'x': [1, 2] },
    });

    const dstPath = path.join(tmpDir, 'copy.json');
    const target = new JsonEmbeddingStore(dstPath);
    cleanups.push(() => target.close());

    const result = migrateJsonEmbeddingsToStore(srcPath, target);
    expect(result.migrated).toBe(1);

    const loaded = target.load();
    expect(loaded!.embeddings['x']).toEqual([1, 2]);
  });

  it('returns error for missing JSON file', () => {
    const tmpDir = makeTmpDir();
    const dstPath = path.join(tmpDir, 'dest.json');
    const target = new JsonEmbeddingStore(dstPath);
    cleanups.push(() => target.close());

    const result = migrateJsonEmbeddingsToStore('/nonexistent/path.json', target);
    expect(result.migrated).toBe(0);
    expect(result.error).toContain('No embedding data');
  });

  it('returns zero migrated for empty embeddings', () => {
    const tmpDir = makeTmpDir();
    const jsonPath = writeJsonEmbeddings(tmpDir, {
      indexHash: 'empty',
      embeddings: {},
    });

    const dstPath = path.join(tmpDir, 'dest.json');
    const target = new JsonEmbeddingStore(dstPath);
    cleanups.push(() => target.close());

    const result = migrateJsonEmbeddingsToStore(jsonPath, target);
    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('preserves modelName and entryHashes during migration', () => {
    const tmpDir = makeTmpDir();
    const jsonPath = writeJsonEmbeddings(tmpDir, {
      indexHash: 'h3',
      modelName: 'my-model',
      entryHashes: { 'inst-1': 'hash-1' },
      embeddings: { 'inst-1': [1, 0, 0] },
    });

    const dbPath = path.join(tmpDir, 'target.db');
    const target = new SqliteEmbeddingStore(dbPath, 3);
    cleanups.push(() => target.close());

    migrateJsonEmbeddingsToStore(jsonPath, target);
    const loaded = target.load();
    expect(loaded!.modelName).toBe('my-model');
    expect(loaded!.entryHashes!['inst-1']).toBe('hash-1');
  });

  it('handles dimension mismatch gracefully', () => {
    const tmpDir = makeTmpDir();
    const jsonPath = writeJsonEmbeddings(tmpDir, {
      indexHash: 'h4',
      embeddings: { 'a': [1, 2, 3, 4] }, // 4 dims
    });

    const dbPath = path.join(tmpDir, 'target.db');
    const target = new SqliteEmbeddingStore(dbPath, 2); // 2 dims
    cleanups.push(() => target.close());

    const result = migrateJsonEmbeddingsToStore(jsonPath, target);
    expect(result.migrated).toBe(0);
    expect(result.error).toBeDefined();
  });
});
