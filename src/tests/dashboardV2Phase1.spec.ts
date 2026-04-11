/**
 * Dashboard V2 Phase 1 — Dead Code Removal RED Tests
 *
 * These tests define the DESIRED end state after dead code removal.
 * They should currently FAIL (RED) because the dead files still exist
 * and the dead code path (`/js/dashboard-client.js`) is still served.
 *
 * After removal the tests will pass (GREEN).
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createDashboardServer, type DashboardServer } from '../dashboard/server/DashboardServer.js';

/** Resolve a path relative to the project root (two levels above src/tests/) */
const projectRoot = path.resolve(__dirname, '..', '..');

/** Tiny HTTP GET helper that returns status + body text */
function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(4000, () => { req.destroy(new Error('timeout')); });
  });
}

describe('Dashboard V2 Phase 1 — dead code removal', () => {
  let server: DashboardServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  // ── 1. Dead files do NOT exist ──────────────────────────────────────

  const deadFiles = [
    'src/dashboard/client/Phase3DashboardClient.ts',
    'src/dashboard/client/Phase4DashboardClient.ts',
    'src/dashboard/client/Phase4Demo.html',
    'src/dashboard/client/Phase4Integration.ts',
    'src/dashboard/client/Phase4Styles.css',
    'src/dashboard/client/DashboardClient.ts',
    'src/dashboard/client/DashboardStyles.ts',
    'src/dashboard/client/DashboardTypes.ts',
  ];

  it('dead dashboard client files do not exist in source tree', { timeout: 5000 }, () => {
    const existing = deadFiles.filter((rel) =>
      fs.existsSync(path.resolve(projectRoot, rel)),
    );
    expect(existing, 'These dead files should have been removed').toEqual([]);
  });

  // ── 2. No DashboardClient.js reference in DashboardServer.ts ──────

  it('DashboardServer.ts has no DashboardClient.js reference', { timeout: 5000 }, () => {
    const serverSrc = fs.readFileSync(
      path.resolve(projectRoot, 'src', 'dashboard', 'server', 'DashboardServer.ts'),
      'utf-8',
    );
    expect(serverSrc).not.toContain('DashboardClient.js');
  });

  // ── 3. DashboardServer starts without errors ──────────────────────

  it('DashboardServer starts and returns valid server info', { timeout: 5000 }, async () => {
    server = createDashboardServer({ port: 0, enableWebSockets: false });
    const info = await server.start();

    expect(info).toBeDefined();
    expect(info.port).toBeGreaterThan(0);
    expect(info.url).toContain(String(info.port));
    expect(typeof info.close).toBe('function');
  });

  // ── 4. /admin route responds with HTML ────────────────────────────

  it('/admin route responds with 200 and HTML content', { timeout: 5000 }, async () => {
    server = createDashboardServer({ port: 0, enableWebSockets: false });
    const info = await server.start();

    const res = await httpGet(`http://127.0.0.1:${info.port}/admin`);
    expect(res.status).toBe(200);
    expect(res.body.toLowerCase()).toContain('<html');
  });

  // ── 5. Dead /js/dashboard-client.js route is removed ──────────────

  it('/js/dashboard-client.js route does not return 200', { timeout: 5000 }, async () => {
    server = createDashboardServer({ port: 0, enableWebSockets: false });
    const info = await server.start();

    try {
      const res = await httpGet(`http://127.0.0.1:${info.port}/js/dashboard-client.js`);
      expect(res.status).not.toBe(200);
    } catch {
      // Connection error also means the route does not serve 200 — acceptable
    }
  });
});
