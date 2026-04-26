import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createInstructionsRoutes } from '../dashboard/server/routes/instructions.routes';
import { ensureLoadedMiddleware } from '../dashboard/server/middleware/ensureLoadedMiddleware';
import { invalidate } from '../services/indexContext';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

function httpJson(
  method: 'POST' | 'PUT',
  url: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.write(data);
    req.end();
  });
}

function writeInstruction(dir: string, entry: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2));
}

function sourceHashFor(label: string): string {
  return crypto.createHash('sha256').update(label, 'utf8').digest('hex');
}

describe('instructions search route', () => {
  const previousDir = process.env.INDEX_SERVER_DIR;
  let tmpDir = '';
  let server: http.Server | undefined;
  let port = 0;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instructions-search-route-'));
    process.env.INDEX_SERVER_DIR = tmpDir;
    reloadRuntimeConfig();
    invalidate();

    writeInstruction(tmpDir, {
      id: 'service-mesh-runbook',
      title: 'Mesh Traffic Guide',
      body: 'Traffic policy guidance for proxies and ingress controllers.',
      semanticSummary: 'Platform traffic operations handbook',
      priority: 10,
      audience: 'all',
      requirement: 'recommended',
      categories: ['networking', 'platform'],
      contentType: 'instruction',
      sourceHash: sourceHashFor('service-mesh-runbook'),
      schemaVersion: '1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });

    writeInstruction(tmpDir, {
      id: 'opaque-cert-guide',
      title: 'Opaque Guide',
      body: 'Proxy rollout safety checks.',
      semanticSummary: 'Cluster certificate rotation playbook',
      priority: 10,
      audience: 'all',
      requirement: 'recommended',
      categories: ['certificates', 'operations'],
      contentType: 'instruction',
      sourceHash: sourceHashFor('opaque-cert-guide'),
      schemaVersion: '1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    });

    const app = express();
    app.use(express.json());
    app.use(ensureLoadedMiddleware);
    app.use('/api', createInstructionsRoutes());
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        port = (server!.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    invalidate();
    reloadRuntimeConfig();
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server = undefined;
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (previousDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = previousDir;
    reloadRuntimeConfig();
  });

  it('finds normalized id queries through the dashboard search route', async () => {
    const res = await httpGet(`http://127.0.0.1:${port}/api/instructions_search?q=service%20mesh%20runbook&limit=5`);
    const json = JSON.parse(res.body) as { success: boolean; count: number; results: Array<{ name: string }> };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.count).toBeGreaterThan(0);
    expect(json.results.some((item) => item.name === 'service-mesh-runbook')).toBe(true);
  });

  it('finds semanticSummary content through the dashboard search route', async () => {
    const res = await httpGet(`http://127.0.0.1:${port}/api/instructions_search?q=certificate%20rotation&limit=5`);
    const json = JSON.parse(res.body) as { success: boolean; count: number; results: Array<{ name: string }> };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.count).toBeGreaterThan(0);
    expect(json.results[0]?.name).toBe('opaque-cert-guide');
  });

  it('returns verified from the computed read-back result for dashboard instruction create and update routes', async () => {
    const createRes = await httpJson('POST', `http://127.0.0.1:${port}/api/instructions`, {
      name: 'dashboard-route-verified',
      content: {
        title: 'Dashboard Route Verified',
        body: 'Route verification response should reflect read-back state.',
        categories: ['dashboard']
      }
    });
    const created = JSON.parse(createRes.body) as { success: boolean; name: string; verified: boolean };

    expect(createRes.status).toBe(200);
    expect(created).toMatchObject({
      success: true,
      name: 'dashboard-route-verified',
      verified: true
    });

    const updateRes = await httpJson('PUT', `http://127.0.0.1:${port}/api/instructions/dashboard-route-verified`, {
      content: {
        body: 'Updated dashboard route body'
      }
    });
    const updated = JSON.parse(updateRes.body) as { success: boolean; verified: boolean };

    expect(updateRes.status).toBe(200);
    expect(updated).toMatchObject({
      success: true,
      verified: true
    });
  });

  it('uses computed verified variables in dashboard instruction route success responses', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'dashboard', 'server', 'routes', 'instructions.routes.ts'), 'utf8');

    expect(src).toContain('const verified = reloaded.byId.has(id);');
    expect(src).toContain("res.json({ success: true, message: 'Instruction created', name: id, verified, timestamp: Date.now() });");
    expect(src).toContain("res.json({ success: true, message: 'Instruction updated', verified, timestamp: Date.now() });");
    expect(src).not.toContain("message: 'Instruction created', name: id, verified: true");
    expect(src).not.toContain("message: 'Instruction updated', verified: true");
  });
});
