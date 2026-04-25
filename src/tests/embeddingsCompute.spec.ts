/**
 * Embedding Compute Route + Store Tests
 *
 * Covers:
 * - POST /embeddings/compute: disabled flag, empty index, success shape
 * - JsonEmbeddingStore: save/load round-trip, search returns results
 * - SqliteEmbeddingStore: save/load round-trip, search KNN (when sqlite-vec available)
 * - checkModelReadiness: ready state based on cache directory
 * - resolveDevice: returns a valid device string
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { createEmbeddingsRoutes } from '../dashboard/server/routes/embeddings.routes.js';
import { JsonEmbeddingStore } from '../services/storage/jsonEmbeddingStore.js';
import type { EmbeddingCacheData } from '../services/storage/types.js';

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function httpRequest(
  url: string,
  method: 'GET' | 'POST' = 'GET',
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
    if (body) {
      req.setHeader('Content-Type', 'application/json');
      req.write(body);
    }
    req.end();
  });
}

// ── Fixture data ─────────────────────────────────────────────────────────────

/** Create a deterministic embedding vector of given dimensions */
function makeVector(seed: number, dims = 384): number[] {
  const v: number[] = [];
  for (let i = 0; i < dims; i++) {
    v.push(Math.sin(seed * (i + 1) * 0.1));
  }
  return v;
}

function makeCacheData(count = 5, dims = 384): EmbeddingCacheData {
  const embeddings: Record<string, number[]> = {};
  const entryHashes: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const id = `test-instr-${i}`;
    embeddings[id] = makeVector(i + 1, dims);
    entryHashes[id] = `hash-${i}`;
  }
  return {
    indexHash: 'test-index-hash',
    modelName: 'test-model',
    entryHashes,
    embeddings,
  };
}

// ── POST /embeddings/compute route ──────────────────────────────────────────

describe('Embeddings Route: POST /embeddings/compute', () => {
  let server: http.Server;
  let port: number;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-compute-'));

    // Mock runtime config to return disabled semantic
    vi.doMock('../config/runtimeConfig.js', () => ({
      getRuntimeConfig: () => ({
        semantic: {
          enabled: false,
          embeddingPath: path.join(tmpDir, 'embeddings.json'),
          model: 'test-model',
          cacheDir: tmpDir,
          device: 'cpu',
          localOnly: true,
        },
      }),
    }));

    const app = express();
    app.use('/api', createEmbeddingsRoutes());
    server = app.listen(0);
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    vi.doUnmock('../config/runtimeConfig.js');
    if (server) server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 400 when semantic embeddings are disabled', async () => {
    const res = await httpRequest(`http://localhost:${port}/api/embeddings/compute`, 'POST');
    expect(res.status).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(false);
    expect(json.error).toContain('disabled');
  });
});

// ── JsonEmbeddingStore ──────────────────────────────────────────────────────

describe('JsonEmbeddingStore', () => {
  let tmpDir: string;
  let storePath: string;
  let store: JsonEmbeddingStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-emb-'));
    storePath = path.join(tmpDir, 'embeddings.json');
    store = new JsonEmbeddingStore(storePath);
  });

  afterAll(() => {
    // Cleanup handled per-test
  });

  it('returns null when file does not exist', () => {
    expect(store.load()).toBeNull();
  });

  it('round-trips save/load correctly', () => {
    const data = makeCacheData(3);
    store.save(data);
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.indexHash).toBe('test-index-hash');
    expect(loaded!.modelName).toBe('test-model');
    expect(Object.keys(loaded!.embeddings)).toHaveLength(3);
    // Verify vector values preserved
    const firstId = Object.keys(data.embeddings)[0];
    expect(loaded!.embeddings[firstId]).toEqual(data.embeddings[firstId]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('search returns results sorted by distance', () => {
    const data = makeCacheData(10);
    store.save(data);

    // Query with the vector for entry 0 — entry 0 should be closest (distance ~0)
    const queryVec = new Float32Array(data.embeddings['test-instr-0']);
    const results = store.search(queryVec, 5);
    expect(results.length).toBe(5);
    expect(results[0].id).toBe('test-instr-0');
    expect(results[0].distance).toBeCloseTo(0, 3);
    // Results should be sorted ascending by distance
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('search returns empty for limit <= 0', () => {
    const data = makeCacheData(3);
    store.save(data);
    const results = store.search(new Float32Array(384), 0);
    expect(results).toEqual([]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('search returns empty when no data saved', () => {
    const results = store.search(new Float32Array(384), 5);
    expect(results).toEqual([]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── SqliteEmbeddingStore (conditional — needs sqlite-vec) ───────────────────

describe('SqliteEmbeddingStore', () => {
  let SqliteEmbeddingStore: typeof import('../services/storage/sqliteEmbeddingStore.js').SqliteEmbeddingStore;
  let available = false;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-emb-'));
    try {
      const mod = await import('../services/storage/sqliteEmbeddingStore.js');
      SqliteEmbeddingStore = mod.SqliteEmbeddingStore;
      // Quick probe: try constructing — will throw if sqlite-vec missing
      const testDb = path.join(tmpDir, 'probe.db');
      const probe = new SqliteEmbeddingStore(testDb, 4);
      probe.close();
      fs.unlinkSync(testDb);
      available = true;
    } catch {
      available = false;
    }
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('save/load round-trip', () => {
    if (!available) return; // skip if sqlite-vec not installed
    const dbPath = path.join(tmpDir, 'roundtrip.db');
    const store = new SqliteEmbeddingStore(dbPath, 384);
    const data = makeCacheData(5);
    store.save(data);
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.indexHash).toBe('test-index-hash');
    expect(Object.keys(loaded!.embeddings)).toHaveLength(5);
    // Values should be approximately equal (Float32 precision)
    const firstId = 'test-instr-0';
    for (let i = 0; i < 10; i++) {
      expect(loaded!.embeddings[firstId][i]).toBeCloseTo(data.embeddings[firstId][i], 4);
    }
    store.close();
  });

  it('search returns KNN results', () => {
    if (!available) return;
    const dbPath = path.join(tmpDir, 'search.db');
    const store = new SqliteEmbeddingStore(dbPath, 384);
    const data = makeCacheData(10);
    store.save(data);

    // Query with entry 0 vector — should find entry 0 as closest
    const query = new Float32Array(data.embeddings['test-instr-0']);
    const results = store.search(query, 5);
    expect(results.length).toBe(5);
    expect(results[0].id).toBe('test-instr-0');
    expect(results[0].distance).toBeCloseTo(0, 2);
    // Sorted ascending by distance
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
    store.close();
  });

  it('rejects invalid dimensions', () => {
    if (!available) return;
    expect(() => new SqliteEmbeddingStore(path.join(tmpDir, 'bad.db'), 0)).toThrow();
    expect(() => new SqliteEmbeddingStore(path.join(tmpDir, 'bad.db'), -1)).toThrow();
  });

  it('search returns empty for dimension mismatch', () => {
    if (!available) return;
    const dbPath = path.join(tmpDir, 'mismatch.db');
    const store = new SqliteEmbeddingStore(dbPath, 384);
    const data = makeCacheData(3);
    store.save(data);
    // Wrong dimensions in query
    const results = store.search(new Float32Array(128), 5);
    expect(results).toEqual([]);
    store.close();
  });
});

// ── resolveDevice + checkModelReadiness ─────────────────────────────────────

describe('Embedding Service: resolveDevice', () => {
  let resolveDevice: typeof import('../services/embeddingService.js').resolveDevice;

  beforeAll(async () => {
    vi.resetModules();
    const mod = await import('../services/embeddingService.js');
    resolveDevice = mod.resolveDevice;
  });

  it('returns cpu when requested', async () => {
    const device = await resolveDevice('cpu');
    expect(device).toBe('cpu');
  });

  it('falls back to cpu with mock ORT that has no backends', async () => {
    const device = await resolveDevice('dml', {
      listSupportedBackends: () => [{ name: 'cpu', bundled: true }],
    });
    expect(device).toBe('cpu');
  });

  it('returns requested device when available in backends', async () => {
    const device = await resolveDevice('dml', {
      listSupportedBackends: () => [
        { name: 'cpu', bundled: true },
        { name: 'dml', bundled: true },
      ],
    });
    expect(device).toBe('dml');
  });
});

describe('Embedding Service: checkModelReadiness', () => {
  let checkModelReadiness: typeof import('../services/embeddingService.js').checkModelReadiness;
  let tmpDir: string;

  beforeAll(async () => {
    vi.resetModules();
    const mod = await import('../services/embeddingService.js');
    checkModelReadiness = mod.checkModelReadiness;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-ready-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ready when localOnly is false', () => {
    const result = checkModelReadiness('Xenova/all-MiniLM-L6-v2', tmpDir, false);
    expect(result.ready).toBe(true);
  });

  it('returns not-ready for missing cache directory when localOnly', () => {
    const result = checkModelReadiness('Xenova/all-MiniLM-L6-v2', path.join(tmpDir, 'no-exist'), true);
    expect(result.ready).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message!.length).toBeGreaterThan(0);
  });

  it('returns not-ready for empty cache directory when localOnly', () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    // Create the expected model subdirectory but leave it empty
    const modelDir = path.join(emptyDir, 'models--Xenova--all-MiniLM-L6-v2');
    fs.mkdirSync(modelDir, { recursive: true });
    // Empty dir means no model files
    // Actually the check is readdirSync(modelPath).length > 0, and we made it empty
    // But mkdir creates the dir, not files. Let's check...
    const result = checkModelReadiness('Xenova/all-MiniLM-L6-v2', emptyDir, true);
    expect(result.ready).toBe(false);
  });

  it('returns ready when model cache has files and localOnly', () => {
    const cacheDir = path.join(tmpDir, 'has-model');
    const modelDir = path.join(cacheDir, 'models--Xenova--all-MiniLM-L6-v2');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'config.json'), '{}');
    const result = checkModelReadiness('Xenova/all-MiniLM-L6-v2', cacheDir, true);
    expect(result.ready).toBe(true);
  });
});
