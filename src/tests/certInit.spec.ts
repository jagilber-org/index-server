/**
 * Integration tests for `runCertInit`: actually shell out to OpenSSL when it
 * is available on PATH and verify the produced files.
 *
 * Cases gated on openssl availability use `it.skipIf(!opensslAvailable)` —
 * mirrors the pattern already established in src/tests/dashboardTls.spec.ts.
 *
 * Constitution refs:
 * - TS-12: 7+ cases when openssl is available; gating preserves green CI on
 *   minimal images.
 * - TS-10: tests call the real production `runCertInit` (no toy reimplementation).
 * - SH-4: re-exercises the path-traversal guard end-to-end through runCertInit.
 * - SH-6: never sets `rejectUnauthorized: false` in this suite — generated
 *   certs are inspected via `openssl x509 -text`, not over a TLS connection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';

import { runCertInit, validateOptions } from '../server/certInit';
import { CertInitError } from '../server/certInit.types';

// ── openssl availability detection ────────────────────────────────────────

let opensslAvailable = false;
let opensslSkipReason = 'openssl not detected';
try {
  const probe = spawnSync('openssl', ['version'], { stdio: 'pipe', timeout: 5000 });
  if (probe.status === 0) {
    opensslAvailable = true;
  } else {
    opensslSkipReason = `openssl probe exited with status ${probe.status}`;
  }
} catch (e) {
  opensslSkipReason = `openssl probe threw: ${(e instanceof Error) ? e.message : String(e)}`;
}

// Emit a single visible breadcrumb so a green-skip in CI is unambiguous.

console.log(`[certInit.spec] opensslAvailable=${opensslAvailable} reason="${opensslSkipReason}"`);

// ── shared tmp dir for the suite ──────────────────────────────────────────

let suiteDir = '';
beforeAll(() => {
  suiteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cert-init-int-'));
});
afterAll(() => {
  if (suiteDir && fs.existsSync(suiteDir)) {
    fs.rmSync(suiteDir, { recursive: true, force: true });
  }
});

function freshCertDir(label: string): string {
  const d = path.join(suiteDir, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function defaultOpts(certDir: string) {
  return validateOptions({
    certDir,
    certFile: path.join(certDir, 'index-server.crt'),
    keyFile: path.join(certDir, 'index-server.key'),
    cn: 'localhost',
    san: 'DNS:localhost,IP:127.0.0.1',
    days: 1,
    keyBits: 2048,
    force: false,
    printEnv: false,
  });
}

// ── 1. Real generation produces parseable cert ────────────────────────────

describe('certInit / integration (openssl-gated)', () => {
  it.skipIf(!opensslAvailable)('produces a cert file that openssl x509 can re-parse with the requested CN and SAN', async () => {
    const certDir = freshCertDir('parse');
    const opts = defaultOpts(certDir);
    const result = await runCertInit(opts);
    expect(result.kind).toBe('generated');
    expect(fs.existsSync(opts.certFile)).toBe(true);
    expect(fs.existsSync(opts.keyFile)).toBe(true);

    const text = execFileSync('openssl', ['x509', '-in', opts.certFile, '-noout', '-text'], { encoding: 'utf8' });
    // OpenSSL formats subject as "CN=localhost" (older) or "CN = localhost" (newer); accept both.
    expect(text).toMatch(/CN\s*=\s*localhost/);
    expect(text).toContain('DNS:localhost');
    expect(text).toContain('IP Address:127.0.0.1');
  });

  it.skipIf(!opensslAvailable)('skipped result returned when files already exist and force=false', async () => {
    const certDir = freshCertDir('skip');
    const opts = defaultOpts(certDir);
    const first = await runCertInit(opts);
    expect(first.kind).toBe('generated');

    const before = fs.statSync(opts.certFile);
    const second = await runCertInit(opts);
    expect(second.kind).toBe('skipped');
    if (second.kind === 'skipped') {
      expect(second.certFile).toBe(opts.certFile);
      expect(second.keyFile).toBe(opts.keyFile);
    }
    const after = fs.statSync(opts.certFile);
    // mtime must not have advanced
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it.skipIf(!opensslAvailable)('force=true overwrites existing files and produces a different cert serial', async () => {
    const certDir = freshCertDir('force');
    const opts = defaultOpts(certDir);
    await runCertInit(opts);
    const serialBefore = execFileSync(
      'openssl', ['x509', '-in', opts.certFile, '-noout', '-serial'],
      { encoding: 'utf8' },
    ).trim();

    // Brief delay so the new cert has a different notBefore timestamp.
    await new Promise(r => setTimeout(r, 1100));

    const opts2 = validateOptions({ ...opts, force: true });
    const second = await runCertInit(opts2);
    expect(second.kind).toBe('generated');
    if (second.kind === 'generated') {
      expect(second.overwritten).toBe(true);
    }

    const serialAfter = execFileSync(
      'openssl', ['x509', '-in', opts.certFile, '-noout', '-serial'],
      { encoding: 'utf8' },
    ).trim();
    expect(serialAfter).not.toBe(serialBefore);
  });

  it.skipIf(!opensslAvailable || process.platform === 'win32')('writes private key with 0600 permissions on POSIX', async () => {
    const certDir = freshCertDir('perms');
    const opts = defaultOpts(certDir);
    await runCertInit(opts);
    const mode = fs.statSync(opts.keyFile).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it.skipIf(!opensslAvailable)('opens NO listening sockets during cert-init (network isolation)', async () => {
    // Sanity: runCertInit must not start any server. We assert via the absence
    // of any unref'd handle types beyond what the test runner already holds.
    const certDir = freshCertDir('isolation');
    const opts = defaultOpts(certDir);
    const before = process.getActiveResourcesInfo?.() ?? [];
    await runCertInit(opts);
    const after = process.getActiveResourcesInfo?.() ?? [];
    // Compare counts of socket-like resources only; allow other timers/fs handles.
    const sockBefore = before.filter(r => /Socket|Server/i.test(r)).length;
    const sockAfter = after.filter(r => /Socket|Server/i.test(r)).length;
    expect(sockAfter).toBeLessThanOrEqual(sockBefore);
  });

  it.skipIf(!opensslAvailable)('respects key-bits=4096 (cert reports a 4096-bit RSA key)', async () => {
    const certDir = freshCertDir('keybits');
    const opts = validateOptions({ ...defaultOpts(certDir), keyBits: 4096 });
    await runCertInit(opts);
    const text = execFileSync('openssl', ['x509', '-in', opts.certFile, '-noout', '-text'], { encoding: 'utf8' });
    // OpenSSL prints "Public-Key: (4096 bit)" or similar
    expect(text).toMatch(/4096\s*bit/i);
  });

  it.skipIf(!opensslAvailable)('rejects a certFile that escapes certDir even when openssl is available (SH-4 end-to-end)', async () => {
    const certDir = freshCertDir('traversal');
    const escape = path.join(certDir, '..', 'evil.crt');
    let caught: unknown;
    try {
      await runCertInit({
        certDir,
        certFile: escape,
        keyFile: path.join(certDir, 'k.key'),
        cn: 'localhost',
        san: 'DNS:localhost',
        days: 1,
        keyBits: 2048,
        force: false,
        printEnv: false,
      });
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CertInitError);
    expect((caught as CertInitError).code).toBe('PATH_OUTSIDE_CERT_DIR');
    // And no file was written outside the cert dir
    expect(fs.existsSync(escape)).toBe(false);
  });
});
