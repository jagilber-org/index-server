#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Pull and audit CI artifacts from GitHub Actions workflow runs.

.DESCRIPTION
  Downloads artifacts from recent workflow runs and generates an audit report
  covering: server logs, test results, coverage, traces, and security scans.
  Requires the GitHub CLI (gh) to be authenticated.

.PARAMETER RunId
  Specific run ID to audit. If omitted, audits the latest successful CI run.

.PARAMETER Workflow
  Workflow name filter (default: all). Examples: ci.yml, security-tier2.yml

.PARAMETER OutputDir
  Directory for downloaded artifacts (default: tmp/audit)

.PARAMETER Last
  Number of recent runs to audit (default: 1)

.PARAMETER IncludeFailed
  Include failed runs in the audit

.EXAMPLE
  .\scripts\audit-ci-artifacts.ps1
  .\scripts\audit-ci-artifacts.ps1 -Workflow security-tier2.yml -Last 3
  .\scripts\audit-ci-artifacts.ps1 -RunId 23922102006
  .\scripts\audit-ci-artifacts.ps1 -IncludeFailed -Last 5
#>
[CmdletBinding()]
param(
    [string]$RunId,
    [string]$Workflow,
    [string]$OutputDir = 'tmp/audit',
    [int]$Last = 1,
    [switch]$IncludeFailed
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

Set-Location $root

# ── Helpers ──────────────────────────────────────────────────────────

function Write-Section($title) {
    Write-Host "`n$('=' * 70)" -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host "$('=' * 70)" -ForegroundColor Cyan
}

function Write-Finding($severity, $message) {
    $color = switch ($severity) {
        'CRITICAL' { 'Red' }
        'HIGH'     { 'Red' }
        'WARN'     { 'Yellow' }
        'INFO'     { 'Gray' }
        'OK'       { 'Green' }
        default    { 'White' }
    }
    Write-Host "  [$severity] $message" -ForegroundColor $color
}

function Format-Bytes($bytes) {
    if ($bytes -ge 1MB) { return "{0:N1} MB" -f ($bytes / 1MB) }
    if ($bytes -ge 1KB) { return "{0:N1} KB" -f ($bytes / 1KB) }
    return "$bytes bytes"
}

# ── Discover runs ────────────────────────────────────────────────────

Write-Section "Discovering workflow runs"

$ghArgs = @('run', 'list', '--limit', [math]::Min($Last * 5, 50), '--json', 'databaseId,name,conclusion,status,event,createdAt,headBranch')
if ($Workflow) { $ghArgs += '--workflow'; $ghArgs += $Workflow }

$allRuns = gh @ghArgs 2>&1 | ConvertFrom-Json

if ($RunId) {
    $runs = @(@{ databaseId = [long]$RunId; name = '(specified)'; conclusion = ''; event = '' })
} else {
    $runs = $allRuns |
        Where-Object { $_.status -eq 'completed' } |
        Where-Object { $IncludeFailed -or $_.conclusion -eq 'success' }
    if (-not $runs) {
        $runs = $allRuns | Where-Object { $_.status -eq 'completed' } | Select-Object -First $Last
    } else {
        $runs = $runs | Select-Object -First $Last
    }
}

if (-not $runs -or $runs.Count -eq 0) {
    Write-Host "No matching runs found." -ForegroundColor Yellow
    exit 0
}

Write-Host "  Found $($runs.Count) run(s) to audit:"
foreach ($r in $runs) {
    $icon = if ($r.conclusion -eq 'success') { '✓' } elseif ($r.conclusion -eq 'failure') { '✗' } else { '?' }
    Write-Host "    $icon $($r.databaseId) | $($r.name) | $($r.conclusion) | $($r.event)" -ForegroundColor $(if ($r.conclusion -eq 'success') { 'Green' } else { 'Yellow' })
}

# ── Download artifacts ───────────────────────────────────────────────

$findings = @()
$totalArtifacts = 0

foreach ($run in $runs) {
    $runDir = Join-Path $OutputDir "run-$($run.databaseId)"
    Write-Section "Run $($run.databaseId) — $($run.name)"

    if (Test-Path $runDir) {
        Write-Host "  (cached — skipping download)" -ForegroundColor DarkGray
    } else {
        Write-Host "  Downloading artifacts..."
        New-Item -ItemType Directory -Force $runDir | Out-Null
        try {
            gh run download $run.databaseId -D $runDir 2>&1 | Out-Null
        } catch {
            Write-Finding 'WARN' "Failed to download artifacts: $_"
            continue
        }
    }

    $files = Get-ChildItem $runDir -Recurse -File
    $totalArtifacts += $files.Count
    $totalSize = ($files | Measure-Object -Property Length -Sum).Sum

    Write-Host "  $($files.Count) files, $(Format-Bytes $totalSize) total"

    # ── Server Logs Audit ────────────────────────────────────────────

    $serverLogs = $files | Where-Object { $_.Name -match 'server-.*\.log$|mcp-server\.log$' }
    if ($serverLogs) {
        Write-Section "Server Logs"
        foreach ($log in $serverLogs) {
            $content = Get-Content $log.FullName -Raw -ErrorAction SilentlyContinue
            $size = $log.Length
            Write-Host "  $($log.Name) ($(Format-Bytes $size))"

            if (-not $content -or $content.Trim() -eq '') {
                Write-Finding 'INFO' "Empty log file: $($log.Name)"
                continue
            }

            # Check for crashes
            if ($content -match 'Error:|FATAL|MODULE_NOT_FOUND|EADDRINUSE|UnhandledPromiseRejection|segfault') {
                $errorLines = ($content -split "`n") | Where-Object { $_ -match 'Error:|FATAL|MODULE_NOT_FOUND|EADDRINUSE' } | Select-Object -First 5
                Write-Finding 'HIGH' "Server errors detected in $($log.Name):"
                foreach ($line in $errorLines) {
                    Write-Host "      $($line.Trim())" -ForegroundColor Red
                }
                $findings += @{ Severity = 'HIGH'; Run = $run.databaseId; Message = "Server errors in $($log.Name)" }
            }

            # Check for successful startup
            if ($content -match 'Server started|server_started|SDK server started') {
                Write-Finding 'OK' "Server started successfully"
            } else {
                Write-Finding 'WARN' "No startup confirmation found in $($log.Name)"
                $findings += @{ Severity = 'WARN'; Run = $run.databaseId; Message = "No startup confirmation in $($log.Name)" }
            }

            # Check for clean shutdown
            if ($content -match 'ppid_orphan|shutdown|SIGTERM|Server stopped') {
                Write-Finding 'OK' "Clean shutdown detected"
            }

            # Check for security warnings
            if ($content -match 'CORS|unauthorized|403|401|certificate') {
                Write-Finding 'WARN' "Security-related log entries found"
            }
        }
    } else {
        Write-Finding 'INFO' "No server logs in this run"
    }

    # ── Test Results Audit ───────────────────────────────────────────

    $junitFiles = $files | Where-Object { $_.Name -eq 'junit.xml' }
    if ($junitFiles) {
        Write-Section "Test Results"
        foreach ($junit in $junitFiles) {
            try {
                [xml]$xml = Get-Content $junit.FullName
                $suites = $xml.testsuites
                $tests = [int]$suites.tests
                $failures = [int]$suites.failures
                $errors = [int]$suites.errors
                $skipped = [int]$suites.skipped
                $time = [math]::Round([double]$suites.time, 1)
                $passed = $tests - $failures - $errors - $skipped

                Write-Host "  Tests: $tests | Passed: $passed | Failed: $failures | Errors: $errors | Skipped: $skipped | Time: ${time}s"

                if ($failures -gt 0 -or $errors -gt 0) {
                    Write-Finding 'WARN' "$failures failure(s), $errors error(s)"
                    # Extract failed test names
                    $failedTests = $xml.SelectNodes('//testcase[failure]') | Select-Object -First 10
                    foreach ($ft in $failedTests) {
                        Write-Host "      FAIL: $($ft.classname) > $($ft.name)" -ForegroundColor Red
                    }
                    $findings += @{ Severity = 'WARN'; Run = $run.databaseId; Message = "$failures test failure(s)" }
                } else {
                    Write-Finding 'OK' "All $passed tests passed ($skipped skipped)"
                }
            } catch {
                Write-Finding 'WARN' "Could not parse junit.xml: $_"
            }
        }
    }

    # ── Coverage Audit ───────────────────────────────────────────────

    $lcovFiles = $files | Where-Object { $_.Name -eq 'lcov.info' }
    if ($lcovFiles) {
        Write-Section "Coverage"
        foreach ($lcov in $lcovFiles | Select-Object -First 1) {
            $content = Get-Content $lcov.FullName -Raw
            $linesFound = ([regex]::Matches($content, 'LF:(\d+)')).Groups | Where-Object { $_.Name -eq '1' } | ForEach-Object { [int]$_.Value } | Measure-Object -Sum
            $linesHit = ([regex]::Matches($content, 'LH:(\d+)')).Groups | Where-Object { $_.Name -eq '1' } | ForEach-Object { [int]$_.Value } | Measure-Object -Sum
            if ($linesFound.Sum -gt 0) {
                $pct = [math]::Round(($linesHit.Sum / $linesFound.Sum) * 100, 1)
                Write-Host "  Line coverage: $pct% ($($linesHit.Sum)/$($linesFound.Sum) lines)"
                if ($pct -lt 70) {
                    Write-Finding 'WARN' "Coverage below 70% threshold"
                    $findings += @{ Severity = 'WARN'; Run = $run.databaseId; Message = "Coverage $pct% (below 70%)" }
                } else {
                    Write-Finding 'OK' "Coverage meets threshold (>= 70%)"
                }
            }
        }
    }

    # ── Trace Logs Audit ─────────────────────────────────────────────

    $traceFiles = $files | Where-Object { $_.Name -match '\.jsonl$' -and $_.Name -notmatch 'rotation-test' }
    if ($traceFiles) {
        Write-Section "Trace Logs"
        $totalTraceLines = 0
        foreach ($tf in $traceFiles) {
            $lines = (Get-Content $tf.FullName | Measure-Object).Count
            $totalTraceLines += $lines
            if ($tf.Length -gt 0) {
                Write-Host "  $($tf.Name) — $lines entries ($(Format-Bytes $tf.Length))"
            }
        }
        Write-Finding 'INFO' "Total trace entries: $totalTraceLines across $($traceFiles.Count) file(s)"

        # Check for error-level traces
        $errorTraces = $traceFiles | ForEach-Object {
            Get-Content $_.FullName | Where-Object { $_ -match '"lvl":\s*[45]|"level":\s*"error"|tool_error' }
        }
        if ($errorTraces) {
            Write-Finding 'WARN' "$($errorTraces.Count) error-level trace entries found"
            $errorTraces | Select-Object -First 3 | ForEach-Object {
                Write-Host "      $($_.Substring(0, [math]::Min(120, $_.Length)))..." -ForegroundColor Yellow
            }
        }
    }

    # ── Security Scan Artifacts ──────────────────────────────────────

    $zapReport = $files | Where-Object { $_.Name -match 'report_html\.html|zap.*report' }
    $trivyReport = $files | Where-Object { $_.Name -match 'trivy.*\.sarif' }
    $niktoReport = $files | Where-Object { $_.Name -match 'nikto.*\.html' }
    $testsslReport = $files | Where-Object { $_.Name -match 'testssl.*\.json' }

    if ($zapReport -or $trivyReport -or $niktoReport -or $testsslReport) {
        Write-Section "Security Scan Artifacts"
        if ($zapReport) { Write-Finding 'INFO' "ZAP report: $($zapReport.Name) ($(Format-Bytes $zapReport.Length))" }
        if ($trivyReport) {
            Write-Finding 'INFO' "Trivy SARIF: $($trivyReport.Name) ($(Format-Bytes $trivyReport.Length))"
            # Parse SARIF for high/critical findings
            try {
                $sarif = Get-Content $trivyReport.FullName -Raw | ConvertFrom-Json
                $results = $sarif.runs[0].results
                if ($results) {
                    $critCount = ($results | Where-Object { $_.level -eq 'error' }).Count
                    $highCount = ($results | Where-Object { $_.level -eq 'warning' }).Count
                    Write-Host "    Trivy: $critCount critical, $highCount high findings"
                    if ($critCount -gt 0) {
                        Write-Finding 'HIGH' "Trivy found $critCount critical vulnerability(ies)"
                        $findings += @{ Severity = 'HIGH'; Run = $run.databaseId; Message = "Trivy: $critCount critical vulns" }
                    }
                }
            } catch { }
        }
        if ($niktoReport) { Write-Finding 'INFO' "Nikto report: $($niktoReport.Name) ($(Format-Bytes $niktoReport.Length))" }
        if ($testsslReport) { Write-Finding 'INFO' "testssl report: $($testsslReport.Name) ($(Format-Bytes $testsslReport.Length))" }
    }

    # ── Transaction Log Audit ────────────────────────────────────────

    $txLogs = $files | Where-Object { $_.Name -match 'instruction-transactions' }
    if ($txLogs) {
        Write-Section "Transaction Logs"
        foreach ($tx in $txLogs) {
            $lines = (Get-Content $tx.FullName | Measure-Object).Count
            Write-Host "  $($tx.Name) — $lines entries ($(Format-Bytes $tx.Length))"
            Write-Finding 'INFO' "Transaction audit trail captured"
        }
    }
}

# ── Summary ──────────────────────────────────────────────────────────

Write-Section "AUDIT SUMMARY"
Write-Host "  Runs audited:    $($runs.Count)"
Write-Host "  Total artifacts: $totalArtifacts files"
Write-Host "  Output dir:      $OutputDir"

$criticals = $findings | Where-Object { $_.Severity -in @('CRITICAL', 'HIGH') }
$warnings = $findings | Where-Object { $_.Severity -eq 'WARN' }

if ($criticals) {
    Write-Host "`n  CRITICAL/HIGH FINDINGS ($($criticals.Count)):" -ForegroundColor Red
    foreach ($f in $criticals) {
        Write-Host "    [$($f.Severity)] Run $($f.Run): $($f.Message)" -ForegroundColor Red
    }
}

if ($warnings) {
    Write-Host "`n  WARNINGS ($($warnings.Count)):" -ForegroundColor Yellow
    foreach ($f in $warnings) {
        Write-Host "    [$($f.Severity)] Run $($f.Run): $($f.Message)" -ForegroundColor Yellow
    }
}

if (-not $criticals -and -not $warnings) {
    Write-Host "`n  No issues found." -ForegroundColor Green
}

Write-Host ""
