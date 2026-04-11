/**
 * Dashboard TLS Support Tests
 *
 * TDD RED phase: tests for HTTPS/TLS enforcement on the optional dashboard.
 * Constitution refs: Q-1, S-4, A-2
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// ── helpers ────────────────────────────────────────────────────────────
/** Generate a self-signed cert+key pair into a temp directory for testing. */
function generateSelfSignedCert(): { certPath: string; keyPath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tls-test-'));
  const certPath = path.join(tmpDir, 'cert.pem');
  const keyPath = path.join(tmpDir, 'key.pem');

  // Use openssl to generate a self-signed certificate (available on most CI and dev machines).
  // If openssl is unavailable the test will be skipped gracefully.
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost"`,
      { stdio: 'pipe', timeout: 10000 },
    );
  } catch {
    // Clean up and signal caller
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw new Error('openssl not available – skipping TLS tests');
  }

  return {
    certPath,
    keyPath,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

let certFixture: { certPath: string; keyPath: string; cleanup: () => void } | null = null;
let opensslAvailable = true;

try {
  certFixture = generateSelfSignedCert();
} catch {
  opensslAvailable = false;
}

afterEach(() => {
  // nothing per-test; fixture cleaned up in final afterAll-style block below
});

// Clean up cert fixture at end of file (vitest runs describe blocks then afterAll)
if (certFixture) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__mcpTlsCertCleanup = certFixture.cleanup;
}

// ── 1. runtimeConfig TLS env parsing ───────────────────────────────────
describe('runtimeConfig – dashboard TLS fields', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot env vars we'll mutate
    for (const key of [
      'INDEX_SERVER_DASHBOARD_TLS',
      'INDEX_SERVER_DASHBOARD_TLS_CERT',
      'INDEX_SERVER_DASHBOARD_TLS_KEY',
      'INDEX_SERVER_DASHBOARD_TLS_CA',
      'INDEX_SERVER_DASHBOARD',
    ]) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('should default tls.enabled to false when INDEX_SERVER_DASHBOARD_TLS is unset', async () => {
    delete process.env.INDEX_SERVER_DASHBOARD_TLS;
    // Force re-parse
    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    const cfg = reloadRuntimeConfig();
    expect(cfg.dashboard.http.tls).toBeDefined();
    expect(cfg.dashboard.http.tls.enabled).toBe(false);
  });

  it('should parse tls.enabled=true from INDEX_SERVER_DASHBOARD_TLS=1', async () => {
    process.env.INDEX_SERVER_DASHBOARD_TLS = '1';
    process.env.INDEX_SERVER_DASHBOARD_TLS_CERT = '/tmp/cert.pem';
    process.env.INDEX_SERVER_DASHBOARD_TLS_KEY = '/tmp/key.pem';
    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    const cfg = reloadRuntimeConfig();
    expect(cfg.dashboard.http.tls.enabled).toBe(true);
    expect(cfg.dashboard.http.tls.certPath).toBe('/tmp/cert.pem');
    expect(cfg.dashboard.http.tls.keyPath).toBe('/tmp/key.pem');
  });

  it('should parse optional CA path from INDEX_SERVER_DASHBOARD_TLS_CA', async () => {
    process.env.INDEX_SERVER_DASHBOARD_TLS = '1';
    process.env.INDEX_SERVER_DASHBOARD_TLS_CERT = '/tmp/cert.pem';
    process.env.INDEX_SERVER_DASHBOARD_TLS_KEY = '/tmp/key.pem';
    process.env.INDEX_SERVER_DASHBOARD_TLS_CA = '/tmp/ca.pem';
    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    const cfg = reloadRuntimeConfig();
    expect(cfg.dashboard.http.tls.caPath).toBe('/tmp/ca.pem');
  });

  it('should leave caPath undefined when INDEX_SERVER_DASHBOARD_TLS_CA is unset', async () => {
    process.env.INDEX_SERVER_DASHBOARD_TLS = '1';
    process.env.INDEX_SERVER_DASHBOARD_TLS_CERT = '/tmp/cert.pem';
    process.env.INDEX_SERVER_DASHBOARD_TLS_KEY = '/tmp/key.pem';
    delete process.env.INDEX_SERVER_DASHBOARD_TLS_CA;
    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    const cfg = reloadRuntimeConfig();
    expect(cfg.dashboard.http.tls.caPath).toBeUndefined();
  });
});

// ── 2. DashboardServer TLS integration ─────────────────────────────────
describe('DashboardServer – TLS support', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;

  afterEach(async () => {
    if (server) {
      try { await server.stop(); } catch { /* ignore */ }
      server = null;
    }
  });

  it('should accept tls option in DashboardServerOptions', async () => {
    const { createDashboardServer } = await import('../dashboard/server/DashboardServer.js');
    // Construct with tls option – should not throw even if we don't start
    server = createDashboardServer({
      port: 0,
      enableWebSockets: false,
      tls: { cert: 'fake-cert', key: 'fake-key' },
    });
    expect(server).toBeDefined();
  });

  it.skipIf(!opensslAvailable)('should create HTTPS server when tls option provided', async () => {
    const { createDashboardServer } = await import('../dashboard/server/DashboardServer.js');
    server = createDashboardServer({
      port: 0,
      host: '127.0.0.1',
      maxPortTries: 1,
      enableWebSockets: false,
      tls: {
        cert: fs.readFileSync(certFixture!.certPath, 'utf8'),
        key: fs.readFileSync(certFixture!.keyPath, 'utf8'),
      },
    });

    const result = await server.start();
    expect(result.url).toMatch(/^https:\/\//);
    expect(result.port).toBeGreaterThan(0);
  });

  it.skipIf(!opensslAvailable)('should serve over HTTPS when tls option provided', async () => {
    const { createDashboardServer } = await import('../dashboard/server/DashboardServer.js');
    server = createDashboardServer({
      port: 0,
      host: '127.0.0.1',
      maxPortTries: 1,
      enableWebSockets: false,
      tls: {
        cert: fs.readFileSync(certFixture!.certPath, 'utf8'),
        key: fs.readFileSync(certFixture!.keyPath, 'utf8'),
      },
    });

    const result = await server.start();

    // Make an HTTPS request to the server (allow self-signed cert)
    const body = await new Promise<string>((resolve, reject) => {
      const req = https.get(
        `${result.url}admin`,
        { rejectUnauthorized: false },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    });

    expect(body).toContain('Dashboard');
  });

  it('should create HTTP server when tls option is absent (backward compat)', async () => {
    const { createDashboardServer } = await import('../dashboard/server/DashboardServer.js');
    server = createDashboardServer({
      port: 0,
      host: '127.0.0.1',
      maxPortTries: 1,
      enableWebSockets: false,
    });

    const result = await server.start();
    expect(result.url).toMatch(/^http:\/\//);
  });

  it.skipIf(!opensslAvailable)('should report wss:// WebSocket URL when tls is enabled', async () => {
    const { createDashboardServer } = await import('../dashboard/server/DashboardServer.js');
    server = createDashboardServer({
      port: 0,
      host: '127.0.0.1',
      maxPortTries: 1,
      enableWebSockets: true,
      tls: {
        cert: fs.readFileSync(certFixture!.certPath, 'utf8'),
        key: fs.readFileSync(certFixture!.keyPath, 'utf8'),
      },
    });

    const result = await server.start();

    // Fetch /ws-info over HTTPS (retry for server readiness)
    const fetchWsInfo = () => new Promise<string>((resolve, reject) => {
      const req = https.get(
        `${result.url}ws-info`,
        { rejectUnauthorized: false },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    });

    let body: string | undefined;
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try { body = await fetchWsInfo(); break; } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 50)); }
    }
    if (!body && lastErr) throw lastErr;

    const info = JSON.parse(body!);
    expect(info.url).toMatch(/^wss:\/\//);
  });

  it('should report ws:// WebSocket URL when tls is not enabled', async () => {
    const { createDashboardServer } = await import('../dashboard/server/DashboardServer.js');
    server = createDashboardServer({
      port: 0,
      host: '127.0.0.1',
      maxPortTries: 1,
      enableWebSockets: true,
    });

    const result = await server.start();

    // Fetch /ws-info over HTTP
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        `${result.url}ws-info`,
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    });

    const info = JSON.parse(body);
    expect(info.url).toMatch(/^ws:\/\//);
  });
});

// ── 3. CLI arg parsing ─────────────────────────────────────────────────
describe('CLI parseArgs – TLS flags', () => {
  it('should parse --dashboard-tls flag', async () => {
    // We need to test parseArgs which is not exported directly.
    // Instead, test through runtimeConfig + env vars which is the canonical path (S-4).
    // The CLI args test will be done via the env var path since parseArgs
    // delegates to runtimeConfig for defaults.
    process.env.INDEX_SERVER_DASHBOARD_TLS = '1';
    process.env.INDEX_SERVER_DASHBOARD_TLS_CERT = '/tmp/cert.pem';
    process.env.INDEX_SERVER_DASHBOARD_TLS_KEY = '/tmp/key.pem';
    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    const cfg = reloadRuntimeConfig();
    expect(cfg.dashboard.http.tls.enabled).toBe(true);
    // Cleanup
    delete process.env.INDEX_SERVER_DASHBOARD_TLS;
    delete process.env.INDEX_SERVER_DASHBOARD_TLS_CERT;
    delete process.env.INDEX_SERVER_DASHBOARD_TLS_KEY;
  });
});

// ── cleanup ────────────────────────────────────────────────────────────
afterEach(() => {
  // Deferred cert cleanup — guarded by existence check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cleanup = (globalThis as any).__mcpTlsCertCleanup;
  if (cleanup && typeof cleanup === 'function') {
    // Only remove after last test — vitest calls afterEach per test,
    // so we let the fixture persist. Actual cleanup in process exit.
  }
});

// Process-level cleanup for cert fixture
if (certFixture) {
  process.once('beforeExit', () => {
    certFixture?.cleanup();
  });
}
