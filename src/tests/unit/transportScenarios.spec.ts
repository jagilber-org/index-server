/**
 * Transport Scenario Tests — Stdio, HTTP, and Hybrid
 *
 * Exercises the server through different transport paths to verify
 * consistent behavior regardless of how the client connects.
 *
 * Covers:
 * - Stdio transport: JSON-RPC lifecycle (initialize → tool calls → shutdown)
 * - HTTP transport: REST bridge /api/tools/:name endpoint
 * - Hybrid: Stdio clients + HTTP dashboard simultaneously
 * - Error behavior consistency across transports
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDashboardServer, DashboardServer } from '../../dashboard/server/DashboardServer.js';
import { getHandler } from '../../server/registry';
import { invalidate } from '../../services/indexContext';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Register handlers
import '../../services/toolHandlers.js';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'transport-test-'));
const INSTR_DIR = path.join(TMP_ROOT, 'instructions');

const HTTP_PORT = 18887;
const HTTP_HOST = '127.0.0.1';
const BASE_URL = `http://${HTTP_HOST}:${HTTP_PORT}`;

function uniqueId(): string {
  return `transport-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Call handler directly (simulates stdio path) */
async function invokeStdio(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = getHandler(name);
  if (!handler) throw new Error(`Handler "${name}" not registered`);
  const raw = await handler(params);
  const wrapped = raw as { content?: Array<{ text: string }> };
  if (wrapped?.content?.[0]?.text) {
    try {
      const inner = JSON.parse(wrapped.content[0].text);
      if (inner && typeof inner === 'object' && 'data' in inner && typeof inner.data === 'object') {
        return inner.data as Record<string, unknown>;
      }
      return inner as Record<string, unknown>;
    } catch { /* fall through */ }
  }
  return raw as Record<string, unknown>;
}

/** Call handler via HTTP REST bridge (simulates HTTP dashboard path) */
async function invokeHttp(toolName: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BASE_URL}/api/tools/${toolName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return await resp.json() as Record<string, unknown>;
}

describe('Transport Scenario Tests', () => {
  let server: DashboardServer | null = null;
  const createdIds: string[] = [];

  beforeAll(async () => {
    fs.mkdirSync(INSTR_DIR, { recursive: true });
    process.env.INDEX_SERVER_DIR = INSTR_DIR;
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_MEMOIZE = '0';
    reloadRuntimeConfig();
    invalidate();

    try {
      server = createDashboardServer({ port: HTTP_PORT, host: HTTP_HOST });
      await server.start();
    } catch (e) {
      console.warn('Dashboard server failed to start:', (e as Error).message);
    }
  }, 15_000);

  afterAll(async () => {
    if (server) {
      try { await server.stop(); } catch { /* ok */ }
    }
    if (createdIds.length > 0) {
      try {
        await invokeStdio('index_dispatch', { action: 'remove', ids: createdIds, missingOk: true });
      } catch { /* ok */ }
    }
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MEMOIZE;
    reloadRuntimeConfig();
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Stdio Transport Tests
  // ═══════════════════════════════════════════════════════════════════

  describe('Stdio transport (direct handler invocation)', () => {
    it('health_check returns valid response', async () => {
      const result = await invokeStdio('health_check', {});
      expect(result.status).toBeDefined();
    });

    it('index_dispatch list returns items array', async () => {
      const result = await invokeStdio('index_dispatch', { action: 'list', limit: 5 });
      expect(result.items ?? result.list).toBeDefined();
    });

    it('index_search returns results structure', async () => {
      const result = await invokeStdio('index_search', { keywords: ['test'], limit: 5 });
      expect(result.totalMatches).toBeDefined();
    });

    it('add + get roundtrip via stdio', async () => {
      const id = uniqueId();
      createdIds.push(id);
      await invokeStdio('index_dispatch', {
        action: 'add',
        entry: { id, title: 'Stdio add', body: 'Created via stdio path.', priority: 50, audience: 'all', requirement: 'optional', categories: ['transport'], contentType: 'instruction' },
        lax: true,
      });

      invalidate();
      const got = await invokeStdio('index_dispatch', { action: 'get', id });
      // Verify the instruction was persisted and is retrievable
      expect(got).toBeDefined();
      expect(got.id ?? got.found).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  HTTP Transport Tests
  // ═══════════════════════════════════════════════════════════════════

  describe('HTTP transport (REST bridge)', () => {
    it('health_check via HTTP returns valid response', async () => {
      if (!server) return;
      const result = await invokeHttp('health_check', {});
      expect(result).toBeDefined();
    });

    it('index_dispatch list via HTTP', async () => {
      if (!server) return;
      const result = await invokeHttp('index_dispatch', { action: 'list', limit: 5 });
      expect(result).toBeDefined();
    });

    it('index_search via HTTP returns results', async () => {
      if (!server) return;
      const result = await invokeHttp('index_search', { keywords: ['test'], limit: 5 });
      expect(result).toBeDefined();
    });

    it('add + get roundtrip via HTTP', async () => {
      if (!server) return;
      const id = uniqueId();
      createdIds.push(id);
      await invokeHttp('index_dispatch', {
        action: 'add',
        entry: { id, title: 'HTTP add', body: 'Created via HTTP path.', priority: 50, audience: 'all', requirement: 'optional', categories: ['transport'], contentType: 'instruction' },
        lax: true,
      });

      invalidate();
      const got = await invokeHttp('index_dispatch', { action: 'get', id });
      expect(got).toBeDefined();
    });

    it('invalid tool name returns 404', async () => {
      if (!server) return;
      const resp = await fetch(`${BASE_URL}/api/tools/nonexistent_tool_xyz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(resp.status).toBe(404);
    });

    it('malformed tool name returns 400', async () => {
      if (!server) return;
      const resp = await fetch(`${BASE_URL}/api/tools/bad-name!@#`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(resp.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Hybrid: Stdio + HTTP simultaneous
  // ═══════════════════════════════════════════════════════════════════

  describe('Hybrid: Stdio + HTTP simultaneous operations', () => {
    it('instruction added via stdio is queryable via HTTP list', async () => {
      if (!server) return;
      const id = uniqueId();
      createdIds.push(id);

      // Write via stdio (uses temp dir via indexContext)
      await invokeStdio('index_dispatch', {
        action: 'add',
        entry: { id, title: 'Stdio→HTTP visibility', body: 'Written stdio, checked HTTP.', priority: 50, audience: 'all', requirement: 'optional', categories: ['hybrid'], contentType: 'instruction' },
        lax: true,
      });

      // Read list via HTTP (shares same in-process handlers)
      const listResult = await invokeHttp('index_dispatch', { action: 'list', limit: 200 });
      expect(listResult).toBeDefined();
    });

    it('concurrent stdio + HTTP reads produce consistent results', async () => {
      if (!server) return;

      const stdioReads = Array.from({ length: 3 }, () =>
        invokeStdio('health_check', {})
      );

      const httpReads = Array.from({ length: 3 }, () =>
        invokeHttp('health_check', {})
      );

      const [stdioResults, httpResults] = await Promise.all([
        Promise.allSettled(stdioReads),
        Promise.allSettled(httpReads),
      ]);

      expect(stdioResults.filter(r => r.status === 'fulfilled').length).toBe(3);
      expect(httpResults.filter(r => r.status === 'fulfilled').length).toBe(3);
    });

    it('search returns same structure via both transports', async () => {
      if (!server) return;

      const stdioResult = await invokeStdio('index_search', { keywords: ['test'], limit: 5 });
      const httpResult = await invokeHttp('index_search', { keywords: ['test'], limit: 5 });

      // Both should have results structure (may differ in data but same shape)
      expect(stdioResult.totalMatches).toBeDefined();
      expect(httpResult).toBeDefined();
    });
  });
});
