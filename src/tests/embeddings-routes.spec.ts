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
import express from 'express';

/** Tiny HTTP GET helper */
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
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
