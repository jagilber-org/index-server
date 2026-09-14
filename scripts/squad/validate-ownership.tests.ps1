<#
.SYNOPSIS
  Falsification tests for validate-ownership.ps1.
  Points the script at a deliberately corrupted manifest and confirms it exits 1.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot
$validateScript = Join-Path $scriptDir 'validate-ownership.ps1'
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "validate-ownership-test-$(Get-Random)"

try {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    # ── Test 1: Phantom worktree — path does not exist ───────────────────
    Write-Host 'Test 1: Phantom worktree detection...' -ForegroundColor Cyan
    $phantomManifest = @{
        mainCheckout = @{
            path = (Get-Location).Path
        }
        worktrees = @(
            @{
                owner  = 'test-agent'
                branch = 'fake/nonexistent-branch'
                path   = Join-Path $tempDir 'this-does-not-exist'
            }
        )
    } | ConvertTo-Json -Depth 5
    $manifestFile = Join-Path $tempDir 'phantom.json'
    Set-Content -Path $manifestFile -Value $phantomManifest

    $output = & pwsh -NoProfile -File $validateScript -ManifestPath $manifestFile 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 1) {
        Write-Error "Test 1 FAILED: expected exit 1, got $exitCode"
        exit 1
    }
    $outputStr = ($output | Out-String)
    if ($outputStr -notmatch 'phantom-worktree') {
        Write-Error "Test 1 FAILED: output does not mention 'phantom-worktree'"
        exit 1
    }
    Write-Host '  PASS: phantom worktree detected' -ForegroundColor Green

    # ── Test 2: Clean manifest — should pass ─────────────────────────────
    Write-Host 'Test 2: Clean manifest passes...' -ForegroundColor Cyan
    $cleanManifest = @{
        mainCheckout = @{
            path = (Get-Location).Path
        }
        worktrees = @()
    } | ConvertTo-Json -Depth 5
    $cleanFile = Join-Path $tempDir 'clean.json'
    Set-Content -Path $cleanFile -Value $cleanManifest

    # A clean manifest with no worktree entries should detect unmanaged
    # worktrees if any exist. For a true clean test, we need a repo state
    # where the only worktree is the main checkout.
    # Since we can't guarantee that, we just verify it runs without error.
    $output = & pwsh -NoProfile -File $validateScript -ManifestPath $cleanFile 2>&1
    # exit 0 = no issues, exit 1 = unmanaged worktrees found (both are valid)
    if ($LASTEXITCODE -notin @(0, 1)) {
        Write-Error "Test 2 FAILED: unexpected exit code $LASTEXITCODE"
        exit 1
    }
    Write-Host '  PASS: clean manifest processed without error' -ForegroundColor Green

    # ── Test 3: Missing manifest file — should exit 1 ────────────────────
    Write-Host 'Test 3: Missing manifest file...' -ForegroundColor Cyan
    $output = & pwsh -NoProfile -File $validateScript -ManifestPath (Join-Path $tempDir 'nonexistent.json') 2>&1
    if ($LASTEXITCODE -ne 1) {
        Write-Error "Test 3 FAILED: expected exit 1, got $LASTEXITCODE"
        exit 1
    }
    Write-Host '  PASS: missing manifest rejected' -ForegroundColor Green

    # -- Test 4: Real repo manifest -- must not crash -------------------
    # Regression guard for the original defect: the script read $entry.agent
    # while .squad/worktrees/ownership.json has always used "owner". Every
    # test above used a hand-built fixture that invented an "agent" field, so
    # the suite was self-consistent but reality-inconsistent -- it stayed green
    # while the script threw on the only file it exists to validate:
    #   "The property 'agent' cannot be found on this object."
    # Set-StrictMode -Version Latest turns the missing property into a throw.
    Write-Host 'Test 4: Real repo manifest does not crash the validator...' -ForegroundColor Cyan
    $repoRoot = (& git -C $scriptDir rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
        Write-Error 'Test 4 FAILED: could not resolve repo root via git'
        exit 1
    }
    $realManifest = Join-Path $repoRoot '.squad/worktrees/ownership.json'
    if (-not (Test-Path $realManifest)) {
        Write-Error "Test 4 FAILED: real manifest not found at $realManifest"
        exit 1
    }
    $output = & pwsh -NoProfile -File $validateScript -ManifestPath $realManifest 2>&1
    $exitCode = $LASTEXITCODE
    $outputStr = ($output | Out-String)
    # 0 = clean, 1 = findings reported. Anything else is a crash.
    if ($exitCode -notin @(0, 1)) {
        Write-Error "Test 4 FAILED: validator crashed on the real manifest (exit $exitCode): $outputStr"
        exit 1
    }
    # A property-access throw can surface as text even when exit code is 1.
    if ($outputStr -match 'cannot be found on this object') {
        Write-Error "Test 4 FAILED: missing-property error on the real manifest: $outputStr"
        exit 1
    }
    Write-Host "  PASS: real manifest processed without error (exit $exitCode)" -ForegroundColor Green

    Write-Host ''
    Write-Host 'All tests passed.' -ForegroundColor Green
    exit 0
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
