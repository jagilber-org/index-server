/**
 * HttpTransport Tests - TDD
 *
 * Tests for the HTTP/JSON-RPC transport layer:
 * - Health endpoint
 * - Leader info endpoint
 * - JSON-RPC request/response
 * - Error handling (invalid requests, missing methods)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';
import { createMcpTransportRoutes } from '../../dashboard/server/HttpTransport';

describe('HttpTransport', () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  // Mock handler lookup
  const mockHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
    'index_search': async (params: unknown) => {
      const p = params as { keywords?: string[] };
      return { matches: p?.keywords?.length ?? 0, results: [] };
    },
    'health_check': async () => ({ status: 'ok' }),
    'error_handler': async () => { throw new Error('test error'); },
  };

  const handlerLookup = (method: string) => mockHandlers[method];

  beforeAll(async () => {
    app = express();
    const routes = createMcpTransportRoutes({ handlerLookup });
    app.use('/mcp', routes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function jsonRpc(method: string, params: unknown = {}, id: number = 1) {
    const res = await fetch(`${baseUrl}/mcp/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
    });
    return { status: res.status, body: await res.json() };
  }

  describe('GET /mcp/health', () => {
    it('should return ok status', async () => {
      const res = await fetch(`${baseUrl}/mcp/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.pid).toBe(process.pid);
      expect(data.uptime).toBeGreaterThan(0);
    });
  });

  describe('GET /mcp/leader', () => {
    it('should return leader info', async () => {
      const res = await fetch(`${baseUrl}/mcp/leader`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.pid).toBe(process.pid);
      expect(data.role).toBe('leader');
    });
  });

  describe('POST /mcp/rpc', () => {
    it('should route JSON-RPC to handler and return result', async () => {
      const { status, body } = await jsonRpc('index_search', { keywords: ['test', 'foo'] });
      expect(status).toBe(200);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.result).toEqual({ matches: 2, results: [] });
      expect(body.id).toBe(1);
    });

    it('should return -32601 for unknown method', async () => {
      const { status, body } = await jsonRpc('nonexistent_method');
      expect(status).toBe(404);
      expect(body.error.code).toBe(-32601);
      expect(body.error.message).toContain('nonexistent_method');
    });

    it('should return -32600 for invalid JSON-RPC (no method)', async () => {
      const res = await fetch(`${baseUrl}/mcp/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe(-32600);
    });

    it('should return -32600 for wrong jsonrpc version', async () => {
      const res = await fetch(`${baseUrl}/mcp/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '1.0', method: 'test' }),
      });
      expect(res.status).toBe(400);
    });

    it('should return -32603 for handler errors', async () => {
      const { status, body } = await jsonRpc('error_handler');
      expect(status).toBe(500);
      expect(body.error.code).toBe(-32603);
      expect(body.error.message).toBe('test error');
    });

    it('should handle missing params gracefully', async () => {
      const { status, body } = await jsonRpc('health_check');
      expect(status).toBe(200);
      expect(body.result).toEqual({ status: 'ok' });
    });

    it('should preserve request id in response', async () => {
      const { body } = await jsonRpc('health_check', {}, 42);
      expect(body.id).toBe(42);
    });
  });
});
