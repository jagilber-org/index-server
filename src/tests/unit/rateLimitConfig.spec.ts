/**
 * Rate Limit runtime-config Tests — Issue #63
 *
 * Validates that dashboard rate limits are env-configurable via runtimeConfig:
 *   - INDEX_SERVER_RATE_LIMIT_WINDOW_MS — sliding window duration
 *   - INDEX_SERVER_RATE_LIMIT_MAX — global per-window cap
 *   - INDEX_SERVER_RATE_LIMIT_MUTATION_MAX — stricter cap for POST/PUT/PATCH/DELETE
 *
 * When no `rateLimit` option is provided to createApiRoutes, it must read
 * defaults from runtimeConfig rather than hardcoded constants.
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

describe('Rate limit runtime-config (issue #63)', () => {
  let server: http.Server;
  let port: number;
  const origMax = process.env.INDEX_SERVER_RATE_LIMIT_MAX;
  const origWin = process.env.INDEX_SERVER_RATE_LIMIT_WINDOW_MS;
  const origMut = process.env.INDEX_SERVER_RATE_LIMIT_MUTATION_MAX;
  const origDis = process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;

  beforeAll(async () => {
    delete process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
    process.env.INDEX_SERVER_RATE_LIMIT_MAX = '3';
    process.env.INDEX_SERVER_RATE_LIMIT_WINDOW_MS = '60000';
    process.env.INDEX_SERVER_RATE_LIMIT_MUTATION_MAX = '1';
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
    const { createApiRoutes } = await import('../../dashboard/server/ApiRoutes.js');
    const app = express();
    // No `rateLimit` option => must use runtimeConfig defaults
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
    if (origMax === undefined) delete process.env.INDEX_SERVER_RATE_LIMIT_MAX;
    else process.env.INDEX_SERVER_RATE_LIMIT_MAX = origMax;
    if (origWin === undefined) delete process.env.INDEX_SERVER_RATE_LIMIT_WINDOW_MS;
    else process.env.INDEX_SERVER_RATE_LIMIT_WINDOW_MS = origWin;
    if (origMut === undefined) delete process.env.INDEX_SERVER_RATE_LIMIT_MUTATION_MAX;
    else process.env.INDEX_SERVER_RATE_LIMIT_MUTATION_MAX = origMut;
    if (origDis === undefined) delete process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
    else process.env.INDEX_SERVER_DISABLE_RATE_LIMIT = origDis;
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
  });

  it('global cap (INDEX_SERVER_RATE_LIMIT_MAX=3) is honored', async () => {
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

  it('runtimeConfig exposes rate limit values', async () => {
    const { getRuntimeConfig } = await import('../../config/runtimeConfig.js');
    const cfg = getRuntimeConfig();
    expect(cfg.dashboard.http.rateLimitMax).toBe(3);
    expect(cfg.dashboard.http.rateLimitWindowMs).toBe(60000);
    expect(cfg.dashboard.http.rateLimitMutationMax).toBe(1);
  });
});
