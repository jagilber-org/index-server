import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createApiRoutes } from '../dashboard/server/ApiRoutes.js';

function httpGet(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body,
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
  });
}

describe('Dashboard API rate limiting', () => {
  let server: http.Server;
  let port: number;
  const origEnv = process.env.INDEX_SERVER_RATE_LIMIT_ENABLED;

  beforeAll(async () => {
    process.env.INDEX_SERVER_RATE_LIMIT_ENABLED = '1';
    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    reloadRuntimeConfig();
    const app = express();
    app.use('/api', createApiRoutes({ enableCors: false, rateLimit: { windowMs: 60_000, max: 2 } }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
    if (origEnv === undefined) delete process.env.INDEX_SERVER_RATE_LIMIT_ENABLED;
    else process.env.INDEX_SERVER_RATE_LIMIT_ENABLED = origEnv;
  });

  it('returns 429 after the configured per-IP request budget is exhausted', async () => {
    const first = await httpGet(`http://127.0.0.1:${port}/api/status`);
    const second = await httpGet(`http://127.0.0.1:${port}/api/status`);
    const third = await httpGet(`http://127.0.0.1:${port}/api/status`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);

    const json = JSON.parse(third.body);
    expect(json.error).toBe('Too Many Requests');
    expect(Number(json.retryAfterSeconds)).toBeGreaterThan(0);
    expect(third.headers['retry-after']).toBeDefined();
    expect(third.headers['x-ratelimit-limit']).toBe('2');
    expect(third.headers['x-ratelimit-remaining']).toBe('0');
  });
});
