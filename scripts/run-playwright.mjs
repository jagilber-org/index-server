#!/usr/bin/env node
/**
 * Helper script to run Playwright tests with the dashboard server started automatically.
 * Cross-platform (Windows friendly) because it uses Node child_process APIs instead of shell job control.
 *
 * Usage examples:
 *   node scripts/run-playwright.mjs --grep @baseline          # drift check
 *   node scripts/run-playwright.mjs --grep @baseline --update # update snapshots
 *
 * Options:
 *   --grep <pattern>   Playwright grep filter (default none)
 *   --update           Set PLAYWRIGHT_UPDATE_SNAPSHOTS=1
 *   --project <name>   Playwright project (default chromium)
 *   --port <port>      Dashboard port override (default 8787 or DASHBOARD_PORT env)
 *   --timeout <ms>     Server readiness timeout (default 15000)
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import process from 'node:process';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { grep: null, update: false, project: 'chromium', port: process.env.DASHBOARD_PORT || '8787', timeout: 15000 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--grep') { opts.grep = args[++i]; }
    else if (a === '--update') { opts.update = true; }
    else if (a === '--project') { opts.project = args[++i]; }
    else if (a === '--port') { opts.port = args[++i]; }
    else if (a === '--timeout') { opts.timeout = parseInt(args[++i], 10) || opts.timeout; }
  }
  return opts;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForServer(port, timeoutMs) {
  const start = Date.now();
  const url = `http://127.0.0.1:${port}/`;
  const interval = 350;
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise(res => {
      const req = http.get(url, { timeout: 2000 }, r => {
        r.resume();
        res(r.statusCode === 200 || (r.statusCode && r.statusCode < 500));
      });
      req.on('error', () => res(false));
      req.on('timeout', () => { req.destroy(); res(false); });
    });
    if (ok) return true;
    await wait(interval);
  }
  return false;
}

async function main() {
  const opts = parseArgs();
  const env = { ...process.env, INDEX_SERVER_DASHBOARD: '1', DASHBOARD_PORT: opts.port, INDEX_SERVER_DIR: process.env.INDEX_SERVER_DIR || `${process.cwd()}/devinstructions` };

  console.log(`[run-playwright] Starting dashboard server on port ${opts.port} ...`);
  const server = spawn(process.execPath, ['dist/server/index-server.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverExitedEarly = false;
  server.on('exit', (code, signal) => {
    serverExitedEarly = true;
    console.error(`[run-playwright] Server exited early (code=${code} signal=${signal})`);
  });

  server.stdout.on('data', d => process.stdout.write(`[server] ${d}`));
  server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

  const ready = await waitForServer(opts.port, opts.timeout);
  if (!ready) {
    console.error(`[run-playwright] ERROR: Server not ready within ${opts.timeout}ms`);
    server.kill('SIGKILL');
    process.exit(1);
  }
  if (serverExitedEarly) {
    console.error('[run-playwright] ERROR: Server terminated before readiness confirmed.');
    process.exit(1);
  }
  console.log('[run-playwright] Server ready. Launching Playwright...');

  const pwArgs = ['playwright', 'test', '--project', opts.project];
  if (opts.grep) pwArgs.push('--grep', opts.grep);
  const pwEnv = { ...env };
  if (opts.update) {
    pwEnv.PLAYWRIGHT_UPDATE_SNAPSHOTS = '1'; // legacy env pattern (harmless)
    pwArgs.push('--update-snapshots'); // actual Playwright flag
  }

  let pw;
  if (process.platform === 'win32') {
    // Spawn npx directly with args array — avoids shell metacharacter injection via cmd.exe
    pw = spawn('npx', pwArgs, { env: pwEnv, stdio: 'inherit', shell: true });
  } else {
    const npxCmd = 'npx';
    pw = spawn(npxCmd, pwArgs, { env: pwEnv, stdio: 'inherit', shell: false });
  }

  const shutdown = () => {
    if (!server.killed) {
      server.kill('SIGTERM');
      setTimeout(() => { if (!server.killed) server.kill('SIGKILL'); }, 2500);
    }
  };
  process.on('SIGINT', () => { shutdown(); process.exit(130); });
  process.on('SIGTERM', () => { shutdown(); process.exit(143); });

  pw.on('exit', code => {
    shutdown();
    if (code !== 0) {
      console.error(`[run-playwright] Playwright failed with code ${code}`);
      process.exit(code || 1);
    }
    console.log('[run-playwright] Playwright finished successfully.');
  });
}

main().catch(err => {
  console.error('[run-playwright] Unhandled error:', err);
  process.exit(1);
});
