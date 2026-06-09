<#
.SYNOPSIS
    Release preflight — runs every release gate without publishing or tagging.

.DESCRIPTION
    Standalone, fail-fast (in report mode: fail-aggregate) validator that runs
    each release gate independently so a single execution surfaces every
    issue blocking a release. Designed to be run before opening the Phase 1
    release PR chain so issues can be fixed in one batch instead of an
    8-PR chain.

    Gates (in order):
      1. Clean working tree         - git status --porcelain is empty
      2. Version parity             - package.json.version === server.json.version
      3. npm pack files array       - npm pack --dry-run inventory check
      4. Whitespace check           - git diff --check HEAD
      5. Type check                 - npm run typecheck
      6. Lint                       - npm run lint
      7. Test suite                 - npm test
      8. Schema compliance          - npm run lint:instructions
      9. Pre-commit hooks           - pre-commit run --all-files

    Each gate reports PASS / FAIL with timing. Failed gates print
    remediation hints. Non-zero exit on any failure. Use -FailFast to
    abort at the first failure instead of running every gate.

.PARAMETER FailFast
    Stop at the first failing gate instead of running them all.

.PARAMETER SkipPreCommit
    Skip the pre-commit run --all-files gate (useful when pre-commit
    is not installed on the current machine). Strongly discouraged for
    actual release preflight — CI will replay it anyway.

.PARAMETER SkipTests
    Skip the full test suite gate (npm test). Discouraged outside of
    iterative local triage.

.EXAMPLE
    pwsh -NoProfile -File scripts/release-preflight.ps1

.EXAMPLE
    pwsh -NoProfile -File scripts/release-preflight.ps1 -FailFast

.NOTES
    Issue: #250
    Related: scripts/Invoke-ReleaseWorkflow.ps1 (full release/publish wrapper)
#>
[CmdletBinding()]
param(
    [switch]$FailFast,
    [switch]$SkipPreCommit,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Continue'
$script:Results = @()
$script:OverallStart = Get-Date

function Write-Header($text) {
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor Cyan
    Write-Host $text -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor Cyan
}

function Invoke-Gate {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Script,
        [string]$Remediation = ''
    )

    Write-Host ''
    Write-Host "[gate] $Name" -ForegroundColor Yellow
    # Reset $LASTEXITCODE so a non-zero value lingering from a prior gate
    # (or from earlier shell state) cannot spuriously fail this gate when
    # the script body uses only PowerShell cmdlets.
    $global:LASTEXITCODE = 0
    $start = Get-Date
    $status = 'PASS'
    $err = $null

    try {
        & $Script
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            throw "External command exited with code $LASTEXITCODE"
        }
    }
    catch {
        $status = 'FAIL'
        $err = $_.ToString()
    }

    $elapsed = [int]((Get-Date) - $start).TotalSeconds
    $color = if ($status -eq 'PASS') { 'Green' } else { 'Red' }
    Write-Host "[$status] $Name (${elapsed}s)" -ForegroundColor $color
    if ($status -eq 'FAIL') {
        Write-Host "  error: $err" -ForegroundColor Red
        if ($Remediation) {
            Write-Host "  remediation: $Remediation" -ForegroundColor DarkYellow
        }
    }

    $script:Results += [pscustomobject]@{
        Name        = $Name
        Status      = $status
        ElapsedSec  = $elapsed
        Error       = $err
        Remediation = $Remediation
    }

    if ($status -eq 'FAIL' -and $FailFast) {
        throw "Fail-fast: gate '$Name' failed."
    }
}

# Anchor to repo root (scripts/ is at repo root)
$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

try {
    Write-Header 'Release Preflight (issue #250)'
    Write-Host "Repo root: $RepoRoot"
    Write-Host "Started:   $(Get-Date -Format o)"

    # 1. Clean working tree
    Invoke-Gate 'Clean working tree' {
        $changes = git status --porcelain
        if ($changes) {
            $changes | ForEach-Object { Write-Host "  $_" }
            throw "Working tree has uncommitted changes."
        }
    } -Remediation 'Commit or stash changes, then re-run preflight.'

    # 2. Version parity
    Invoke-Gate 'Version parity (package.json vs server.json)' {
        npm run check:version-parity --silent 2>&1 | Out-Host
    } -Remediation 'Run `node scripts/build/bump-version.mjs patch` (or minor/major) to align versions.'

    # 3. npm pack files-array dry run
    Invoke-Gate 'npm pack files-array inventory' {
        # `npm pack --dry-run --json` is *supposed* to emit a single JSON
        # document on stdout, but npm frequently leaks lifecycle banners,
        # deprecation notices, and `npm warn ...` lines onto stdout *before*
        # the JSON payload. A naive ConvertFrom-Json on the raw stream then
        # explodes, which the previous version of this gate disguised as
        # "External command exited with code 1".
        #
        # Extract the JSON payload defensively: find the first '[' or '{'
        # and the matching closing brace, and parse only that slice.
        $rawCombined = npm pack --dry-run --json 2>&1
        $rawString = ($rawCombined | Out-String)
        $startArr = $rawString.IndexOf('[')
        $startObj = $rawString.IndexOf('{')
        $startIdx = -1
        if ($startArr -ge 0 -and ($startObj -lt 0 -or $startArr -lt $startObj)) { $startIdx = $startArr }
        elseif ($startObj -ge 0) { $startIdx = $startObj }
        if ($startIdx -lt 0) {
            throw "npm pack --dry-run produced no JSON payload. Raw output:`n$rawString"
        }
        $endIdx = $rawString.LastIndexOfAny([char[]]@(']', '}'))
        if ($endIdx -lt $startIdx) {
            throw "npm pack --dry-run JSON payload is truncated. Raw output:`n$rawString"
        }
        $jsonSlice = $rawString.Substring($startIdx, $endIdx - $startIdx + 1)
        $parsed = $jsonSlice | ConvertFrom-Json
        $entry = if ($parsed -is [System.Array]) { $parsed[0] } else { $parsed }
        $fileCount = if ($entry.files) { $entry.files.Count } else { 0 }
        Write-Host "  npm pack would include $fileCount entries; tarball: $($entry.filename)"
        $names = @($entry.files | ForEach-Object { $_.path })
        $required = @('package.json', 'README.md', 'LICENSE', 'server.json', 'CHANGELOG.md')
        foreach ($r in $required) {
            if ($names -notcontains $r) {
                throw "npm pack inventory missing required file: $r"
            }
        }
        $hasDist = $names | Where-Object { $_ -like 'dist/*' } | Select-Object -First 1
        if (-not $hasDist) {
            throw "npm pack inventory has no dist/ files — did you run ``npm run build``?"
        }
    } -Remediation 'Run `npm run build`, then verify `files` array in package.json includes all critical scripts.'

    # 4. Whitespace check
    Invoke-Gate 'Whitespace integrity (git diff --check HEAD)' {
        git --no-pager diff --check HEAD
    } -Remediation 'Run `npm run format` or fix flagged trailing whitespace / mixed indentation.'

    # 5. Typecheck
    Invoke-Gate 'TypeScript typecheck' {
        npm run typecheck --silent 2>&1 | Out-Host
    } -Remediation 'Fix reported type errors. Run `npm run typecheck` locally to reproduce.'

    # 6. Lint
    Invoke-Gate 'ESLint' {
        npm run lint --silent 2>&1 | Out-Host
    } -Remediation 'Run `npm run lint -- --fix` for autofixable issues; address the rest manually.'

    # 7. Test suite
    if ($SkipTests) {
        Write-Host '[skip] Test suite (-SkipTests specified)' -ForegroundColor DarkYellow
        $script:Results += [pscustomobject]@{ Name = 'Test suite'; Status = 'SKIP'; ElapsedSec = 0; Error = $null; Remediation = '' }
    }
    else {
        Invoke-Gate 'Test suite (npm test)' {
            npm test --silent 2>&1 | Out-Host
        } -Remediation 'Fix failing tests. Re-run with `npm test` or `npm run test:fast` for iteration.'
    }

    # 8. Schema compliance of fixtures + instruction docs
    Invoke-Gate 'Instruction schema compliance' {
        npm run lint:instructions --silent 2>&1 | Out-Host
    } -Remediation 'Update offending instruction files to match `schemas/instruction.schema.json`.'

    # 9. Pre-commit hooks
    if ($SkipPreCommit) {
        Write-Host '[skip] pre-commit run --all-files (-SkipPreCommit specified)' -ForegroundColor DarkYellow
        $script:Results += [pscustomobject]@{ Name = 'pre-commit'; Status = 'SKIP'; ElapsedSec = 0; Error = $null; Remediation = '' }
    }
    else {
        Invoke-Gate 'pre-commit run --all-files' {
            $cmd = Get-Command pre-commit -ErrorAction SilentlyContinue
            if (-not $cmd) {
                throw "pre-commit is not on PATH. Install it (https://pre-commit.com) or re-run with -SkipPreCommit."
            }
            pre-commit run --all-files 2>&1 | Out-Host
        } -Remediation 'Fix reported hook failures. Run individual hooks via `pre-commit run <hook-id> --all-files`.'
    }
}
catch {
    Write-Host ''
    Write-Host "[abort] $_" -ForegroundColor Red
}
finally {
    Pop-Location
}

# Summary
$totalElapsed = [int]((Get-Date) - $script:OverallStart).TotalSeconds
$passCount = @($script:Results | Where-Object Status -EQ 'PASS').Count
$failCount = @($script:Results | Where-Object Status -EQ 'FAIL').Count
$skipCount = @($script:Results | Where-Object Status -EQ 'SKIP').Count

Write-Header "Preflight Summary"
$script:Results | Format-Table -AutoSize Name, Status, ElapsedSec

Write-Host ''
Write-Host "Pass: $passCount  Fail: $failCount  Skip: $skipCount  (total ${totalElapsed}s)"

if ($failCount -gt 0) {
    Write-Host ''
    Write-Host 'FAILED gates:' -ForegroundColor Red
    foreach ($r in ($script:Results | Where-Object Status -EQ 'FAIL')) {
        Write-Host "  - $($r.Name)" -ForegroundColor Red
        if ($r.Remediation) {
            Write-Host "      $($r.Remediation)" -ForegroundColor DarkYellow
        }
    }
    Write-Host ''
    Write-Host '[release-preflight] FAIL — fix the above before opening release PR.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '[release-preflight] OK — all release gates passed.' -ForegroundColor Green
exit 0
