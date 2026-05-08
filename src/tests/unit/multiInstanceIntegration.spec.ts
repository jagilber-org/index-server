/**
 * Multi-Instance Integration Tests
 *
 * End-to-end tests for the leader/follower architecture:
 * - Leader election with lock file
 * - HTTP transport serving JSON-RPC
 * - Thin client discovery and forwarding
 * - Failover: leader release → follower promotion
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LeaderElection } from '../../dashboard/server/LeaderElection';
import { createMcpTransportRoutes } from '../../dashboard/server/HttpTransport';
import { ThinClient } from '../../dashboard/server/ThinClient';

describe('Multi-Instance Integration', () => {
  // The afterEach hook closes HTTP servers + stops LeaderElection heartbeat timers.
  // Under heavy parallel-suite contention on Windows the default 60s hook
  // timeout has been observed to expire even though server.close() ultimately
  // resolves. Give teardown plenty of headroom; isolated runs complete in <1s.
  const HOOK_TIMEOUT_MS = 120_000;

  let tempDir: string;
  let elections: LeaderElection[] = [];
  let servers: http.Server[] = [];

  // Mock index handler
  const mockHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
    'health_check': async () => ({ status: 'ok' }),
    'index_search': async (params: unknown) => {
      const p = params as { keywords?: string[] };
      return { matches: p?.keywords?.length ?? 0, results: [] };
    },
    'index_dispatch': async (params: unknown) => {
      const p = params as { action?: string };
      if (p?.action === 'categories') {
        return { categories: [{ name: 'test', count: 1 }] };
      }
      return { success: true };
    },
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-integration-'));
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    for (const e of elections) { e.stop(); }
    elections = [];
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers = [];
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }, HOOK_TIMEOUT_MS);

  async function startLeaderServer(): Promise<{ election: LeaderElection; port: number; url: string }> {
    const app = express();
    const routes = createMcpTransportRoutes({
      handlerLookup: (m) => mockHandlers[m],
    });
    app.use('/mcp', routes);

    return new Promise((resolve) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const port = typeof addr !== 'string' ? addr!.port : 0;

        const election = new LeaderElection({
          stateDir: tempDir,
          port,
          host: '127.0.0.1',
          heartbeatIntervalMs: 100,
          staleThresholdMs: 300,
        });

        elections.push(election);
        servers.push(server);

        const _role = election.start();
        resolve({ election, port, url: `http://127.0.0.1:${port}/mcp` });
      });
    });
  }

  describe('Full Stack: Leader + ThinClient', () => {
    it('should allow thin client to discover and call leader', async () => {
      const { port: _port } = await startLeaderServer();

      const client = new ThinClient({ stateDir: tempDir });
      const result = await client.sendRpc('health_check', {}, 1) as any;
      expect(result.result.status).toBe('ok');
      expect(client.connected).toBe(true);
    });

    it('should forward instruction searches through thin client', async () => {
      await startLeaderServer();

      const client = new ThinClient({ stateDir: tempDir });
      const result = await client.sendRpc('index_search', { keywords: ['leader', 'test'] }, 2) as any;
      expect(result.result.matches).toBe(2);
    });

    it('should forward dispatch actions through thin client', async () => {
      await startLeaderServer();

      const client = new ThinClient({ stateDir: tempDir });
      const result = await client.sendRpc('index_dispatch', { action: 'categories' }, 3) as any;
      expect(result.result.categories).toHaveLength(1);
      expect(result.result.categories[0].name).toBe('test');
    });

    it('should process raw JSON-RPC frames end-to-end', async () => {
      await startLeaderServer();

      const client = new ThinClient({ stateDir: tempDir });
      const frame = JSON.stringify({
        jsonrpc: '2.0',
        method: 'health_check',
        params: {},
        id: 42,
      });

      const response = await client.processFrame(frame);
      const parsed = JSON.parse(response);
      expect(parsed.result.status).toBe('ok');
      expect(parsed.id).toBe(42);
    });
  });

  describe('Leader Election Flow', () => {
    it('should elect first instance as leader', async () => {
      const { election } = await startLeaderServer();
      expect(election.role).toBe('leader');
    });

    it('should have lock file after election', async () => {
      await startLeaderServer();
      const lockPath = path.join(tempDir, 'leader.lock');
      expect(fs.existsSync(lockPath)).toBe(true);
    });

    it('should clean up lock file when leader stops', async () => {
      const { election } = await startLeaderServer();
      election.stop();
      const lockPath = path.join(tempDir, 'leader.lock');
      expect(fs.existsSync(lockPath)).toBe(false);
    });
  });

  describe('Failover Scenario', () => {
    it('should allow new leader after previous leader releases lock', async () => {
      const leader1 = await startLeaderServer();
      expect(leader1.election.role).toBe('leader');

      // Leader 1 stops (releases lock)
      leader1.election.stop();

      // Leader 2 takes over
      const leader2 = await startLeaderServer();
      expect(leader2.election.role).toBe('leader');

      // Thin client should connect to new leader
      const client = new ThinClient({ stateDir: tempDir });
      const result = await client.sendRpc('health_check', {}, 1) as any;
      expect(result.result.status).toBe('ok');
    });

    it('thin client health check should detect leader availability', async () => {
      const client = new ThinClient({ stateDir: tempDir });

      // No leader yet
      const beforeHealth = await client.checkHealth();
      expect(beforeHealth).toBe(false);

      // Start leader
      await startLeaderServer();

      // Now healthy
      const afterHealth = await client.checkHealth();
      expect(afterHealth).toBe(true);
    });
  });
});
