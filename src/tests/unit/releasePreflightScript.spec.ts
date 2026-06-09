/**
 * Release preflight script structure + reliability tests (#250).
 *
 * The full preflight is a PowerShell script (`scripts/release-preflight.ps1`)
 * that shells out to `npm`, `git`, and `pre-commit`. We don't try to drive
 * the full pipeline from vitest (that's what CI does); instead we lock in
 * the structural and reliability invariants flagged on PR #412:
 *
 *   - the script exists and has comment-based help
 *   - it accepts the three documented flags (-FailFast / -SkipTests /
 *     -SkipPreCommit)
 *   - `$global:LASTEXITCODE = 0` is reset at the top of `Invoke-Gate`
 *     (squad-review reliability fix: prevents cross-gate carry-over)
 *   - the `npm pack --dry-run --json` parser uses a defensive
 *     extract-JSON-slice approach (squad-review reliability fix: tolerates
 *     `npm warn` lines on stdout)
 *   - dead code from the original draft (no-op `try { } catch { throw }`
 *     wrapper and unused `Tee-Object -Variable out`) is removed
 *
 * Validates the source text directly so the suite stays cross-platform
 * (no pwsh dependency).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPT_PATH = resolve(__dirname, '..', '..', '..', 'scripts', 'release-preflight.ps1');

describe('release-preflight.ps1 structure (#250)', () => {
  it('script file exists at scripts/release-preflight.ps1', () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  const src = existsSync(SCRIPT_PATH) ? readFileSync(SCRIPT_PATH, 'utf8') : '';

  it('declares comment-based help (SYNOPSIS / DESCRIPTION / PARAMETER / EXAMPLE)', () => {
    expect(src).toMatch(/\.SYNOPSIS/);
    expect(src).toMatch(/\.DESCRIPTION/);
    expect(src).toMatch(/\.PARAMETER\s+FailFast/);
    expect(src).toMatch(/\.PARAMETER\s+SkipPreCommit/);
    expect(src).toMatch(/\.PARAMETER\s+SkipTests/);
    expect(src).toMatch(/\.EXAMPLE/);
  });

  it('accepts -FailFast / -SkipPreCommit / -SkipTests switches', () => {
    expect(src).toMatch(/\[switch\]\$FailFast/);
    expect(src).toMatch(/\[switch\]\$SkipPreCommit/);
    expect(src).toMatch(/\[switch\]\$SkipTests/);
  });

  it('declares each release gate (clean tree / version parity / npm pack / whitespace / typecheck / lint / tests / schema / pre-commit)', () => {
    expect(src).toMatch(/Invoke-Gate ['"]Clean working tree['"]/);
    expect(src).toMatch(/Invoke-Gate ['"]Version parity/);
    expect(src).toMatch(/Invoke-Gate ['"]npm pack files-array inventory/);
    expect(src).toMatch(/Invoke-Gate ['"]Whitespace integrity/);
    expect(src).toMatch(/Invoke-Gate ['"]TypeScript typecheck/);
    expect(src).toMatch(/Invoke-Gate ['"]ESLint/);
    expect(src).toMatch(/Invoke-Gate ['"]Test suite/);
    expect(src).toMatch(/Invoke-Gate ['"]Instruction schema compliance/);
    expect(src).toMatch(/Invoke-Gate ['"]pre-commit run --all-files/);
  });
});

describe('release-preflight.ps1 reliability fixes (PR #412 review)', () => {
  const src = existsSync(SCRIPT_PATH) ? readFileSync(SCRIPT_PATH, 'utf8') : '';

  it('resets $LASTEXITCODE per gate to avoid cross-gate carry-over', () => {
    // Must appear inside Invoke-Gate, before the script-block invocation.
    expect(src).toMatch(/\$global:LASTEXITCODE\s*=\s*0/);
    const gateIdx = src.indexOf('function Invoke-Gate');
    const resetIdx = src.indexOf('$global:LASTEXITCODE = 0');
    const tryIdx = src.indexOf('try {', gateIdx);
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(resetIdx).toBeGreaterThan(gateIdx);
    expect(resetIdx).toBeLessThan(tryIdx);
  });

  it('parses `npm pack --dry-run --json` defensively (extracts JSON slice, tolerates npm warn leakage)', () => {
    // The hardened parser must locate the first `[` or `{` and the matching
    // closing brace, not rely on `.StartsWith('[')` against the raw stream.
    expect(src).toMatch(/IndexOf\('\['\)/);
    expect(src).toMatch(/LastIndexOfAny/);
    expect(src).toMatch(/Substring\(\$startIdx,\s*\$endIdx\s*-\s*\$startIdx\s*\+\s*1\)/);
    // Negative: the brittle StartsWith guard must be gone.
    expect(src).not.toMatch(/\.Trim\(\)\.StartsWith\('\['\)/);
  });

  it('does not contain the no-op `Tee-Object -Variable out` from the draft', () => {
    expect(src).not.toMatch(/Tee-Object\s+-Variable\s+out/);
  });

  it('does not contain a no-op `try { ... } catch { throw }` wrapper around the pack-inventory body', () => {
    // The original wrapper opened immediately after a `try {` whose only
    // catch block was `catch { throw }`. After the fix the inventory body
    // sits directly inside Invoke-Gate's outer try.
    expect(src).not.toMatch(/catch\s*\{\s*throw\s*\}/);
  });
});

describe('release-preflight wiring (#250)', () => {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')
  ) as { scripts?: Record<string, string> };

  it('exposes `npm run release:preflight` alias', () => {
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts?.['release:preflight']).toMatch(/release-preflight\.ps1/);
  });
});
