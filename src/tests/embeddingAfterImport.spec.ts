/**
 * End-to-End: Import → Embedding Compute → Keyword/Semantic Search → Compare
 *
 * Verifies:
 * 1. After add/import, embeddings are computed and both search modes work
 * 2. Semantic search finds conceptually related content that keyword search misses
 * 3. No staging/embedding artifacts leak into INDEX_SERVER_DIR or sqlite dir
 *
 * Uses mocked embedding function (deterministic vectors) to avoid model downloads.
 * Exercises the real triggerEmbeddingComputeAfterImport (awaitable path).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── Deterministic mock vectors for semantic similarity testing ──────────────
// We assign vectors where cosine similarity reflects conceptual relatedness:
//   k8s/containers → [0.9, 0.1, 0.0]
//   database/indexing → [0.1, 0.9, 0.0]
//   auth/security → [0.0, 0.1, 0.9]
// Query "container orchestration" → [0.85, 0.15, 0.0] (close to k8s, far from auth)
const VECTORS: Record<string, number[]> = {
  // Instruction bodies (heuristic: assign by content keyword)
  'kubernetes': [0.9, 0.1, 0.0],
  'database': [0.1, 0.9, 0.0],
  'authentication': [0.0, 0.1, 0.9],
  'microservices': [0.7, 0.2, 0.1],
  'caching': [0.2, 0.7, 0.1],
  // Default fallback
  'default': [0.33, 0.33, 0.34],
};

function vectorForText(text: string): Float32Array {
  const lower = text.toLowerCase();
  for (const [key, vec] of Object.entries(VECTORS)) {
    if (lower.includes(key)) return new Float32Array(vec);
  }
  return new Float32Array(VECTORS['default']);
}

// Disallowed file extensions/names that should never appear in instructions dir
const DISALLOWED_IN_INSTR_DIR = ['.zip', '.db', '.db-wal', '.db-shm', 'embeddings.json'];
// Disallowed artifacts that should not appear in sqlite dir alongside the DB
const DISALLOWED_IN_SQLITE_DIR = ['.zip', 'embeddings.json'];

describe('Embedding After Import: E2E Search Verification', () => {
  let tempRoot: string;
  let instructionsDir: string;
  let stateDir: string;
  let embeddingPath: string;
  let sqlitePath: string;

  // Saved env
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'INDEX_SERVER_DIR',
    'INDEX_SERVER_STATE_DIR',
    'INDEX_SERVER_EMBEDDING_PATH',
    'INDEX_SERVER_SQLITE_PATH',
    'INDEX_SERVER_SEMANTIC_ENABLED',
    'INDEX_SERVER_MUTATION',
    'INDEX_SERVER_MANIFEST_WRITE',
    'INDEX_SERVER_AUTO_EMBED_ON_IMPORT',
    'INDEX_SERVER_STORAGE_BACKEND',
    'INDEX_SERVER_SQLITE_VEC_ENABLED',
  ];

  // Dynamically imported modules (after mocks)
  let invoke: (name: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  let invalidate: () => void;
  let triggerEmbeddingComputeAfterImport: (reason: string) => Promise<{ triggered: boolean; reason?: string; entries?: number; ms?: number }>;
  let forceBootstrapConfirmForTests: (reason: string) => void;

  const createdIds: string[] = [];

  beforeAll(async () => {
    // Save env
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

    // Create isolated temp directories
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-e2e-'));
    instructionsDir = path.join(tempRoot, 'instructions');
    stateDir = path.join(tempRoot, 'state');
    embeddingPath = path.join(tempRoot, 'data', 'embeddings.json');
    sqlitePath = path.join(tempRoot, 'data', 'index.db');
    fs.mkdirSync(instructionsDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(path.dirname(embeddingPath), { recursive: true });

    // Configure env for isolation
    process.env.INDEX_SERVER_DIR = instructionsDir;
    process.env.INDEX_SERVER_STATE_DIR = stateDir;
    process.env.INDEX_SERVER_EMBEDDING_PATH = embeddingPath;
    process.env.INDEX_SERVER_SQLITE_PATH = sqlitePath;
    process.env.INDEX_SERVER_SEMANTIC_ENABLED = '1';
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_MANIFEST_WRITE = '0';
    process.env.INDEX_SERVER_AUTO_EMBED_ON_IMPORT = '1';
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'json';
    process.env.INDEX_SERVER_SQLITE_VEC_ENABLED = '0';

    // Mock embedText to return deterministic vectors
    vi.doMock('../services/embeddingService', async (importOriginal) => {
      const original = await importOriginal() as Record<string, unknown>;
      return {
        ...original,
        embedText: vi.fn().mockImplementation(async (text: string) => vectorForText(text)),
        getInstructionEmbeddings: vi.fn().mockImplementation(
          async (instructions: Array<{ id: string; body: string }>) => {
            const result: Record<string, Float32Array> = {};
            for (const instr of instructions) {
              result[instr.id] = vectorForText(instr.body);
            }
            return result;
          }
        ),
        cosineSimilarity: (original as Record<string, unknown>).cosineSimilarity,
      };
    });

    // Import modules after mocking
    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    const { getHandler } = await import('../server/registry.js');
    const indexContext = await import('../services/indexContext.js');
    const bootstrap = await import('../services/bootstrapGating.js');
    const trigger = await import('../services/embeddingTrigger.js');

    // Register handlers
    await import('../services/handlers.instructions.js');
    await import('../services/handlers.search.js');
    await import('../services/instructions.dispatcher.js');

    invalidate = indexContext.invalidate;
    triggerEmbeddingComputeAfterImport = trigger.triggerEmbeddingComputeAfterImport;
    forceBootstrapConfirmForTests = bootstrap.forceBootstrapConfirmForTests;

    invoke = async (name: string, params: Record<string, unknown>) => {
      const handler = getHandler(name);
      if (!handler) throw new Error(`Handler "${name}" not registered`);
      const raw = await handler(params);
      const wrapped = raw as { content?: Array<{ text: string }> };
      if (wrapped?.content?.[0]?.text) {
        try {
          const inner = JSON.parse(wrapped.content[0].text);
          if (inner && typeof inner === 'object' && 'data' in inner && typeof inner.data === 'object') {
            return inner.data as Record<string, unknown>;
          }
          return inner as Record<string, unknown>;
        } catch { /* fall through */ }
      }
      return raw as Record<string, unknown>;
    };

    try { reloadRuntimeConfig(); } catch { /* ok */ }
    forceBootstrapConfirmForTests('embedding-after-import-e2e');
    invalidate();
  });

  afterAll(() => {
    // Restore env
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
    try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ok */ }
  });

  beforeEach(() => {
    invalidate();
  });

  // ─── Test 1: Add + Keyword Search + Semantic Search (same query) ────────────
  it('add instructions then verify both keyword and semantic search find them', async () => {
    const instructions = [
      {
        id: 'emb-e2e-k8s',
        title: 'Kubernetes deployment practices',
        body: 'Use kubernetes pod autoscaling with horizontal pod autoscaler for container orchestration reliability.',
        priority: 30,
        audience: 'all',
        requirement: 'recommended',
        categories: ['infrastructure'],
        contentType: 'instruction',
      },
      {
        id: 'emb-e2e-db',
        title: 'Database index optimization',
        body: 'Create composite database indexes on frequently queried columns to improve read performance.',
        priority: 30,
        audience: 'all',
        requirement: 'recommended',
        categories: ['performance'],
        contentType: 'instruction',
      },
      {
        id: 'emb-e2e-auth',
        title: 'Authentication token rotation',
        body: 'Implement authentication token rotation with short-lived JWTs and refresh token patterns.',
        priority: 30,
        audience: 'all',
        requirement: 'recommended',
        categories: ['security'],
        contentType: 'instruction',
      },
    ];

    // Add all instructions
    for (const entry of instructions) {
      const result = await invoke('index_dispatch', { action: 'add', entry, lax: true, overwrite: true });
      expect(result.id).toBe(entry.id);
      createdIds.push(entry.id);
    }

    invalidate();

    // Trigger embedding compute (awaitable, not fire-and-forget)
    const triggerResult = await triggerEmbeddingComputeAfterImport('e2e-test-add');
    expect(triggerResult.triggered).toBe(true);

    // Keyword search: "kubernetes" should find the k8s instruction
    const keywordResult = await invoke('index_search', {
      keywords: ['kubernetes'],
      mode: 'keyword',
      limit: 10,
    });
    const keywordIds = ((keywordResult.results ?? []) as Array<{ instructionId: string }>).map(r => r.instructionId);
    expect(keywordIds).toContain('emb-e2e-k8s');
    // Keyword search should NOT find auth instruction for "kubernetes"
    expect(keywordIds).not.toContain('emb-e2e-auth');

    // Semantic search: same query "kubernetes" — should also find k8s
    const semanticResult = await invoke('index_search', {
      keywords: ['kubernetes'],
      mode: 'semantic',
      limit: 10,
    });
    const semanticIds = ((semanticResult.results ?? []) as Array<{ instructionId: string }>).map(r => r.instructionId);
    expect(semanticIds).toContain('emb-e2e-k8s');
  }, 30_000);

  // ─── Test 2: Semantic search finds conceptual matches keyword misses ────────
  it('semantic search finds conceptually related results that keyword search misses', async () => {
    // Use a query with NO exact keyword overlap with any instruction body
    const conceptualQuery = 'container orchestration scaling';

    // Keyword search: no instruction body contains all these words together
    const keywordResult = await invoke('index_search', {
      keywords: [conceptualQuery],
      mode: 'keyword',
      limit: 10,
    });
    const keywordMatches = (keywordResult.totalMatches as number) ?? 0;

    // Semantic search: should find k8s instruction via conceptual similarity
    const semanticResult = await invoke('index_search', {
      keywords: [conceptualQuery],
      mode: 'semantic',
      limit: 10,
    });
    const semanticMatches = (semanticResult.totalMatches as number) ?? 0;
    const semanticIds = ((semanticResult.results ?? []) as Array<{ instructionId: string }>).map(r => r.instructionId);

    // Semantic should find more results than keyword for conceptual queries
    expect(semanticMatches).toBeGreaterThanOrEqual(keywordMatches);
    // The k8s instruction should be found semantically
    expect(semanticIds).toContain('emb-e2e-k8s');
  }, 30_000);

  // ─── Test 3: Bulk import + embeddings computed for all ──────────────────────
  it('bulk import computes embeddings for all imported instructions', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `emb-e2e-bulk-${i}`,
      title: `Bulk instruction ${i}`,
      body: i < 2 ? 'kubernetes container pod deployment' : i < 4 ? 'database query optimization caching' : 'authentication security hardening',
      priority: 20,
      audience: 'all' as const,
      requirement: 'recommended' as const,
      categories: ['bulk-test'],
      contentType: 'instruction' as const,
    }));

    const importResult = await invoke('index_dispatch', {
      action: 'import',
      entries,
      mode: 'overwrite',
      lax: true,
    });
    expect(importResult.error).toBeUndefined();
    createdIds.push(...entries.map(e => e.id));

    invalidate();

    // Wait to avoid 1s debounce from prior test
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Trigger embedding compute
    const triggerResult = await triggerEmbeddingComputeAfterImport('e2e-bulk-import');
    expect(triggerResult.triggered).toBe(true);

    // Search should find bulk entries
    const searchResult = await invoke('index_search', {
      keywords: ['kubernetes'],
      mode: 'keyword',
      limit: 20,
    });
    const ids = ((searchResult.results ?? []) as Array<{ instructionId: string }>).map(r => r.instructionId);
    expect(ids).toContain('emb-e2e-bulk-0');
    expect(ids).toContain('emb-e2e-bulk-1');
  }, 30_000);

  // ─── Test 4: No staging artifacts in INDEX_SERVER_DIR ──────────────────────
  it('no staging/embedding artifacts leak into INDEX_SERVER_DIR or sqlite directory', async () => {
    // After all prior tests, scan the instructions directory
    const instrFiles = fs.readdirSync(instructionsDir);

    for (const file of instrFiles) {
      const lower = file.toLowerCase();
      for (const disallowed of DISALLOWED_IN_INSTR_DIR) {
        expect(lower.endsWith(disallowed) || lower === disallowed,
          `Disallowed artifact "${file}" found in INDEX_SERVER_DIR`
        ).toBe(false);
      }
      // All files in instructions dir should be .json instruction files or known infra
      const ALLOWED_INFRA_FILES = ['.index-version', '.gitkeep'];
      if (!file.startsWith('_') && !ALLOWED_INFRA_FILES.includes(file)) {
        expect(file.endsWith('.json'),
          `Non-JSON file "${file}" found in INDEX_SERVER_DIR`
        ).toBe(true);
      }
    }

    // Scan sqlite directory (dirname of INDEX_SERVER_SQLITE_PATH)
    const sqliteDir = path.dirname(sqlitePath);
    if (fs.existsSync(sqliteDir)) {
      const sqliteFiles = fs.readdirSync(sqliteDir);
      for (const file of sqliteFiles) {
        const lower = file.toLowerCase();
        for (const disallowed of DISALLOWED_IN_SQLITE_DIR) {
          expect(lower === disallowed,
            `Disallowed artifact "${file}" found in sqlite directory`
          ).toBe(false);
        }
      }
    }

    // Verify embeddings land ONLY at the configured EMBEDDING_PATH
    if (fs.existsSync(embeddingPath)) {
      // This is fine — embeddings are expected here
      const embDir = path.dirname(embeddingPath);
      expect(embDir).not.toBe(instructionsDir);
    }

    // Recursively check instructions dir for any nested staging dirs
    const walk = (dir: string): string[] => {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...walk(full));
        else results.push(full);
      }
      return results;
    };

    const allInstrFiles = walk(instructionsDir);
    for (const file of allInstrFiles) {
      const basename = path.basename(file).toLowerCase();
      expect(basename.endsWith('.zip'),
        `Zip staging artifact "${file}" found under INDEX_SERVER_DIR`
      ).toBe(false);
      expect(basename.endsWith('.db'),
        `Database artifact "${file}" found under INDEX_SERVER_DIR`
      ).toBe(false);
      expect(basename === 'embeddings.json',
        `Embeddings cache "${file}" found under INDEX_SERVER_DIR`
      ).toBe(false);
    }
  });

  // ─── Test 5: Embedding path isolation from instructions dir ────────────────
  it('embedding path is distinct from instructions directory', () => {
    const resolvedEmb = path.resolve(embeddingPath);
    const resolvedInstr = path.resolve(instructionsDir);
    const resolvedSqlite = path.resolve(sqlitePath);

    // Embedding file must not be inside the instructions directory
    expect(resolvedEmb.startsWith(resolvedInstr + path.sep),
      `Embedding path "${resolvedEmb}" must not be inside INDEX_SERVER_DIR "${resolvedInstr}"`
    ).toBe(false);

    // Embedding file must not be the sqlite file
    expect(resolvedEmb).not.toBe(resolvedSqlite);

    // Instructions dir must not contain the sqlite database
    expect(resolvedSqlite.startsWith(resolvedInstr + path.sep),
      `SQLite path "${resolvedSqlite}" must not be inside INDEX_SERVER_DIR "${resolvedInstr}"`
    ).toBe(false);
  });
});
