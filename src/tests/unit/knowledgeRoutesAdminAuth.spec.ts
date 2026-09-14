/**
 * Issue #590 — `POST /api/knowledge` is behind `dashboardAdminAuth`, and
 * nothing asserted it.
 *
 * `src/dashboard/server/routes/knowledge.routes.ts:18` registers the route with
 * `dashboardAdminAuth`; `src/dashboard/server/routes/adminAuth.ts:21-42` fails
 * closed (loopback passes with no key, 403 otherwise, Bearer required once
 * `INDEX_SERVER_ADMIN_API_KEY` is set). `docs/knowledge_api_spec.md` documented
 * the route with NO auth middleware and never mentioned authentication, and
 * `src/tests/knowledgeStore.spec.ts` asserts nothing about 401/403/Authorization
 * — so the omission was invisible from inside this repo.
 *
 * It was not invisible downstream: agent-manager's `IndexClient` was written
 * against that text, posts with no header, swallows the response as "endpoint
 * not yet added", and has never delivered an insight
 * (jagilber-dev/agent-manager#157).
 *
 * TRAP CONDITIONS — each produces a FALSE GREEN:
 *
 *  T1 Asserting the status code alone. A 401 from a route that also does
 *     nothing on success proves little. Every case here additionally asserts
 *     the store contents: refusals must leave the key ABSENT, successes must
 *     leave it PRESENT.
 *  T2 Testing `dashboardAdminAuth` directly instead of through the route. The
 *     falsification bar is "fails if the middleware is removed from :18", and
 *     a direct middleware test passes happily with the route unwired.
 *  T3 Only testing refusals. A middleware that refused everything would pass.
 *     Cases 1, 4 and 6 are green-both-sides guards.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createKnowledgeRoutes } from '../../dashboard/server/routes/knowledge.routes.js';
import { getKnowledgeStore, resetKnowledgeStore } from '../../dashboard/server/KnowledgeStore.js';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';

const KEY = 'issue590-admin-key'; // pragma: allowlist secret

let dataDir: string;
let prevIndexDir: string | undefined;
let prevAdminKey: string | undefined;

/** Loopback app — req.ip is the real socket address (127.0.0.1). */
let loopbackServer: http.Server;
let loopbackUrl: string;

/**
 * Proxy-trusting app — `trust proxy` makes express take req.ip from
 * X-Forwarded-For, which is the only portable way to present a NON-loopback
 * caller to a server that must bind to loopback in a test. Production apps do
 * not set this, so a real remote caller is identified by its socket address;
 * the middleware reads `req.ip || req.socket.remoteAddress` either way.
 */
let remoteServer: http.Server;
let remoteUrl: string;

function listen(app: express.Express): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const url = addr && typeof addr !== 'string' ? `http://127.0.0.1:${addr.port}` : '';
      resolve({ server, url });
    });
  });
}

async function postKnowledge(url: string, key: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${url}/api/knowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ key, content: 'insight body', metadata: { category: 'agent-performance' } }),
  });
  return { status: res.status, body: await res.json() as { success?: boolean; error?: string } };
}

function setAdminKey(value: string | undefined) {
  if (value === undefined) delete process.env.INDEX_SERVER_ADMIN_API_KEY;
  else process.env.INDEX_SERVER_ADMIN_API_KEY = value;
  reloadRuntimeConfig();
}

describe('issue #590: POST /api/knowledge enforces admin auth', () => {
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-auth-'));
    prevIndexDir = process.env.INDEX_SERVER_DIR;
    prevAdminKey = process.env.INDEX_SERVER_ADMIN_API_KEY;
    // Point the singleton store at a temp dir so the suite cannot write into a
    // real catalog, and drop any store built from earlier config.
    process.env.INDEX_SERVER_DIR = dataDir;
    setAdminKey(undefined);
    resetKnowledgeStore();

    const loopbackApp = express();
    loopbackApp.use(express.json());
    loopbackApp.use('/api', createKnowledgeRoutes());
    ({ server: loopbackServer, url: loopbackUrl } = await listen(loopbackApp));

    const remoteApp = express();
    remoteApp.set('trust proxy', true);
    remoteApp.use(express.json());
    remoteApp.use('/api', createKnowledgeRoutes());
    ({ server: remoteServer, url: remoteUrl } = await listen(remoteApp));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => loopbackServer.close(() => resolve()));
    await new Promise<void>((resolve) => remoteServer.close(() => resolve()));
    if (prevIndexDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = prevIndexDir;
    setAdminKey(prevAdminKey);
    resetKnowledgeStore();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  beforeEach(() => {
    setAdminKey(undefined);
  });

  // ── 1. normal — GUARD (green both sides) ────────────────────────────────
  it('accepts a loopback POST when no admin key is configured', async () => {
    const key = 'issue590:loopback-no-key';
    const { status, body } = await postKnowledge(loopbackUrl, key);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // T1: the write really happened.
    expect(getKnowledgeStore().get(key)?.content).toBe('insight body');
  });

  // ── 2. error — RED: key configured, no header ───────────────────────────
  it('returns 401 and stores nothing when the admin key is configured and no header is sent', async () => {
    const key = 'issue590:no-header';
    setAdminKey(KEY);
    const { status, body } = await postKnowledge(loopbackUrl, key);
    expect(status).toBe(401);
    expect(body.error).toMatch(/Admin API key required/);
    expect(getKnowledgeStore().get(key)).toBeUndefined();
  });

  // ── 3. error — RED: wrong key ───────────────────────────────────────────
  it('returns 401 and stores nothing for a wrong key', async () => {
    const key = 'issue590:wrong-key';
    setAdminKey(KEY);
    const { status } = await postKnowledge(loopbackUrl, key, { Authorization: 'Bearer not-the-key' }); // pragma: allowlist secret
    expect(status).toBe(401);
    expect(getKnowledgeStore().get(key)).toBeUndefined();
  });

  // ── 4. normal — GUARD: the correct key gets through ─────────────────────
  it('accepts the correct Bearer key', async () => {
    const key = 'issue590:right-key';
    setAdminKey(KEY);
    const { status, body } = await postKnowledge(loopbackUrl, key, { Authorization: `Bearer ${KEY}` });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(getKnowledgeStore().get(key)?.content).toBe('insight body');
  });

  // ── 5. error — RED: non-loopback caller, no key configured ──────────────
  it('returns 403 and stores nothing for a non-loopback caller when no key is configured', async () => {
    const key = 'issue590:remote-no-key';
    const { status, body } = await postKnowledge(remoteUrl, key, { 'X-Forwarded-For': '203.0.113.9' }); // pii-allowlist: RFC 5737 TEST-NET-3
    expect(status).toBe(403);
    expect(body.error).toMatch(/localhost/i);
    expect(getKnowledgeStore().get(key)).toBeUndefined();
  });

  // ── 6. boundary — GUARD: read routes stay open ──────────────────────────
  // Encodes the documented policy (docs/dashboard.md: mutation routes require
  // admin auth when a key is set, read-only routes remain open). If that policy
  // is ever changed, change it here deliberately rather than by accident.
  it('leaves GET /api/knowledge/search unauthenticated even with a key configured', async () => {
    setAdminKey(KEY);
    const res = await fetch(`${loopbackUrl}/api/knowledge/search?q=insight`);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
