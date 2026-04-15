/**
 * Follower Proxy Integration Test
 *
 * Validates the full flow: leader starts HTTP transport,
 * follower installs proxy, follower tool calls forward to leader.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ThinClient } from '../../dashboard/server/ThinClient';
import { createMcpTransportRoutes } from '../../dashboard/server/HttpTransport';
import { installHandlerProxy, registerHandler, getHandler } from '../../server/registry';

describe('Follower Proxy Integration', () => {
  let app: express.Express;
  let server: http.Server;
  let port: number;
  let tempDir: string;

  beforeAll(async () => {
    // Register test handlers (the real handlers aren't loaded in test context)
    registerHandler('health_check', async () => ({ status: 'ok', version: '1.0.0' }));
    registerHandler('index_search', async (_params: { keywords?: string[] }) => ({
      results: [{ id: 'test-1', title: 'Test instruction' }],
      total: 1
    }));

    // Start a mock leader HTTP transport
    app = express();
    app.use('/mcp', createMcpTransportRoutes());
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        port = addr.port;
        resolve();
      });
    });

    // Create temp state dir with leader.lock pointing at our mock leader
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'follower-proxy-test-'));
    const lockFile = path.join(tempDir, 'leader.lock');
    fs.writeFileSync(lockFile, JSON.stringify({
      pid: process.pid,
      port: port,
      host: '127.0.0.1',
      startedAt: new Date().toISOString(),
      heartbeat: Date.now()
    }));
  });

  afterAll(async () => {
    installHandlerProxy(null);
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    try { fs.rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }
  });

  afterEach(() => {
    installHandlerProxy(null);
  });

  it('should proxy health_check through ThinClient to leader', async () => {
    const thinClient = new ThinClient({ stateDir: tempDir });

    // Install proxy just like index.ts follower block does
    installHandlerProxy(async (tool: string, params: unknown) => {
      const response = await thinClient.sendRpc(tool, params) as { result?: unknown; error?: { code: number; message: string } };
      if (response.error) {
        throw new Error(`Leader error [${response.error.code}]: ${response.error.message}`);
      }
      return response.result;
    });

    const handler = getHandler('health_check');
    expect(handler).toBeDefined();

    const result = await handler!({}) as Record<string, unknown>;
    // The leader should return health_check result (status: ok)
    expect(result).toBeDefined();
    expect(result.status).toBe('ok');

    thinClient.stop();
  });

  it('should proxy index_search through ThinClient to leader', async () => {
    const thinClient = new ThinClient({ stateDir: tempDir });

    installHandlerProxy(async (tool: string, params: unknown) => {
      const response = await thinClient.sendRpc(tool, params) as { result?: unknown; error?: { code: number; message: string } };
      if (response.error) {
        throw new Error(`Leader error [${response.error.code}]: ${response.error.message}`);
      }
      return response.result;
    });

    const handler = getHandler('index_search');
    expect(handler).toBeDefined();

    const result = await handler!({ keywords: ['test'] }) as Record<string, unknown>;
    expect(result).toBeDefined();

    thinClient.stop();
  });
});
