/**
 * Messaging 404 catch-all test (#522).
 *
 * Mounts the REAL createApiRoutes() router on a real express app and issues
 * real requests. This matters: an earlier version of this spec re-implemented
 * the handler inline, so it passed while the actual route registration threw
 * `TypeError: Missing parameter name at index 12: /messaging/*` under
 * Express 5 / path-to-regexp v8. A test that never imports the module under
 * test cannot fail for the reason it exists.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createApiRoutes } from '../../../dashboard/server/ApiRoutes.js';

function request(
  url: string,
  method = 'GET',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

describe('messaging 404 catch-all (#522)', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    // High cap so the rate limiter never colours these assertions.
    app.use('/api', createApiRoutes({ enableCors: false, rateLimitPerMinute: 1000 }));
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

  const base = () => `http://127.0.0.1:${port}`;

  it('registers the router without throwing (Express 5 wildcard syntax)', async () => {
    // If createApiRoutes() threw at construction, beforeAll would have failed
    // and this control request could not succeed.
    const res = await request(`${base()}/api/status`);
    expect(res.status).toBe(200);
  });

  it.each([
    ['/api/messaging', 'GET'],
    ['/api/messaging/', 'GET'],
    ['/api/messaging/send', 'GET'],
    ['/api/messaging/channels/foo/bar', 'GET'],
    ['/api/messaging/send', 'POST'],
  ])('returns 404 with a hint for %s (%s)', async (path, method) => {
    const res = await request(`${base()}${path}`, method);
    expect(res.status).toBe(404);
    const json = JSON.parse(res.body);
    expect(json.error).toBe('Not found');
    expect(json.hint).toContain('/api/messages/*');
    expect(json.hint).toContain('/api/messaging/*');
  });

  it('does not swallow unrelated paths', async () => {
    const res = await request(`${base()}/api/status`);
    expect(res.status).toBe(200);
    expect(res.body).not.toContain('Messaging routes live under');
  });
});
