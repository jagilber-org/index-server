/**
 * Unit tests for scripts/ggshield-with-retry.sh.
 *
 * We stub out `ggshield` by prepending a fake bin dir to PATH so the wrapper
 * invokes our shim instead of the real CLI. The shim's behavior is controlled
 * via FAKE_GGSHIELD_MODE env var so each test can simulate one scenario.
 *
 * Skipped on Windows runners — the wrapper is a bash script consumed only by
 * Linux GitHub Actions runners.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'ggshield-with-retry.sh');
const isWindows = platform() === 'win32';

function makeFakeBin(mode: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ggshield-fake-'));
  const shim = path.join(dir, 'ggshield');
  // Two-mode shim: 'quota' always prints quota error and exits 128;
  // 'transient-then-ok' fails on first call (counted via state file) then succeeds.
  const stateFile = path.join(dir, 'state');
  const script = `#!/usr/bin/env bash
case "${mode}" in
  quota)
    echo "Error: Could not perform the requested action: no more API calls available."
    exit 128
    ;;
  transient-then-ok)
    if [ ! -f "${stateFile}" ]; then
      echo "transient ggshield error" >&2
      touch "${stateFile}"
      exit 2
    fi
    echo "ok"
    exit 0
    ;;
  ok)
    echo "ok"
    exit 0
    ;;
  *)
    echo "unknown mode: ${mode}" >&2
    exit 99
    ;;
esac
`;
  writeFileSync(shim, script, { encoding: 'utf8' });
  chmodSync(shim, 0o755);
  return dir;
}

function runWrapper(opts: {
  fakeMode: string;
  env?: Record<string, string>;
  args?: string[];
}): { code: number; stdout: string; stderr: string } {
  const fakeBin = makeFakeBin(opts.fakeMode);
  try {
    const env = {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
      GGSHIELD_INITIAL_BACKOFF: '1', // keep tests fast
      GGSHIELD_MAX_RETRIES: '2',
      ...(opts.env ?? {}),
    };
    const res = spawnSync('bash', [SCRIPT, ...(opts.args ?? ['secret', 'scan', 'changes'])], {
      env,
      encoding: 'utf8',
    });
    return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
}

describe.skipIf(isWindows)('ggshield-with-retry.sh', () => {
  it('exits 0 when ggshield succeeds on first try', () => {
    const { code, stdout } = runWrapper({ fakeMode: 'ok' });
    expect(code).toBe(0);
    expect(stdout).toMatch(/ok/);
  });

  it('exits 0 when GGSHIELD_DISABLED=1', () => {
    const { code, stderr } = runWrapper({ fakeMode: 'quota', env: { GGSHIELD_DISABLED: '1' } });
    expect(code).toBe(0);
    expect(stderr).toMatch(/GGSHIELD_DISABLED=1/);
  });

  it('exits 0 on quota error when GGSHIELD_SKIP_ON_QUOTA=1', () => {
    const { code, stderr } = runWrapper({
      fakeMode: 'quota',
      env: { GGSHIELD_SKIP_ON_QUOTA: '1' },
    });
    expect(code).toBe(0);
    expect(stderr).toMatch(/Quota exhausted.*GGSHIELD_SKIP_ON_QUOTA=1/);
  });

  it('propagates quota error exit code without skip switch', () => {
    const { code } = runWrapper({ fakeMode: 'quota' });
    expect(code).toBe(128);
  });

  it('retries transient failures and eventually succeeds', () => {
    const { code, stderr } = runWrapper({ fakeMode: 'transient-then-ok' });
    expect(code).toBe(0);
    expect(stderr).toMatch(/attempt 2\/2/);
  });
});
