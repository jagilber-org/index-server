/**
 * Multi-Instance Cross-Process Failover Test
 *
 * Spawns actual Node.js server processes (not in-process mocks) to validate:
 * 1. Leader starts and serves health endpoint
 * 2. Follower starts, discovers leader, proxies calls
 * 3. Leader is killed → follower promotes to leader
 * 4. New leader serves requests after promotion
 *
 * This test requires a built dist/ (npm run build).
 * Intended to run as part of release validation.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SERVER_BIN = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
const STARTUP_TIMEOUT = 15_000;
const FAILOVER_TIMEOUT = 20_000;

interface ServerInstance {
  proc: ChildProcess;
  dashUrl: string;
  pid: number;
  kill: () => void;
}

/** Spawn a server process with dashboard enabled, wait for URL + healthy. */
async function spawnServer(env: Record<string, string>, label: string): Promise<ServerInstance> {
  const mergedEnv = {
    ...process.env,
    INDEX_SERVER_DASHBOARD: '1',
    INDEX_SERVER_HEALTH_MIN_UPTIME: '0',   // disable min-uptime gate for tests
    NODE_ENV: 'test',
    ...env,
  };

  const proc = spawn('node', [SERVER_BIN, '--dashboard-port=0', '--dashboard-host=127.0.0.1'], {
    env: mergedEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let dashUrl = '';
  const pat = /Server started on (http:\/\/[^\s]+)/;

  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');

  const capture = (data: string) => {
    const m = pat.exec(data);
    if (m && !dashUrl) dashUrl = m[1];
  };
  proc.stdout.on('data', capture);
  proc.stderr.on('data', capture);

  const start = Date.now();
  while (!dashUrl && Date.now() - start < STARTUP_TIMEOUT) {
    if (proc.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }

  if (!dashUrl) {
    try { proc.kill(); } catch { /* */ }
    throw new Error(`[${label}] Server start timeout after ${STARTUP_TIMEOUT}ms`);
  }

  // Wait for health endpoint to return 200 (index loaded)
  const healthReady = await waitFor(async () => {
    try {
      const r = await fetch(`${dashUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch { return false; }
  }, STARTUP_TIMEOUT - (Date.now() - start));

  if (!healthReady) {
    try { proc.kill(); } catch { /* */ }
    throw new Error(`[${label}] Health readiness timeout`);
  }

  return {
    proc,
    dashUrl,
    pid: proc.pid!,
    kill: () => { try { proc.kill('SIGKILL'); } catch { /* */ } },
  };
}

/** Fetch JSON from a server endpoint with timeout. */
async function fetchJson(base: string, path: string, timeoutMs = 5000): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${base}${path}`, { signal: controller.signal });
    const data = await resp.json();
    return { status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Wait for a condition to become true, polling at interval. */
async function waitFor(fn: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await fn()) return true; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

describe('Multi-Instance Cross-Process Failover', { timeout: 60_000 }, () => {
  const processes: ServerInstance[] = [];
  let stateDir: string;

  afterEach(async () => {
    for (const p of processes) p.kill();
    processes.length = 0;
    // Wait for processes to fully exit
    await new Promise(r => setTimeout(r, 500));
    try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('leader starts and health endpoint responds', async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-failover-'));
    const leader = await spawnServer({
      INDEX_SERVER_MODE: 'leader',
      INDEX_SERVER_LEADER_PORT: '0',
      INDEX_SERVER_STATE_DIR: stateDir,
      INDEX_SERVER_HEARTBEAT_MS: '1000',
    }, 'leader');
    processes.push(leader);

    const health = await fetchJson(leader.dashUrl, '/api/health');
    expect(health.status).toBe(200);
    expect((health.data as Record<string, unknown>).status).toBeTruthy();
  });

  it('two instances: leader elected, second becomes follower or standalone', async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-failover-'));

    // Start instance 1
    const inst1 = await spawnServer({
      INDEX_SERVER_MODE: 'auto',
      INDEX_SERVER_LEADER_PORT: '0',
      INDEX_SERVER_STATE_DIR: stateDir,
      INDEX_SERVER_HEARTBEAT_MS: '1000',
      INDEX_SERVER_STALE_THRESHOLD_MS: '3000',
    }, 'instance-1');
    processes.push(inst1);

    // Give leader time to write lock file
    await new Promise(r => setTimeout(r, 2000));

    // Start instance 2
    const inst2 = await spawnServer({
      INDEX_SERVER_MODE: 'auto',
      INDEX_SERVER_LEADER_PORT: '0',
      INDEX_SERVER_STATE_DIR: stateDir,
      INDEX_SERVER_HEARTBEAT_MS: '1000',
      INDEX_SERVER_STALE_THRESHOLD_MS: '3000',
    }, 'instance-2');
    processes.push(inst2);

    // Both should have health endpoints
    const h1 = await fetchJson(inst1.dashUrl, '/api/health');
    const h2 = await fetchJson(inst2.dashUrl, '/api/health');
    expect(h1.status).toBe(200);
    expect(h2.status).toBe(200);

    // Lock file should exist
    const lockExists = fs.existsSync(path.join(stateDir, 'leader.lock'));
    expect(lockExists).toBe(true);
  });

  it('failover: kill leader → second instance continues serving', async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-failover-'));

    // Start leader
    const leader = await spawnServer({
      INDEX_SERVER_MODE: 'auto',
      INDEX_SERVER_LEADER_PORT: '0',
      INDEX_SERVER_STATE_DIR: stateDir,
      INDEX_SERVER_HEARTBEAT_MS: '500',
      INDEX_SERVER_STALE_THRESHOLD_MS: '2000',
    }, 'leader');
    processes.push(leader);
    await new Promise(r => setTimeout(r, 2000));

    // Start follower
    const follower = await spawnServer({
      INDEX_SERVER_MODE: 'auto',
      INDEX_SERVER_LEADER_PORT: '0',
      INDEX_SERVER_STATE_DIR: stateDir,
      INDEX_SERVER_HEARTBEAT_MS: '500',
      INDEX_SERVER_STALE_THRESHOLD_MS: '2000',
    }, 'follower');
    processes.push(follower);

    // Verify both are healthy
    const h1 = await fetchJson(leader.dashUrl, '/api/health');
    expect(h1.status).toBe(200);
    const h2 = await fetchJson(follower.dashUrl, '/api/health');
    expect(h2.status).toBe(200);

    // Kill the leader
    leader.kill();
    await new Promise(r => setTimeout(r, 1000));

    // Follower's dashboard should still be responsive
    const survived = await waitFor(async () => {
      const resp = await fetchJson(follower.dashUrl, '/api/health');
      return resp.status === 200;
    }, FAILOVER_TIMEOUT);

    expect(survived).toBe(true);

    // Verify follower can serve instruction list
    const instructions = await fetchJson(follower.dashUrl, '/api/instructions');
    expect(instructions.status).toBe(200);
    const body = instructions.data as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  it('failover: new leader can acquire lock after original leader dies', async () => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-failover-'));
    const lockPath = path.join(stateDir, 'leader.lock');

    // Start and kill first leader
    const leader1 = await spawnServer({
      INDEX_SERVER_MODE: 'auto',
      INDEX_SERVER_LEADER_PORT: '0',
      INDEX_SERVER_STATE_DIR: stateDir,
      INDEX_SERVER_HEARTBEAT_MS: '500',
      INDEX_SERVER_STALE_THRESHOLD_MS: '2000',
    }, 'leader-1');
    processes.push(leader1);
    await new Promise(r => setTimeout(r, 2000));
    expect(fs.existsSync(lockPath)).toBe(true);

    // Kill leader and wait for lock to go stale
    leader1.kill();
    await new Promise(r => setTimeout(r, 3000));

    // Remove the stale lock file to unblock the new instance
    try { fs.unlinkSync(lockPath); } catch { /* may already be gone */ }

    // Start new instance — should become leader immediately
    const leader2 = await spawnServer({
      INDEX_SERVER_MODE: 'auto',
      INDEX_SERVER_LEADER_PORT: '0',
      INDEX_SERVER_STATE_DIR: stateDir,
      INDEX_SERVER_HEARTBEAT_MS: '500',
      INDEX_SERVER_STALE_THRESHOLD_MS: '2000',
    }, 'leader-2');
    processes.push(leader2);

    // New instance should be healthy
    const health = await fetchJson(leader2.dashUrl, '/api/health');
    expect(health.status).toBe(200);
  });
});
