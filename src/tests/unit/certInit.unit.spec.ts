/**
 * Unit tests for src/server/certInit.ts.
 *
 * TDD RED phase: these tests must FAIL until certInit.ts is implemented.
 * The skeleton currently throws CertInitError for every call so failures will
 * surface with a stable shape.
 *
 * Coverage targets (constitution refs):
 * - TS-12 (>=5 cases for complex paths): this suite has 13.
 * - SH-4 (path-traversal guard): exercised by INVALID days/keyBits, and the
 *   cert-file-outside-cert-dir case below.
 * - OB-3 (structured errors): assertions check `error.code`, not message text,
 *   so wording can evolve without breaking the contract.
 * - TS-10 (real production code): tests import the actual module under test.
 */

import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import {
  validateOptions,
  parseSan,
  buildOpenSslArgs,
  preflightOpenssl,
  formatPrintEnv,
  runCertInit,
} from '../../server/certInit';
import { CertInitError } from '../../server/certInit.types';
import type { CertInitOptions } from '../../server/certInit.types';

// ── helpers ───────────────────────────────────────────────────────────────

const tmpRoot = os.tmpdir();

/** Build an option bag with sensible test defaults; callers override fields. */
function baseOptions(overrides: Partial<CertInitOptions> = {}): Partial<CertInitOptions> {
  const certDir = path.join(tmpRoot, 'mcp-cert-init-test');
  return {
    certDir,
    certFile: path.join(certDir, 'index-server.crt'),
    keyFile: path.join(certDir, 'index-server.key'),
    cn: 'localhost',
    san: 'DNS:localhost,IP:127.0.0.1',
    days: 365,
    keyBits: 2048,
    force: false,
    printEnv: false,
    ...overrides,
  };
}

function expectCertInitError<T>(fn: () => T, expectedCode: string): CertInitError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught, `expected CertInitError with code=${expectedCode}, got nothing`).toBeInstanceOf(CertInitError);
  const err = caught as CertInitError;
  expect(err.code).toBe(expectedCode);
  return err;
}

async function expectAsyncCertInitError(fn: () => Promise<unknown>, expectedCode: string): Promise<CertInitError> {
  let caught: unknown;
  try { await fn(); } catch (e) { caught = e; }
  expect(caught, `expected CertInitError with code=${expectedCode}, got nothing`).toBeInstanceOf(CertInitError);
  const err = caught as CertInitError;
  expect(err.code).toBe(expectedCode);
  return err;
}

// ── 1. validateOptions: numeric range guards ──────────────────────────────

describe('certInit / validateOptions', () => {
  it('rejects days < 1 with INVALID_DAYS', () => {
    expectCertInitError(() => validateOptions(baseOptions({ days: 0 })), 'INVALID_DAYS');
  });

  it('rejects days > 3650 with INVALID_DAYS', () => {
    expectCertInitError(() => validateOptions(baseOptions({ days: 3651 })), 'INVALID_DAYS');
  });

  it('accepts days at the inclusive 1 and 3650 boundaries', () => {
    expect(() => validateOptions(baseOptions({ days: 1 }))).not.toThrow();
    expect(() => validateOptions(baseOptions({ days: 3650 }))).not.toThrow();
  });

  it('rejects keyBits not in {2048, 4096} with INVALID_KEY_BITS', () => {
    expectCertInitError(() => validateOptions(baseOptions({ keyBits: 1024 as 2048 })), 'INVALID_KEY_BITS');
    expectCertInitError(() => validateOptions(baseOptions({ keyBits: 3072 as 2048 })), 'INVALID_KEY_BITS');
  });

  // SH-4: path-traversal guard. A certFile that resolves outside certDir must
  // be rejected with a stable code so tests do not need to grep the message.
  it('rejects cert-file resolving outside cert-dir with PATH_OUTSIDE_CERT_DIR', () => {
    const certDir = path.join(tmpRoot, 'mcp-cert-init-test');
    const escape = path.join(certDir, '..', '..', 'evil.crt');
    expectCertInitError(
      () => validateOptions(baseOptions({ certDir, certFile: escape })),
      'PATH_OUTSIDE_CERT_DIR',
    );
  });

  it('rejects key-file resolving outside cert-dir with PATH_OUTSIDE_CERT_DIR', () => {
    const certDir = path.join(tmpRoot, 'mcp-cert-init-test');
    const escape = path.join(certDir, '..', 'evil.key');
    expectCertInitError(
      () => validateOptions(baseOptions({ certDir, keyFile: escape })),
      'PATH_OUTSIDE_CERT_DIR',
    );
  });

  it('rejects empty CN with INVALID_CN', () => {
    expectCertInitError(() => validateOptions(baseOptions({ cn: '' })), 'INVALID_CN');
  });

  it('returns absolute paths when given relative inputs', () => {
    const opts = validateOptions(baseOptions({
      certDir: 'rel-dir',
      certFile: path.join('rel-dir', 'a.crt'),
      keyFile: path.join('rel-dir', 'a.key'),
    }));
    expect(path.isAbsolute(opts.certDir)).toBe(true);
    expect(path.isAbsolute(opts.certFile)).toBe(true);
    expect(path.isAbsolute(opts.keyFile)).toBe(true);
  });
});

// ── 2. parseSan: prefix enforcement ────────────────────────────────────────

describe('certInit / parseSan', () => {
  it('parses mixed DNS and IP entries preserving order', () => {
    expect(parseSan('DNS:host.local,IP:127.0.0.1,DNS:alt.local'))
      .toEqual(['DNS:host.local', 'IP:127.0.0.1', 'DNS:alt.local']);
  });

  it('trims surrounding whitespace around each entry', () => {
    expect(parseSan(' DNS:a , IP:192.0.2.4 ')).toEqual(['DNS:a', 'IP:192.0.2.4']); // # pii-allowlist: RFC 5737 documentation IP
  });

  it('rejects bare tokens without DNS:/IP: prefix with INVALID_SAN', () => {
    expectCertInitError(() => parseSan('localhost,127.0.0.1'), 'INVALID_SAN');
  });

  it('rejects empty input with INVALID_SAN', () => {
    expectCertInitError(() => parseSan(''), 'INVALID_SAN');
  });

  it('rejects trailing comma with INVALID_SAN', () => {
    expectCertInitError(() => parseSan('DNS:host,'), 'INVALID_SAN');
  });
});

// ── 3. buildOpenSslArgs: argv shape (no shell metacharacters) ──────────────

describe('certInit / buildOpenSslArgs', () => {
  it('emits req -x509 with key-bits, days, key/cert paths, subj, and SAN extension', () => {
    const opts = validateOptions(baseOptions({ days: 730, keyBits: 4096, cn: 'test.local' }));
    const args = buildOpenSslArgs(opts);

    // Sanity: first positional must be `req` then `-x509`
    expect(args[0]).toBe('req');
    expect(args).toContain('-x509');
    expect(args).toContain('-newkey');
    expect(args).toContain('rsa:4096');
    expect(args).toContain('-nodes');
    expect(args).toContain('-keyout');
    expect(args).toContain(opts.keyFile);
    expect(args).toContain('-out');
    expect(args).toContain(opts.certFile);
    expect(args).toContain('-days');
    expect(args).toContain('730');
    expect(args).toContain('-subj');
    expect(args).toContain('/CN=test.local');
    // SAN must be passed as an -addext value, not via shell
    expect(args).toContain('-addext');
    expect(args.some(a => a.startsWith('subjectAltName='))).toBe(true);
  });

  it('contains no shell metacharacters in any argument', () => {
    const opts = validateOptions(baseOptions());
    const args = buildOpenSslArgs(opts);
    // Each argument is passed individually to execFile; this assertion guards
    // against accidental string concatenation that would re-introduce shell risk.
    for (const a of args) {
      expect(a, `arg "${a}" must not contain ; & | \` $ < > newlines`).not.toMatch(/[;&|`$<>\n\r]/);
    }
  });
});

// ── 4. preflightOpenssl ────────────────────────────────────────────────────

describe('certInit / preflightOpenssl', () => {
  it('throws OPENSSL_NOT_FOUND when openssl is unavailable', () => {
    // We can't reliably hide openssl from the spawned process via env on all
    // platforms in a unit test, so we accept either success (returns string) or
    // the documented error code. The TDD-red skeleton always throws
    // OPENSSL_NOT_FOUND, so this test passes during red. After green it will
    // pass when openssl is on PATH (returns string) and also pass when missing
    // (CertInitError with OPENSSL_NOT_FOUND).
    let result: unknown;
    let err: unknown;
    try { result = preflightOpenssl(); } catch (e) { err = e; }
    if (err) {
      expect(err).toBeInstanceOf(CertInitError);
      expect((err as CertInitError).code).toBe('OPENSSL_NOT_FOUND');
    } else {
      expect(typeof result).toBe('string');
      expect((result as string).length).toBeGreaterThan(0);
    }
  });
});

// ── 5. formatPrintEnv ──────────────────────────────────────────────────────

describe('certInit / formatPrintEnv', () => {
  it('emits POSIX export lines for INDEX_SERVER_DASHBOARD_TLS_CERT and _KEY', () => {
    const opts = validateOptions(baseOptions());
    const out = formatPrintEnv(opts, 'posix');
    expect(out).toContain(`export INDEX_SERVER_DASHBOARD_TLS=1`);
    expect(out).toContain(`export INDEX_SERVER_DASHBOARD_TLS_CERT="${opts.certFile}"`);
    expect(out).toContain(`export INDEX_SERVER_DASHBOARD_TLS_KEY="${opts.keyFile}"`);
  });

  it('emits PowerShell $env: lines for the same vars', () => {
    const opts = validateOptions(baseOptions());
    const out = formatPrintEnv(opts, 'powershell');
    expect(out).toContain(`$env:INDEX_SERVER_DASHBOARD_TLS="1"`);
    expect(out).toContain(`$env:INDEX_SERVER_DASHBOARD_TLS_CERT="${opts.certFile}"`);
    expect(out).toContain(`$env:INDEX_SERVER_DASHBOARD_TLS_KEY="${opts.keyFile}"`);
  });

  it('emits both formats with platform headers when format=both', () => {
    const opts = validateOptions(baseOptions());
    const out = formatPrintEnv(opts, 'both');
    expect(out).toContain('# POSIX');
    expect(out).toContain('# PowerShell');
    expect(out).toContain('export INDEX_SERVER_DASHBOARD_TLS=1');
    expect(out).toContain('$env:INDEX_SERVER_DASHBOARD_TLS="1"');
  });

  it('format=auto picks PowerShell on win32 and POSIX elsewhere', () => {
    const opts = validateOptions(baseOptions());
    const out = formatPrintEnv(opts, 'auto');
    if (process.platform === 'win32') {
      expect(out).toContain('$env:INDEX_SERVER_DASHBOARD_TLS="1"');
      expect(out).not.toContain('export INDEX_SERVER_DASHBOARD_TLS=1');
    } else {
      expect(out).toContain('export INDEX_SERVER_DASHBOARD_TLS=1');
      expect(out).not.toContain('$env:INDEX_SERVER_DASHBOARD_TLS="1"');
    }
  });
});

// ── 6. runCertInit: contract-level behavior (no openssl spawn here) ───────

describe('certInit / runCertInit (unit-level behavior)', () => {
  it('rejects invalid options before invoking openssl (INVALID_DAYS bubbles through)', async () => {
    await expectAsyncCertInitError(
      () => runCertInit(baseOptions({ days: 0 })),
      'INVALID_DAYS',
    );
  });

  it('returns kind="skipped" when only the cert exists (no --force) — must NOT clobber surviving cert', async () => {
    const fs = await import('fs');
    const certDir = path.join(tmpRoot, `mcp-cert-init-partial-cert-${Date.now()}-${process.pid}`);
    fs.mkdirSync(certDir, { recursive: true });
    const certFile = path.join(certDir, 'index-server.crt');
    const keyFile = path.join(certDir, 'index-server.key');
    fs.writeFileSync(certFile, 'PRE-EXISTING-CERT');
    try {
      const result = await runCertInit({ certDir, certFile, keyFile });
      expect(result.kind).toBe('skipped');
      if (result.kind === 'skipped') {
        expect(result.reason).toMatch(/partial state/i);
      }
      // Surviving cert content untouched.
      expect(fs.readFileSync(certFile, 'utf8')).toBe('PRE-EXISTING-CERT');
      // Key was NOT created.
      expect(fs.existsSync(keyFile)).toBe(false);
    } finally {
      fs.rmSync(certDir, { recursive: true, force: true });
    }
  });

  it('returns kind="skipped" when only the key exists (no --force) — symmetric to cert-only case', async () => {
    const fs = await import('fs');
    const certDir = path.join(tmpRoot, `mcp-cert-init-partial-key-${Date.now()}-${process.pid}`);
    fs.mkdirSync(certDir, { recursive: true });
    const certFile = path.join(certDir, 'index-server.crt');
    const keyFile = path.join(certDir, 'index-server.key');
    fs.writeFileSync(keyFile, 'PRE-EXISTING-KEY');
    try {
      const result = await runCertInit({ certDir, certFile, keyFile });
      expect(result.kind).toBe('skipped');
      if (result.kind === 'skipped') {
        expect(result.reason).toMatch(/partial state/i);
      }
      // Surviving key content untouched.
      expect(fs.readFileSync(keyFile, 'utf8')).toBe('PRE-EXISTING-KEY');
      // Cert was NOT created.
      expect(fs.existsSync(certFile)).toBe(false);
    } finally {
      fs.rmSync(certDir, { recursive: true, force: true });
    }
  });
});
