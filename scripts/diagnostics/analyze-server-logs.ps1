#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Analyze index-server instance logs for errors, activity coverage, and client IP tracking.

.DESCRIPTION
  Parses server logs (mcp-server.log, instruction-transactions.log.jsonl, server-stderr.log,
  trace files) and produces a structured audit report covering:

  1. ERROR TRIAGE — errors categorized by severity, frequency, and actionability
  2. ACTIVITY COVERAGE — verifies all tool calls, HTTP requests, and mutations are logged
  3. CLIENT IP AUDIT — checks whether client IPs are captured for HTTP traffic
  4. COMPLETENESS CHECK — identifies logging gaps (missing fields, uncorrelated requests)

.PARAMETER LogDir
  Directory containing log files to analyze. Can be:
  - A local logs/ directory from a running server
  - A downloaded CI artifact directory (e.g., tmp/audit/run-12345)
  Default: logs/

.PARAMETER Recursive
  Search subdirectories for log files

.PARAMETER JsonOutput
  Output findings as JSON (for CI pipelines)

.EXAMPLE
  .\scripts\analyze-server-logs.ps1
  .\scripts\analyze-server-logs.ps1 -LogDir tmp/audit/run-23922102006
  .\scripts\analyze-server-logs.ps1 -LogDir tmp/ci-artifacts/tier2-fixed -Recursive
  .\scripts\analyze-server-logs.ps1 -LogDir logs/ -JsonOutput
#>
[CmdletBinding()]
param(
    [string]$LogDir = 'logs',
    [switch]$Recursive,
    [switch]$JsonOutput
)

$ErrorActionPreference = 'Continue'

# ── Helpers ──────────────────────────────────────────────────────────

function Write-Section($title) {
    if ($JsonOutput) { return }
    Write-Host "`n$('═' * 72)" -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host "$('═' * 72)" -ForegroundColor Cyan
}

function Write-Finding($severity, $message, $detail) {
    if ($JsonOutput) { return }
    $color = switch ($severity) {
        'CRITICAL' { 'Red' }
        'ERROR'    { 'Red' }
        'WARN'     { 'Yellow' }
        'INFO'     { 'DarkGray' }
        'OK'       { 'Green' }
        'GAP'      { 'Magenta' }
        default    { 'White' }
    }
    Write-Host "  [$severity] $message" -ForegroundColor $color
    if ($detail) { Write-Host "         $detail" -ForegroundColor DarkGray }
}

$findings = [System.Collections.ArrayList]::new()
function Add-Finding($category, $severity, $message, $detail, $count) {
    [void]$findings.Add(@{
        category = $category
        severity = $severity
        message  = $message
        detail   = $detail
        count    = $count
    })
}

# ── Discover log files ───────────────────────────────────────────────

Write-Section "LOG FILE DISCOVERY"

$searchOpt = if ($Recursive) { 'AllDirectories' } else { 'TopDirectoryOnly' }
$allFiles = @()

# Search multiple possible locations
$searchPaths = @($LogDir)
if ($Recursive) {
    $searchPaths += Get-ChildItem $LogDir -Directory -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
}

foreach ($sp in $searchPaths) {
    if (Test-Path $sp) {
        $allFiles += Get-ChildItem $sp -File -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -match '\.(log|jsonl|json)$'
        }
    }
}

$allFiles = $allFiles | Sort-Object FullName -Unique

$serverLogs   = $allFiles | Where-Object { $_.Name -match '^(mcp-server|server-stderr|server-stdout)\.log$' }
$auditLogs    = $allFiles | Where-Object { $_.Name -match 'instruction-transactions' }
$traceLogs    = $allFiles | Where-Object { $_.Name -match '^trace-.*\.jsonl$' -and $_.Length -gt 0 }

if (-not $JsonOutput) {
    Write-Host "  Search root: $LogDir"
    Write-Host "  Server logs:      $($serverLogs.Count) file(s)"
    Write-Host "  Audit trail logs: $($auditLogs.Count) file(s)"
    Write-Host "  Trace logs:       $($traceLogs.Count) file(s)"
    Write-Host "  Total log files:  $($allFiles.Count)"
}

if ($allFiles.Count -eq 0) {
    Write-Finding 'WARN' 'No log files found in specified directory'
    if ($JsonOutput) { $findings | ConvertTo-Json -Depth 5; exit 0 }
    exit 0
}

# ══════════════════════════════════════════════════════════════════════
#  1. ERROR TRIAGE
# ══════════════════════════════════════════════════════════════════════

Write-Section "1. ERROR TRIAGE"

$errorsByType = @{}
$warningsByType = @{}
$criticalErrors = @()

foreach ($log in $serverLogs) {
    $lines = Get-Content $log.FullName -ErrorAction SilentlyContinue
    if (-not $lines) { continue }

    foreach ($line in $lines) {
        # Structured JSON errors
        if ($line -match '"level"\s*:\s*"error"' -or $line -match '\bERROR\b' -or $line -match '\bFATAL\b') {
            # Extract error event/type
            $evtMatch = [regex]::Match($line, '"evt"\s*:\s*"([^"]+)"')
            $eventKey = if ($evtMatch.Success) { $evtMatch.Groups[1].Value } else { 'unknown_error' }

            # Check for critical patterns
            if ($line -match 'MODULE_NOT_FOUND|EADDRINUSE|EACCES|ENOMEM|segfault|heap out of memory') {
                $criticalErrors += @{ file = $log.Name; line = $line.Substring(0, [math]::Min(200, $line.Length)); type = 'CRITICAL' }
            }

            if (-not $errorsByType.ContainsKey($eventKey)) { $errorsByType[$eventKey] = 0 }
            $errorsByType[$eventKey]++
        }

        # Warnings
        if ($line -match '"level"\s*:\s*"warn"' -or $line -match '\bWARN\b') {
            $evtMatch = [regex]::Match($line, '"evt"\s*:\s*"([^"]+)"')
            $eventKey = if ($evtMatch.Success) { $evtMatch.Groups[1].Value }
            elseif ($line -match '\[(\w+)\]\s*WARN') { $Matches[1] }
            else { 'unknown_warn' }

            if (-not $warningsByType.ContainsKey($eventKey)) { $warningsByType[$eventKey] = 0 }
            $warningsByType[$eventKey]++
        }

        # Unhandled rejections / crashes
        if ($line -match 'UnhandledPromiseRejection|unhandledRejection|uncaughtException') {
            $criticalErrors += @{ file = $log.Name; line = $line.Substring(0, [math]::Min(200, $line.Length)); type = 'UNHANDLED' }
        }
    }
}

# Also check audit logs for error entries
foreach ($log in $auditLogs) {
    $lines = Get-Content $log.FullName -ErrorAction SilentlyContinue
    if (-not $lines) { continue }
    foreach ($line in $lines) {
        if ($line -match '"success"\s*:\s*false') {
            try {
                $entry = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
                $key = "tool_error:$($entry.action)"
                if (-not $errorsByType.ContainsKey($key)) { $errorsByType[$key] = 0 }
                $errorsByType[$key]++
            } catch { }
        }
    }
}

# Report
if ($criticalErrors.Count -gt 0) {
    Write-Finding 'CRITICAL' "$($criticalErrors.Count) critical error(s) found — REQUIRES IMMEDIATE ATTENTION"
    foreach ($ce in $criticalErrors | Select-Object -First 5) {
        Write-Finding 'CRITICAL' "$($ce.type) in $($ce.file)" $ce.line
    }
    Add-Finding 'errors' 'CRITICAL' "Critical errors: $($criticalErrors.Count)" ($criticalErrors | ForEach-Object { $_.line }) $criticalErrors.Count
}

if ($errorsByType.Count -gt 0) {
    $totalErrors = ($errorsByType.Values | Measure-Object -Sum).Sum
    Write-Finding 'ERROR' "$totalErrors error(s) across $($errorsByType.Count) type(s):"
    $errorsByType.GetEnumerator() | Sort-Object { -$_.Value } | Select-Object -First 15 | ForEach-Object {
        $actionable = if ($_.Key -match 'tool_error|code_[45]') { '← actionable' } else { '' }
        Write-Host "         $($_.Value.ToString().PadLeft(5))x  $($_.Key)  $actionable" -ForegroundColor $(if ($actionable) { 'Yellow' } else { 'Gray' })
    }
    Add-Finding 'errors' 'ERROR' "Total errors: $totalErrors" $null $totalErrors
} else {
    Write-Finding 'OK' 'No errors found in server logs'
}

if ($warningsByType.Count -gt 0) {
    $totalWarns = ($warningsByType.Values | Measure-Object -Sum).Sum
    Write-Finding 'WARN' "$totalWarns warning(s) across $($warningsByType.Count) type(s):"
    $warningsByType.GetEnumerator() | Sort-Object { -$_.Value } | Select-Object -First 10 | ForEach-Object {
        Write-Host "         $($_.Value.ToString().PadLeft(5))x  $($_.Key)" -ForegroundColor DarkYellow
    }
    Add-Finding 'errors' 'WARN' "Total warnings: $totalWarns" $null $totalWarns
}

# ══════════════════════════════════════════════════════════════════════
#  2. ACTIVITY COVERAGE
# ══════════════════════════════════════════════════════════════════════

Write-Section "2. ACTIVITY COVERAGE"

$toolCalls = @{}
$httpRequests = @{}
$mutations = @{}
$totalAuditEntries = 0

foreach ($log in $auditLogs) {
    $lines = Get-Content $log.FullName -ErrorAction SilentlyContinue
    if (-not $lines) { continue }

    foreach ($line in $lines) {
        $totalAuditEntries++
        try {
            $entry = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
            if (-not $entry) { continue }

            $kind = $entry.kind
            $action = $entry.action

            switch ($kind) {
                'http' {
                    if (-not $httpRequests.ContainsKey($action)) { $httpRequests[$action] = 0 }
                    $httpRequests[$action]++
                }
                'mutation' {
                    if (-not $mutations.ContainsKey($action)) { $mutations[$action] = 0 }
                    $mutations[$action]++
                    # Also count in tool calls
                    if (-not $toolCalls.ContainsKey($action)) { $toolCalls[$action] = 0 }
                    $toolCalls[$action]++
                }
                'read' {
                    if (-not $toolCalls.ContainsKey($action)) { $toolCalls[$action] = 0 }
                    $toolCalls[$action]++
                }
            }
        } catch { }
    }
}

Write-Host "  Total audit entries: $totalAuditEntries"

if ($toolCalls.Count -gt 0) {
    $totalToolCalls = ($toolCalls.Values | Measure-Object -Sum).Sum
    Write-Finding 'OK' "$totalToolCalls tool call(s) logged across $($toolCalls.Count) tool(s)"
    Write-Host ""
    Write-Host "  Tool call distribution:" -ForegroundColor White
    $toolCalls.GetEnumerator() | Sort-Object { -$_.Value } | Select-Object -First 20 | ForEach-Object {
        $bar = '█' * [math]::Min(40, [math]::Max(1, [int]($_.Value / [math]::Max(1, $totalToolCalls) * 40)))
        Write-Host "    $($_.Value.ToString().PadLeft(6))  $($_.Key.PadRight(30)) $bar" -ForegroundColor Gray
    }
    Add-Finding 'activity' 'OK' "Tool calls: $totalToolCalls across $($toolCalls.Count) tools" $null $totalToolCalls
} else {
    Write-Finding 'GAP' 'No tool calls found in audit logs'
    Add-Finding 'activity' 'GAP' 'No tool calls in audit trail' $null 0
}

if ($httpRequests.Count -gt 0) {
    $totalHttp = ($httpRequests.Values | Measure-Object -Sum).Sum
    Write-Finding 'OK' "$totalHttp HTTP request(s) logged across $($httpRequests.Count) endpoint(s)"
    Write-Host ""
    Write-Host "  HTTP endpoint distribution:" -ForegroundColor White
    $httpRequests.GetEnumerator() | Sort-Object { -$_.Value } | Select-Object -First 15 | ForEach-Object {
        Write-Host "    $($_.Value.ToString().PadLeft(6))  $($_.Key)" -ForegroundColor Gray
    }
    Add-Finding 'activity' 'OK' "HTTP requests: $totalHttp across $($httpRequests.Count) endpoints" $null $totalHttp
} else {
    Write-Finding 'INFO' 'No HTTP requests in audit trail (expected for stdio-only mode)'
}

if ($mutations.Count -gt 0) {
    $totalMutations = ($mutations.Values | Measure-Object -Sum).Sum
    Write-Finding 'OK' "$totalMutations mutation(s) logged across $($mutations.Count) type(s)"
    $mutations.GetEnumerator() | Sort-Object { -$_.Value } | ForEach-Object {
        Write-Host "    $($_.Value.ToString().PadLeft(6))  $($_.Key)" -ForegroundColor Gray
    }
    Add-Finding 'activity' 'OK' "Mutations: $totalMutations" $null $totalMutations
}

# ══════════════════════════════════════════════════════════════════════
#  3. CLIENT IP AUDIT
# ══════════════════════════════════════════════════════════════════════

Write-Section "3. CLIENT IP AUDIT"

$ipsCaptured = @{}
$httpWithoutIp = 0
$httpWithIp = 0

foreach ($log in $auditLogs) {
    $lines = Get-Content $log.FullName -ErrorAction SilentlyContinue
    if (-not $lines) { continue }

    foreach ($line in $lines) {
        try {
            $entry = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
            if (-not $entry -or $entry.kind -ne 'http') { continue }

            $ip = $entry.meta.clientIp
            if ($ip) {
                $httpWithIp++
                if (-not $ipsCaptured.ContainsKey($ip)) { $ipsCaptured[$ip] = 0 }
                $ipsCaptured[$ip]++
            } else {
                $httpWithoutIp++
            }
        } catch { }
    }
}

$totalHttpAudited = $httpWithIp + $httpWithoutIp

if ($totalHttpAudited -gt 0) {
    $pct = if ($totalHttpAudited -gt 0) { [math]::Round(($httpWithIp / $totalHttpAudited) * 100, 1) } else { 0 }
    Write-Finding 'INFO' "HTTP requests audited: $totalHttpAudited"
    Write-Host "    With client IP:     $httpWithIp ($pct%)" -ForegroundColor $(if ($pct -ge 95) { 'Green' } else { 'Yellow' })
    Write-Host "    Without client IP:  $httpWithoutIp" -ForegroundColor $(if ($httpWithoutIp -gt 0) { 'Yellow' } else { 'Green' })

    if ($httpWithoutIp -gt 0) {
        Write-Finding 'GAP' "$httpWithoutIp HTTP request(s) missing client IP"
        Add-Finding 'client_ip' 'GAP' "HTTP requests without client IP: $httpWithoutIp" $null $httpWithoutIp
    } else {
        Write-Finding 'OK' "All HTTP requests have client IP captured"
    }

    if ($ipsCaptured.Count -gt 0) {
        Write-Host ""
        Write-Host "  Client IP distribution:" -ForegroundColor White
        $ipsCaptured.GetEnumerator() | Sort-Object { -$_.Value } | ForEach-Object {
            Write-Host "    $($_.Value.ToString().PadLeft(6))  $($_.Key)" -ForegroundColor Gray
        }
    }

    Add-Finding 'client_ip' $(if ($pct -ge 95) { 'OK' } else { 'WARN' }) "IP capture rate: $pct%" $null $httpWithIp
} else {
    Write-Finding 'INFO' 'No HTTP traffic in audit logs (stdio-only mode — no client IPs expected)'
    Add-Finding 'client_ip' 'INFO' 'No HTTP traffic (stdio mode)' $null 0
}

# ══════════════════════════════════════════════════════════════════════
#  4. COMPLETENESS & GAP ANALYSIS
# ══════════════════════════════════════════════════════════════════════

Write-Section "4. COMPLETENESS & GAP ANALYSIS"

# Check for correlation IDs
$withCorrelation = 0
$withoutCorrelation = 0
foreach ($log in $auditLogs) {
    $lines = Get-Content $log.FullName -ErrorAction SilentlyContinue
    if (-not $lines) { continue }
    foreach ($line in $lines) {
        if ($line -match '"correlationId"') { $withCorrelation++ }
        elseif ($line -match '"kind"\s*:\s*"(read|mutation)"') { $withoutCorrelation++ }
    }
}

if (($withCorrelation + $withoutCorrelation) -gt 0) {
    $corrPct = [math]::Round(($withCorrelation / ($withCorrelation + $withoutCorrelation)) * 100, 1)
    if ($corrPct -ge 95) {
        Write-Finding 'OK' "Correlation ID coverage: $corrPct% ($withCorrelation/$($withCorrelation + $withoutCorrelation))"
    } else {
        Write-Finding 'GAP' "Correlation ID coverage: $corrPct% — $withoutCorrelation tool calls lack correlation"
        Add-Finding 'completeness' 'GAP' "Missing correlation IDs: $withoutCorrelation" $null $withoutCorrelation
    }
}

# Check for missing user-agent in HTTP logs (known gap)
$httpEntries = 0
$httpWithUserAgent = 0
foreach ($log in $auditLogs) {
    $lines = Get-Content $log.FullName -ErrorAction SilentlyContinue
    if (-not $lines) { continue }
    foreach ($line in $lines) {
        if ($line -match '"kind"\s*:\s*"http"') {
            $httpEntries++
            if ($line -match '"userAgent"') { $httpWithUserAgent++ }
        }
    }
}

if ($httpEntries -gt 0) {
    if ($httpWithUserAgent -eq 0) {
        Write-Finding 'GAP' "User-Agent not captured in HTTP audit trail ($httpEntries requests)"
        Write-Finding 'INFO' 'Known gap — ApiRoutes.ts does not include req.headers[user-agent] in logHttpAudit()'
        Add-Finding 'completeness' 'GAP' 'User-Agent missing from HTTP audit' 'ApiRoutes.ts logHttpAudit() does not pass user-agent' $httpEntries
    } else {
        Write-Finding 'OK' "User-Agent captured in $httpWithUserAgent/$httpEntries HTTP entries"
    }
}

# Check for startup/shutdown completeness
$startups = 0
$shutdowns = 0
foreach ($log in $serverLogs) {
    $content = Get-Content $log.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    $startups += ([regex]::Matches($content, 'server_started|Server started|SDK server started')).Count
    $shutdowns += ([regex]::Matches($content, 'ppid_orphan|shutdown|SIGTERM|Server stopped|Session Ended')).Count
}

if ($startups -gt 0) {
    Write-Finding 'OK' "Server startups: $startups, shutdowns: $shutdowns"
    if ($startups -gt $shutdowns + 1) {
        Write-Finding 'WARN' "More startups than shutdowns — possible unclean exit(s)"
        Add-Finding 'completeness' 'WARN' "Unbalanced startup/shutdown: $startups starts, $shutdowns stops" $null ($startups - $shutdowns)
    }
}

# Check for instruction ID tracking in mutations
$mutationsWithIds = 0
$mutationsWithoutIds = 0
foreach ($log in $auditLogs) {
    $lines = Get-Content $log.FullName -ErrorAction SilentlyContinue
    if (-not $lines) { continue }
    foreach ($line in $lines) {
        if ($line -match '"kind"\s*:\s*"mutation"') {
            if ($line -match '"ids"\s*:') { $mutationsWithIds++ }
            else { $mutationsWithoutIds++ }
        }
    }
}

if (($mutationsWithIds + $mutationsWithoutIds) -gt 0) {
    $idPct = [math]::Round(($mutationsWithIds / ($mutationsWithIds + $mutationsWithoutIds)) * 100, 1)
    if ($idPct -ge 80) {
        Write-Finding 'OK' "Mutation ID tracking: $idPct% ($mutationsWithIds/$($mutationsWithIds + $mutationsWithoutIds) have instruction IDs)"
    } else {
        Write-Finding 'GAP' "Mutation ID tracking: $idPct% — $mutationsWithoutIds mutations lack instruction IDs"
        Add-Finding 'completeness' 'GAP' "Mutations without instruction IDs: $mutationsWithoutIds" $null $mutationsWithoutIds
    }
}

# ══════════════════════════════════════════════════════════════════════
#  5. TIMING & PERFORMANCE
# ══════════════════════════════════════════════════════════════════════

Write-Section "5. PERFORMANCE SIGNALS"

$slowOps = @()
foreach ($log in $auditLogs) {
    $lines = Get-Content $log.FullName -ErrorAction SilentlyContinue
    if (-not $lines) { continue }
    foreach ($line in $lines) {
        try {
            $entry = $line | ConvertFrom-Json -ErrorAction SilentlyContinue
            if (-not $entry -or -not $entry.meta.durationMs) { continue }
            $ms = [double]$entry.meta.durationMs
            if ($ms -gt 1000) {
                $slowOps += @{ action = $entry.action; kind = $entry.kind; ms = $ms }
            }
        } catch { }
    }
}

if ($slowOps.Count -gt 0) {
    Write-Finding 'WARN' "$($slowOps.Count) operation(s) exceeded 1000ms:"
    $slowOps | Sort-Object { -$_.ms } | Select-Object -First 10 | ForEach-Object {
        Write-Host "    $([math]::Round($_.ms, 0).ToString().PadLeft(7))ms  $($_.kind.PadRight(10)) $($_.action)" -ForegroundColor Yellow
    }
    Add-Finding 'performance' 'WARN' "Slow operations (>1s): $($slowOps.Count)" $null $slowOps.Count
} else {
    Write-Finding 'OK' 'No operations exceeded 1000ms'
}

# ══════════════════════════════════════════════════════════════════════
#  SUMMARY
# ══════════════════════════════════════════════════════════════════════

Write-Section "SUMMARY"

$critCount  = ($findings | Where-Object { $_.severity -in @('CRITICAL','ERROR') }).Count
$warnCount  = ($findings | Where-Object { $_.severity -eq 'WARN' }).Count
$gapCount   = ($findings | Where-Object { $_.severity -eq 'GAP' }).Count
$okCount    = ($findings | Where-Object { $_.severity -eq 'OK' }).Count

Write-Host "  Files analyzed: $($allFiles.Count)"
Write-Host "  Audit entries:  $totalAuditEntries"
Write-Host ""
Write-Host "  Findings:" -ForegroundColor White
Write-Host "    Critical/Error: $critCount" -ForegroundColor $(if ($critCount -gt 0) { 'Red' } else { 'Green' })
Write-Host "    Warnings:       $warnCount" -ForegroundColor $(if ($warnCount -gt 0) { 'Yellow' } else { 'Green' })
Write-Host "    Gaps:           $gapCount" -ForegroundColor $(if ($gapCount -gt 0) { 'Magenta' } else { 'Green' })
Write-Host "    OK:             $okCount" -ForegroundColor Green

if ($JsonOutput) {
    @{
        analyzedAt = (Get-Date).ToUniversalTime().ToString('o')
        logDir     = $LogDir
        fileCount  = $allFiles.Count
        auditEntries = $totalAuditEntries
        summary    = @{
            criticals = $critCount
            warnings  = $warnCount
            gaps      = $gapCount
            ok        = $okCount
        }
        findings = $findings
    } | ConvertTo-Json -Depth 5
}

Write-Host ""
