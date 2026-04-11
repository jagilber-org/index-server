/**
 * ThinClient Tests - TDD
 *
 * Tests for the stdio-to-HTTP bridge:
 * - Leader discovery from state files
 * - JSON-RPC forwarding
 * - Health checks
 * - Frame processing
 * - Error handling and retries
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ThinClient } from '../../dashboard/server/ThinClient';
import { createMcpTransportRoutes } from '../../dashboard/server/HttpTransport';

describe('ThinClient', () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;
  let port: number;
  let tempDir: string;

  // Mock handlers
  const mockHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
    'health_check': async () => ({ status: 'ok' }),
    'index_search': async (params: unknown) => {
      const p = params as { keywords?: string[] };
      return { matches: p?.keywords?.length ?? 0, results: [] };
    },
  };

  beforeAll(async () => {
    app = express();
    const routes = createMcpTransportRoutes({
      handlerLookup: (m) => mockHandlers[m],
    });
    app.use('/mcp', routes);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          port = addr.port;
          baseUrl = `http://127.0.0.1:${port}/mcp`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-thin-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('Leader Discovery', () => {
    it('should discover leader from lock file', () => {
      const lockPath = path.join(tempDir, 'leader.lock');
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        port,
        host: '127.0.0.1',
        startedAt: new Date().toISOString(),
        heartbeat: new Date().toISOString(),
      }));

      const client = new ThinClient({ stateDir: tempDir });
      const url = client.discoverLeader();
      expect(url).toBe(`http://127.0.0.1:${port}/mcp`);
    });

    it('should return null when no lock file exists', () => {
      const client = new ThinClient({ stateDir: tempDir });
      const url = client.discoverLeader();
      expect(url).toBeNull();
    });

    it('should use explicit URL over discovery', () => {
      const client = new ThinClient({
        leaderUrl: 'http://explicit:1234/mcp',
        stateDir: tempDir,
      });
      expect(client.resolveLeaderUrl()).toBe('http://explicit:1234/mcp');
    });
  });

  describe('RPC Forwarding', () => {
    it('should forward JSON-RPC to leader and return result', async () => {
      const client = new ThinClient({ leaderUrl: baseUrl });
      const result = await client.sendRpc('health_check', {}, 1);
      expect(result).toEqual({
        jsonrpc: '2.0',
        result: { status: 'ok' },
        id: 1,
      });
      expect(client.connected).toBe(true);
    });

    it('should forward params correctly', async () => {
      const client = new ThinClient({ leaderUrl: baseUrl });
      const result = await client.sendRpc('index_search', { keywords: ['a', 'b', 'c'] }, 2) as any;
      expect(result.result.matches).toBe(3);
    });

    it('should throw when no leader URL available', async () => {
      const client = new ThinClient({ maxRetries: 1 });
      await expect(client.sendRpc('test')).rejects.toThrow('No leader URL available');
    });
  });

  describe('Health Check', () => {
    it('should return true when leader is healthy', async () => {
      const client = new ThinClient({ leaderUrl: baseUrl });
      const healthy = await client.checkHealth();
      expect(healthy).toBe(true);
    });

    it('should return false when leader is unreachable', async () => {
      const client = new ThinClient({ leaderUrl: 'http://127.0.0.1:1/mcp' });
      const healthy = await client.checkHealth();
      expect(healthy).toBe(false);
    });
  });

  describe('Frame Processing', () => {
    it('should process a valid JSON-RPC frame', async () => {
      const client = new ThinClient({ leaderUrl: baseUrl });
      const frame = JSON.stringify({ jsonrpc: '2.0', method: 'health_check', id: 1 });
      const response = await client.processFrame(frame);
      const parsed = JSON.parse(response);
      expect(parsed.result).toEqual({ status: 'ok' });
    });

    it('should return parse error for invalid JSON', async () => {
      const client = new ThinClient({ leaderUrl: baseUrl });
      const response = await client.processFrame('not json');
      const parsed = JSON.parse(response);
      expect(parsed.error.code).toBe(-32700);
    });
  });

  describe('Auto-Discovery Integration', () => {
    it('should discover and connect to leader via lock file', async () => {
      // Write a lock file pointing to our test server
      const lockPath = path.join(tempDir, 'leader.lock');
      fs.writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        port,
        host: '127.0.0.1',
        startedAt: new Date().toISOString(),
        heartbeat: new Date().toISOString(),
      }));

      const client = new ThinClient({ stateDir: tempDir });
      const result = await client.sendRpc('health_check', {}, 1) as any;
      expect(result.result.status).toBe('ok');
      expect(client.connected).toBe(true);
    });
  });
});
