<#
.SYNOPSIS
  Comprehensive search benchmark across keyword, regex, and semantic modes.
  Runs ~30s of stress queries and saves results to a markdown report with Mermaid charts.

.PARAMETER Device
  The INDEX_SERVER_SEMANTIC_DEVICE value currently configured (cpu, cuda, dml). Used for labeling only.

.PARAMETER OutputPath
  Path to write the markdown results file.

.PARAMETER Port
  Dashboard HTTP port (auto-detected from listening ports 8787-8799 if omitted).

.EXAMPLE
  .\scripts\benchmark-search.ps1 -Device cpu -OutputPath .\docs\benchmark-results.md
#>
param(
    [ValidateSet('cpu','cuda','dml')]
    [string]$Device = 'cpu',
    [string]$OutputPath = (Join-Path $PSScriptRoot '..' 'docs' 'benchmark-results.md'),
    [int]$Port = 0,
    [ValidateSet('http','https')]
    [string]$Scheme = 'https'
)

$ErrorActionPreference = 'Stop'

# --- Auto-detect dashboard port if not specified ---
if ($Port -eq 0) {
    $listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -ge 8787 -and $_.LocalPort -le 8799 } |
        Sort-Object LocalPort |
        Select-Object -First 1
    if ($listening) {
        $Port = $listening.LocalPort
        Write-Host "Auto-detected dashboard port: $Port" -ForegroundColor Yellow
    } else {
        Write-Error "No MCP dashboard port found listening on 8787-8799. Start the server or specify -Port."
        return
    }
}
$baseUri = "${Scheme}://127.0.0.1:$Port/api/tools/instructions_search"

# Skip certificate validation for self-signed certs
if ($Scheme -eq 'https') {
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        $PSDefaultParameterValues['Invoke-RestMethod:SkipCertificateCheck'] = $true
        $PSDefaultParameterValues['Invoke-WebRequest:SkipCertificateCheck'] = $true
    } else {
        Add-Type @"
        using System.Net;
        using System.Net.Security;
        using System.Security.Cryptography.X509Certificates;
        public class TrustAll {
            public static void Enable() {
                ServicePointManager.ServerCertificateValidationCallback = delegate { return true; };
            }
        }
"@
        [TrustAll]::Enable()
    }
}

# Verify endpoint is reachable
try {
    $null = Invoke-RestMethod -Uri "${Scheme}://127.0.0.1:$Port/api/tools" -Method GET -TimeoutSec 5
} catch {
    Write-Error "Cannot reach dashboard at ${Scheme}://127.0.0.1:$Port. Ensure server is running and restart after deploying tools endpoint."
    return
}

# --- Test definitions: complex, varied queries covering all modes ---
$queries = @(
    # Simple single-keyword
    @{ name = "simple-single";       keywords = @("security");              mode = "keyword" }
    @{ name = "simple-single";       keywords = @("security");              mode = "regex"   }
    @{ name = "simple-single";       keywords = @("security");              mode = "semantic" }

    # Multi-keyword AND-style
    @{ name = "multi-keyword";       keywords = @("deploy","kubernetes","container"); mode = "keyword" }
    @{ name = "multi-keyword";       keywords = @("deploy","kubernetes","container"); mode = "regex"   }
    @{ name = "multi-keyword";       keywords = @("deploy","kubernetes","container"); mode = "semantic" }

    # Complex regex alternation
    @{ name = "regex-alternation";   keywords = @("deploy|release|publish"); mode = "keyword" }
    @{ name = "regex-alternation";   keywords = @("deploy|release|publish"); mode = "regex"   }
    @{ name = "regex-alternation";   keywords = @("deploy|release|publish"); mode = "semantic" }

    # Broad conceptual
    @{ name = "broad-concept";       keywords = @("best practices for error handling"); mode = "keyword" }
    @{ name = "broad-concept";       keywords = @("best practices for error handling"); mode = "regex"   }
    @{ name = "broad-concept";       keywords = @("best practices for error handling"); mode = "semantic" }

    # Technical narrow
    @{ name = "tech-narrow";         keywords = @("RBAC","authorization","role"); mode = "keyword" }
    @{ name = "tech-narrow";         keywords = @("RBAC","authorization","role"); mode = "regex"   }
    @{ name = "tech-narrow";         keywords = @("RBAC","authorization","role"); mode = "semantic" }

    # Pattern matching
    @{ name = "pattern-match";       keywords = @("test.*coverage|unit.test"); mode = "keyword" }
    @{ name = "pattern-match";       keywords = @("test.*coverage|unit.test"); mode = "regex"   }
    @{ name = "pattern-match";       keywords = @("test.*coverage|unit.test"); mode = "semantic" }

    # Long natural language
    @{ name = "natural-lang";        keywords = @("how to configure CI/CD pipelines with automated testing"); mode = "keyword" }
    @{ name = "natural-lang";        keywords = @("how to configure CI/CD pipelines with automated testing"); mode = "regex"   }
    @{ name = "natural-lang";        keywords = @("how to configure CI/CD pipelines with automated testing"); mode = "semantic" }

    # Infrastructure & ops
    @{ name = "infra-ops";           keywords = @("monitoring","alerting","observability"); mode = "keyword" }
    @{ name = "infra-ops";           keywords = @("monitoring","alerting","observability"); mode = "regex"   }
    @{ name = "infra-ops";           keywords = @("monitoring","alerting","observability"); mode = "semantic" }

    # Code quality
    @{ name = "code-quality";        keywords = @("lint","format","code review"); mode = "keyword" }
    @{ name = "code-quality";        keywords = @("lint","format","code review"); mode = "regex"   }
    @{ name = "code-quality";        keywords = @("lint","format","code review"); mode = "semantic" }

    # Repeat key queries for warm cache timing
    @{ name = "warm-security";       keywords = @("security");              mode = "semantic" }
    @{ name = "warm-deploy";         keywords = @("deploy","kubernetes","container"); mode = "semantic" }
    @{ name = "warm-concept";        keywords = @("best practices for error handling"); mode = "semantic" }
)

Write-Host "=== MCP Search Benchmark ===" -ForegroundColor Cyan
Write-Host "Device: $Device | Queries: $($queries.Count) | $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host ""

$results = @()
$totalStart = Get-Date

foreach ($q in $queries) {
    $label = "$($q.name)/$($q.mode)"
    Write-Host -NoNewline "  Running: $label ... "

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $params = @{
            keywords = $q.keywords
            mode     = $q.mode
            limit    = 50
        }

        # Call the REST tool endpoint
        $jsonInput = $params | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Uri $baseUri -Method POST -Body $jsonInput -ContentType 'application/json' -TimeoutSec 30
        $sw.Stop()

        $matchCount = if ($response.totalMatches) { $response.totalMatches }
                      elseif ($response.result -and $response.result.totalMatches) { $response.result.totalMatches }
                      else { 0 }
        $execMs = if ($response.executionTimeMs) { [math]::Round($response.executionTimeMs, 2) }
                  elseif ($response.result -and $response.result.executionTimeMs) { [math]::Round($response.result.executionTimeMs, 2) }
                  else { $sw.ElapsedMilliseconds }
        $returnCount = if ($response.results) { $response.results.Count }
                       elseif ($response.result -and $response.result.results) { $response.result.results.Count }
                       else { 0 }

        Write-Host "${execMs}ms (${returnCount}/${matchCount} results)" -ForegroundColor Green

        $results += [PSCustomObject]@{
            Name        = $q.name
            Mode        = $q.mode
            Keywords    = ($q.keywords -join ', ')
            ExecMs      = $execMs
            WallMs      = $sw.ElapsedMilliseconds
            Matches     = $matchCount
            Returned    = $returnCount
            Status      = 'OK'
        }
    } catch {
        $sw.Stop()
        Write-Host "FAILED: $_" -ForegroundColor Red
        $results += [PSCustomObject]@{
            Name        = $q.name
            Mode        = $q.mode
            Keywords    = ($q.keywords -join ', ')
            ExecMs      = $sw.ElapsedMilliseconds
            WallMs      = $sw.ElapsedMilliseconds
            Matches     = 0
            Returned    = 0
            Status      = "ERROR: $($_.Exception.Message)"
        }
    }
}

$totalEnd = Get-Date
$totalSec = [math]::Round(($totalEnd - $totalStart).TotalSeconds, 2)
Write-Host ""
Write-Host "=== Complete: ${totalSec}s ===" -ForegroundColor Cyan

# --- Compute summary stats ---
$keywordResults  = $results | Where-Object { $_.Mode -eq 'keyword'  -and $_.Status -eq 'OK' }
$regexResults    = $results | Where-Object { $_.Mode -eq 'regex'    -and $_.Status -eq 'OK' }
$semanticResults = $results | Where-Object { $_.Mode -eq 'semantic' -and $_.Status -eq 'OK' }

function Get-Stats($data) {
    if (-not $data -or $data.Count -eq 0) { return @{ Avg = 0; Min = 0; Max = 0; P50 = 0; P95 = 0; Count = 0 } }
    $sorted = $data | Sort-Object ExecMs
    $vals = $sorted.ExecMs
    @{
        Avg   = [math]::Round(($vals | Measure-Object -Average).Average, 2)
        Min   = [math]::Round(($vals | Measure-Object -Minimum).Minimum, 2)
        Max   = [math]::Round(($vals | Measure-Object -Maximum).Maximum, 2)
        P50   = [math]::Round($vals[[math]::Floor($vals.Count * 0.5)], 2)
        P95   = [math]::Round($vals[[math]::Min($vals.Count - 1, [math]::Floor($vals.Count * 0.95))], 2)
        Count = $vals.Count
    }
}

$kwStats  = Get-Stats $keywordResults
$rxStats  = Get-Stats $regexResults
$smStats  = Get-Stats $semanticResults

# --- Generate Markdown ---
$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$md = @"
# MCP Search Benchmark Results

**Date**: $timestamp
**Device**: ``$Device``
**Total Duration**: ${totalSec}s
**Total Queries**: $($queries.Count)
**GPU**: $(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)
**OS**: $(Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption)

---

## Summary Statistics

| Mode | Queries | Avg (ms) | Min (ms) | P50 (ms) | P95 (ms) | Max (ms) |
|------|---------|----------|----------|----------|----------|----------|
| keyword | $($kwStats.Count) | $($kwStats.Avg) | $($kwStats.Min) | $($kwStats.P50) | $($kwStats.P95) | $($kwStats.Max) |
| regex | $($rxStats.Count) | $($rxStats.Avg) | $($rxStats.Min) | $($rxStats.P50) | $($rxStats.P95) | $($rxStats.Max) |
| semantic | $($smStats.Count) | $($smStats.Avg) | $($smStats.Min) | $($smStats.P50) | $($smStats.P95) | $($smStats.Max) |

---

## Average Execution Time by Mode

``````mermaid
bar chart
    title Average Search Time (ms) — $Device
    x-axis [keyword, regex, semantic]
    y-axis "Time (ms)" 0 --> $([math]::Max(1, [math]::Ceiling((@($kwStats.Max, $rxStats.Max, $smStats.Max) | Measure-Object -Maximum).Maximum * 1.2)))
    bar [$($kwStats.Avg), $($rxStats.Avg), $($smStats.Avg)]
``````

## Latency Distribution (P50 vs P95 vs Max)

``````mermaid
xychart-beta
    title "Latency Percentiles — $Device"
    x-axis ["keyword", "regex", "semantic"]
    y-axis "Time (ms)" 0 --> $([math]::Max(1, [math]::Ceiling((@($kwStats.Max, $rxStats.Max, $smStats.Max) | Measure-Object -Maximum).Maximum * 1.2)))
    bar [$($kwStats.P50), $($rxStats.P50), $($smStats.P50)]
    bar [$($kwStats.P95), $($rxStats.P95), $($smStats.P95)]
    bar [$($kwStats.Max), $($rxStats.Max), $($smStats.Max)]
``````

## Per-Query Execution Timeline

``````mermaid
xychart-beta
    title "Per-Query Execution Time — $Device"
    x-axis [$(($results | ForEach-Object { "`"$($_.Name.Substring(0, [math]::Min(8, $_.Name.Length)))/$($_.Mode.Substring(0,3))`"" }) -join ', ')]
    y-axis "Time (ms)"
    line [$(($results.ExecMs) -join ', ')]
``````

## Match Count Comparison

``````mermaid
xychart-beta
    title "Total Matches by Query — $Device"
    x-axis [$(($results | ForEach-Object { "`"$($_.Name.Substring(0, [math]::Min(8, $_.Name.Length)))/$($_.Mode.Substring(0,3))`"" }) -join ', ')]
    y-axis "Matches"
    bar [$(($results.Matches) -join ', ')]
``````

---

## Detailed Results

| # | Query | Mode | Keywords | Exec (ms) | Wall (ms) | Matches | Returned | Status |
|---|-------|------|----------|-----------|-----------|---------|----------|--------|
"@

$i = 1
foreach ($r in $results) {
    $md += "| $i | $($r.Name) | $($r.Mode) | $($r.Keywords) | $($r.ExecMs) | $($r.WallMs) | $($r.Matches) | $($r.Returned) | $($r.Status) |`n"
    $i++
}

$md += @"

---

## Mode Descriptions

| Mode | Description |
|------|-------------|
| **keyword** | Default substring matching — scans titles, bodies, categories for literal text |
| **regex** | Pattern-based search — keywords treated as regex (supports alternation, wildcards) |
| **semantic** | Embedding-based similarity — uses ``Xenova/all-MiniLM-L6-v2`` model for conceptual matching |

## Environment

| Setting | Value |
|---------|-------|
| ``INDEX_SERVER_SEMANTIC_ENABLED`` | 1 |
| ``INDEX_SERVER_SEMANTIC_DEVICE`` | $Device |
| Model | Xenova/all-MiniLM-L6-v2 |
| Node.js | $(node --version) |
"@

# Write output
$outDir = Split-Path $OutputPath -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$md | Out-File -FilePath $OutputPath -Encoding utf8 -Force
Write-Host ""
Write-Host "Results saved to: $OutputPath" -ForegroundColor Green
