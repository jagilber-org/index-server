/**
 * Tests for scripts/crawl-logs.mjs — the NDJSON log hygiene gate.
 *
 * The script is intentionally CLI-only; we exercise it via spawnSync so
 * the test harness covers the same surface CI uses.
 *
 * Constitution alignment:
 *   - TS-12: ≥5 scenarios for a bug-prone gate (this file ships 6).
 *   - maxTestDurationMs 5000: each case writes a tiny tmp NDJSON and shells out.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'diagnostics', 'crawl-logs.mjs');

let tmpDir: string;

function writeLog(name: string, lines: object[]) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return p;
}

function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crawl-logs-test-'));
});
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('crawl-logs.mjs', () => {
  it('1) reports counts and exits 0 on a clean log under --strict', () => {
    writeLog('clean.log', [
      { ts: '2026-05-01T00:00:00Z', level: 'INFO', msg: 'startup ok', pid: 1 },
      { ts: '2026-05-01T00:00:01Z', level: 'INFO', msg: 'ready', pid: 1 },
    ]);
    const r = run(['--dir', tmpDir, '--json', '--strict']);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.levelCounts.INFO).toBe(2);
    expect(report.violations).toEqual([]);
  });

  it('2) flags a single signature exceeding --max-repeat as a violation under --strict', () => {
    const lines: object[] = [];
    for (let i = 0; i < 50; i++) {
      lines.push({ ts: '2026-05-01T00:00:00Z', level: 'WARN', msg: `[invariant-repair] firstSeenTs repair exhausted — no source found for id-${i}`, pid: 1 });
    }
    writeLog('warn.log', lines);
    const r = run(['--dir', tmpDir, '--json', '--strict', '--max-repeat', '10']);
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout);
    const repeat = report.violations.find((v: { rule: string }) => v.rule === 'max-repeat');
    expect(repeat).toBeDefined();
    expect(repeat.offenders[0].count).toBe(50);
  });

  it('3) collapses volatile substrings (ids/numbers) into one signature', () => {
    const lines: object[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push({ level: 'WARN', msg: `failed to fetch entry ${i} at 2026-05-01T00:00:00Z`, pid: 1 });
    }
    writeLog('volatile.log', lines);
    const r = run(['--dir', tmpDir, '--json']);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.uniqueWarnSignatures).toBe(1);
    expect(report.topWarns[0].count).toBe(20);
  });

  it('4) detects WARN entries carrying a JS stack trace via the detail field', () => {
    const stack = 'Error: boom\n    at fn (file:///foo/bar.js:10:5)\n    at next (file:///foo/baz.js:20:3)';
    const lines: object[] = [];
    for (let i = 0; i < 8; i++) {
      lines.push({ level: 'WARN', msg: '[storage] Auto-migration failed:', detail: stack, pid: 1 });
    }
    writeLog('stack.log', lines);
    const r = run(['--dir', tmpDir, '--json', '--strict', '--max-stack-warn', '3', '--max-repeat', '99']);
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.stackTracesAtWarn).toBe(8);
    const stackV = report.violations.find((v: { rule: string }) => v.rule === 'max-stack-warn');
    expect(stackV).toBeDefined();
    expect(stackV.threshold).toBe(3);
  });

  it('5) honours an allowlist regex (signature still counted but excluded from violations)', () => {
    const lines: object[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push({ level: 'WARN', msg: `[storage] EXPERIMENTAL: SQLite backend is enabled. id-${i}`, pid: 1 });
    }
    writeLog('experimental.log', lines);
    const allowlist = path.join(tmpDir, 'allow.txt');
    fs.writeFileSync(allowlist, 'EXPERIMENTAL: SQLite backend\n');
    const r = run(['--dir', tmpDir, '--json', '--strict', '--max-repeat', '5', '--allowlist', allowlist]);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.violations).toEqual([]);
    expect(report.topWarns[0].allowlisted).toBe(true);
  });

  it('6) tags known chronic patterns even when input is plain-text (non-NDJSON)', () => {
    const file = path.join(tmpDir, 'plain.log');
    fs.writeFileSync(file, [
      'some random non-json line',
      'Error: listen EADDRINUSE: address already in use 0.0.0.0:8687',
      '[storage] Auto-migration failed: Error: oops',
      'write EPIPE',
    ].join('\n'), 'utf8');
    const r = run(['--dir', tmpDir, '--json']);
    expect(r.status).toBe(0);
    const report = JSON.parse(r.stdout);
    const tags = new Set(report.knownPatternHits.map((h: { tag: string }) => h.tag));
    expect(tags.has('PORT_COLLISION')).toBe(true);
    expect(tags.has('AUTO_MIGRATION_FAIL')).toBe(true);
    expect(tags.has('BROKEN_PIPE')).toBe(true);
  });
});
