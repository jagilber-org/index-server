import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'node:http';
import path from 'path';
import { reloadRuntimeConfig } from '../config/runtimeConfig.js';
import { createSyntheticRoutes } from '../dashboard/server/routes/synthetic.routes.js';

function httpPost(url: string, body: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: data,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

describe('Dashboard synthetic activity security', () => {
  let server: http.Server;
  let port: number;
  const originalAdminKey = process.env.INDEX_SERVER_ADMIN_API_KEY;

  beforeAll(async () => {
    process.env.INDEX_SERVER_ADMIN_API_KEY = 'test-admin-key';
    reloadRuntimeConfig();

    const app = express();
    app.use(express.json());
    app.use('/api', createSyntheticRoutes({} as any));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    if (originalAdminKey === undefined) {
      delete process.env.INDEX_SERVER_ADMIN_API_KEY;
    } else {
      process.env.INDEX_SERVER_ADMIN_API_KEY = originalAdminKey;
    }
    reloadRuntimeConfig();
    server?.close();
  });

  it('requires Authorization when an admin API key is configured', async () => {
    const response = await httpPost(
      `http://127.0.0.1:${port}/api/admin/synthetic/activity`,
      JSON.stringify({ iterations: 1, concurrency: 1 }),
    );

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body).error).toContain('Admin API key required');
  });

  it('keeps synthetic trace controls out of query-string handling', () => {
    const routeSource = fs.readFileSync(path.join(process.cwd(), 'src', 'dashboard', 'server', 'routes', 'synthetic.routes.ts'), 'utf8');
    const clientSource = fs.readFileSync(path.join(process.cwd(), 'src', 'dashboard', 'client', 'js', 'admin.monitor.js'), 'utf8');

    expect(routeSource).not.toContain('req.query.debug');
    expect(routeSource).not.toContain('req.query.trace');
    expect(routeSource).not.toContain('req.query.stream');
    expect(clientSource).not.toContain('/api/admin/synthetic/activity?debug=1');
    expect(clientSource).toContain("body: JSON.stringify({ iterations: iter, concurrency: conc, debug: wantTrace, trace: wantTrace, stream: wantTrace })");
  });
});