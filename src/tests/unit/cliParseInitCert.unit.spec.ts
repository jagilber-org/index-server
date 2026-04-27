/**
 * Unit tests for parseArgs additions in src/server/index-server.ts that wire
 * the new `--init-cert` flag family.
 *
 * TDD RED phase: these tests must FAIL until the parser additions land.
 *
 * Constitution refs:
 * - TS-12: this suite has 10 cases (>= 5 required floor).
 * - TS-10: tests import the actual `_parseArgs` named export — no toy parser.
 * - AG-1: each case asserts the smallest observable parser side effect.
 */

import { describe, it, expect } from 'vitest';
import { _parseArgs } from '../../server/index-server';

// We assert against the new fields via structural typing rather than importing
// the CliConfig interface directly, so the test fails compilation cleanly when
// the field is missing AND fails at runtime when the parser ignores the flag.
type Cfg = Record<string, unknown>;

function parse(argv: string[]): Cfg {
  return _parseArgs(['node', 'index', ...argv]) as unknown as Cfg;
}

describe('parseArgs / --init-cert family', () => {
  it('--init-cert alone sets initCert=true and leaves dashboard defaults intact', () => {
    const cfg = parse(['--init-cert']);
    expect(cfg.initCert).toBe(true);
    // start defaults to false — generation-only mode
    expect(cfg.start ?? false).toBe(false);
    // Dashboard host/port/tls fields are unaffected by cert-init flags
    expect(typeof cfg.dashboardPort).toBe('number');
    expect(typeof cfg.dashboardHost).toBe('string');
  });

  it('--cert-dir <path> populates certDir', () => {
    const cfg = parse(['--init-cert', '--cert-dir', '/tmp/my-certs']);
    expect(cfg.certDir).toBe('/tmp/my-certs');
  });

  it('--cert-dir=<path> populates certDir (equals form)', () => {
    const cfg = parse(['--init-cert', '--cert-dir=/tmp/my-certs']);
    expect(cfg.certDir).toBe('/tmp/my-certs');
  });

  it('--cert-file and --key-file populate respective fields', () => {
    const cfg = parse([
      '--init-cert',
      '--cert-file', '/tmp/c.crt',
      '--key-file=/tmp/c.key',
    ]);
    expect(cfg.certFile).toBe('/tmp/c.crt');
    expect(cfg.keyFile).toBe('/tmp/c.key');
  });

  it('--cn and --san populate certCn and certSan verbatim', () => {
    const cfg = parse([
      '--init-cert',
      '--cn', 'host.local',
      '--san', 'DNS:host.local,IP:192.0.2.4',
    ]);
    expect(cfg.certCn).toBe('host.local');
    expect(cfg.certSan).toBe('DNS:host.local,IP:192.0.2.4');
  });

  it('--days and --key-bits coerce to integers', () => {
    const cfg = parse(['--init-cert', '--days', '730', '--key-bits=4096']);
    expect(cfg.certDays).toBe(730);
    expect(cfg.certKeyBits).toBe(4096);
    expect(typeof cfg.certDays).toBe('number');
    expect(typeof cfg.certKeyBits).toBe('number');
  });

  it('--force toggles certForce=true', () => {
    const cfg = parse(['--init-cert', '--force']);
    expect(cfg.certForce).toBe(true);
  });

  it('--print-env without value sets certPrintEnv=true', () => {
    const cfg = parse(['--init-cert', '--print-env']);
    expect(cfg.certPrintEnv).toBe(true);
  });

  it('--print-env=posix sets certPrintEnv to the format string', () => {
    const cfg = parse(['--init-cert', '--print-env=posix']);
    expect(cfg.certPrintEnv).toBe('posix');
  });

  it('--start sets start=true and is independent of --init-cert', () => {
    const a = parse(['--init-cert', '--start']);
    expect(a.start).toBe(true);
    expect(a.initCert).toBe(true);
    const b = parse(['--start']);
    expect(b.start).toBe(true);
    expect(b.initCert ?? false).toBe(false);
  });
});
