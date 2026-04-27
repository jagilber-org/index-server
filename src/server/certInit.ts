/**
 * Certificate bootstrap module for the `--init-cert` CLI switch.
 *
 * Public surface (all exports carry JSDoc per CQ-7):
 * - {@link validateOptions} : merge defaults, validate, resolve absolute paths
 * - {@link parseSan}        : split + validate SAN entries
 * - {@link buildOpenSslArgs}: build argv for `openssl req -x509`
 * - {@link preflightOpenssl}: verify openssl is callable on PATH
 * - {@link formatPrintEnv}  : produce env-var lines for the operator
 * - {@link runCertInit}     : end-to-end pipeline
 *
 * Constitution refs:
 * - SH-4 : every output path is `path.resolve`d and asserted to live under
 *          the resolved `certDir`.
 * - SH-6 : this module never disables TLS verification anywhere.
 * - CQ-1 : lives in its own file so `index-server.ts` stays under budget.
 * - CQ-6 : every catch surfaces a typed error; no swallowed exceptions.
 * - OB-3 : failures throw {@link CertInitError} with a stable `code`.
 * - OB-5 : success and skip paths log at INFO; failures log at ERROR.
 */

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { logError, logInfo } from '../services/logger';
import {
  CertInitError,
} from './certInit.types';
import type {
  CertInitOptions,
  CertInitResult,
  PrintEnvFormat,
} from './certInit.types';

// ── Defaults ──────────────────────────────────────────────────────────────

/** Default RSA key size when the caller does not specify `--key-bits`. */
const DEFAULT_KEY_BITS = 2048;
/** Default validity period in days. */
const DEFAULT_DAYS = 365;
/** Default subject CommonName. */
const DEFAULT_CN = 'localhost';
/** Default SAN list, covering loopback HTTPS scenarios out of the box. */
const DEFAULT_SAN = 'DNS:localhost,IP:127.0.0.1';
/** Default cert filename within `certDir`. */
const DEFAULT_CERT_FILENAME = 'index-server.crt';
/** Default key filename within `certDir`. */
const DEFAULT_KEY_FILENAME = 'index-server.key';
/** Inclusive minimum value for `--days`. */
const MIN_DAYS = 1;
/** Inclusive maximum value for `--days`. */
const MAX_DAYS = 3650;

/**
 * Compute the default cert directory path: `<homedir>/.index-server/certs`.
 * Used when the caller does not specify `--cert-dir`.
 *
 * @returns Absolute path to the default cert directory.
 */
function defaultCertDir(): string {
  return path.join(os.homedir(), '.index-server', 'certs');
}

// ── validateOptions ───────────────────────────────────────────────────────

/**
 * Validate a partial options bag and return a fully-resolved
 * {@link CertInitOptions} suitable for {@link runCertInit}.
 *
 * Defaults are applied for any field omitted by the caller. All paths are
 * `path.resolve`d. The function rejects values that violate the v1 contract:
 * days out of `[MIN_DAYS, MAX_DAYS]`, key-bits not in `{2048, 4096}`, SAN
 * entries without `DNS:` or `IP:` prefix, empty CN, or output paths that
 * escape `certDir` (SH-4).
 *
 * @param input  Partial options as parsed from the CLI.
 * @returns      Fully-resolved {@link CertInitOptions}.
 * @throws       {@link CertInitError} with codes `INVALID_DAYS`,
 *               `INVALID_KEY_BITS`, `INVALID_SAN`, `INVALID_CN`, or
 *               `PATH_OUTSIDE_CERT_DIR`.
 */
export function validateOptions(input: Partial<CertInitOptions>): CertInitOptions {
  const certDir = path.resolve(input.certDir ?? defaultCertDir());
  const certFile = path.resolve(input.certFile ?? path.join(certDir, DEFAULT_CERT_FILENAME));
  const keyFile = path.resolve(input.keyFile ?? path.join(certDir, DEFAULT_KEY_FILENAME));

  // SH-4: every output path must resolve under the cert dir.
  assertUnderDir(certFile, certDir, 'certFile');
  assertUnderDir(keyFile, certDir, 'keyFile');

  const days = input.days ?? DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new CertInitError(
      'INVALID_DAYS',
      `days must be an integer in [${MIN_DAYS}, ${MAX_DAYS}], received ${String(days)}`,
    );
  }

  const keyBits = input.keyBits ?? DEFAULT_KEY_BITS;
  if (keyBits !== 2048 && keyBits !== 4096) {
    throw new CertInitError(
      'INVALID_KEY_BITS',
      `keyBits must be 2048 or 4096, received ${String(keyBits)}`,
    );
  }

  const cn = (input.cn ?? DEFAULT_CN).trim();
  if (cn.length === 0) {
    throw new CertInitError('INVALID_CN', 'cn (CommonName) must not be empty');
  }

  const san = input.san ?? DEFAULT_SAN;
  // Validate SAN early so callers see a clean error before openssl runs.
  parseSan(san);

  return {
    certDir,
    certFile,
    keyFile,
    cn,
    san,
    days,
    keyBits,
    force: input.force ?? false,
    printEnv: input.printEnv ?? false,
  };
}

/**
 * Assert that `target` resolves to a path strictly inside `dir`. Used by the
 * SH-4 path-traversal guard in {@link validateOptions}.
 *
 * @param target  Absolute path to check.
 * @param dir     Absolute directory path that must contain `target`.
 * @param label   Human-readable name used in the error message.
 * @throws        {@link CertInitError} `PATH_OUTSIDE_CERT_DIR` when `target`
 *                escapes `dir`.
 */
function assertUnderDir(target: string, dir: string, label: string): void {
  const rel = path.relative(dir, target);
  // SH-4: BOTH conditions are required. Do NOT collapse this to a single check.
  //   rel.startsWith('..')   catches same-drive parent-dir escape
  //                          (e.g. C:\certs\..\..\evil  ->  '..\..\evil').
  //   path.isAbsolute(rel)   catches Windows cross-drive paths (D:\evil) and
  //                          UNC shares (\\server\share\evil), where
  //                          path.relative() returns an *absolute* path
  //                          rather than a '..\..'-prefixed relative one.
  // Removing either clause silently reintroduces a path-traversal bypass.
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new CertInitError(
      'PATH_OUTSIDE_CERT_DIR',
      `${label} (${target}) must resolve under cert dir (${dir})`,
    );
  }
}

// ── parseSan ──────────────────────────────────────────────────────────────

/**
 * Parse a comma-separated SAN string into individual entries, validating that
 * each entry has a recognized `DNS:` or `IP:` prefix.
 *
 * @param raw  Raw SAN string from the CLI (e.g. `"DNS:host,IP:127.0.0.1"`).
 * @returns    Array of validated SAN entries with surrounding whitespace
 *             trimmed.
 * @throws     {@link CertInitError} `INVALID_SAN` for empty input, trailing
 *             commas, or entries missing a recognized prefix.
 */
export function parseSan(raw: string): string[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new CertInitError('INVALID_SAN', 'san must be a non-empty string');
  }
  const parts = raw.split(',');
  const entries: string[] = [];
  for (const p of parts) {
    const trimmed = p.trim();
    if (trimmed.length === 0) {
      throw new CertInitError(
        'INVALID_SAN',
        `san contains an empty entry (check for trailing/leading commas in "${raw}")`,
      );
    }
    if (!trimmed.startsWith('DNS:') && !trimmed.startsWith('IP:')) {
      throw new CertInitError(
        'INVALID_SAN',
        `san entry "${trimmed}" must start with "DNS:" or "IP:"`,
      );
    }
    entries.push(trimmed);
  }
  return entries;
}

// ── buildOpenSslArgs ──────────────────────────────────────────────────────

/**
 * Build the argument array for the OpenSSL `req -x509` invocation that
 * generates a self-signed certificate. The returned array is suitable for
 * `child_process.execFile('openssl', args)` — no shell metacharacters are
 * inserted, and inputs are not interpolated into a command string.
 *
 * @param opts  Fully-resolved cert-init options (use {@link validateOptions}
 *              to produce these).
 * @returns     Argument array for `openssl`.
 */
export function buildOpenSslArgs(opts: CertInitOptions): string[] {
  return [
    'req',
    '-x509',
    '-newkey', `rsa:${opts.keyBits}`,
    '-nodes',
    '-keyout', opts.keyFile,
    '-out', opts.certFile,
    '-days', String(opts.days),
    '-subj', `/CN=${opts.cn}`,
    '-addext', `subjectAltName=${opts.san}`,
  ];
}

// ── preflightOpenssl ──────────────────────────────────────────────────────

/**
 * Verify that `openssl` is callable on PATH. Used as a preflight before any
 * generation work so that the failure surfaces with a stable
 * `OPENSSL_NOT_FOUND` code rather than a downstream spawn error.
 *
 * @returns The reported version string when openssl is callable.
 * @throws  {@link CertInitError} `OPENSSL_NOT_FOUND` otherwise.
 */
export function preflightOpenssl(): string {
  let result;
  try {
    result = spawnSync('openssl', ['version'], { stdio: 'pipe', timeout: 5000 });
  } catch (e) {
    throw new CertInitError(
      'OPENSSL_NOT_FOUND',
      'openssl was not found on PATH or could not be invoked. Install OpenSSL and retry. ' +
        'See https://www.openssl.org/source/ for downloads.',
      e,
    );
  }
  if (!result || result.status !== 0) {
    const stderr = result?.stderr?.toString().trim() ?? '';
    throw new CertInitError(
      'OPENSSL_NOT_FOUND',
      `openssl probe failed (status=${String(result?.status)}): ${stderr || 'no output'}. Install OpenSSL and retry.`,
    );
  }
  return result.stdout.toString().trim();
}

// ── formatPrintEnv ────────────────────────────────────────────────────────

/**
 * Format the env-var lines an operator can paste into their shell after a
 * successful generation, pointing the dashboard at the new cert/key.
 *
 * @param opts    Resolved cert-init options.
 * @param format  Output format. `'auto'` picks `'powershell'` on Win32,
 *                `'posix'` elsewhere.
 * @returns       Multi-line string ending with a trailing newline.
 */
export function formatPrintEnv(opts: CertInitOptions, format: PrintEnvFormat = 'auto'): string {
  const resolved: PrintEnvFormat = format === 'auto'
    ? (process.platform === 'win32' ? 'powershell' : 'posix')
    : format;

  const posix = [
    `export INDEX_SERVER_DASHBOARD_TLS=1`,
    `export INDEX_SERVER_DASHBOARD_TLS_CERT="${opts.certFile}"`,
    `export INDEX_SERVER_DASHBOARD_TLS_KEY="${opts.keyFile}"`,
  ].join('\n') + '\n';

  const ps = [
    `$env:INDEX_SERVER_DASHBOARD_TLS="1"`,
    `$env:INDEX_SERVER_DASHBOARD_TLS_CERT="${opts.certFile}"`,
    `$env:INDEX_SERVER_DASHBOARD_TLS_KEY="${opts.keyFile}"`,
  ].join('\n') + '\n';

  if (resolved === 'powershell') return ps;
  if (resolved === 'posix') return posix;
  // both
  return `# POSIX\n${posix}\n# PowerShell\n${ps}`;
}

// ── runCertInit ───────────────────────────────────────────────────────────

/**
 * Execute the full cert-init pipeline: validate options, preflight openssl,
 * create `certDir` if missing, run openssl, set restrictive permissions on
 * POSIX, and emit a structured log line via the existing logger.
 *
 * Idempotency: if `certFile` OR `keyFile` already exists and `force` is false,
 * no openssl invocation is made and a `kind: 'skipped'` result is returned.
 * Treating only the both-exist case as "skip" would clobber a surviving cert
 * when the operator deleted/rotated only the key (or vice versa) — `--force`
 * is required to overwrite *any* existing file.
 *
 * @param input  Caller options (typically from the CLI parser). Re-validated
 *               internally so direct callers do not need to pre-validate.
 * @returns      A {@link CertInitResult} indicating generated vs skipped.
 * @throws       {@link CertInitError} for any validation, preflight, or
 *               execution failure (codes documented on each helper above).
 */
export async function runCertInit(input: Partial<CertInitOptions>): Promise<CertInitResult> {
  const opts = validateOptions(input);

  // Skip if EITHER file exists without --force. Treating only the both-exist
  // case as "skip" would clobber a surviving cert when the operator deleted /
  // rotated only the key (or vice versa) — the principle of least surprise is
  // that --force is required to overwrite *any* existing file on disk.
  const certExists = fs.existsSync(opts.certFile);
  const keyExists = fs.existsSync(opts.keyFile);
  const bothExist = certExists && keyExists;
  const anyExists = certExists || keyExists;
  if (anyExists && !opts.force) {
    const reason = bothExist
      ? 'cert and key files already exist; pass --force to overwrite'
      : `partial state on disk (cert=${certExists}, key=${keyExists}); pass --force to overwrite`;
    logInfo('[certInit] skip (files exist; use --force to overwrite)', {
      cert: opts.certFile,
      certExists,
      key: opts.keyFile,
      keyExists,
    });
    return {
      kind: 'skipped',
      reason,
      certFile: opts.certFile,
      keyFile: opts.keyFile,
    };
  }

  // Preflight openssl AFTER the skip-when-exists check so an idempotent
  // re-run on a host without openssl (where the cert was generated elsewhere)
  // still succeeds with a `skipped` result.
  preflightOpenssl();

  // Ensure cert dir exists.
  try {
    fs.mkdirSync(opts.certDir, { recursive: true });
  } catch (e) {
    throw new CertInitError(
      'MKDIR_FAILED',
      `failed to create cert directory ${opts.certDir}: ${(e instanceof Error) ? e.message : String(e)}`,
      e,
    );
  }

  const args = buildOpenSslArgs(opts);
  // TOCTOU mitigation: openssl writes the key with the process umask (commonly
  // 0o022 -> mode 0o644). We narrow the umask to 0o077 around the execFile so
  // the key is created mode 0o600 from the start, eliminating the world-
  // readable window between key creation and our explicit chmod below. We
  // restore the previous umask in `finally` regardless of outcome. On Windows
  // umask is effectively a no-op (NTFS ACLs are unaffected), so this is safe
  // cross-platform. See docs/cert_init.md for the residual multi-user note
  // (defense-in-depth: dedicated user, 0o700 parent dir).
  const prevUmask = process.umask(0o077);
  try {
    execFileSync('openssl', args, { stdio: 'pipe', timeout: 30000 });
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim() ?? '';
    const status = (e as { status?: number }).status;
    const errorMsg = `openssl req failed (status=${String(status)}): ${stderr || (e instanceof Error ? e.message : String(e))}`;
    logError('[certInit] openssl invocation failed', { args: args.join(' '), stderr });
    throw new CertInitError('OPENSSL_FAILED', errorMsg, e);
  } finally {
    process.umask(prevUmask);
  }

  // Belt-and-braces: explicitly narrow key permissions to 0o600 even though
  // umask 0o077 above should already have produced that mode. Handles the case
  // where openssl ignores umask on some platforms or where the file pre-existed
  // (force overwrite). No-op on Windows where chmod semantics differ
  // (POSIX-mode bits are ignored by NTFS ACLs).
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(opts.keyFile, 0o600);
    } catch (e) {
      // Non-fatal: log a warning but do not fail the whole operation.
      // The key was still written successfully.
      logError('[certInit] failed to chmod private key to 0600', {
        key: opts.keyFile,
        error: (e instanceof Error) ? e.message : String(e),
      });
    }
  }

  logInfo('[certInit] generated certificate', {
    cert: opts.certFile,
    key: opts.keyFile,
    cn: opts.cn,
    san: opts.san,
    days: opts.days,
    keyBits: opts.keyBits,
    overwritten: bothExist,
  });

  return {
    kind: 'generated',
    certFile: opts.certFile,
    keyFile: opts.keyFile,
    overwritten: bothExist,
  };
}
