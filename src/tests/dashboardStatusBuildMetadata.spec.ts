/**
 * Build metadata on GET /api/status must be resolved from the *installation
 * this code runs from*, never from `process.cwd()`.
 *
 * The server is normally launched as
 *   node <install>/dist/server/index-server.js
 * by an MCP client whose working directory is an unrelated project folder. The
 * cwd-relative implementation therefore reported `buildTime: undefined` (the
 * dashboard rendered "Built unknown") and read `<cwd>/.git/HEAD`, so the commit
 * badge showed whatever repo the client happened to be sitting in — a wrong
 * answer presented as a confident one.
 *
 * These tests run the route with cwd pointed at an empty temp directory, which
 * is exactly the production condition.
 */
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStatusRoutes } from '../dashboard/server/routes/status.routes.js';
import type { MetricsCollector } from '../dashboard/server/MetricsCollector.js';

/** Minimal snapshot shape consumed by the /status handler. */
function stubCollector(): MetricsCollector {
  return {
    getCurrentSnapshot: () => ({
      server: { version: '9.9.9-test', uptime: 1234, startTime: Date.now() - 1234 },
    }),
  } as unknown as MetricsCollector;
}

interface Started { url: string; close: () => Promise<void> }

async function startServer(): Promise<Started> {
  const app = express();
  app.use('/api', createStatusRoutes(stubCollector()));
  const server = await new Promise<import('http').Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

const originalCwd = process.cwd();
let tempCwd: string | null = null;

afterEach(() => {
  process.chdir(originalCwd);
  if (tempCwd) {
    try { fs.rmSync(tempCwd, { recursive: true, force: true }); } catch { /* best effort */ }
    tempCwd = null;
  }
});

/** Move cwd somewhere with no dist/, no package.json and no .git. */
function chdirToEmptyDir(): string {
  tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-cwd-'));
  process.chdir(tempCwd);
  return tempCwd;
}

describe('GET /api/status build metadata', () => {
  it('reports a build time when cwd is unrelated to the installation', async () => {
    chdirToEmptyDir();
    const srv = await startServer();
    try {
      const body = await (await fetch(`${srv.url}/api/status`)).json();
      expect(body.status).toBe('online');
      expect(body.buildTime, 'buildTime must not be missing — the UI renders it as "unknown"').toBeTruthy();
      // Must be a parseable ISO timestamp, not a placeholder string.
      expect(Number.isNaN(Date.parse(body.buildTime))).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('does not report a commit borrowed from whatever repo cwd points at', async () => {
    // A decoy repo at cwd. The old implementation read this and presented it as
    // the running build's commit.
    const dir = chdirToEmptyDir();
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'deadbeefcafe0000000000000000000000000000\n'); // pii-allowlist: dummy test fixture, not a real cert thumbprint

    const srv = await startServer();
    try {
      const body = await (await fetch(`${srv.url}/api/status`)).json();
      expect(body.build).not.toBe('deadbeefcafe');
    } finally {
      await srv.close();
    }
  });

  it('reports the commit of the installation it is actually running from', async () => {
    chdirToEmptyDir();
    const srv = await startServer();
    try {
      const body = await (await fetch(`${srv.url}/api/status`)).json();
      // This checkout has a .git, so the route should surface its HEAD.
      const head = fs.readFileSync(path.join(originalCwd, '.git', 'HEAD'), 'utf8').trim();
      const sha = head.startsWith('ref:')
        ? fs.readFileSync(path.join(originalCwd, '.git', head.split(' ')[1]), 'utf8').trim()
        : head;
      expect(body.build).toBe(sha.substring(0, 12));
    } finally {
      await srv.close();
    }
  });

  it('still serves status when cwd no longer exists at all', async () => {
    const dir = chdirToEmptyDir();
    const srv = await startServer();
    try {
      // Deleting the process cwd is legal on POSIX and makes any cwd-relative
      // fs call throw. Nothing in the status path should care.
      if (process.platform !== 'win32') {
        process.chdir(originalCwd);
        fs.rmSync(dir, { recursive: true, force: true });
        tempCwd = null;
      }
      const body = await (await fetch(`${srv.url}/api/status`)).json();
      expect(body.buildTime).toBeTruthy();
    } finally {
      await srv.close();
    }
  });
});
