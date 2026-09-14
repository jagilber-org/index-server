/**
 * Embeddings Routes — TDD RED Tests
 *
 * Tests for GET /api/embeddings/projection endpoint.
 * Validates: route existence, response shape, PCA projection, error handling.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createEmbeddingsRoutes } from '../dashboard/server/routes/embeddings.routes.js';
import { CATEGORY_RULES } from '../services/categoryRules.js';
import express from 'express';

/** Dummy 32-char hex used only to prove indexHash round-trips. */
const TEST_INDEX_HASH = 'abcdef0123456789abcdef0123456789'; // pragma: allowlist secret

/** Tiny HTTP GET helper */
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
  });
}

describe('Embeddings Routes — /api/embeddings/projection', () => {
  let server: http.Server;
  let port: number;
  let tmpDir: string;
  let embeddingsPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-test-'));
    embeddingsPath = path.join(tmpDir, 'embeddings.json');
  });

  afterAll(() => {
    if (server) server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** IDs that exercise deriveCategory — one per major category */
  const FIXTURE_IDS = [
    'azure-batch-pool-resize',
    'sf-deploy-troubleshooting',
    'agent-build-validate',
    'mcp-index-search-guide',
    'powershell-remoting-setup',
    'vscode-debug',
    'ai-model-evaluation',
    'git-branch-strategy',
    'test-coverage-baseline',
    'generic-other-entry',
  ];

  /** Build a minimal embeddings JSON fixture */
  function writeEmbeddings(count: number, dims = 8): void {
    const embeddings: Record<string, number[]> = {};
    for (let i = 0; i < count; i++) {
      const id = i < FIXTURE_IDS.length ? FIXTURE_IDS[i] : `test-instruction-${i}`;
      const vec = Array.from({ length: dims }, (_, d) => Math.sin(i + d) * 0.5);
      embeddings[id] = vec;
    }
    fs.writeFileSync(embeddingsPath, JSON.stringify({
      indexHash: 'test-hash',
      modelName: 'test-model',
      embeddings,
    }));
  }

  /** Start an express app with the embeddings route */
  function startServer(): Promise<number> {
    return new Promise((resolve) => {
      const app = express();
      app.use('/api', createEmbeddingsRoutes(embeddingsPath));
      server = app.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve(port);
      });
    });
  }

  describe('with valid embeddings file', () => {
    beforeAll(async () => {
      writeEmbeddings(10, 8);
      await startServer();
    });

    it('returns 200 with success:true', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/api/embeddings/projection`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.success).toBe(true);
    });

    it('returns correct count and model', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/api/embeddings/projection`);
      const json = JSON.parse(res.body);
      expect(json.count).toBe(10);
      expect(json.model).toBe('test-model');
    });

    it('returns projected 2D points with expected shape', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/api/embeddings/projection`);
      const json = JSON.parse(res.body);
      expect(json.points).toHaveLength(10);
      const pt = json.points[0];
      expect(pt).toHaveProperty('id');
      expect(pt).toHaveProperty('x');
      expect(pt).toHaveProperty('y');
      expect(pt).toHaveProperty('category');
      expect(pt).toHaveProperty('norm');
      expect(typeof pt.x).toBe('number');
      expect(typeof pt.y).toBe('number');
      expect(typeof pt.category).toBe('string');
      expect(typeof pt.norm).toBe('number');
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
      expect(pt.norm).toBeGreaterThan(0);
    });

    it('derives categories from instruction IDs', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/api/embeddings/projection`);
      const json = JSON.parse(res.body);
      const catById = Object.fromEntries(json.points.map((p: { id: string; category: string }) => [p.id, p.category]));
      expect(catById['azure-batch-pool-resize']).toBe('Azure');
      expect(catById['sf-deploy-troubleshooting']).toBe('Service Fabric');
      expect(catById['agent-build-validate']).toBe('Agent');
      expect(catById['mcp-index-search-guide']).toBe('MCP');
      expect(catById['powershell-remoting-setup']).toBe('PowerShell');
      expect(catById['vscode-debug']).toBe('VS Code');
      expect(catById['ai-model-evaluation']).toBe('AI/ML');
      expect(catById['git-branch-strategy']).toBe('Git/Repo');
      expect(catById['test-coverage-baseline']).toBe('Testing');
      expect(catById['generic-other-entry']).toBe('Other');
    });

    it('returns stats object with cosine similarity metrics', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/api/embeddings/projection`);
      const json = JSON.parse(res.body);
      expect(json.stats).toBeDefined();
      expect(json.stats).toHaveProperty('avgCosineSim');
      expect(json.stats).toHaveProperty('minCosineSim');
      expect(json.stats).toHaveProperty('maxCosineSim');
      expect(typeof json.stats.avgCosineSim).toBe('number');
      expect(json.stats.minCosineSim).toBeLessThanOrEqual(json.stats.maxCosineSim);
    });

    it('returns similarPairs array', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/api/embeddings/projection`);
      const json = JSON.parse(res.body);
      expect(Array.isArray(json.similarPairs)).toBe(true);
      if (json.similarPairs.length > 0) {
        const pair = json.similarPairs[0];
        expect(pair).toHaveProperty('a');
        expect(pair).toHaveProperty('b');
        expect(pair).toHaveProperty('similarity');
        expect(typeof pair.similarity).toBe('number');
      }
    });

    it('returns dimensions matching input', async () => {
      const res = await httpGet(`http://127.0.0.1:${port}/api/embeddings/projection`);
      const json = JSON.parse(res.body);
      expect(json.dimensions).toBe(8);
    });
  });

  describe('with missing embeddings file', () => {
    let noFileServer: http.Server;
    let noFilePort: number;

    beforeAll(async () => {
      const missingPath = path.join(tmpDir, 'nonexistent.json');
      const app = express();
      app.use('/api', createEmbeddingsRoutes(missingPath));
      await new Promise<void>((resolve) => {
        noFileServer = app.listen(0, () => {
          noFilePort = (noFileServer.address() as { port: number }).port;
          resolve();
        });
      });
    });

    afterAll(() => { noFileServer?.close(); });

    it('returns 404 when embeddings file does not exist', async () => {
      const res = await httpGet(`http://127.0.0.1:${noFilePort}/api/embeddings/projection`);
      expect(res.status).toBe(404);
      const json = JSON.parse(res.body);
      expect(json.success).toBe(false);
      expect(json.error).toContain('not found');
    });
  });

  describe('with single-point embeddings', () => {
    let singleServer: http.Server;
    let singlePort: number;

    beforeAll(async () => {
      const singlePath = path.join(tmpDir, 'single.json');
      fs.writeFileSync(singlePath, JSON.stringify({
        indexHash: 'h',
        modelName: 'm',
        embeddings: { 'only-one': [1, 0, 0, 0] },
      }));
      const app = express();
      app.use('/api', createEmbeddingsRoutes(singlePath));
      await new Promise<void>((resolve) => {
        singleServer = app.listen(0, () => {
          singlePort = (singleServer.address() as { port: number }).port;
          resolve();
        });
      });
    });

    afterAll(() => { singleServer?.close(); });

    it('handles single embedding gracefully', async () => {
      const res = await httpGet(`http://127.0.0.1:${singlePort}/api/embeddings/projection`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.count).toBe(1);
      expect(json.points).toHaveLength(1);
      // Single point should project to origin or near-zero
      expect(Number.isFinite(json.points[0].x)).toBe(true);
      expect(Number.isFinite(json.points[0].y)).toBe(true);
    });
  });

  describe('with no override (uses runtimeConfig default)', () => {
    let defaultServer: http.Server;
    let defaultPort: number;
    let fixtureDir: string;
    let fixturePath: string;

    beforeAll(async () => {
      // Set env var so runtimeConfig picks up our fixture
      fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-default-'));
      fixturePath = path.join(fixtureDir, 'embeddings.json');
      fs.writeFileSync(fixturePath, JSON.stringify({
        indexHash: 'default-test',
        modelName: 'default-model',
        embeddings: { 'default-instr': [1, 2, 3, 4] },
      }));
      process.env.INDEX_SERVER_EMBEDDING_PATH = fixturePath;
      // Force runtimeConfig to reload with new env
      const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
      reloadRuntimeConfig();

      const app = express();
      app.use('/api', createEmbeddingsRoutes()); // no override
      await new Promise<void>((resolve) => {
        defaultServer = app.listen(0, () => {
          defaultPort = (defaultServer.address() as { port: number }).port;
          resolve();
        });
      });
    });

    afterAll(() => {
      defaultServer?.close();
      delete process.env.INDEX_SERVER_EMBEDDING_PATH;
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    });

    it('uses runtimeConfig.embeddingPath when no override is given', async () => {
      const res = await httpGet(`http://127.0.0.1:${defaultPort}/api/embeddings/projection`);
      // Should NOT be 404 — it should find the file via runtimeConfig
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.success).toBe(true);
      expect(json.count).toBeGreaterThan(0);
    });
  });
});

/**
 * Issue #534 — embeddings projection regressions.
 *
 * Defect 1: the handler built every point with deriveCategory(id) and never
 *           touched res.locals.indexState, so title / primaryCategory /
 *           categories[] could not influence classification (29.9% 'Other').
 * Defect 3: indexHash was read off the store at :198 and then simply omitted
 *           from the response, so the dashboard rendered 'Index Hash: ?'. The
 *           pre-existing suite used indexHash as FIXTURE INPUT ONLY and never
 *           asserted it came back — which is why the defect shipped.
 *
 * Constitution refs: TS-8 (red first), TS-9 (regression test first), TS-12 (>=5 cases).
 */
describe('#534 Embeddings projection — indexHash + metadata classification', () => {
  let tmpDir: string;
  const servers: http.Server[] = [];

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-534-'));
  });

  afterAll(() => {
    for (const s of servers) s.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Minimal InstructionEntry-shaped metadata the route may consult. */
  interface FixtureEntry {
    id: string;
    title?: string;
    primaryCategory?: string;
    categories?: string[];
  }

  /**
   * Boot a server for the given embeddings file. When entries is supplied we
   * install a stand-in for ensureLoadedMiddleware that publishes the same
   * res.locals.indexState shape the real middleware provides, so the route runs
   * against production code with realistic input (TS-10).
   */
  async function boot(
    name: string,
    file: { indexHash?: string; modelName: string; embeddings: Record<string, number[]> },
    entries?: FixtureEntry[],
  ): Promise<string> {
    const filePath = path.join(tmpDir, name + '.json');
    fs.writeFileSync(filePath, JSON.stringify(file));
    const app = express();
    if (entries) {
      app.use((_req, res, next) => {
        res.locals.indexState = {
          hash: file.indexHash,
          list: entries,
          byId: new Map(entries.map(e => [e.id, e])),
        };
        next();
      });
    }
    app.use('/api', createEmbeddingsRoutes(filePath));
    const srv = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    servers.push(srv);
    return 'http://127.0.0.1:' + (srv.address() as { port: number }).port + '/api/embeddings/projection';
  }

  const VEC = (seed: number, dims = 6): number[] =>
    Array.from({ length: dims }, (_, d) => Math.sin(seed + d) * 0.5 + 0.1);

  const catsOf = (json: { points: { id: string; category: string }[] }): Record<string, string> =>
    Object.fromEntries(json.points.map(p => [p.id, p.category]));

  // ── Defect 3: indexHash round-trips ──────────────────────────────────────

  it('returns the indexHash it loaded (multi-point response)', async () => {
    const url = await boot('hash-multi', {
      indexHash: TEST_INDEX_HASH,
      modelName: 'test-model',
      embeddings: { alpha: VEC(1), beta: VEC(2), gamma: VEC(3) },
    });
    const json = JSON.parse((await httpGet(url)).body);
    expect(json.indexHash).toBe(TEST_INDEX_HASH);
  });

  it('returns the indexHash on the empty-index early return', async () => {
    // The ids.length === 0 short-circuit is a separate response literal and
    // omitted indexHash independently of the main path.
    const url = await boot('hash-empty', {
      indexHash: 'empty-index-hash',
      modelName: 'test-model',
      embeddings: {},
    });
    const res = await httpGet(url);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.count).toBe(0);
    expect(json.points).toEqual([]);
    expect(json.indexHash).toBe('empty-index-hash');
  });

  it('returns the indexHash for a single-point projection', async () => {
    const url = await boot('hash-single', {
      indexHash: 'single-hash',
      modelName: 'm',
      embeddings: { 'only-one': [1, 0, 0, 0] },
    });
    const json = JSON.parse((await httpGet(url)).body);
    expect(json.count).toBe(1);
    expect(json.indexHash).toBe('single-hash');
  });

  it('returns a string indexHash even when the store has none (no undefined leak)', async () => {
    // The dashboard renders embData.indexHash || '' — a missing key and an
    // absent hash must both degrade to a rendered placeholder, not a crash.
    const url = await boot('hash-absent', {
      modelName: 'm',
      embeddings: { alpha: VEC(1), beta: VEC(2) },
    });
    const json = JSON.parse((await httpGet(url)).body);
    expect(json).toHaveProperty('indexHash');
    expect(typeof json.indexHash).toBe('string');
    expect(json.indexHash).toBe('');
  });

  // ── Defect 1: metadata-aware classification ──────────────────────────────

  it('classifies from index metadata when the ID alone derives Other', async () => {
    const url = await boot(
      'meta-basic',
      {
        indexHash: 'h', modelName: 'm',
        embeddings: {
          'alpha': VEC(1), 'beta': VEC(2), 'gamma': VEC(3), 'delta': VEC(4), 'epsilon': VEC(5),
        },
      },
      [
        { id: 'alpha', title: 'Kusto query patterns' },
        { id: 'beta', primaryCategory: 'mermaid' },
        { id: 'gamma', categories: ['misc', 'governance'] },
        { id: 'delta', title: 'Incident bridge checklist' },
        { id: 'epsilon', title: 'Assorted notes', categories: ['misc'] },
      ],
    );
    const cat = catsOf(JSON.parse((await httpGet(url)).body));
    expect(cat['alpha']).toBe('Kusto');
    expect(cat['beta']).toBe('Mermaid');
    expect(cat['gamma']).toBe('Governance');
    expect(cat['delta']).toBe('Operations');
    expect(cat['epsilon']).toBe('Other'); // genuinely unclassifiable stays Other
  });

  it('keeps ID derivation authoritative over conflicting metadata', async () => {
    const url = await boot(
      'meta-precedence',
      {
        indexHash: 'h', modelName: 'm',
        embeddings: { 'azure-batch-pool-resize': VEC(1), 'mcp-index-search-guide': VEC(2), 'plain': VEC(3) },
      },
      [
        { id: 'azure-batch-pool-resize', title: 'Kusto notes', primaryCategory: 'mermaid' },
        { id: 'mcp-index-search-guide', primaryCategory: 'testing' },
        { id: 'plain', primaryCategory: 'testing' },
      ],
    );
    const cat = catsOf(JSON.parse((await httpGet(url)).body));
    expect(cat['azure-batch-pool-resize']).toBe('Azure');
    expect(cat['mcp-index-search-guide']).toBe('MCP');
    expect(cat['plain']).toBe('Testing');
  });

  it('falls back to ID-only derivation when no index state is mounted', async () => {
    // The route is mounted without ensureLoadedMiddleware in some test and
    // embedded-server configurations; it must degrade, not throw.
    const url = await boot('meta-absent', {
      indexHash: 'h', modelName: 'm',
      embeddings: { 'azure-batch-pool-resize': VEC(1), 'alpha': VEC(2) },
    });
    const res = await httpGet(url);
    expect(res.status).toBe(200);
    const cat = catsOf(JSON.parse(res.body));
    expect(cat['azure-batch-pool-resize']).toBe('Azure');
    expect(cat['alpha']).toBe('Other');
  });

  it('tolerates embeddings whose IDs are absent from the index state', async () => {
    // Stale embeddings cache vs. a freshly-groomed index: the join must miss
    // silently and fall back to the ID rules for the orphan.
    const url = await boot(
      'meta-orphan',
      { indexHash: 'h', modelName: 'm', embeddings: { 'alpha': VEC(1), 'orphan-entry': VEC(2) } },
      [{ id: 'alpha', primaryCategory: 'kusto' }],
    );
    const res = await httpGet(url);
    expect(res.status).toBe(200);
    const cat = catsOf(JSON.parse(res.body));
    expect(cat['alpha']).toBe('Kusto');
    expect(cat['orphan-entry']).toBe('Other');
  });

  it('emits only categories the client colour map can render', async () => {
    // Closed label set: metadata must be matched THROUGH CATEGORY_RULES, never
    // surfaced verbatim, or the legend grows labels with no colour (#534 d2).
    const url = await boot(
      'meta-closed-set',
      {
        indexHash: 'h', modelName: 'm',
        embeddings: { 'a': VEC(1), 'b': VEC(2), 'c': VEC(3) },
      },
      [
        { id: 'a', primaryCategory: 'performance' },
        { id: 'b', primaryCategory: 'zzz-unknown-taxonomy', categories: ['also-unknown'] },
        { id: 'c', title: 'An ordinary sentence with no signal' },
      ],
    );
    const json = JSON.parse((await httpGet(url)).body);
    const allowed = new Set([...CATEGORY_RULES.map(([, label]) => label), 'Other']);
    for (const p of json.points as { id: string; category: string }[]) {
      expect(allowed.has(p.category), p.id + ' -> unrenderable category ' + p.category).toBe(true);
    }
  });

  it('includes the entry title on points when index state is available', async () => {
    // admin.embeddings.js already renders pt.title in the detail panel; the
    // route never populated it, so that line was permanently dead.
    const url = await boot(
      'meta-title',
      { indexHash: 'h', modelName: 'm', embeddings: { 'alpha': VEC(1), 'orphan': VEC(2) } },
      [{ id: 'alpha', title: 'Kusto query patterns' }],
    );
    const json = JSON.parse((await httpGet(url)).body);
    const byId = Object.fromEntries(
      json.points.map((p: { id: string; title?: string }) => [p.id, p.title]),
    );
    expect(byId['alpha']).toBe('Kusto query patterns');
    expect(byId['orphan']).toBeUndefined();
  });
});
