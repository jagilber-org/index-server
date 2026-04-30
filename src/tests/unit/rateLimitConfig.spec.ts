/**
 * Rate Limit runtime-config Tests — Issue #270
 *
 * Validates the simplified single-knob rate-limit model:
 *   - INDEX_SERVER_RATE_LIMIT — requests per minute (0 disables, default 0)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';

function httpReq(method: string, url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method },
      (res) => {
        res.on('data', () => { /* drain */ });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

describe('Rate limit runtime-config (issue #270)', () => {
  let server: http.Server;
  let port: number;
  const origRateLimit = process.env.INDEX_SERVER_RATE_LIMIT;

  beforeAll(async () => {
    process.env.INDEX_SERVER_RATE_LIMIT = '3';
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
    const { createApiRoutes } = await import('../../dashboard/server/ApiRoutes.js');
    const app = express();
    app.use('/api', createApiRoutes({ enableCors: false }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    server?.close();
    if (origRateLimit === undefined) delete process.env.INDEX_SERVER_RATE_LIMIT;
    else process.env.INDEX_SERVER_RATE_LIMIT = origRateLimit;
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
  });

  it('global cap (INDEX_SERVER_RATE_LIMIT=3) is honored', async () => {
    const url = `http://127.0.0.1:${port}/api/status`;
    const r1 = await httpReq('GET', url);
    const r2 = await httpReq('GET', url);
    const r3 = await httpReq('GET', url);
    const r4 = await httpReq('GET', url);
    expect(r1.status).not.toBe(429);
    expect(r2.status).not.toBe(429);
    expect(r3.status).not.toBe(429);
    expect(r4.status).toBe(429);
    expect(r1.headers['x-ratelimit-limit']).toBe('3');
  });

  it('runtimeConfig exposes the parsed per-minute value', async () => {
    const { getRuntimeConfig } = await import('../../config/runtimeConfig.js');
    const cfg = getRuntimeConfig();
    expect(cfg.dashboard.http.rateLimitPerMinute).toBe(3);
  });
});
