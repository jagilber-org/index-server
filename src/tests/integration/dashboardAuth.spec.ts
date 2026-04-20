/**
 * Integration tests for dashboardAdminAuth middleware (GitHub Issue #42).
 *
 * Mounts the real middleware on a minimal Express app and validates auth
 * behavior across protected and unprotected routes over HTTP.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express, { Request, Response } from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { dashboardAdminAuth } from '../../dashboard/server/routes/adminAuth.js';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal HTTP client that returns status + parsed JSON body. */
async function request(
  base: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(path, base);
  const opts: http.RequestOptions = {
    method,
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    headers: { 'Content-Type': 'application/json', ...headers },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// App factory — builds a throwaway Express app using the real middleware
// ---------------------------------------------------------------------------

function buildTestApp(): express.Express {
  const app = express();
  app.set('trust proxy', true); // honour X-Forwarded-For
  app.use(express.json());

  // Unprotected read routes
  app.get('/api/instructions', (_req: Request, res: Response) => {
    res.json({ items: [] });
  });
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Protected mutation routes
  app.post('/api/instructions', dashboardAdminAuth, (req: Request, res: Response) => {
    res.json({ created: true, body: req.body });
  });
  app.put('/api/instructions/:id', dashboardAdminAuth, (req: Request, res: Response) => {
    res.json({ updated: true, id: req.params.id });
  });
  app.delete('/api/instructions/:id', dashboardAdminAuth, (_req: Request, res: Response) => {
    res.json({ deleted: true });
  });

  // Other protected routes
  app.post('/sqlite/query', dashboardAdminAuth, (req: Request, res: Response) => {
    res.json({ rows: [], sql: req.body?.sql });
  });
  app.post('/api/tools/:name', dashboardAdminAuth, (req: Request, res: Response) => {
    res.json({ tool: req.params.name });
  });
  app.post('/api/knowledge', dashboardAdminAuth, (req: Request, res: Response) => {
    res.json({ stored: true });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Dashboard auth integration (with INDEX_SERVER_ADMIN_API_KEY)', () => {
  const ADMIN_KEY = 'integration-test-secret-key-42';
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    process.env.INDEX_SERVER_ADMIN_API_KEY = ADMIN_KEY;
    process.env.INDEX_SERVER_DISABLE_RATE_LIMIT = '1';
    reloadRuntimeConfig();

    const app = buildTestApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    delete process.env.INDEX_SERVER_ADMIN_API_KEY;
    delete process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
    reloadRuntimeConfig();
  });

  // -- Unprotected GET routes remain accessible ----------------------------

  it('GET /api/instructions returns 200 without auth', async () => {
    const res = await request(base, 'GET', '/api/instructions');
    expect(res.status).toBe(200);
  });

  it('GET /api/status returns 200 without auth', async () => {
    const res = await request(base, 'GET', '/api/status');
    expect(res.status).toBe(200);
  });

  // -- Protected mutation routes require valid Bearer token ----------------

  describe.each([
    ['POST', '/api/instructions', { id: 'test', body: 'x' }],
    ['PUT', '/api/instructions/test-id', { body: 'x' }],
    ['DELETE', '/api/instructions/test-id', undefined],
    ['POST', '/sqlite/query', { sql: 'SELECT 1' }],
    ['POST', '/api/tools/echo', { msg: 'hi' }],
    ['POST', '/api/knowledge', { key: 'k', content: 'v' }],
  ])('%s %s', (method, path, body) => {
    it('returns 401 without Authorization header', async () => {
      const res = await request(base, method, path, {}, body);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(expect.objectContaining({ error: expect.stringContaining('Admin API key required') }));
    });

    it('returns 401 with wrong Bearer token', async () => {
      const res = await request(base, method, path, {
        Authorization: 'Bearer wrong-key-value',
      }, body);
      expect(res.status).toBe(401);
    });

    it('returns 200 with valid Bearer token', async () => {
      const res = await request(base, method, path, {
        Authorization: `Bearer ${ADMIN_KEY}`,
      }, body);
      expect(res.status).toBe(200);
    });

    it('returns 200 with case-insensitive Bearer prefix', async () => {
      const res = await request(base, method, path, {
        Authorization: `bearer ${ADMIN_KEY}`,
      }, body);
      expect(res.status).toBe(200);
    });
  });
});

describe('Dashboard auth integration (without INDEX_SERVER_ADMIN_API_KEY — localhost fallback)', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    // Ensure no admin key is set so middleware falls through to loopback check
    delete process.env.INDEX_SERVER_ADMIN_API_KEY;
    process.env.INDEX_SERVER_DISABLE_RATE_LIMIT = '1';
    reloadRuntimeConfig();

    const app = buildTestApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    delete process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
    reloadRuntimeConfig();
  });

  it('allows mutation routes from localhost without auth', async () => {
    const res = await request(base, 'POST', '/api/instructions', {}, { id: 'test', body: 'x' });
    expect(res.status).toBe(200);
  });

  it('allows DELETE from localhost without auth', async () => {
    const res = await request(base, 'DELETE', '/api/instructions/test-id');
    expect(res.status).toBe(200);
  });

  it('allows POST /sqlite/query from localhost without auth', async () => {
    const res = await request(base, 'POST', '/sqlite/query', {}, { sql: 'SELECT 1' });
    expect(res.status).toBe(200);
  });

  it('allows POST /api/tools/:name from localhost without auth', async () => {
    const res = await request(base, 'POST', '/api/tools/echo', {}, {});
    expect(res.status).toBe(200);
  });

  it('allows POST /api/knowledge from localhost without auth', async () => {
    const res = await request(base, 'POST', '/api/knowledge', {}, { key: 'k', content: 'v' });
    expect(res.status).toBe(200);
  });

  it('returns 403 for non-localhost origin (X-Forwarded-For)', async () => {
    const res = await request(base, 'POST', '/api/instructions', {
      'X-Forwarded-For': '10.0.0.5',
    }, { id: 'test', body: 'x' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual(expect.objectContaining({ error: expect.stringContaining('localhost') }));
  });

  it('returns 403 for non-localhost DELETE (X-Forwarded-For)', async () => {
    const res = await request(base, 'DELETE', '/api/instructions/test-id', {
      'X-Forwarded-For': '192.168.1.100',
    });
    expect(res.status).toBe(403);
  });
});
