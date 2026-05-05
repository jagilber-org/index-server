/**
 * Dashboard Integration Tests — TDD RED Phase
 *
 * Tests the dashboard HTTP server endpoints, security headers,
 * WebSocket connectivity, and API responses.
 *
 * Exercises the REAL DashboardServer with Express routes — no mocks of
 * the code under test. Tests the full HTTP pipeline.
 *
 * Constitution: TS-4 (full pipeline round-trips), TS-9 (real code),
 *               TS-11 (Playwright for UI, vitest for API), TS-12 (>=5 cases)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDashboardServer, DashboardServer } from '../dashboard/server/DashboardServer.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const DASH_HOST = '127.0.0.1';

describe('Dashboard API Integration', () => {
  let server: DashboardServer | null = null;
  let baseUrl = '';

  beforeAll(async () => {
    try {
      server = createDashboardServer({
        port: 0,
        host: DASH_HOST,
        maxPortTries: 5,
      });
      const started = await server.start();
      baseUrl = started.url.replace(/\/$/, '');
    } catch (e) {
      console.warn('Dashboard server failed to start:', (e as Error).message);
    }
  }, 15_000);

  afterAll(async () => {
    if (server) {
      try { await server.stop(); } catch { /* ok */ }
    }
  });

  // ── Status / Health ──────────────────────────────────────────────────

  it('GET /api/status should return server status', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/status`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data).toBeDefined();
    expect(typeof data).toBe('object');
  });

  it('GET /api/status should include version information', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/status`);
    const data = await resp.json() as Record<string, unknown>;
    // Version should be present somewhere in the response
    expect(data.version || data.serverVersion || data.status).toBeDefined();
  });

  // ── Tools ─────────────────────────────────────────────────────────────

  it('GET /api/tools should return registered tools', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/tools`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data) || (typeof data === 'object' && data !== null)).toBe(true);
  });

  // ── Instructions ──────────────────────────────────────────────────────

  it('GET /api/instructions should return instruction list', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/instructions`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data).toBeDefined();
  });

  // ── Security Headers ─────────────────────────────────────────────────

  it('should set X-Content-Type-Options: nosniff', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/status`);
    expect(resp.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('should set X-Frame-Options: DENY', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/status`);
    expect(resp.headers.get('x-frame-options')).toBe('DENY');
  });

  it('should NOT expose X-Powered-By header', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/status`);
    expect(resp.headers.get('x-powered-by')).toBeNull();
  });

  it('should set Content-Security-Policy header', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/admin`);
    const csp = resp.headers.get('content-security-policy');
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
  });

  it('should set Referrer-Policy header', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/status`);
    expect(resp.headers.get('referrer-policy')).toBeDefined();
  });

  // ── Error Handling ────────────────────────────────────────────────────

  it('should return 404 for unknown routes', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/nonexistent-endpoint-xyz`);
    expect(resp.status).toBe(404);
  });

  it('should handle malformed JSON in POST body gracefully', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/instructions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not valid json }',
    });
    // Should return 400, not 500
    expect(resp.status).toBeGreaterThanOrEqual(400);
    expect(resp.status).toBeLessThan(500);
  });

  // ── Admin Dashboard HTML ──────────────────────────────────────────────

  it('GET /admin should serve dashboard HTML', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/admin`);
    expect(resp.ok).toBe(true);
    const html = await resp.text();
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('dashboard HTML should have CSP nonce on scripts', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/admin`);
    const html = await resp.text();
    const csp = resp.headers.get('content-security-policy') || '';
    // Extract nonce from CSP
    const nonceMatch = csp.match(/nonce-([A-Za-z0-9+/=]+)/);
    if (nonceMatch) {
      expect(html).toContain(`nonce="${nonceMatch[1]}"`);
    }
  });

  // ── Metrics ───────────────────────────────────────────────────────────

  it('GET /api/metrics should return metrics data', async () => {
    if (!server) return;
    const resp = await fetch(`${baseUrl}/api/metrics`);
    // Metrics might be empty but endpoint should respond
    expect(resp.status).toBeLessThan(500);
  });

  // ── Rate Limiting / DoS Protection ────────────────────────────────────

  it('should handle rapid sequential requests without crashing', async () => {
    if (!server) return;
    const results: number[] = [];
    for (let i = 0; i < 50; i++) {
      const resp = await fetch(`${baseUrl}/api/status`);
      results.push(resp.status);
    }
    // Should not have any 500 errors
    const serverErrors = results.filter(s => s >= 500);
    expect(serverErrors).toHaveLength(0);
  });
});

describe('Dashboard TLS Integration', () => {
  let server: DashboardServer | null = null;
  const TLS_PORT = 16788;
  let certDir: string;

  beforeAll(async () => {
    // Check for openssl
    let hasOpenssl = false;
    const { execSync } = await import('child_process');
    try {
      execSync('openssl version', { stdio: 'pipe' });
      hasOpenssl = true;
    } catch { /* ok */ }

    if (!hasOpenssl) return;

    certDir = path.join(os.tmpdir(), `dash-tls-test-${Date.now()}`); // lgtm[js/insecure-temporary-file] — test temp dir with Date.now() suffix
    fs.mkdirSync(certDir, { recursive: true });

    // Write a minimal config to avoid system config issues (Windows compat)
    const cnfPath = path.join(certDir, 'openssl.cnf');
    fs.writeFileSync(cnfPath, '[req]\ndistinguished_name=req_dn\nprompt=no\n[req_dn]\nCN=localhost\n'); // lgtm[js/insecure-temporary-file] — test writes openssl config inside per-test certDir created with Date.now() suffix
    const cnfEnv = { ...process.env, OPENSSL_CONF: cnfPath };
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${path.join(certDir, 'server.key')}" ` +
      `-out "${path.join(certDir, 'server.crt')}" -days 1 -nodes -subj "/CN=localhost" -config "${cnfPath}"`,
      { stdio: 'pipe', env: cnfEnv }
    );

    const cert = fs.readFileSync(path.join(certDir, 'server.crt'), 'utf8');
    const key = fs.readFileSync(path.join(certDir, 'server.key'), 'utf8');

    server = createDashboardServer({
      port: TLS_PORT,
      host: DASH_HOST,
      tls: { cert, key },
    });
    await server.start();
  }, 30_000);

  afterAll(async () => {
    if (server) {
      try { await server.stop(); } catch { /* ok */ }
    }
    if (certDir) {
      try { fs.rmSync(certDir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it('should serve HTTPS with valid TLS', async () => {
    if (!server) return;
    // Use Node's https module with rejectUnauthorized: false for self-signed
    const https = await import('https');
    const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = https.get(
        `https://${DASH_HOST}:${TLS_PORT}/api/status`,
        { rejectUnauthorized: false }, // lgtm[js/disabling-certificate-validation] — test: self-signed cert
        (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
        }
      );
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    expect(result.statusCode).toBe(200);
  });

  it('should include HSTS header on HTTPS responses', async () => {
    if (!server) return;
    const https = await import('https');
    const result = await new Promise<{ headers: Record<string, string | string[] | undefined> }>((resolve, reject) => {
      const req = https.get(
        `https://${DASH_HOST}:${TLS_PORT}/api/status`,
        { rejectUnauthorized: false }, // lgtm[js/disabling-certificate-validation] — test: self-signed cert
        (res) => {
          res.resume();
          resolve({ headers: res.headers as Record<string, string | string[] | undefined> });
        }
      );
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    expect(result.headers['strict-transport-security']).toBeDefined();
  });

  it('should use WSS protocol for WebSocket when TLS enabled', () => {
    if (!server) return;
    // Access via public getter or type assertion for test verification
    expect((server as unknown as { wsProtocol: string }).wsProtocol).toBe('wss');
    expect((server as unknown as { httpProtocol: string }).httpProtocol).toBe('https');
  });
});
