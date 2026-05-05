<#
.SYNOPSIS
    Pre-push hook: runs adhoc mutation integrity and concurrent SQLite tests
    against a locally-built server to catch disk/state regressions before push.

.DESCRIPTION
    Spawns a temporary MCP server process, runs the 12-probe mutation integrity
    test, and (if SQLite is enabled) runs the 4-client concurrent write test.
    Skipped when SKIP_INTEGRITY_PREPUSH=1 or when no src/scripts changes exist.
#>
Param()

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repoRoot

# --- Skip conditions ---------------------------------------------------------
if ($env:SKIP_INTEGRITY_PREPUSH -eq '1') {
    Write-Host '[pre-push:integrity] Skipped (SKIP_INTEGRITY_PREPUSH=1)' -ForegroundColor Yellow
    exit 0
}

# Skip for doc-only pushes
$changedFiles = git diff --name-only HEAD "@{u}" 2>$null
if ($changedFiles) {
    $codeChanges = $changedFiles | Where-Object { $_ -match '^(src/|scripts/|vitest|package)' }
    if (-not $codeChanges) {
        Write-Host '[pre-push:integrity] Documentation-only changes — skipping.' -ForegroundColor Yellow
        exit 0
    }
}

# --- Ensure dist is built ----------------------------------------------------
$distEntry = Join-Path $repoRoot 'dist' 'server' 'index-server.js'
if (-not (Test-Path $distEntry)) {
    Write-Host '[pre-push:integrity] dist/ not found — running npm run build...' -ForegroundColor DarkCyan
    npm run build --silent 2>&1 | Out-Null
    if (-not (Test-Path $distEntry)) {
        Write-Host '[pre-push:integrity] Build failed — skipping integrity tests.' -ForegroundColor Yellow
        exit 0
    }
}

# --- Run mutation integrity test (12 probes) ---------------------------------
Write-Host '[pre-push:integrity] Running mutation integrity probe (12 tests)...' -ForegroundColor Cyan

$mutationScript = Join-Path $repoRoot 'scripts' 'diagnostics' 'adhoc-mutation-integrity.mjs'
if (-not (Test-Path $mutationScript)) {
    Write-Host '[pre-push:integrity] adhoc-mutation-integrity.mjs not found — skipping.' -ForegroundColor Yellow
    exit 0
}

$timeoutSec = if ($env:INTEGRITY_TIMEOUT_SEC) { [int]$env:INTEGRITY_TIMEOUT_SEC } else { 30 }

$job = Start-Job -ScriptBlock {
    Set-Location $using:repoRoot
    $env:INDEX_SERVER_MUTATION = '1'
    node $using:mutationScript 2>&1
}

$completed = $job | Wait-Job -Timeout $timeoutSec
if (-not $completed) {
    $job | Stop-Job
    $job | Remove-Job -Force
    Write-Host "[pre-push:integrity] Mutation probe timed out (${timeoutSec}s) — skipping." -ForegroundColor Yellow
    exit 0
}

$output = $job | Receive-Job
$jobFailed = $job.ChildJobs[0].JobStateInfo.State -eq 'Failed'
$job | Remove-Job -Force

if ($jobFailed -or $output -match '❌|FAIL:') {
    Write-Host '[pre-push:integrity] ❌ Mutation integrity probe FAILED:' -ForegroundColor Red
    $output | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Host '[pre-push:integrity] ✅ Mutation integrity probe passed.' -ForegroundColor Green

# --- Run concurrent integrity test (4 clients) --------------------------------
$concurrentScript = Join-Path $repoRoot 'scripts' 'perf' 'adhoc-concurrent-integrity.mjs'
if (-not (Test-Path $concurrentScript)) {
    Write-Host '[pre-push:integrity] adhoc-concurrent-integrity.mjs not found — skipping concurrent test.' -ForegroundColor Yellow
    exit 0
}

Write-Host '[pre-push:integrity] Running concurrent write integrity (4 clients, 10 ops each)...' -ForegroundColor Cyan

$concTimeoutSec = if ($env:INTEGRITY_TIMEOUT_SEC) { [int]$env:INTEGRITY_TIMEOUT_SEC } else { 60 }

$job2 = Start-Job -ScriptBlock {
    Set-Location $using:repoRoot
    $env:INDEX_SERVER_MUTATION = '1'
    node $using:concurrentScript --concurrency 4 --ops-per-client 10 2>&1
}

$completed2 = $job2 | Wait-Job -Timeout $concTimeoutSec
if (-not $completed2) {
    $job2 | Stop-Job
    $job2 | Remove-Job -Force
    Write-Host "[pre-push:integrity] Concurrent test timed out (${concTimeoutSec}s) — skipping." -ForegroundColor Yellow
    exit 0
}

$output2 = $job2 | Receive-Job
$job2Failed = $job2.ChildJobs[0].JobStateInfo.State -eq 'Failed'
$job2 | Remove-Job -Force

if ($job2Failed -or $output2 -match '❌|FAIL:|lost writes') {
    Write-Host '[pre-push:integrity] ❌ Concurrent integrity test FAILED:' -ForegroundColor Red
    $output2 | ForEach-Object { Write-Host "  $_" }
    exit 1
}

Write-Host '[pre-push:integrity] ✅ Concurrent integrity test passed.' -ForegroundColor Green
Write-Host '[pre-push:integrity] All integrity checks passed.' -ForegroundColor Green
exit 0
