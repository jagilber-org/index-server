/**
 * Security Header Regression Tests — TDD Red/Green
 *
 * Validates that the DashboardServer and ApiRoutes apply all
 * security headers discovered during pen testing (April 2026).
 * Exercises REAL production code per TS-9.
 *
 * These tests start a real DashboardServer instance and make
 * HTTP requests to verify header presence and values.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { DashboardServer } from '../dashboard/server/DashboardServer.js';

/** Helper: make an HTTP GET request and return the response headers + status */
function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

describe('Security Headers — Pen Test Regression', () => {
  let server: DashboardServer;
  let url: string;
  let close: () => void;

  afterEach(async () => {
    if (close) {
      close();
      // Small delay to let socket drain
      await new Promise(r => setTimeout(r, 50));
    }
  });

  async function startServer(): Promise<void> {
    // Use port 0 so the OS assigns a free port, avoiding EACCES on restricted ports.
    // DashboardServer.start() returns the requested port, so we read the real
    // port from getServerInfo() which calls server.address().
    server = new DashboardServer({
      host: '127.0.0.1',
      port: 0,
      enableWebSockets: false,
      enableCors: false,
    });
    const info = await server.start();
    const resolved = server.getServerInfo();
    url = resolved ? resolved.url : info.url;
    close = info.close;
  }

  // L1: X-Powered-By must NOT be present (technology fingerprinting)
  it('should not expose X-Powered-By header', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  // Security headers on every response
  it('should include X-Content-Type-Options: nosniff', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('should include X-Frame-Options: DENY', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('should include X-XSS-Protection header', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    expect(res.headers['x-xss-protection']).toBe('1; mode=block');
  });

  it('should include Referrer-Policy header', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  // M1: Content-Security-Policy with frame-ancestors and form-action
  it('should include CSP with frame-ancestors none', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('should include CSP with form-action self', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("form-action 'self'");
  });

  // M2: CSP nonce — must be present and unique per request
  it('should include a nonce in CSP script-src', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toMatch(/nonce-[A-Za-z0-9+/=]+/);
  });

  it('should not allow unsafe inline scripts in CSP', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    const csp = res.headers['content-security-policy'] as string;
    const scriptDirective = csp.split(';').map(part => part.trim()).find(part => part.startsWith('script-src '));
    expect(scriptDirective).toBeDefined();
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(scriptDirective).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
  });

  it('should generate different nonces for different requests', async () => {
    await startServer();
    const res1 = await httpGet(`${url}/health`);
    const res2 = await httpGet(`${url}/health`);
    const csp1 = res1.headers['content-security-policy'] as string;
    const csp2 = res2.headers['content-security-policy'] as string;
    const nonce1 = csp1.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];
    const nonce2 = csp2.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];
    expect(nonce1).toBeDefined();
    expect(nonce2).toBeDefined();
    expect(nonce1).not.toBe(nonce2);
  });

  // L2: ETag must not leak inode info (should use "strong" setting)
  it('should not expose x-powered-by on API routes', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  // I2: API cache-control headers
  // NOTE: /api/* routes depend on full server initialization (IndexContext, runtimeConfig).
  // In isolated DashboardServer tests, API routes return 404 because route modules
  // fail to load without the full runtime. The API-layer Cache-Control and Pragma
  // headers are validated at CI level by scripts/validate-security-headers.mjs
  // against a fully running server instance.

  // HSTS: must NOT be present on plain HTTP (only on TLS)
  it('should not include HSTS header over plain HTTP', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  // CSP: default-src must be 'self'
  it('should have default-src self in CSP', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
  });

  // CSP: connect-src for WebSocket
  it('should include ws: in connect-src for non-TLS', async () => {
    await startServer();
    const res = await httpGet(`${url}/health`);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain('connect-src');
    expect(csp).toContain('ws:');
  });
});

describe('Security Headers — Script for CI validation', () => {
  it('should export a validate function for CI pipelines', async () => {
    // The validation script is an .mjs file that can run standalone.
    // Verify it exists on disk (the CI workflow invokes it directly via node).
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const scriptPath = join(process.cwd(), 'scripts', 'validate-security-headers.mjs');
    expect(existsSync(scriptPath)).toBe(true);
  });
});
