/**
 * RED/GREEN test suite: incremental embedding cache
 *
 * Root cause: when indexHash changes (any instruction added/modified),
 * ALL ~600 embeddings are recomputed from scratch. With concurrent searches
 * each independently computing the full set, a 3-request burst takes 120s+
 * instead of the expected ~12s for a single pass.
 *
 * Fix: track per-entry sourceHash in the cache; on index hash change,
 * only recompute embeddings for entries whose sourceHash changed or is new.
 * Add a module-level concurrency lock so concurrent misses share one computation.
 *
 * Tests use the optional embedFn parameter (dependency injection) to avoid
 * loading the real ONNX/transformers model.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonEmbeddingStore } from '../services/storage/jsonEmbeddingStore.js';

const MOCK_LOGGING = { level: 'warn', verbose: false, json: false, sync: false, diagnostics: false, protocol: false, sentinelRequested: false };

// Base instruction shape reused across tests
function makeInstruction(id: string, sourceHash: string, body: string = `body of ${id}`) {
  return {
    id,
    title: `Title ${id}`,
    body,
    sourceHash,
    priority: 10,
    audience: 'all' as const,
    requirement: 'recommended' as const,
    categories: [] as string[],
    contentType: 'instruction' as const,
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

// ─── Incremental cache: only embeds new/changed entries ─────────────────────
describe('getInstructionEmbeddings: incremental cache', () => {
  let tmpDir: string;
  let cachePath: string;
  let getInstructionEmbeddings: typeof import('../services/embeddingService').getInstructionEmbeddings;
  let saveCachedEmbeddings: typeof import('../services/embeddingService').saveCachedEmbeddings;
  let DERIVATION_VERSION: number;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-incr-'));
    cachePath = path.join(tmpDir, 'embeddings.json');

    vi.doMock('../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({ logging: MOCK_LOGGING }),
    }));

    const mod = await import('../services/embeddingService.js');
    getInstructionEmbeddings = mod.getInstructionEmbeddings;
    saveCachedEmbeddings = mod.saveCachedEmbeddings;
    DERIVATION_VERSION = mod.DERIVATION_VERSION;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reuses cached embeddings when indexHash is unchanged (full hit)', async () => {
    const instructions = [
      makeInstruction('a', 'sha-a'),
      makeInstruction('b', 'sha-b'),
    ];
    const mockEmbedFn = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));

    // Seed valid cache (hash-v1 matches the call below)
    saveCachedEmbeddings(cachePath, {
      indexHash: 'hash-v1',
      modelName: 'test-model',
      embeddings: { a: [0.1, 0.2, 0.3], b: [0.4, 0.5, 0.6] },
      derivationVersion: DERIVATION_VERSION,
    });

    const result = await getInstructionEmbeddings(
      instructions, 'hash-v1', cachePath, 'test-model', tmpDir, 'cpu', false, mockEmbedFn, new JsonEmbeddingStore(cachePath)
    );

    expect(mockEmbedFn).not.toHaveBeenCalled();
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('invalidates a legacy cache that predates derivationVersion (#537)', async () => {
    const instructions = [
      makeInstruction('a', 'sha-a'),
      makeInstruction('b', 'sha-b'),
    ];
    const mockEmbedFn = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));

    // Cache written before #537: indexHash and model both match, and the only
    // reason to recompute is the absent derivationVersion. Without the version
    // check this is a full hit and the embedder is never called.
    fs.writeFileSync(cachePath, JSON.stringify({
      indexHash: 'hash-v1',
      modelName: 'test-model',
      entryHashes: { a: 'sha-a', b: 'sha-b' },
      embeddings: { a: [0.11, 0.22, 0.33], b: [0.44, 0.55, 0.66] },
    }), 'utf-8');

    const result = await getInstructionEmbeddings(
      instructions, 'hash-v1', cachePath, 'test-model', tmpDir, 'cpu', false, mockEmbedFn, new JsonEmbeddingStore(cachePath)
    );

    // Every entry must be re-embedded under the new derivation.
    expect(mockEmbedFn).toHaveBeenCalledTimes(2);
    expect(Object.keys(result).sort()).toEqual(['a', 'b']);

    // And the rewritten cache must carry the current version so the next
    // run is a hit rather than re-embedding forever.
    const saved = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(saved.derivationVersion).toBe(DERIVATION_VERSION);
  });

  it('only embeds new/changed entries when indexHash changes (incremental miss)', async () => {
    const instructions = [
      makeInstruction('a', 'sha-a'),          // sourceHash unchanged -> reuse
      makeInstruction('b', 'sha-b-CHANGED'),  // sourceHash changed   -> recompute
      makeInstruction('c', 'sha-c'),          // new entry            -> compute
    ];
    const mockEmbedFn = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));

    // Seed stale cache (old indexHash, entries a+b with old sourceHashes)
    fs.writeFileSync(cachePath, JSON.stringify({
      indexHash: 'hash-v1',
      modelName: 'test-model',
      entryHashes: { a: 'sha-a', b: 'sha-b' },
      embeddings: { a: [0.11, 0.22, 0.33], b: [0.44, 0.55, 0.66] },
      derivationVersion: DERIVATION_VERSION,
    }), 'utf-8');

    const result = await getInstructionEmbeddings(
      instructions, 'hash-v2', cachePath, 'test-model', tmpDir, 'cpu', false, mockEmbedFn, new JsonEmbeddingStore(cachePath)
    );

    // Only b (changed sourceHash) and c (new) need embedding -- NOT a
    expect(mockEmbedFn).toHaveBeenCalledTimes(2);

    // All 3 IDs present in result
    expect(Object.keys(result).sort()).toEqual(['a', 'b', 'c']);

    // Entry a must be the original cached vector (~0.11, ~0.22, ~0.33) -- not recomputed
    // Float32Array has 32-bit precision; use toBeCloseTo after JSON round-trip.
    const aVec = Array.from(result['a']);
    expect(aVec[0]).toBeCloseTo(0.11, 3);
    expect(aVec[1]).toBeCloseTo(0.22, 3);
    expect(aVec[2]).toBeCloseTo(0.33, 3);
  });

  it('performs full recompute when model name changes (no reuse)', async () => {
    const instructions = [
      makeInstruction('a', 'sha-a'),
      makeInstruction('b', 'sha-b'),
    ];
    const mockEmbedFn = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));

    // Seed cache with OLD model name
    fs.writeFileSync(cachePath, JSON.stringify({
      indexHash: 'hash-v1',
      modelName: 'old-model',
      entryHashes: { a: 'sha-a', b: 'sha-b' },
      embeddings: { a: [0.11, 0.22, 0.33], b: [0.44, 0.55, 0.66] },
    }), 'utf-8');

    await getInstructionEmbeddings(
      instructions, 'hash-v2', cachePath, 'new-model', tmpDir, 'cpu', false, mockEmbedFn, new JsonEmbeddingStore(cachePath)
    );

    // All entries recomputed when model changes (no reuse possible)
    expect(mockEmbedFn).toHaveBeenCalledTimes(2);
  });

  it('removes stale entries (deleted instructions) from saved cache', async () => {
    // Only 'b' remains in the current index (a was deleted)
    const instructions = [makeInstruction('b', 'sha-b')];
    const mockEmbedFn = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));

    fs.writeFileSync(cachePath, JSON.stringify({
      indexHash: 'hash-v1',
      modelName: 'test-model',
      entryHashes: { a: 'sha-a', b: 'sha-b' },
      embeddings: { a: [0.11, 0.22, 0.33], b: [0.44, 0.55, 0.66] },
    }), 'utf-8');

    const result = await getInstructionEmbeddings(
      instructions, 'hash-v2', cachePath, 'test-model', tmpDir, 'cpu', false, mockEmbedFn, new JsonEmbeddingStore(cachePath)
    );

    // Only 'b' in result (deleted 'a' pruned)
    expect(Object.keys(result)).toEqual(['b']);

    // Saved cache must not contain 'a'
    const saved = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(Object.keys(saved.embeddings)).not.toContain('a');
  });

  it('saves updated entryHashes and indexHash after incremental recompute', async () => {
    const instructions = [
      makeInstruction('a', 'sha-a'),
      makeInstruction('b', 'sha-b-NEW'),
    ];
    const mockEmbedFn = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));

    fs.writeFileSync(cachePath, JSON.stringify({
      indexHash: 'hash-v1',
      modelName: 'test-model',
      entryHashes: { a: 'sha-a', b: 'sha-b-OLD' },
      embeddings: { a: [0.1, 0.2, 0.3], b: [0.4, 0.5, 0.6] },
    }), 'utf-8');

    await getInstructionEmbeddings(
      instructions, 'hash-v2', cachePath, 'test-model', tmpDir, 'cpu', false, mockEmbedFn, new JsonEmbeddingStore(cachePath)
    );

    const saved = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(saved.indexHash).toBe('hash-v2');
    expect(saved.entryHashes['a']).toBe('sha-a');
    expect(saved.entryHashes['b']).toBe('sha-b-NEW');
  });
});

// ─── Embed-text pinning: exact text passed to embedFn ─────────────────────
describe('getInstructionEmbeddings: embed-text composition', () => {
  let tmpDir: string;
  let cachePath: string;
  let getInstructionEmbeddings: typeof import('../services/embeddingService').getInstructionEmbeddings;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-text-'));
    cachePath = path.join(tmpDir, 'embeddings.json');

    vi.doMock('../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({ logging: MOCK_LOGGING }),
    }));

    const mod = await import('../services/embeddingService.js');
    getInstructionEmbeddings = mod.getInstructionEmbeddings;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('embeds title + semanticSummary, not body', async () => {
    const inst = {
      ...makeInstruction('a', 'sha-a', 'this body content must NOT appear in embed text'),
      semanticSummary: 'concise summary of the entry',
    };
    const mockEmbedFn = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));

    await getInstructionEmbeddings(
      [inst], 'hash-v1', cachePath, 'test-model', tmpDir, 'cpu', false, mockEmbedFn, new JsonEmbeddingStore(cachePath)
    );

    expect(mockEmbedFn).toHaveBeenCalledTimes(1);
    expect(mockEmbedFn).toHaveBeenCalledWith(
      'Title a concise summary of the entry',
      'test-model', tmpDir, 'cpu', false
    );
  });

  it('does not fall back to body when semanticSummary is absent (#537)', async () => {
    const inst = makeInstruction('a', 'sha-a', 'body that old code would embed');
    const mockEmbedFn = vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));

    await getInstructionEmbeddings(
      [inst], 'hash-v1', cachePath, 'test-model', tmpDir, 'cpu', false, mockEmbedFn, new JsonEmbeddingStore(cachePath)
    );

    expect(mockEmbedFn).toHaveBeenCalledTimes(1);
    const actualText = mockEmbedFn.mock.calls[0][0] as string;
    expect(actualText).not.toContain('body that old code would embed');
    expect(actualText).toBe('Title a ');
  });
});

// ─── Concurrency lock: concurrent misses share one computation ──────────────
describe('getInstructionEmbeddings: concurrency lock', () => {
  let tmpDir: string;
  let cachePath: string;
  let getInstructionEmbeddings: typeof import('../services/embeddingService').getInstructionEmbeddings;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-conc-'));
    cachePath = path.join(tmpDir, 'embeddings.json');

    vi.doMock('../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({ logging: MOCK_LOGGING }),
    }));

    const mod = await import('../services/embeddingService.js');
    getInstructionEmbeddings = mod.getInstructionEmbeddings;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('concurrent cache-miss requests share one computation (not N)', async () => {
    const instructions = [
      makeInstruction('a', 'sha-a'),
      makeInstruction('b', 'sha-b'),
    ];

    let embedCallCount = 0;
    // Slow mock so calls genuinely overlap in the event loop
    const slowEmbedFn = vi.fn().mockImplementation(async () => {
      embedCallCount++;
      await new Promise(r => setTimeout(r, 10));
      return new Float32Array([0.1, 0.2, 0.3]);
    });

    // 3 concurrent cache-miss requests all using the same slow embedFn
    const [r1, r2, r3] = await Promise.all([
      getInstructionEmbeddings(instructions, 'hash-v1', cachePath, 'test-model', tmpDir, 'cpu', false, slowEmbedFn, new JsonEmbeddingStore(cachePath)),
      getInstructionEmbeddings(instructions, 'hash-v1', cachePath, 'test-model', tmpDir, 'cpu', false, slowEmbedFn, new JsonEmbeddingStore(cachePath)),
      getInstructionEmbeddings(instructions, 'hash-v1', cachePath, 'test-model', tmpDir, 'cpu', false, slowEmbedFn, new JsonEmbeddingStore(cachePath)),
    ]);

    // embedFn called only 2 times (1 per instruction) -- not 2*3=6
    expect(embedCallCount).toBe(2);

    // All 3 responses complete and identical
    expect(Object.keys(r1)).toHaveLength(2);
    expect(Object.keys(r2)).toHaveLength(2);
    expect(Object.keys(r3)).toHaveLength(2);
  });
});
