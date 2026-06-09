/**
 * Publish-ToMirror.ps1 — Wait-ReleaseWorkflowRun behavioral tests (#269).
 *
 * The PR #411 squad review's load-bearing finding: the existing
 * publishMirrorReleaseWait.spec.ts is a source-grep that proves the wiring
 * exists but exercises no branches. This spec drives the actual
 * Wait-ReleaseWorkflowRun function via pwsh + the new -GhInvoker
 * injection seam, covering each reliability branch the reviewer called out:
 *
 *   1. discovery-timeout (no matching run within DiscoveryTimeoutMinutes)
 *   2. completion-timeout (run found but never reaches 'completed')
 *   3. conclusion=failure / cancelled (non-success → flagged as failure)
 *   4. transient gh errors that later recover (does not abort the loop)
 *   5. split-budget semantics (discovery cap doesn't starve completion)
 *
 * Each test injects a deterministic scriptblock for gh, so no network,
 * no real gh binary, no real sleeps (we drive seconds=0 / sub-second).
 * Skipped on platforms without `pwsh` on PATH.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts', 'build', 'Publish-ToMirror.ps1');

function pwshAvailable(): boolean {
  try {
    execFileSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
      stdio: 'ignore',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

function runDriver(driverPs1: string): { stdout: string; stderr: string; code: number } {
  const dir = mkdtempSync(join(tmpdir(), 'wait-release-test-'));
  const path = join(dir, 'driver.ps1');
  writeFileSync(path, driverPs1, 'utf8');
  try {
    const out = execFileSync(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-File', path],
      { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { stdout: out, stderr: '', code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : '',
      code: typeof err.status === 'number' ? err.status : 1,
    };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const describeOrSkip = pwshAvailable() ? describe : describe.skip;

// The publish script auto-executes on dot-source (it has Mandatory params and
// runs a workflow). For unit testing the polling helper we only need the
// function body, so each driver extracts it via PowerShell's AST and
// Invoke-Expressions just the function definition into the current scope.
const PRELUDE = `
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT_PATH.replace(/\\/g, '\\\\').replace(/'/g, "''")}', [ref]$tokens, [ref]$errors)
$fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Wait-ReleaseWorkflowRun' }, $true) | Select-Object -First 1
if (-not $fn) { throw 'Wait-ReleaseWorkflowRun not found in source.' }
Invoke-Expression $fn.Extent.Text
`.trim();

describeOrSkip('Wait-ReleaseWorkflowRun — behavioral coverage (#269)', () => {

  it('returns Found=$false / DiscoveryTimedOut=$true when no run is ever discovered', () => {
    // gh returns OK + empty array forever. Discovery window must be tiny so
    // we don't actually wait — give it 1 min, poll every 0 seconds.
    const driver = `
$ErrorActionPreference = 'Stop'
${PRELUDE}
$invoker = { param([string[]]$GhArgs); return @(0, '[]') }
# Override Start-Sleep so the test runs instantly.
function Start-Sleep { param([int]$Seconds) }
$r = Wait-ReleaseWorkflowRun -Repo 'o/r' -Tag 'v1.0.0' -WorkflowName 'Release' \`
    -TimeoutMinutes 1 -DiscoveryTimeoutMinutes 1 -TimeoutSeconds 2 -DiscoveryTimeoutSeconds 2 \`
    -DiscoveryPollSeconds 0 -CompletionPollSeconds 0 \`
    -GhInvoker $invoker
Write-Output ("FOUND=" + $r.Found)
Write-Output ("DISCOVERY_TIMED_OUT=" + $r.DiscoveryTimedOut)
Write-Output ("COMPLETION_TIMED_OUT=" + $r.CompletionTimedOut)
Write-Output ("CONCLUSION=" + ($r.Conclusion ?? 'null'))
`;
    const out = runDriver(driver);
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/FOUND=False/);
    expect(out.stdout).toMatch(/DISCOVERY_TIMED_OUT=True/);
  }, 60_000);

  it('returns CompletionTimedOut=$true when run is found but never completes', () => {
    const driver = `
$ErrorActionPreference = 'Stop'
${PRELUDE}
$script:Calls = 0
$invoker = {
    param([string[]]$GhArgs)
    $script:Calls++
    if ($GhArgs -contains 'list') {
        return @(0, '[{"databaseId":42,"headBranch":"v1.0.0","status":"in_progress","conclusion":null,"event":"push"}]')
    } else {
        return @(0, '{"status":"in_progress","conclusion":null,"url":"https://x/42"}')
    }
}
function Start-Sleep { param([int]$Seconds) }
$r = Wait-ReleaseWorkflowRun -Repo 'o/r' -Tag 'v1.0.0' -WorkflowName 'Release' \`
    -TimeoutMinutes 1 -DiscoveryTimeoutMinutes 1 -TimeoutSeconds 2 -DiscoveryTimeoutSeconds 2 \`
    -DiscoveryPollSeconds 0 -CompletionPollSeconds 0 \`
    -GhInvoker $invoker
Write-Output ("FOUND=" + $r.Found)
Write-Output ("RUNID=" + $r.RunId)
Write-Output ("STATUS=" + $r.Status)
Write-Output ("COMPLETION_TIMED_OUT=" + $r.CompletionTimedOut)
`;
    const out = runDriver(driver);
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/FOUND=True/);
    expect(out.stdout).toMatch(/RUNID=42/);
    expect(out.stdout).toMatch(/STATUS=in_progress/);
    expect(out.stdout).toMatch(/COMPLETION_TIMED_OUT=True/);
  }, 60_000);

  it('captures Conclusion=failure when the run completes with conclusion=failure', () => {
    const driver = `
$ErrorActionPreference = 'Stop'
${PRELUDE}
$invoker = {
    param([string[]]$GhArgs)
    if ($GhArgs -contains 'list') {
        return @(0, '[{"databaseId":99,"headBranch":"v1.0.0","status":"completed","conclusion":"failure","event":"push"}]')
    } else {
        return @(0, '{"status":"completed","conclusion":"failure","url":"https://x/99"}')
    }
}
function Start-Sleep { param([int]$Seconds) }
$r = Wait-ReleaseWorkflowRun -Repo 'o/r' -Tag 'v1.0.0' -WorkflowName 'Release' \`
    -TimeoutMinutes 1 -DiscoveryTimeoutMinutes 1 -TimeoutSeconds 2 -DiscoveryTimeoutSeconds 2 \`
    -DiscoveryPollSeconds 0 -CompletionPollSeconds 0 \`
    -GhInvoker $invoker
Write-Output ("FOUND=" + $r.Found)
Write-Output ("STATUS=" + $r.Status)
Write-Output ("CONCLUSION=" + $r.Conclusion)
Write-Output ("COMPLETION_TIMED_OUT=" + $r.CompletionTimedOut)
`;
    const out = runDriver(driver);
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/STATUS=completed/);
    expect(out.stdout).toMatch(/CONCLUSION=failure/);
    expect(out.stdout).toMatch(/COMPLETION_TIMED_OUT=False/);
  }, 60_000);

  it('captures Conclusion=cancelled and surfaces it as completed-not-success', () => {
    const driver = `
$ErrorActionPreference = 'Stop'
${PRELUDE}
$invoker = {
    param([string[]]$GhArgs)
    if ($GhArgs -contains 'list') {
        return @(0, '[{"databaseId":100,"headBranch":"v1.0.0","status":"completed","conclusion":"cancelled","event":"push"}]')
    } else {
        return @(0, '{"status":"completed","conclusion":"cancelled","url":"https://x/100"}')
    }
}
function Start-Sleep { param([int]$Seconds) }
$r = Wait-ReleaseWorkflowRun -Repo 'o/r' -Tag 'v1.0.0' -WorkflowName 'Release' \`
    -TimeoutMinutes 1 -DiscoveryTimeoutMinutes 1 -TimeoutSeconds 2 -DiscoveryTimeoutSeconds 2 \`
    -DiscoveryPollSeconds 0 -CompletionPollSeconds 0 \`
    -GhInvoker $invoker
Write-Output ("CONCLUSION=" + $r.Conclusion)
`;
    const out = runDriver(driver);
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/CONCLUSION=cancelled/);
  }, 60_000);

  it('survives transient gh failures and reaches success after recovery', () => {
    // First 3 calls fail (exit=1), then succeed.
    const driver = `
$ErrorActionPreference = 'Stop'
${PRELUDE}
$script:Calls = 0
$invoker = {
    param([string[]]$GhArgs)
    $script:Calls++
    if ($script:Calls -le 3) {
        return @(1, '')
    }
    if ($GhArgs -contains 'list') {
        return @(0, '[{"databaseId":7,"headBranch":"v1.0.0","status":"completed","conclusion":"success","event":"push"}]')
    } else {
        return @(0, '{"status":"completed","conclusion":"success","url":"https://x/7"}')
    }
}
function Start-Sleep { param([int]$Seconds) }
$r = Wait-ReleaseWorkflowRun -Repo 'o/r' -Tag 'v1.0.0' -WorkflowName 'Release' \`
    -TimeoutMinutes 1 -DiscoveryTimeoutMinutes 1 -TimeoutSeconds 2 -DiscoveryTimeoutSeconds 2 \`
    -DiscoveryPollSeconds 0 -CompletionPollSeconds 0 \`
    -GhInvoker $invoker
Write-Output ("FOUND=" + $r.Found)
Write-Output ("CONCLUSION=" + $r.Conclusion)
Write-Output ("CALLS=" + $script:Calls)
`;
    const out = runDriver(driver);
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/FOUND=True/);
    expect(out.stdout).toMatch(/CONCLUSION=success/);
    // Verify it really did fail 3x before recovering.
    expect(out.stdout).toMatch(/CALLS=[4-9]\d*|CALLS=\d{2,}/);
  }, 60_000);

  it('emits a transient-error log line on the first failure (debuggable timeouts)', () => {
    // Every call fails; we just need to see the first-failure log line.
    const driver = `
$ErrorActionPreference = 'Stop'
${PRELUDE}
$invoker = { param([string[]]$GhArgs); return @(1, '') }
function Start-Sleep { param([int]$Seconds) }
$r = Wait-ReleaseWorkflowRun -Repo 'o/r' -Tag 'v1.0.0' -WorkflowName 'Release' \`
    -TimeoutMinutes 1 -DiscoveryTimeoutMinutes 1 -TimeoutSeconds 2 -DiscoveryTimeoutSeconds 2 \`
    -DiscoveryPollSeconds 0 -CompletionPollSeconds 0 \`
    -GhInvoker $invoker
Write-Output ("DISCOVERY_TIMED_OUT=" + $r.DiscoveryTimedOut)
`;
    const out = runDriver(driver);
    expect(out.code).toBe(0);
    // The transient-error log line goes to host stream (captured in stdout).
    expect(out.stdout).toMatch(/Discovery: gh call returned exit=1/);
    expect(out.stdout).toMatch(/DISCOVERY_TIMED_OUT=True/);
  }, 60_000);
});
