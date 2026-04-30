/**
 * Rate Limit 429 Body Shape Tests — Issue #270
 *
 * Single-tier model: no `tier` field. Body must contain
 *   { error, message, retryAfterSeconds, timestamp }
 * Bulk-prefixed routes are exempt regardless of cap.
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

describe('Rate limit 429 body shape (issue #270)', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.use('/api', createApiRoutes({ enableCors: false, rateLimitPerMinute: 2 }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
  });

  it('429 body has expected shape (single tier, no `tier` field)', async () => {
    const base = `http://127.0.0.1:${port}/api/status`;
    await httpReq('GET', base);
    await httpReq('GET', base);
    const res = await httpReq('GET', base);

    expect(res.status).toBe(429);

    const json = JSON.parse(res.body);
    expect(json.error).toBe('Too Many Requests');
    expect(typeof json.message).toBe('string');
    expect(json.message).toContain('Rate limit exceeded');
    expect(typeof json.retryAfterSeconds).toBe('number');
    expect(json.retryAfterSeconds).toBeGreaterThan(0);
    expect(typeof json.timestamp).toBe('number');
    expect(json.timestamp).toBeGreaterThan(0);

    expect(json).not.toHaveProperty('tier');

    expect(res.headers['retry-after']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBe('2');
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('429 body does NOT contain unexpected fields', async () => {
    const res = await httpReq('GET', `http://127.0.0.1:${port}/api/status`);
    if (res.status !== 429) return;

    const json = JSON.parse(res.body);
    const allowedKeys = new Set(['error', 'message', 'retryAfterSeconds', 'timestamp']);
    for (const key of Object.keys(json)) {
      expect(allowedKeys.has(key), `Unexpected field '${key}' in 429 body`).toBe(true);
    }
  });

  it('bulk-prefixed routes are exempt from rate limiting', async () => {
    const app2 = express();
    app2.use('/api', createApiRoutes({ enableCors: false, rateLimitPerMinute: 1 }));
    const server2 = await new Promise<http.Server>((resolve) => {
      const s = app2.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port2 = (server2.address() as { port: number }).port;
    try {
      const url = `http://127.0.0.1:${port2}/api/admin/maintenance/backups`;
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => httpReq('GET', url)));
      for (const r of results) {
        expect(r.status).not.toBe(429);
      }
    } finally {
      server2.close();
    }
  });
});
