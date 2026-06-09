/**
 * npm files coverage tests — issue #247.
 *
 * Companion to `npmPackReadiness.spec.ts`. Where that suite checks
 * declarative invariants (presence of named entries in the `files` array),
 * this suite catches the drift class that caused PR #240: a script in the
 * `files` allowlist dynamically invokes a sibling script via
 * `execFileSync(path.join(ROOT, 'scripts', 'build', 'generate-certs.mjs'), …)`
 * — a reference that no static `import` graph would surface — but that
 * sibling script is **not** itself in `files`. The npm-installed consumer
 * gets `MODULE_NOT_FOUND` / `ENOENT` at runtime; CI never noticed.
 *
 * Coverage is performed by `scripts/governance/validate-npm-files.mjs`,
 * which builds the declared shipped set from `package.json#files`, scans
 * every shipped JS source for references (relative imports + path.join
 * string-array forms + bare literal `scripts/…\.mjs` strings), and flags
 * any reference that resolves to a real file not covered by `files`.
 *
 * This test runs the same script and asserts no drift. Two cases:
 *   1. Positive: current `package.json` has zero drift.
 *   2. Negative: removing `scripts/build/generate-certs.mjs` from `files`
 *      (the historical regression) must be detected by the script. This
 *      keeps the validator itself honest — a script that exits 0 for every
 *      input would pass the positive case silently.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'governance', 'validate-npm-files.mjs');

interface DriftReport {
  ok: boolean;
  shippedCount: number;
  missing: Array<{ from: string; ref: string }>;
}

function runValidator(opts: { expectExit: 0 | 1 } = { expectExit: 0 }): DriftReport {
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(process.execPath, [VALIDATOR, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string };
    exitCode = typeof e.status === 'number' ? e.status : 1;
    stdout = e.stdout ? e.stdout.toString() : '';
  }
  expect(exitCode, `validator exit code (expected ${opts.expectExit}); stdout:\n${stdout}`).toBe(opts.expectExit);
  return JSON.parse(stdout) as DriftReport;
}

describe('npm files coverage (#247)', () => {
  it('current package.json has zero drift between `files` and shipped JS references', () => {
    const report = runValidator({ expectExit: 0 });
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
    // Sanity: the validator actually has something to validate.
    expect(report.shippedCount).toBeGreaterThan(100);
  });

  it('detects the historical #240 regression (generate-certs.mjs removed from files)', () => {
    const pkgPath = path.join(REPO_ROOT, 'package.json');
    const original = readFileSync(pkgPath, 'utf8');
    // Strip the generate-certs entry to simulate the pre-#240 manifest.
    const mutated = original.replace(/\s*"scripts\/build\/generate-certs\.mjs",?\r?\n/, '\n');
    expect(mutated, 'failed to strip generate-certs from files[]').not.toBe(original);

    try {
      writeFileSync(pkgPath, mutated);
      const report = runValidator({ expectExit: 1 });
      expect(report.ok).toBe(false);
      const refs = report.missing.map((m) => m.ref);
      expect(refs).toContain('scripts/build/generate-certs.mjs');
      // The offending source must be identified.
      const setupWizardHits = report.missing.filter((m) => m.from === 'scripts/build/setup-wizard.mjs');
      expect(setupWizardHits.length).toBeGreaterThan(0);
    } finally {
      writeFileSync(pkgPath, original);
    }
  });
});
