/**
 * GET /api/embeddings/status — banner state machine for the Embeddings tab.
 *
 * State semantics:
 *   - disabled       : INDEX_SERVER_SEMANTIC_ENABLED=0
 *   - missing        : localOnly=true AND model not in cache (compute will fail)
 *   - will-download  : localOnly=false AND model not in cache (compute will fetch)
 *   - no-embeddings  : model ok but no embeddings file / count=0
 *   - ready          : model + embeddings populated
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

function makeApp(semantic: { enabled: boolean; localOnly: boolean; model: string; cacheDir: string; embeddingPath: string; device?: string }): Promise<{
  port: number; close: () => void;
}> {
  vi.resetModules();
  vi.doMock('../../config/runtimeConfig.js', () => ({
    getRuntimeConfig: () => ({
      semantic: { device: 'cpu', ...semantic },
    }),
  }));
  // Dynamic import after mock so the route factory binds to mocked config.
  return import('../../dashboard/server/routes/embeddings.routes.js').then((mod) => {
    const app = express();
    app.use('/api', mod.createEmbeddingsRoutes());
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    return { port, close: () => server.close() };
  });
}

describe('GET /api/embeddings/status', () => {
  let tmpDir: string;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-status-'));
  });
  afterAll(() => {
    vi.doUnmock('../../config/runtimeConfig.js');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns state=disabled when semantic.enabled is false', async () => {
    const { port, close } = await makeApp({
      enabled: false,
      localOnly: false,
      model: 'Xenova/all-MiniLM-L6-v2',
      cacheDir: tmpDir,
      embeddingPath: path.join(tmpDir, 'no-emb.json'),
    });
    try {
      const res = await httpGet(`http://localhost:${port}/api/embeddings/status`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.success).toBe(true);
      expect(json.enabled).toBe(false);
      expect(json.state).toBe('disabled');
    } finally { close(); }
  });

  it('returns state=missing when localOnly and model not cached', async () => {
    const cacheDir = path.join(tmpDir, 'no-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const { port, close } = await makeApp({
      enabled: true,
      localOnly: true,
      model: 'Xenova/all-MiniLM-L6-v2',
      cacheDir,
      embeddingPath: path.join(tmpDir, 'no-emb.json'),
    });
    try {
      const res = await httpGet(`http://localhost:${port}/api/embeddings/status`);
      expect(res.status).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.state).toBe('missing');
      expect(json.modelCached).toBe(false);
      expect(json.message).toContain('LOCAL_ONLY');
    } finally { close(); }
  });

  it('returns state=will-download when !localOnly and model not cached', async () => {
    const cacheDir = path.join(tmpDir, 'will-dl');
    fs.mkdirSync(cacheDir, { recursive: true });
    const { port, close } = await makeApp({
      enabled: true,
      localOnly: false,
      model: 'Xenova/all-MiniLM-L6-v2',
      cacheDir,
      embeddingPath: path.join(tmpDir, 'no-emb.json'),
    });
    try {
      const res = await httpGet(`http://localhost:${port}/api/embeddings/status`);
      const json = JSON.parse(res.body);
      expect(json.state).toBe('will-download');
      expect(json.modelCached).toBe(false);
    } finally { close(); }
  });

  it('returns state=no-embeddings when model cached but embeddings file missing', async () => {
    const cacheDir = path.join(tmpDir, 'cached');
    fs.mkdirSync(path.join(cacheDir, 'models--Xenova--all-MiniLM-L6-v2'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'models--Xenova--all-MiniLM-L6-v2', 'config.json'), '{}');
    const { port, close } = await makeApp({
      enabled: true,
      localOnly: true,
      model: 'Xenova/all-MiniLM-L6-v2',
      cacheDir,
      embeddingPath: path.join(tmpDir, 'still-missing.json'),
    });
    try {
      const res = await httpGet(`http://localhost:${port}/api/embeddings/status`);
      const json = JSON.parse(res.body);
      expect(json.state).toBe('no-embeddings');
      expect(json.modelCached).toBe(true);
      expect(json.embeddingsFileExists).toBe(false);
    } finally { close(); }
  });

  it('returns state=ready when model cached and embeddings populated', async () => {
    const cacheDir = path.join(tmpDir, 'ready');
    fs.mkdirSync(path.join(cacheDir, 'models--Xenova--all-MiniLM-L6-v2'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'models--Xenova--all-MiniLM-L6-v2', 'config.json'), '{}');
    const embPath = path.join(tmpDir, 'ready-emb.json');
    fs.writeFileSync(embPath, JSON.stringify({
      indexHash: 'h',
      modelName: 'Xenova/all-MiniLM-L6-v2',
      embeddings: { 'instr-1': [0.1, 0.2], 'instr-2': [0.3, 0.4] },
    }));
    const { port, close } = await makeApp({
      enabled: true,
      localOnly: true,
      model: 'Xenova/all-MiniLM-L6-v2',
      cacheDir,
      embeddingPath: embPath,
    });
    try {
      const res = await httpGet(`http://localhost:${port}/api/embeddings/status`);
      const json = JSON.parse(res.body);
      expect(json.state).toBe('ready');
      expect(json.ready).toBe(true);
      expect(json.embeddingsCount).toBe(2);
    } finally { close(); }
  });
});
