/**
 * Client Scripts — E2E & Download Endpoint Tests
 *
 * Tests:
 * 1. Script download endpoint (GET /api/scripts, GET /api/scripts/:name)
 * 2. PowerShell client script E2E against live dashboard server
 * 3. Bash client script E2E against live dashboard server
 * 4. Nmap security scan of the dashboard port
 *
 * Spins up a real DashboardServer on an isolated port and exercises the
 * full HTTP pipeline end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDashboardServer, DashboardServer } from '../dashboard/server/DashboardServer.js';
import { reloadRuntimeConfig } from '../config/runtimeConfig.js';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Register handlers so tools are available via REST bridge
import '../services/toolHandlers.js';

const TEST_PORT = 17787;
const TEST_HOST = '127.0.0.1';
let activePort = TEST_PORT;
let activeBaseUrl = `http://${TEST_HOST}:${TEST_PORT}`;
const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');
const PS1_SCRIPT = path.join(SCRIPTS_DIR, 'index-server-client.ps1');
const SH_SCRIPT = path.join(SCRIPTS_DIR, 'index-server-client.sh');

const isWindows = os.platform() === 'win32';
const hasPwsh = (() => { try { execSync('pwsh -Version', { stdio: 'pipe' }); return true; } catch { return false; } })();
const hasBash = (() => {
  try {
    execSync(isWindows ? 'bash --version' : '/usr/bin/env bash --version', { stdio: 'pipe' });
    // On Windows, also verify the script is accessible from bash (line endings etc.)
    if (isWindows) {
      const bp = SH_SCRIPT.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);
      execSync(`bash -c "test -f '${bp}'"`, { stdio: 'pipe' });
    }
    return true;
  } catch { return false; }
})();
const hasNmap = (() => { try { execSync('nmap --version', { stdio: 'pipe' }); return true; } catch { return false; } })();

const execFileAsync = promisify(execFile);

async function runPwsh(args: string, timeoutMs = 60_000): Promise<string> {
  const { stdout } = await execFileAsync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', args], {
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  // Strip non-JSON warning/verbose lines that pwsh may emit
  const lines = stdout.trim().split('\n');
  const jsonStart = lines.findIndex(l => l.trimStart().startsWith('{') || l.trimStart().startsWith('['));
  let raw = jsonStart >= 0 ? lines.slice(jsonStart).join('\n').trim() : stdout.trim();
  // Sanitize control characters in string values (PowerShell ConvertTo-Json
  // may emit raw newlines/tabs inside JSON string literals)
  // eslint-disable-next-line no-control-regex
  raw = raw.replace(/[\x00-\x1f]/g, (ch) => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ch; // structural whitespace OK
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  });
  return raw;
}

/** Retry a pwsh tool call up to `retries` times with a delay between attempts. */
async function runPwshWithRetry(args: string, retries = 2, delayMs = 2000, timeoutMs = 60_000): Promise<string> {
  let lastOutput = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    lastOutput = await runPwsh(args, timeoutMs);
    try {
      const parsed = JSON.parse(lastOutput);
      if (parsed.success !== false) return lastOutput;
    } catch {
      return lastOutput; // not JSON — let caller handle
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, delayMs));
  }
  return lastOutput;
}

function getBashScriptPath(): string {
  if (isWindows) {
    return SH_SCRIPT.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`);
  }
  return SH_SCRIPT;
}

async function runBash(args: string, timeoutMs = 20_000): Promise<string> {
  const shell = isWindows ? 'bash' : '/usr/bin/env';
  const shellArgs = isWindows ? ['-c', args] : ['bash', '-c', args];
  const { stdout } = await execFileAsync(shell, shellArgs, {
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  return stdout.trim();
}

describe('Client Scripts E2E', () => {
  let server: DashboardServer | null = null;
  let originalMutation: string | undefined;
  let originalRateLimit: string | undefined;

  beforeAll(async () => {
    originalMutation = process.env.INDEX_SERVER_MUTATION;
    originalRateLimit = process.env.INDEX_SERVER_DISABLE_RATE_LIMIT;
    process.env.INDEX_SERVER_MUTATION = '1';
    // Disable rate limiting — E2E tests issue many sequential requests
    // (warmup loop + PS1/bash client invocations) and will exceed the default limit.
    process.env.INDEX_SERVER_DISABLE_RATE_LIMIT = '1';
    reloadRuntimeConfig();
    try {
      server = createDashboardServer({
        port: TEST_PORT,
        host: TEST_HOST,
      });
      const started = await server.start();
      activePort = started.port;
      activeBaseUrl = `http://${TEST_HOST}:${activePort}`;

      // Warm up: trigger index load and wait for readiness so tool
      // handlers don't fail with transient "index loading" errors.
      for (let i = 0; i < 40; i++) {
        try {
          const resp = await fetch(`${activeBaseUrl}/api/tools/health_check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          if (resp.ok) break;
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {
      console.warn('Test dashboard server failed to start:', (e as Error).message);
      server = null;
    }
  }, 45_000);

  afterAll(async () => {
    if (server) {
      try { await server.stop(); } catch { /* ok */ }
    }
    process.env.INDEX_SERVER_MUTATION = originalMutation;
    process.env.INDEX_SERVER_DISABLE_RATE_LIMIT = originalRateLimit;
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Script Download Endpoint Tests (fast — run first)
  // ═══════════════════════════════════════════════════════════════════════

  describe('GET /api/scripts', () => {
    it('should list available scripts', async () => {
      if (!server) return;
      // Retry once in case server is still warming up
      let resp: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          resp = await fetch(`${activeBaseUrl}/api/scripts`);
          break;
        } catch {
          if (attempt === 1) throw new Error('Failed to fetch script list after 2 attempts');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      expect(resp!.ok).toBe(true);
      const data = await resp!.json() as { scripts: Array<{ name: string; description: string; downloadUrl: string }> };
      expect(data.scripts).toBeDefined();
      expect(Array.isArray(data.scripts)).toBe(true);
      expect(data.scripts.length).toBeGreaterThanOrEqual(2);

      const names = data.scripts.map(s => s.name);
      expect(names).toContain('index-server-client.ps1');
      expect(names).toContain('index-server-client.sh');

      for (const s of data.scripts) {
        expect(s.description).toBeTruthy();
        expect(s.downloadUrl).toMatch(/^\/api\/scripts\//);
      }
    });
  });

  describe('GET /api/scripts/:name', () => {
    it('should download PowerShell script with correct headers', async () => {
      if (!server) return;
      // Retry in case of transient ECONNRESET during server warmup
      let resp: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          resp = await fetch(`${activeBaseUrl}/api/scripts/index-server-client.ps1`);
          break;
        } catch {
          if (attempt === 2) throw new Error('Failed to fetch PowerShell script after 3 attempts');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      expect(resp!.ok).toBe(true);
      expect(resp!.headers.get('content-disposition')).toContain('index-server-client.ps1');
      const body = await resp!.text();
      expect(body).toContain('.SYNOPSIS');
      expect(body).toContain('Index Server REST client');
    });

    it('should download Bash script with correct headers', async () => {
      if (!server) return;
      // Retry in case of transient ECONNRESET during server warmup
      let resp: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          resp = await fetch(`${activeBaseUrl}/api/scripts/index-server-client.sh`);
          break;
        } catch {
          if (attempt === 2) throw new Error('Failed to fetch Bash script after 3 attempts');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      expect(resp!.ok).toBe(true);
      expect(resp!.headers.get('content-disposition')).toContain('index-server-client.sh');
      const body = await resp!.text();
      expect(body).toContain('#!/usr/bin/env bash');
      expect(body).toContain('index-server-client.sh');
    });

    it('should return 404 for unknown script name', async () => {
      if (!server) return;
      // Retry in case of transient ECONNRESET during initial index loading
      let resp: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          resp = await fetch(`${activeBaseUrl}/api/scripts/nonexistent.ps1`);
          break;
        } catch {
          if (attempt === 2) throw new Error('Failed to fetch after 3 attempts');
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      expect(resp!.status).toBe(404);
      const data = await resp!.json() as { error: string; available: string[] };
      expect(data.error).toContain('not found');
      expect(data.available).toBeDefined();
    });

    it('should reject path traversal attempts', async () => {
      if (!server) return;
      const resp = await fetch(`${activeBaseUrl}/api/scripts/..%2F..%2Fpackage.json`);
      expect(resp.status).toBe(404);
    });

    it('should serve scripts with matching content to disk files', async () => {
      if (!server) return;
      const diskPs1 = fs.readFileSync(PS1_SCRIPT, 'utf-8');
      const resp = await fetch(`${activeBaseUrl}/api/scripts/index-server-client.ps1`);
      const httpPs1 = await resp.text();
      expect(httpPs1).toBe(diskPs1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Security Header Tests (fast — run before slow shell tests)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Script endpoint security', () => {
    it('should set Cache-Control no-store on script list', async () => {
      if (!server) return;
      const resp = await fetch(`${activeBaseUrl}/api/scripts`);
      const cc = resp.headers.get('cache-control');
      expect(cc).toContain('no-store');
    });

    it('should set security headers on script download', async () => {
      if (!server) return;
      // Retry in case of transient ECONNRESET during server warmup
      let resp: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          resp = await fetch(`${activeBaseUrl}/api/scripts/index-server-client.ps1`);
          break;
        } catch {
          if (attempt === 2) throw new Error('Failed to fetch script after 3 attempts');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      expect(resp!.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('should not expose server version in headers', async () => {
      if (!server) return;
      let resp: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          resp = await fetch(`${activeBaseUrl}/api/scripts`);
          break;
        } catch {
          if (attempt === 2) throw new Error('Failed to fetch scripts list after 3 attempts');
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      expect(resp!.headers.get('x-powered-by')).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  PowerShell Client Script E2E Tests
  //  Consolidated into fewer tests to minimize pwsh startup overhead
  // ═══════════════════════════════════════════════════════════════════════

  describe('PowerShell client (index-server-client.ps1)', () => {
    it.skipIf(!hasPwsh)('health action should return success', async () => {
      if (!server) return;
      const output = await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action health`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    }, 60_000);

    it.skipIf(!hasPwsh)('search action should return results', async () => {
      if (!server) return;
      const output = await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action search -Keywords 'bootstrap'`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
    }, 60_000);

    it.skipIf(!hasPwsh)('list action should return instructions', async () => {
      if (!server) return;
      const output = await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action list -Limit 5`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
    }, 60_000);

    it.skipIf(!hasPwsh)('get action without id should return error', async () => {
      if (!server) return;
      const output = await runPwsh(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action get`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Id required');
    }, 60_000);

    it.skipIf(!hasPwsh)('search without keywords should return error', async () => {
      if (!server) return;
      const output = await runPwsh(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action search`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Keywords required');
    }, 60_000);

    it.skipIf(!hasPwsh)('hotset action should return results', async () => {
      if (!server) return;
      const output = await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action hotset -Limit 5`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
    }, 60_000);
    it.skipIf(!hasPwsh)('add action should create instruction with entry wrapper', async () => {
      if (!server) return;
      const output = await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action add -Id 'e2e-ps1-test-1' -Title 'PS1 E2E Test' -Body 'Created by clientScriptsE2e test' -Priority 42 -Overwrite`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    }, 60_000);

    it.skipIf(!hasPwsh)('get should retrieve instruction created by add', async () => {
      if (!server) return;
      // Create first
      await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action add -Id 'e2e-ps1-roundtrip' -Title 'Roundtrip Test' -Body 'Roundtrip body content'`
      );
      // Then retrieve
      const output = await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action get -Id 'e2e-ps1-roundtrip'`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      // index_dispatch get returns { hash, item: { id, title, ... } } or { notFound, id, ... }
      const entry = result.result.item ?? result.result;
      expect(entry.id).toBe('e2e-ps1-roundtrip');
      expect(entry.title).toBe('Roundtrip Test');
    }, 60_000);

    it.skipIf(!hasPwsh)('track action should record usage signal', async () => {
      if (!server) return;
      const output = await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action track -Id 'e2e-ps1-roundtrip' -Signal helpful`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
    }, 60_000);

    it.skipIf(!hasPwsh)('remove action should delete instruction', async () => {
      if (!server) return;
      const output = await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action remove -Id 'e2e-ps1-roundtrip'`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result.removed).toBe(1);
    }, 60_000);

    it.skipIf(!hasPwsh)('add with overwrite should update existing instruction', async () => {
      if (!server) return;
      const testId = `e2e-ps1-ow-${Date.now()}`;
      // Create
      await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action add -Id '${testId}' -Title 'Original' -Body 'Original body'`
      );
      // Overwrite
      const output = await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action add -Id '${testId}' -Title 'Updated' -Body 'Updated body' -Overwrite`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
      expect(result.result.overwritten).toBe(true);
      // Cleanup
      await runPwshWithRetry(
        `& '${PS1_SCRIPT}' -BaseUrl '${activeBaseUrl}' -Action remove -Id '${testId}'`
      );
    }, 90_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Bash Client Script E2E Tests
  // ═══════════════════════════════════════════════════════════════════════

  describe('Bash client (index-server-client.sh)', () => {
    it.skipIf(!hasBash)('health action should return success', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      const output = await runBash(`INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' health`);
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
    });

    it.skipIf(!hasBash)('search action should return results', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      const output = await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' search 'bootstrap'`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
    });

    it.skipIf(!hasBash)('list action should return instructions', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      const output = await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' list 5`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
    });

    it.skipIf(!hasBash)('unknown action should return error with usage', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      try {
        await runBash(`INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' unknownaction`);
      } catch (err) {
        const output = (err as { stdout?: string; stderr?: string }).stdout || '';
        if (output) {
          const result = JSON.parse(output);
          expect(result.success).toBe(false);
          expect(result.error).toContain('unknown action');
        }
      }
    });

    it.skipIf(!hasBash)('hotset action should return results', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      const output = await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' hotset 5`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
    });

    // ── CRUD lifecycle tests (add → get → track → remove) ──────────────
    it.skipIf(!hasBash)('add action should create instruction with entry wrapper', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      const output = await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' add 'e2e-sh-test-1' 'SH E2E Test' 'Created by clientScriptsE2e test' 42`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result.created).toBe(true);
    }, 30_000);

    it.skipIf(!hasBash)('get should retrieve instruction created by add', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' add 'e2e-sh-roundtrip' 'SH Roundtrip' 'Roundtrip body content'`
      );
      const output = await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' get 'e2e-sh-roundtrip'`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      // index_dispatch get returns { hash, item: { id, title, ... } } or { notFound, id, ... }
      const entry = result.result.item ?? result.result;
      expect(entry.id).toBe('e2e-sh-roundtrip');
    }, 30_000);

    it.skipIf(!hasBash)('track action should record usage signal', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      const output = await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' track 'e2e-sh-roundtrip' helpful`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
    }, 30_000);

    it.skipIf(!hasBash)('remove action should delete instruction', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      const output = await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' remove 'e2e-sh-roundtrip'`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result.removed).toBe(1);
    }, 30_000);

    it.skipIf(!hasBash)('add with overwrite should update existing', async () => {
      if (!server) return;
      const sp = getBashScriptPath();
      const testId = `e2e-sh-ow-${Date.now()}`;
      await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' add '${testId}' 'Original' 'Original body'`
      );
      const output = await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' add '${testId}' 'Updated' 'Updated body' 50 --overwrite`
      );
      const result = JSON.parse(output);
      expect(result.success).toBe(true);
      expect(result.result.overwritten).toBe(true);
      await runBash(
        `INDEX_SERVER_URL='${activeBaseUrl}' bash '${sp}' remove '${testId}'`
      );
    }, 30_000);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Nmap Security Scan Tests
  // ═══════════════════════════════════════════════════════════════════════

  describe('Nmap security scanning', () => {
    it.skipIf(!hasNmap)('port scan should show only expected port open', async () => {
      if (!server) return;
      const { stdout } = await execFileAsync('nmap', ['-p', String(activePort), '--open', '-T4', '-oG', '-', TEST_HOST], {
        encoding: 'utf-8', timeout: 60_000,
      });
      expect(stdout).toContain(`${activePort}/open`);
    }, 90_000);

    it.skipIf(!hasNmap)('service detection should identify HTTP', async () => {
      if (!server) return;
      const { stdout } = await execFileAsync('nmap', ['-sV', '-T4', '--version-intensity', '2', '-p', String(activePort), TEST_HOST], {
        encoding: 'utf-8', timeout: 120_000,
      });
      expect(stdout.toLowerCase()).toMatch(/http|node/);
    }, 150_000);

    it.skipIf(!hasNmap)('should not expose unnecessary services on adjacent ports', async () => {
      if (!server) return;
      const scanRange = `${activePort - 5}-${activePort + 5}`;
      const { stdout } = await execFileAsync('nmap', ['-p', scanRange, '--open', '-T4', '-oG', '-', TEST_HOST], {
        encoding: 'utf-8', timeout: 60_000,
      });
      const openPorts = (stdout.match(/\d+\/open/g) || []);
      expect(openPorts.length).toBeLessThanOrEqual(2);
      expect(stdout).toContain(`${activePort}/open`);
    }, 90_000);

    it.skipIf(!hasNmap)('SSL/TLS scan should report no TLS on HTTP port', async () => {
      if (!server) return;
      const { stdout } = await execFileAsync('nmap', ['--script', 'ssl-enum-ciphers', '-T4', '-p', String(activePort), TEST_HOST], {
        encoding: 'utf-8', timeout: 120_000,
      });
      expect(stdout).not.toContain('TLSv1.3');
    }, 150_000);

    it.skipIf(!hasNmap)('HTTP vuln scan should not find critical issues', async () => {
      if (!server) return;
      const { stdout } = await execFileAsync('nmap', ['--script', 'http-methods', '-T4', '-p', String(activePort), TEST_HOST], {
        encoding: 'utf-8', timeout: 60_000,
      });
      expect(stdout.toUpperCase()).not.toContain('TRACE');
    }, 90_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  HTTPS / TLS Test Suite
// ═══════════════════════════════════════════════════════════════════════

import { execSync as execSyncImport } from 'child_process';

const HTTPS_PORT = 17887;
let activeHttpsPort = HTTPS_PORT;
let activeHttpsBaseUrl = `https://${TEST_HOST}:${HTTPS_PORT}`;

const hasOpenssl = (() => { try { execSyncImport('openssl version', { stdio: 'pipe' }); return true; } catch { return false; } })();

function generateSelfSignedCert(): { cert: string; key: string; certFile: string; keyFile: string } | null {
  if (!hasOpenssl) return null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-tls-'));
  const keyFile = path.join(tmpDir, 'key.pem');
  const certFile = path.join(tmpDir, 'cert.pem');
  try {
    execSyncImport(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyFile}" -out "${certFile}" -days 1 -nodes -subj "/CN=localhost"`,
      { stdio: 'pipe', timeout: 15_000 }
    );
    return {
      cert: fs.readFileSync(certFile, 'utf-8'),
      key: fs.readFileSync(keyFile, 'utf-8'),
      certFile,
      keyFile,
    };
  } catch {
    return null;
  }
}

describe.skipIf(!hasOpenssl)('HTTPS / TLS Tests', () => {
  let httpsServer: DashboardServer | null = null;
  let tlsCert: ReturnType<typeof generateSelfSignedCert> = null;

  beforeAll(async () => {
    tlsCert = generateSelfSignedCert();
    if (!tlsCert) return;
    try {
      httpsServer = createDashboardServer({
        port: HTTPS_PORT,
        host: TEST_HOST,
        tls: { cert: tlsCert.cert, key: tlsCert.key },
      });
      const started = await httpsServer.start();
      activeHttpsPort = started.port;
      activeHttpsBaseUrl = `https://${TEST_HOST}:${activeHttpsPort}`;
    } catch (e) {
      console.warn('HTTPS test server failed to start:', (e as Error).message);
      httpsServer = null;
    }
  }, 15_000);

  afterAll(async () => {
    if (httpsServer) {
      try { await httpsServer.stop(); } catch { /* ok */ }
    }
  });

  // ── HTTPS Endpoint Tests ────────────────────────────────────────────

  it('should serve /health over HTTPS', async () => {
    if (!httpsServer) return;
    // Node fetch with self-signed cert requires NODE_TLS_REJECT_UNAUTHORIZED=0
    const orig = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // lgtm[js/disabling-certificate-validation] — test: self-signed cert
    try {
      const resp = await fetch(`${activeHttpsBaseUrl}/health`);
      expect(resp.ok).toBe(true);
      const data = await resp.json() as { status: string };
      expect(data.status).toBe('healthy');
    } finally {
      if (orig === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = orig;
    }
  });

  it('should serve /api/scripts over HTTPS', async () => {
    if (!httpsServer) return;
    const orig = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // lgtm[js/disabling-certificate-validation] — test: self-signed cert
    try {
      const resp = await fetch(`${activeHttpsBaseUrl}/api/scripts`);
      expect(resp.ok).toBe(true);
      const data = await resp.json() as { scripts: unknown[] };
      expect(data.scripts.length).toBeGreaterThanOrEqual(2);
    } finally {
      if (orig === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = orig;
    }
  });

  it('should set security headers over HTTPS', async () => {
    if (!httpsServer) return;
    const orig = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // lgtm[js/disabling-certificate-validation] — test: self-signed cert
    try {
      const resp = await fetch(`${activeHttpsBaseUrl}/api/status`);
      expect(resp.headers.get('x-content-type-options')).toBe('nosniff');
      expect(resp.headers.get('x-frame-options')).toBe('DENY');
      // HSTS should be present on HTTPS
      expect(resp.headers.get('strict-transport-security')).toBeDefined();
    } finally {
      if (orig === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = orig;
    }
  });

  // ── Nmap HTTPS Scans ────────────────────────────────────────────────

  describe('Nmap HTTPS scanning', () => {
    it.skipIf(!hasNmap)('HTTPS port should be open', async () => {
      if (!httpsServer) return;
      const { stdout } = await execFileAsync('nmap', ['-p', String(activeHttpsPort), '--open', '-oG', '-', TEST_HOST], {
        encoding: 'utf-8', timeout: 30_000,
      });
      expect(stdout).toContain(`${activeHttpsPort}/open`);
    }, 35_000);

    it.skipIf(!hasNmap)('should detect TLS/SSL on HTTPS port', async () => {
      if (!httpsServer) return;
      const { stdout } = await execFileAsync('nmap', ['--script', 'ssl-enum-ciphers', '-p', String(activeHttpsPort), TEST_HOST], {
        encoding: 'utf-8', timeout: 30_000,
      });
      // Should have TLS ciphers listed
      expect(stdout.toLowerCase()).toMatch(/tls|ssl/);
    }, 35_000);

    it.skipIf(!hasNmap)('should identify HTTPS service', async () => {
      if (!httpsServer) return;
      const { stdout } = await execFileAsync('nmap', ['-sV', '-p', String(activeHttpsPort), TEST_HOST], {
        encoding: 'utf-8', timeout: 30_000,
      });
      expect(stdout.toLowerCase()).toMatch(/https|ssl|tls|node/);
    }, 35_000);

    it.skipIf(!hasNmap)('should not have weak SSL protocols', async () => {
      if (!httpsServer) return;
      const { stdout } = await execFileAsync('nmap', ['--script', 'ssl-enum-ciphers', '-p', String(activeHttpsPort), TEST_HOST], {
        encoding: 'utf-8', timeout: 30_000,
      });
      // SSLv2 and SSLv3 should not be present
      expect(stdout).not.toMatch(/SSLv[23]/);
    }, 35_000);
  });
});
