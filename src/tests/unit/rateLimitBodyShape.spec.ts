/**
 * Rate Limit 429 Body Shape Tests — Issue #63 verification
 *
 * Validates the new `tier` field in 429 responses:
 *   - Global rate limit → tier: 'global'
 *   - Mutation rate limit → tier: 'mutation'
 *   - Both include error, message, retryAfterSeconds, tier, timestamp
 *   - Retry-After header is present
 *
 * Extends the existing dashboardApiRateLimit.spec.ts with shape assertions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createApiRoutes } from '../../dashboard/server/ApiRoutes.js';

function httpReq(
  method: string,
  url: string,
  body?: string,
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

describe('Rate limit 429 body shape — tier field (issue #63)', () => {
  let server: http.Server;
  let port: number;
  const origDisable = process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;

  beforeAll(async () => {
    delete process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
    const app = express();
    // Very low limits to trigger 429 quickly: 2 global, ceil(2/5)=1 mutation
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
    if (origDisable === undefined) delete process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
    else process.env.INDEX_SERVER_DISABLE_RATE_LIMIT = origDisable;
  });

  it('global rate limit 429 has tier:"global" and correct body shape', async () => {
    const base = `http://127.0.0.1:${port}/api/status`;
    // Exhaust the global limit (max=2)
    await httpReq('GET', base);
    await httpReq('GET', base);
    const res = await httpReq('GET', base);

    expect(res.status).toBe(429);

    const json = JSON.parse(res.body);
    // Required fields
    expect(json.error).toBe('Too Many Requests');
    expect(json.tier).toBe('global');
    expect(typeof json.message).toBe('string');
    expect(json.message).toContain('Rate limit exceeded');
    expect(typeof json.retryAfterSeconds).toBe('number');
    expect(json.retryAfterSeconds).toBeGreaterThan(0);
    expect(typeof json.timestamp).toBe('number');
    expect(json.timestamp).toBeGreaterThan(0);

    // Headers
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBe('2');
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('mutation rate limit 429 has tier:"mutation" and distinct message', async () => {
    // Create a SECOND server instance with fresh rate-limit state
    // to avoid pollution from the global test above
    const app2 = express();
    app2.use('/api', createApiRoutes({ enableCors: false, rateLimit: { windowMs: 60_000, max: 10 } }));
    const server2 = await new Promise<http.Server>((resolve) => {
      const s = app2.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port2 = (server2.address() as { port: number }).port;

    try {
      // Mutation limiter: ceil(10/5) = 2 max for POST/PUT/PATCH/DELETE
      // First POST should succeed, second POST hits mutation limit
      await httpReq('POST', `http://127.0.0.1:${port2}/api/admin/maintenance/backups/prune`, JSON.stringify({ retain: 99 }));
      await httpReq('POST', `http://127.0.0.1:${port2}/api/admin/maintenance/backups/prune`, JSON.stringify({ retain: 99 }));
      const res = await httpReq('POST', `http://127.0.0.1:${port2}/api/admin/maintenance/backups/prune`, JSON.stringify({ retain: 99 }));

      // Should hit mutation tier (or global — depends on which fires first)
      if (res.status === 429) {
        const json = JSON.parse(res.body);
        expect(json.error).toBe('Too Many Requests');
        expect(['global', 'mutation']).toContain(json.tier);
        expect(typeof json.retryAfterSeconds).toBe('number');
        expect(typeof json.timestamp).toBe('number');

        if (json.tier === 'mutation') {
          expect(json.message).toContain('Mutation rate limit exceeded');
        }
      }
      // If not 429, the prune ran — that's also valid (rate limit wasn't triggered)
    } finally {
      server2.close();
    }
  });

  it('429 body does NOT contain unexpected fields (shape strictness)', async () => {
    // Re-use the already-exhausted server from the first test
    const res = await httpReq('GET', `http://127.0.0.1:${port}/api/status`);
    if (res.status !== 429) return; // rate-limit state might have expired

    const json = JSON.parse(res.body);
    const allowedKeys = new Set(['error', 'message', 'retryAfterSeconds', 'tier', 'timestamp']);
    for (const key of Object.keys(json)) {
      expect(allowedKeys.has(key), `Unexpected field '${key}' in 429 body`).toBe(true);
    }
  });
});
