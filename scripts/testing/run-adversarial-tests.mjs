#!/usr/bin/env node
/**
 * Adversarial CRUD test workflow.
 * Starts an isolated dashboard server, runs the adversarial test suite,
 * captures findings, and produces a structured report.
 *
 * Usage:
  *   node scripts/run-adversarial-tests.mjs [--port 9898] [--keep-server]
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = test failures detected
 *   2 = infrastructure failure (server didn't start, etc.)
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CWD = process.cwd();
const DEFAULT_PORT = '8787';
const SPEC_FILE = 'tests/playwright/crud-adversarial.spec.ts';
const REPORT_FILE = 'test-artifacts/adversarial-report.json';
const RAW_STDOUT_FILE = 'test-artifacts/adversarial-playwright.stdout.txt';
const RAW_STDERR_FILE = 'test-artifacts/adversarial-playwright.stderr.txt';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { port: DEFAULT_PORT, keepServer: false, timeout: 20000 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') opts.port = args[++i];
    else if (args[i] === '--keep-server') opts.keepServer = true;
    else if (args[i] === '--timeout') opts.timeout = parseInt(args[++i], 10) || opts.timeout;
  }
  return opts;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForServer(port, timeoutMs) {
  const start = Date.now();
  const url = `http://127.0.0.1:${port}/`;
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise(res => {
      const req = http.get(url, { timeout: 2000 }, r => {
        r.resume();
        res(r.statusCode < 500);
      });
      req.on('error', () => res(false));
      req.on('timeout', () => { req.destroy(); res(false); });
    });
    if (ok) return true;
    await wait(400);
  }
  return false;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseJsonReporter(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const first = stdout.indexOf('{');
    const last = stdout.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(stdout.slice(first, last + 1));
    }
    throw new Error('No JSON object found in Playwright stdout');
  }
}

async function main() {
  const opts = parseArgs();
  const reportDir = path.dirname(REPORT_FILE);
  ensureDir(reportDir);
  ensureDir(path.join(CWD, 'test-artifacts', 'adversarial-instructions'));

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Adversarial CRUD Test Workflow                      ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Port:      ${opts.port}`);
  console.log(`  Spec:      ${SPEC_FILE}`);
  console.log(`  Report:    ${REPORT_FILE}`);
  console.log('');

  // ─── Step 1: Start isolated dashboard server ─────────────────────────
  console.log('[1/4] Starting isolated dashboard server...');
  const serverEnv = {
    ...process.env,
    INDEX_SERVER_DASHBOARD: '1',
    INDEX_SERVER_DASHBOARD_PORT: opts.port,
    INDEX_SERVER_DIR: path.join(CWD, 'test-artifacts', 'adversarial-instructions'),
    INDEX_SERVER_LOG_LEVEL: 'warn',
  };

  const server = spawn(process.execPath, ['dist/server/index-server.js', '--dashboard', `--dashboard-port=${opts.port}`, '--dashboard-host=127.0.0.1'], {
    env: serverEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: CWD,
  });

  let serverOutput = '';
  server.stdout.on('data', d => { serverOutput += d.toString(); });
  server.stderr.on('data', d => { serverOutput += d.toString(); });

  let serverExited = false;
  server.on('exit', (code) => {
    serverExited = true;
    if (code !== null && code !== 0) {
      console.error(`[ERROR] Server exited with code ${code}`);
    }
  });

  const ready = await waitForServer(opts.port, opts.timeout);
  if (!ready || serverExited) {
    console.error('[FATAL] Server failed to start within timeout.');
    console.error('Server output:', serverOutput.slice(-500));
    if (!server.killed) server.kill('SIGKILL');
    process.exit(2);
  }
  console.log(`[1/4] Server ready on http://127.0.0.1:${opts.port}`);

  // ─── Step 2: Run Playwright adversarial tests ────────────────────────
  console.log('[2/4] Running adversarial test suite...');
  const pwEnv = {
    ...process.env,
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${opts.port}`,
  };

  const playwrightCli = path.join(CWD, 'node_modules', '@playwright', 'test', 'cli.js');
  const pwCommand = process.execPath;
  const pwArgs = [playwrightCli, 'test', SPEC_FILE, '--project', 'chromium', '--reporter', 'json'];
  const pw = spawn(pwCommand, pwArgs, {
    env: pwEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: CWD,
  });

  let pwStdout = '';
  let pwStderr = '';
  pw.stdout.on('data', d => { pwStdout += d.toString(); });
  pw.stderr.on('data', d => { pwStderr += d.toString(); });

  const pwExitCode = await new Promise(res => pw.on('exit', res));
  console.log(`[2/4] Playwright exited with code ${pwExitCode}`);
  fs.writeFileSync(path.join(CWD, RAW_STDOUT_FILE), pwStdout);
  fs.writeFileSync(path.join(CWD, RAW_STDERR_FILE), pwStderr);

  // ─── Step 3: Parse results and extract findings ──────────────────────
  console.log('[3/4] Parsing test results and findings...');
  let report;
  try {
    report = parseJsonReporter(pwStdout);
  } catch (err) {
    console.warn('[WARN] Could not parse JSON reporter output. Using stderr fallback.');
    console.warn(`[WARN] ${err.message}`);
    if (pwStderr.trim()) console.warn(pwStderr.trim().slice(-2000));
    report = { errors: [pwStderr.slice(0, 2000)] };
  }

  // Extract findings from stderr (console.warn/error lines with [FINDING] or [CRITICAL])
  const findingLines = pwStderr.split('\n').filter(l =>
    /\[FINDING\]|\[CRITICAL|\[INFO\]/.test(l)
  );

  const findings = findingLines.map(line => {
    const severity = /CRITICAL/.test(line) ? 'critical' :
                     /FINDING/.test(line) ? 'medium' : 'info';
    return { severity, message: line.replace(/^\s*\[.*?\]\s*/, '').trim() };
  });

  const summary = {
    timestamp: new Date().toISOString(),
    port: opts.port,
    specFile: SPEC_FILE,
    exitCode: pwExitCode,
    totalTests: (report?.stats?.expected ?? 0) + (report?.stats?.unexpected ?? 0) + (report?.stats?.skipped ?? 0) + (report?.stats?.flaky ?? 0),
    passed: report?.stats?.expected ?? 0,
    failed: report?.stats?.unexpected ?? 0,
    skipped: report?.stats?.skipped ?? 0,
    findings,
    findingsCount: findings.length,
  };

  // ─── Step 4: Write report and shut down ──────────────────────────────
  console.log('[4/4] Writing report and cleaning up...');
  fs.writeFileSync(path.join(CWD, REPORT_FILE), JSON.stringify(summary, null, 2));

  if (!opts.keepServer && !server.killed) {
    server.kill('SIGTERM');
    await wait(1000);
    if (!server.killed) server.kill('SIGKILL');
  }

  // ─── Final output ────────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Results: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`);
  console.log(`  Findings: ${summary.findingsCount}`);
  if (findings.length > 0) {
    console.log('  ────────────────────────────────────────────');
    for (const f of findings) {
      const icon = f.severity === 'critical' ? '🔴' : f.severity === 'medium' ? '🟡' : 'ℹ️';
      console.log(`  ${icon} [${f.severity.toUpperCase()}] ${f.message}`);
    }
  }
  console.log(`  Report: ${REPORT_FILE}`);
  console.log('══════════════════════════════════════════════════════════');

  process.exit(pwExitCode === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(2);
});
