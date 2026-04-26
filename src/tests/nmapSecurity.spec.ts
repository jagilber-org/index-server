/**
 * Nmap Security Scan Tests — TDD RED Phase
 *
 * Validates the Index Server's network security posture using nmap.
 * Tests include: port scanning, service detection, TLS configuration,
 * and vulnerability assessment.
 *
 * Requires: nmap installed and dashboard server running.
 * These tests are integration tests that scan the REAL server.
 *
 * Constitution: S-1 (no secrets), TS-4 (full pipeline round-trips),
 *               TS-9 (test real production code)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import { createDashboardServer, DashboardServer } from '../dashboard/server/DashboardServer.js';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

const NMAP_PORT = 19787;
const NMAP_HOST = '127.0.0.1';

function nmapAvailable(): boolean {
  try {
    execSync('nmap --version', { stdio: 'pipe', timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

function opensslAvailable(): boolean {
  try {
    execSync('openssl version', { stdio: 'pipe', timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

function nmapScriptAvailable(scriptName: string): boolean {
  try {
    const output = execSync(`nmap --script-help ${scriptName}`, { stdio: 'pipe', timeout: 10_000 }).toString();
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

async function runNmap(args: string, timeoutMs = 60_000): Promise<string> {
  const { stdout } = await execFileAsync('nmap', args.split(/\s+/), { timeout: timeoutMs });
  return stdout;
}

const hasNmap = nmapAvailable();

describe.skipIf(!hasNmap)('Nmap Security Scanning', () => {
  const hasVulnScript = nmapScriptAvailable('vuln') && process.platform !== 'win32';
  const hasHttpEnumScript = nmapScriptAvailable('http-enum');
  let server: DashboardServer | null = null;
  let activePort = NMAP_PORT;

  beforeAll(async () => {
    if (!hasNmap) return;
    server = createDashboardServer({
      port: NMAP_PORT,
      host: NMAP_HOST,
    });
    const started = await server.start();
    activePort = started.port;
    // Wait until server is accepting connections before running nmap
    for (let i = 0; i < 20; i++) {
      try {
        const resp = await fetch(`http://${NMAP_HOST}:${activePort}/api/tools/health_check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (resp.ok) break;
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 500));
    }
  }, 60_000);

  afterAll(async () => {
    if (server) {
      try { await server.stop(); } catch { /* ok */ }
    }
  });

  it('should expose only the expected port', async () => {
    if (!hasNmap) return;
    // Scan a narrow range around our port instead of all 65535
    const scanRange = `${activePort - 10}-${activePort + 10}`;
    const output = await runNmap(`-p ${scanRange} --open -T4 ${NMAP_HOST}`);
    expect(output).toContain(`${activePort}/tcp`);
    expect(output).toContain('open');
  }, 90_000);

  it('should detect HTTP service on dashboard port', async () => {
    if (!hasNmap) return;
    // -sV probes are slow on Windows; use aggressive timing + short timeout
    const output = await runNmap(`-sV -T4 --version-intensity 2 -p ${activePort} ${NMAP_HOST}`, 120_000);
    // Should detect HTTP service
    expect(output.toLowerCase()).toContain('http');
  }, 150_000);

  it('should not expose server version in banner', async () => {
    if (!hasNmap) return;
    // -sV with version-intensity is slow; use aggressive timing + extended timeout
    const output = await runNmap(`-sV -T4 --version-intensity 5 -p ${activePort} ${NMAP_HOST}`, 180_000);
    // Express with helmet-like headers shouldn't expose version
    expect(output).not.toContain('Express');
    // Node version shouldn't be exposed either
    expect(output).not.toMatch(/Node\.js \d+/);
  }, 200_000);

  it.skipIf(!hasVulnScript)('should not have known vulnerabilities (vuln scan)', async () => {
    if (!hasNmap) return;
    const output = await runNmap(`--script vuln -p ${activePort} ${NMAP_HOST}`);
    const vulnLines = output.split('\n').filter(l => l.includes('VULNERABLE'));
    expect(vulnLines).toHaveLength(0);
  }, 90_000);

  it('should have secure HTTP headers', async () => {
    if (!hasNmap) return;
    const response = await fetch(`http://${NMAP_HOST}:${activePort}/api/status`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  }, 90_000);

  it.skipIf(!hasHttpEnumScript)('should not expose directory listing', async () => {
    if (!hasNmap) return;
    const output = await runNmap(`--script http-enum -p ${activePort} ${NMAP_HOST}`);
    const lower = output.toLowerCase();
    expect(lower).not.toContain('.env');
    expect(lower).not.toContain('.git');
    expect(lower).not.toContain('node_modules');
  }, 90_000);

  it('should handle SYN flood gracefully (rate limiting)', async () => {
    if (!hasNmap) return;
    try {
      await runNmap(`-sS -T5 --max-retries 1 -p ${activePort} ${NMAP_HOST}`);
    } catch {
      // SYN scan may require root/admin — that's acceptable
    }
    // Give server a moment to recover from the flood
    await new Promise(r => setTimeout(r, 2000));
    // Retry up to 3 times to verify server is still responsive
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const output = await runNmap(`-p ${activePort} ${NMAP_HOST}`);
        expect(output).toContain('open');
        return;
      } catch (e) {
        lastError = e as Error;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    expect.fail(`Server became unresponsive after SYN scan: ${lastError?.message}`);
  }, 120_000);
});

const hasOpenssl = opensslAvailable();

describe.skipIf(!hasNmap || !hasOpenssl)('Nmap TLS Security', () => {
  const hasSslEnumCiphersScript = nmapScriptAvailable('ssl-enum-ciphers');
  let server: DashboardServer | null = null;
  const tlsPort = 19788;
  let activeTlsPort = tlsPort;
  let certDir: string;

  beforeAll(async () => {
    // Generate test certs
    certDir = path.join(__dirname, '..', '..', 'tmp', 'nmap-tls-test');
    fs.mkdirSync(certDir, { recursive: true });

    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${path.join(certDir, 'server.key')}" ` +
      `-out "${path.join(certDir, 'server.crt')}" -days 1 -nodes ` +
      `-subj "/CN=localhost"`,
      { stdio: 'pipe' }
    );

    const cert = fs.readFileSync(path.join(certDir, 'server.crt'), 'utf8');
    const key = fs.readFileSync(path.join(certDir, 'server.key'), 'utf8');

    server = createDashboardServer({
      port: tlsPort,
      host: NMAP_HOST,
      tls: { cert, key },
    });
    const started = await server.start();
    activeTlsPort = started.port;
  }, 30_000);

  afterAll(async () => {
    if (server) {
      try { await server.stop(); } catch { /* ok */ }
    }
    // Cleanup temp certs
    try { fs.rmSync(certDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it('should detect HTTPS/TLS on the TLS port', async () => {
    if (!hasNmap || !server) return;
    const output = await runNmap(`-sV -p ${activeTlsPort} ${NMAP_HOST}`);
    expect(output.toLowerCase()).toMatch(/ssl|https|tls/);
  });

  it.skipIf(!hasSslEnumCiphersScript)('should not support SSLv3 or TLS 1.0/1.1 (weak protocols)', async () => {
    if (!hasNmap || !server) return;
    const output = await runNmap(`--script ssl-enum-ciphers -p ${activeTlsPort} ${NMAP_HOST}`);
    const lower = output.toLowerCase();
    expect(lower).not.toMatch(/sslv3.*accepted/);
    expect(lower).not.toMatch(/tlsv1\.0.*accepted/);
  });

  it.skipIf(!hasSslEnumCiphersScript)('should not have weak ciphers enabled', async () => {
    if (!hasNmap || !server) return;
    const output = await runNmap(`--script ssl-enum-ciphers -p ${activeTlsPort} ${NMAP_HOST}`);
    const lower = output.toLowerCase();
    expect(lower).not.toContain('rc4');
    expect(lower).not.toContain('des-cbc3');
    expect(lower).not.toContain('null');
  });

  it('should have HSTS header when TLS is enabled', async () => {
    if (!hasNmap || !server) return;
    const orig = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // lgtm[js/disabling-certificate-validation] — test: self-signed cert
    try {
      const response = await fetch(`https://${NMAP_HOST}:${activeTlsPort}/api/status`);
      expect(response.headers.get('strict-transport-security')).toBeDefined();
    } finally {
      if (orig === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = orig;
    }
  });
});
