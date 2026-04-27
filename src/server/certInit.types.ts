/**
 * Type definitions for the `--init-cert` certificate bootstrap subsystem.
 *
 * These types are deliberately split out from `certInit.ts` so that test
 * fixtures and external callers can import the option/result shapes without
 * pulling in the OpenSSL invocation surface.
 *
 * Constitution refs: CQ-7 (JSDoc on public types), AR-1 (smallest type surface
 * sufficient for the v1 feature).
 */

/**
 * Output format for `--print-env` helper.
 *
 * - `posix`        — emit `export NAME="value"` lines (bash, zsh, sh).
 * - `powershell`   — emit `$env:NAME="value"` lines (Windows PowerShell, pwsh).
 * - `both`         — emit both, separated by a blank line and platform headers.
 * - `auto`         — pick `powershell` on Win32, `posix` elsewhere.
 */
export type PrintEnvFormat = 'posix' | 'powershell' | 'both' | 'auto';

/**
 * Resolved options for a single `runCertInit` invocation.
 *
 * All paths must be absolute by the time they reach `runCertInit`. Validation
 * (path-traversal guard per SH-4, numeric range checks) happens via
 * `validateOptions` before any filesystem or `openssl` work occurs.
 */
export interface CertInitOptions {
  /** Absolute directory that contains the cert + key (and optionally CA). */
  certDir: string;
  /** Absolute path to the server certificate file (PEM). Must resolve under `certDir`. */
  certFile: string;
  /** Absolute path to the server private key file (PEM). Must resolve under `certDir`. */
  keyFile: string;
  /** Subject CommonName (CN) for the generated certificate. */
  cn: string;
  /**
   * Comma-separated SAN entries, e.g. `DNS:localhost,IP:127.0.0.1`.
   * Each entry MUST start with a `DNS:` or `IP:` prefix.
   */
  san: string;
  /** Validity period in days. Range: 1..3650 inclusive. */
  days: number;
  /** RSA key size in bits. Allowed values: 2048, 4096. */
  keyBits: 2048 | 4096;
  /** When true, overwrite existing cert/key files. */
  force: boolean;
  /** When true, the dispatcher will print env-var lines after generation. */
  printEnv: boolean | PrintEnvFormat;
}

/**
 * Result of `runCertInit`. Distinguishes generated vs skipped vs failed paths
 * so the dispatcher in `index-server.ts` can decide whether to exit, continue,
 * or surface an error.
 */
export type CertInitResult =
  | {
      kind: 'generated';
      /** Absolute path to the written certificate file. */
      certFile: string;
      /** Absolute path to the written private key file. */
      keyFile: string;
      /** True when files were overwritten because `--force` was given. */
      overwritten: boolean;
    }
  | {
      kind: 'skipped';
      /** Reason the operation was skipped (e.g. files already present). */
      reason: string;
      /** Absolute path to the existing certificate file. */
      certFile: string;
      /** Absolute path to the existing private key file. */
      keyFile: string;
    };

/**
 * Structured error thrown by `runCertInit` and its helpers. The `code` field
 * is stable and machine-readable; tests assert on `code`, not on `message`
 * wording (per OB-3 / TS-12 robustness).
 */
export class CertInitError extends Error {
  /**
   * @param code   Stable machine-readable identifier for the failure class.
   * @param message Human-readable explanation; safe to surface to operators.
   * @param cause  Optional underlying cause (e.g. a spawn error or fs error).
   */
  constructor(
    public readonly code: CertInitErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CertInitError';
  }
}

/**
 * Stable error codes emitted by the cert-init subsystem. New codes may be
 * appended; existing codes MUST NOT change meaning (semver guarantee for
 * downstream tooling and test assertions).
 */
export type CertInitErrorCode =
  | 'OPENSSL_NOT_FOUND'
  | 'OPENSSL_FAILED'
  | 'INVALID_DAYS'
  | 'INVALID_KEY_BITS'
  | 'INVALID_SAN'
  | 'INVALID_CN'
  | 'PATH_OUTSIDE_CERT_DIR'
  | 'WRITE_FAILED'
  | 'MKDIR_FAILED';
