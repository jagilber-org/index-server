/**
 * Test Suite for Semantic Search Mode + Embedding Service
 *
 * Phase 2 TDD RED: tests written before implementation.
 * All embedding model interactions are mocked — no real model needed.
 *
 * Covers:
 * - Cosine similarity math
 * - Cached embeddings load/save roundtrip
 * - Staleness detection
 * - Semantic mode integration via handleInstructionsSearch
 * - Feature flag gating
 * - Zero startup impact (no import-time model loading)
 * - Graceful degradation on model failure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

/** Minimal logging config to satisfy logger.ts in tests */
const MOCK_LOGGING = { level: 'warn', verbose: false, json: false, sync: false, diagnostics: false, protocol: false, sentinelRequested: false };

// ─── Pure math helpers (no deps, no model) ──────────────────────────────────
describe('Embedding Service: cosineSimilarity', () => {
  // We import the pure function; it must not trigger model loading.
  let cosineSimilarity: (a: Float32Array, b: Float32Array) => number;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../services/embeddingService.js');
    cosineSimilarity = mod.cosineSimilarity;
  });

  it('returns 1.0 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([-1, -2, -3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });
});

// ─── Disk cache roundtrip ───────────────────────────────────────────────────
describe('Embedding Service: disk cache', () => {
  let tmpDir: string;
  let saveCachedEmbeddings: (filePath: string, data: { indexHash: string; embeddings: Record<string, number[]> }) => void;
  let loadCachedEmbeddings: (filePath: string) => { indexHash: string; embeddings: Record<string, number[]> } | null;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-test-'));
    const mod = await import('../services/embeddingService.js');
    saveCachedEmbeddings = mod.saveCachedEmbeddings;
    loadCachedEmbeddings = mod.loadCachedEmbeddings;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadCachedEmbeddings returns null when file missing', () => {
    expect(loadCachedEmbeddings(path.join(tmpDir, 'nonexistent.json'))).toBeNull();
  });

  it('save + load roundtrips correctly', () => {
    const filePath = path.join(tmpDir, 'embeddings.json');
    const data = {
      indexHash: 'abc123',
      embeddings: {
        'inst-1': [0.1, 0.2, 0.3],
        'inst-2': [0.4, 0.5, 0.6],
      },
    };
    saveCachedEmbeddings(filePath, data);
    const loaded = loadCachedEmbeddings(filePath);
    expect(loaded).not.toBeNull();
    expect(loaded!.indexHash).toBe('abc123');
    expect(loaded!.embeddings['inst-1']).toEqual([0.1, 0.2, 0.3]);
    expect(loaded!.embeddings['inst-2']).toEqual([0.4, 0.5, 0.6]);
  });
});

// ─── Staleness detection ────────────────────────────────────────────────────
describe('Embedding Service: isStale', () => {
  let isStale: (indexHash: string, embeddingHash: string) => boolean;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../services/embeddingService.js');
    isStale = mod.isStale;
  });

  it('returns false when hashes match', () => {
    expect(isStale('abc123', 'abc123')).toBe(false);
  });

  it('returns true when hashes differ', () => {
    expect(isStale('abc123', 'def456')).toBe(true);
  });
});

// ─── Semantic mode integration via search handler ───────────────────────────
describe('Search Mode: semantic', () => {
  let handleInstructionsSearch: typeof import('../services/handlers.search').handleInstructionsSearch;

  beforeEach(async () => {
    vi.resetModules();

    // Mock indexContext
    vi.doMock('../services/indexContext', () => ({
      ensureLoaded: () => ({
        loadedAt: new Date().toISOString(),
        hash: 'Index-hash-1',
        byId: new Map(),
        list: [
          {
            id: 'deploy-001',
            title: 'Deployment Pipeline',
            body: 'CI/CD deployment pipeline configuration for production releases',
            priority: 10,
            audience: 'all',
            requirement: 'recommended',
            categories: ['devops', 'ci-cd'],
            contentType: 'instruction',
            sourceHash: 'h1',
            schemaVersion: '1',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
          {
            id: 'style-001',
            title: 'Code Style Guide',
            body: 'Follow consistent coding style with linting and formatting rules',
            priority: 20,
            audience: 'all',
            requirement: 'recommended',
            categories: ['style', 'quality'],
            contentType: 'instruction',
            sourceHash: 'h2',
            schemaVersion: '1',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ],
        fileCount: 2,
        versionMTime: 0,
        versionToken: 'v1',
      }),
    }));

    // Mock runtimeConfig — semantic enabled
    vi.doMock('../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({
        logging: MOCK_LOGGING,
        semantic: {
          enabled: true,
          model: 'Xenova/all-MiniLM-L6-v2',
          cacheDir: '/tmp/models',
          embeddingPath: '/tmp/embeddings.json',
          device: 'cpu',
          localOnly: false,
        },
      }),
    }));

    // Mock embeddingService — pre-computed fake embeddings
    const fakeEmbeddings: Record<string, Float32Array> = {
      'deploy-001': new Float32Array([0.9, 0.1, 0.0]),
      'style-001': new Float32Array([0.1, 0.9, 0.0]),
    };
    vi.doMock('../services/embeddingService', async () => {
      const actual = await vi.importActual('../services/embeddingService');
      return {
        ...(actual as object),
        embedText: vi.fn().mockResolvedValue(new Float32Array([0.85, 0.15, 0.0])),
        getInstructionEmbeddings: vi.fn().mockResolvedValue(fakeEmbeddings),
      };
    });

    const mod = await import('../services/handlers.search.js');
    handleInstructionsSearch = mod.handleInstructionsSearch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return results ranked by cosine similarity', async () => {
    const result = await handleInstructionsSearch({
      keywords: ['deployment pipeline'],
      mode: 'semantic',
    });
    expect(result).toBeDefined();
    expect(result.results.length).toBeGreaterThan(0);
    // deploy-001 embedding [0.9,0.1,0] is closer to query [0.85,0.15,0] than style-001 [0.1,0.9,0]
    expect(result.results[0].instructionId).toBe('deploy-001');
  });

  it('should include mode:semantic in response query', async () => {
    const result = await handleInstructionsSearch({
      keywords: ['deployment'],
      mode: 'semantic',
    });
    expect(result.query.mode).toBe('semantic');
  });

  it('should find conceptually related instructions', async () => {
    // Query vector close to deploy-001 should still return it even though keywords don't substring-match
    const result = await handleInstructionsSearch({
      keywords: ['releasing software'],
      mode: 'semantic',
    });
    expect(result.results.some((r: { instructionId: string }) => r.instructionId === 'deploy-001')).toBe(true);
  });
});

// ─── Feature flag gating ────────────────────────────────────────────────────
describe('Search Mode: semantic (disabled)', () => {
  let handleInstructionsSearch: typeof import('../services/handlers.search').handleInstructionsSearch;

  beforeEach(async () => {
    vi.resetModules();

    // Mock indexContext
    vi.doMock('../services/indexContext', () => ({
      ensureLoaded: () => ({
        loadedAt: new Date().toISOString(),
        hash: 'h1',
        byId: new Map(),
        list: [],
        fileCount: 0,
        versionMTime: 0,
        versionToken: 'v1',
      }),
    }));

    // Mock runtimeConfig — semantic DISABLED
    vi.doMock('../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({
        logging: MOCK_LOGGING,
        semantic: { enabled: false, model: '', cacheDir: '', embeddingPath: '', device: 'cpu', localOnly: false },
      }),
    }));

    const mod = await import('../services/handlers.search.js');
    handleInstructionsSearch = mod.handleInstructionsSearch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return error when semantic mode disabled via feature flag', async () => {
    try {
      await handleInstructionsSearch({
        keywords: ['test'],
        mode: 'semantic',
      });
      // If we get here, the handler didn't throw — fail the test
      expect.unreachable('Expected semantic error to be thrown');
    } catch (err: unknown) {
      // semanticError throws a plain object with __semantic: true
      expect(err).toBeDefined();
      expect((err as { __semantic?: boolean }).__semantic).toBe(true);
      expect((err as { message?: string }).message).toContain('disabled');
    }
  });
});

// ─── Zero startup impact ────────────────────────────────────────────────────
describe('Embedding Service: zero startup cost', () => {
  it('should not load model at import time', async () => {
    vi.resetModules();
    // Importing embeddingService must NOT trigger any dynamic import of transformers
    const _importSpy = vi.fn();
    // We detect model loading by checking that no heavy work happens at import
    const startTime = performance.now();
    await import('../services/embeddingService.js');
    const elapsed = performance.now() - startTime;
    // Import should be essentially instant (<100ms), not multi-second model load
    expect(elapsed).toBeLessThan(500);
  });
});

// ─── Graceful degradation ───────────────────────────────────────────────────
describe('Search Mode: semantic (model failure)', () => {
  let handleInstructionsSearch: typeof import('../services/handlers.search').handleInstructionsSearch;

  beforeEach(async () => {
    vi.resetModules();

    // Mock indexContext
    vi.doMock('../services/indexContext', () => ({
      ensureLoaded: () => ({
        loadedAt: new Date().toISOString(),
        hash: 'h1',
        byId: new Map(),
        list: [
          {
            id: 'test-001',
            title: 'Test Instruction',
            body: 'Some test content about deployment',
            priority: 10,
            audience: 'all',
            requirement: 'recommended',
            categories: ['test'],
            contentType: 'instruction',
            sourceHash: 'h1',
            schemaVersion: '1',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ],
        fileCount: 1,
        versionMTime: 0,
        versionToken: 'v1',
      }),
    }));

    // Mock runtimeConfig — semantic enabled
    vi.doMock('../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({
        logging: MOCK_LOGGING,
        semantic: { enabled: true, model: 'Xenova/all-MiniLM-L6-v2', cacheDir: '/tmp/models', embeddingPath: '/tmp/embeddings.json', device: 'cpu', localOnly: false },
      }),
    }));

    // Mock embeddingService — model loading FAILS
    vi.doMock('../services/embeddingService', async () => {
      const actual = await vi.importActual('../services/embeddingService');
      return {
        ...(actual as object),
        embedText: vi.fn().mockRejectedValue(new Error('Model loading failed: out of memory')),
        getInstructionEmbeddings: vi.fn().mockRejectedValue(new Error('Model loading failed: out of memory')),
      };
    });

    const mod = await import('../services/handlers.search.js');
    handleInstructionsSearch = mod.handleInstructionsSearch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should gracefully degrade to keyword mode if model loading fails', async () => {
    const result = await handleInstructionsSearch({
      keywords: ['deployment'],
      mode: 'semantic',
    });
    // Should fall back to keyword search and find the result via substring match
    expect(result).toBeDefined();
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].instructionId).toBe('test-001');
    // Should indicate fallback happened
    expect(result.query.mode).toBe('keyword');
  });
});

// ─── Device and localOnly config options ────────────────────────────────────
describe('Search Mode: semantic (device/localOnly config)', () => {
  let handleInstructionsSearch: typeof import('../services/handlers.search').handleInstructionsSearch;
  let mockEmbedText: ReturnType<typeof vi.fn>;
  let mockGetEmbeddings: ReturnType<typeof vi.fn>;

  function setupWithConfig(semanticConfig: { enabled: boolean; model: string; cacheDir: string; embeddingPath: string; device: string; localOnly: boolean }) {
    vi.resetModules();

    vi.doMock('../services/indexContext', () => ({
      ensureLoaded: () => ({
        loadedAt: new Date().toISOString(),
        hash: 'Index-hash-1',
        byId: new Map(),
        list: [
          {
            id: 'deploy-001',
            title: 'Deployment Pipeline',
            body: 'CI/CD deployment pipeline configuration',
            priority: 10,
            audience: 'all',
            requirement: 'recommended',
            categories: ['devops'],
            contentType: 'instruction',
            sourceHash: 'h1',
            schemaVersion: '1',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ],
        fileCount: 1,
        versionMTime: 0,
        versionToken: 'v1',
      }),
    }));

    vi.doMock('../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({
        logging: MOCK_LOGGING,
        semantic: semanticConfig,
      }),
    }));

    const fakeEmbeddings: Record<string, Float32Array> = {
      'deploy-001': new Float32Array([0.9, 0.1, 0.0]),
    };
    mockEmbedText = vi.fn().mockResolvedValue(new Float32Array([0.85, 0.15, 0.0]));
    mockGetEmbeddings = vi.fn().mockResolvedValue(fakeEmbeddings);

    vi.doMock('../services/embeddingService', async () => {
      const actual = await vi.importActual('../services/embeddingService');
      return {
        ...(actual as object),
        embedText: mockEmbedText,
        getInstructionEmbeddings: mockGetEmbeddings,
      };
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass device=cuda to embedding functions', async () => {
    setupWithConfig({ enabled: true, model: 'Xenova/all-MiniLM-L6-v2', cacheDir: '/tmp/models', embeddingPath: '/tmp/embeddings.json', device: 'cuda', localOnly: false });
    const mod = await import('../services/handlers.search.js');
    handleInstructionsSearch = mod.handleInstructionsSearch;

    await handleInstructionsSearch({ keywords: ['deploy'], mode: 'semantic' });

    // Verify device='cuda' was passed through
    expect(mockEmbedText).toHaveBeenCalledWith(expect.any(String), 'Xenova/all-MiniLM-L6-v2', '/tmp/models', 'cuda', false);
    expect(mockGetEmbeddings).toHaveBeenCalledWith(expect.any(Array), expect.any(String), '/tmp/embeddings.json', 'Xenova/all-MiniLM-L6-v2', '/tmp/models', 'cuda', false);
  });

  it('should pass device=dml to embedding functions', async () => {
    setupWithConfig({ enabled: true, model: 'Xenova/all-MiniLM-L6-v2', cacheDir: '/tmp/models', embeddingPath: '/tmp/embeddings.json', device: 'dml', localOnly: false });
    const mod = await import('../services/handlers.search.js');
    handleInstructionsSearch = mod.handleInstructionsSearch;

    await handleInstructionsSearch({ keywords: ['deploy'], mode: 'semantic' });

    expect(mockEmbedText).toHaveBeenCalledWith(expect.any(String), 'Xenova/all-MiniLM-L6-v2', '/tmp/models', 'dml', false);
  });

  it('should pass localOnly=true to embedding functions', async () => {
    setupWithConfig({ enabled: true, model: 'Xenova/all-MiniLM-L6-v2', cacheDir: '/tmp/models', embeddingPath: '/tmp/embeddings.json', device: 'cpu', localOnly: true });
    const mod = await import('../services/handlers.search.js');
    handleInstructionsSearch = mod.handleInstructionsSearch;

    await handleInstructionsSearch({ keywords: ['deploy'], mode: 'semantic' });

    expect(mockEmbedText).toHaveBeenCalledWith(expect.any(String), 'Xenova/all-MiniLM-L6-v2', '/tmp/models', 'cpu', true);
    expect(mockGetEmbeddings).toHaveBeenCalledWith(expect.any(Array), expect.any(String), '/tmp/embeddings.json', 'Xenova/all-MiniLM-L6-v2', '/tmp/models', 'cpu', true);
  });
});
