<#
.SYNOPSIS
  Stress test for Index Server — loops CRUD operations via the client script.

.DESCRIPTION
  Runs repeated CRUD cycles (add, get, search, update, remove) against a running
  Index Server instance through index-server-client.ps1. Reports per-operation
  timing, success/failure counts, and error details.

  Parallel mode uses ForEach-Object -Parallel (requires PowerShell 7+).
  When -Parallel N is greater than 1, the script fans out N concurrent workers,
  each executing one CRUD cycle at a time. Sequential mode (default) uses a
  simple for-loop and works on any PowerShell version.

  Prerequisites:
    - A running Index Server (default: http://localhost:4600)
    - scripts/index-server-client.ps1 must exist alongside this script
    - PowerShell 7+ is required when -Parallel > 1

.PARAMETER BaseUrl
  Server URL (default: $env:INDEX_SERVER_URL or http://localhost:4600)

.PARAMETER Iterations
  Number of CRUD cycles to run (default: 100)

.PARAMETER Prefix
  ID prefix for test instructions (default: stress-test)

.PARAMETER Parallel
  Number of concurrent workers (default: 1, sequential).
  Requires PowerShell 7+ when set above 1.

.PARAMETER SkipCertCheck
  Skip TLS cert validation

.PARAMETER SemanticSearch
  Include semantic (embedding-based) search in each CRUD cycle.
  Requires INDEX_SERVER_SEMANTIC_ENABLED=1 on the target server.

.PARAMETER EmbeddingsCompute
  Trigger embedding computation via the dashboard /api/embeddings/compute
  endpoint at the start and end of the run. Requires -DashboardUrl.

.PARAMETER EmbeddingsProjection
  Fetch the /api/embeddings/projection endpoint after compute.
  Requires -DashboardUrl.

.PARAMETER DashboardUrl
  Dashboard base URL for embedding HTTP endpoints (e.g. https://localhost:8687).
  Defaults to BaseUrl if not specified.

.PARAMETER CleanupOnly
  Only remove leftover stress-test instructions

.PARAMETER AdminKey
  Bearer token for authenticated endpoints (default: $env:INDEX_SERVER_ADMIN_API_KEY)

.EXAMPLE
  .\stress-test.ps1 -Iterations 50
  .\stress-test.ps1 -Iterations 200 -Parallel 4
  .\stress-test.ps1 -SemanticSearch -EmbeddingsCompute -DashboardUrl https://localhost:8687 -SkipCertCheck
  .\stress-test.ps1 -CleanupOnly
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = ($env:INDEX_SERVER_URL ?? 'http://localhost:4600'),
    [int]$Iterations = 100,
    [string]$Prefix = 'stress-test',
    [int]$Parallel = 1,
    [switch]$SkipCertCheck,
    [switch]$NoDelete,
    [switch]$SemanticSearch,
    [switch]$EmbeddingsCompute,
    [switch]$EmbeddingsProjection,
    [string]$DashboardUrl = '',
    [switch]$CleanupOnly,
    [string]$AdminKey = $env:INDEX_SERVER_ADMIN_API_KEY
)

$ErrorActionPreference = 'Continue'
$scriptDir = $PSScriptRoot
$client = Join-Path $scriptDir 'index-server-client.ps1'

if (-not (Test-Path $client)) {
    Write-Error "Client script not found: $client"
    exit 1
}

$commonArgs = @{ BaseUrl = $BaseUrl }
if ($SkipCertCheck) { $commonArgs['SkipCertCheck'] = $true }
if ($AdminKey) { $commonArgs['AdminKey'] = $AdminKey }

function Invoke-Client {
    param([hashtable]$Params)
    $merged = $commonArgs.Clone()
    foreach ($k in $Params.Keys) { $merged[$k] = $Params[$k] }
    & $client @merged
}

# Health check first
Write-Host "=== Stress Test ===" -ForegroundColor Cyan
Write-Host "Server : $BaseUrl"
Write-Host "Iters  : $Iterations"
Write-Host "Parallel: $Parallel"
Write-Host ""

$health = Invoke-Client @{ Action = 'health' }
if (-not $health) {
    Write-Error "Server not reachable at $BaseUrl"
    exit 1
}
Write-Host "Health: OK" -ForegroundColor Green

# Dashboard URL for embedding HTTP endpoints
if (-not $DashboardUrl) { $DashboardUrl = $BaseUrl }
$dashboardArgs = @{}
if ($SkipCertCheck) { $dashboardArgs['SkipCertificateCheck'] = $true }

function Invoke-Dashboard {
    param([string]$Method, [string]$Path, [int]$TimeoutSec = 120)
    $url = "$DashboardUrl$Path"
    $splat = @{ Uri = $url; Method = $Method; TimeoutSec = $TimeoutSec } + $dashboardArgs
    if ($Method -eq 'POST') { $splat['ContentType'] = 'application/json' }
    try {
        $resp = Invoke-WebRequest @splat -ErrorAction Stop
        return $resp.Content | ConvertFrom-Json
    } catch {
        $msg = $_.Exception.Message
        try { $msg = $_.ErrorDetails.Message | ConvertFrom-Json | ForEach-Object { $_.error ?? $_.message ?? $msg } } catch {}
        return [PSCustomObject]@{ success = $false; error = $msg }
    }
}

# Pre-run embedding compute
if ($EmbeddingsCompute) {
    Write-Host ""
    Write-Host "── Embedding Compute (pre-run) ──" -ForegroundColor Magenta
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $emb = Invoke-Dashboard -Method POST -Path '/api/embeddings/compute'
    $sw.Stop()
    if ($emb.success) {
        Write-Host ("  OK: {0} embeddings in {1}ms (model={2} device={3})" -f $emb.count, $sw.ElapsedMilliseconds, $emb.model, $emb.device) -ForegroundColor Green
    } else {
        Write-Host ("  WARN: {0}" -f ($emb.error ?? 'Unknown error')) -ForegroundColor Yellow
    }
}

if ($EmbeddingsProjection) {
    Write-Host "── Embedding Projection (pre-run) ──" -ForegroundColor Magenta
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proj = Invoke-Dashboard -Method GET -Path '/api/embeddings/projection'
    $sw.Stop()
    if ($proj.success) {
        Write-Host ("  OK: {0} points, avgCosSim={1:N4} ({2}ms)" -f $proj.count, $proj.stats.avgCosineSim, $sw.ElapsedMilliseconds) -ForegroundColor Green
    } else {
        Write-Host ("  WARN: {0}" -f ($proj.error ?? 'Unknown error')) -ForegroundColor Yellow
    }
}

# Cleanup mode
if ($CleanupOnly) {
    Write-Host "Cleaning up $Prefix-* instructions..." -ForegroundColor Yellow
    $list = Invoke-Client @{ Action = 'search'; Keywords = @($Prefix); Limit = 500 }
    $ids = ($list | ConvertFrom-Json -ErrorAction SilentlyContinue).results |
        Where-Object { $_.id -like "$Prefix-*" } |
        ForEach-Object { $_.id }
    foreach ($id in $ids) {
        Invoke-Client @{ Action = 'remove'; Id = $id } | Out-Null
        Write-Host "  Removed $id"
    }
    Write-Host "Cleanup done. Removed $($ids.Count) instructions."
    exit 0
}

# Single CRUD cycle
function Run-Cycle {
    param([int]$i)
    $id = "$Prefix-$i"
    $title = "Stress instruction $i"
    $body = "Stress test body for iteration $i. Timestamp: $(Get-Date -Format o)"
    $errors = @()
    $timings = @{}

    # CREATE
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $addResult = Invoke-Client @{ Action = 'add'; Id = $id; Title = $title; Body = $body }
    $sw.Stop()
    $timings['add'] = $sw.ElapsedMilliseconds
    $addJson = $addResult | ConvertFrom-Json -ErrorAction SilentlyContinue
    if (-not $addJson -or $addJson.isError) { $errors += "ADD failed: $addResult" }

    # READ
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $getResult = Invoke-Client @{ Action = 'get'; Id = $id }
    $sw.Stop()
    $timings['get'] = $sw.ElapsedMilliseconds

    # SEARCH (keyword)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $searchResult = Invoke-Client @{ Action = 'search'; Keywords = @($Prefix, "$i") }
    $sw.Stop()
    $timings['search'] = $sw.ElapsedMilliseconds

    # SEMANTIC SEARCH (when enabled)
    if ($SemanticSearch) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $semResult = Invoke-Client @{ Action = 'search'; Keywords = @("stress test instruction $i"); Mode = 'semantic' }
        $sw.Stop()
        $timings['semantic'] = $sw.ElapsedMilliseconds
        $semJson = $semResult | ConvertFrom-Json -ErrorAction SilentlyContinue
        if (-not $semJson -or $semJson.isError) { $errors += "SEMANTIC failed: $semResult" }
    }

    # UPDATE (overwrite)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $updateResult = Invoke-Client @{ Action = 'add'; Id = $id; Title = "$title (updated)"; Body = "$body UPDATED"; Overwrite = $true }
    $sw.Stop()
    $timings['update'] = $sw.ElapsedMilliseconds
    $updateJson = $updateResult | ConvertFrom-Json -ErrorAction SilentlyContinue
    if (-not $updateJson -or $updateJson.isError) { $errors += "UPDATE failed: $updateResult" }

    # DELETE
    if (-not $NoDelete) {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $removeResult = Invoke-Client @{ Action = 'remove'; Id = $id }
        $sw.Stop()
        $timings['remove'] = $sw.ElapsedMilliseconds

        # VERIFY DELETED
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $verifyResult = Invoke-Client @{ Action = 'get'; Id = $id }
        $sw.Stop()
        $timings['verify_deleted'] = $sw.ElapsedMilliseconds
    }

    return @{
        Iteration = $i
        Id        = $id
        Timings   = $timings
        Errors    = $errors
        TotalMs   = ($timings.Values | Measure-Object -Sum).Sum
    }
}

# Run cycles
$results = @()
$totalSw = [System.Diagnostics.Stopwatch]::StartNew()

if ($Parallel -le 1) {
    # Sequential
    for ($i = 1; $i -le $Iterations; $i++) {
        $r = Run-Cycle -i $i
        $results += $r
        $status = if ($r.Errors.Count -eq 0) { 'OK' } else { 'FAIL' }
        $color = if ($status -eq 'OK') { 'Green' } else { 'Red' }
        Write-Host ("  [{0,4}/{1}] {2} {3}ms (add:{4} get:{5} search:{6} update:{7} remove:{8})" -f `
            $i, $Iterations, $status, $r.TotalMs,
            $r.Timings['add'], $r.Timings['get'], $r.Timings['search'],
            $r.Timings['update'], $r.Timings['remove']) -ForegroundColor $color
    }
}
else {
    # Parallel using ForEach-Object -Parallel (PS 7+ required)
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        Write-Error "Parallel mode (-Parallel $Parallel) requires PowerShell 7+. Current version: $($PSVersionTable.PSVersion)"
        exit 1
    }

    $results = 1..$Iterations | ForEach-Object -ThrottleLimit $Parallel -Parallel {
        $i = $_
        $prefix = $using:Prefix
        $clientPath = $using:client
        $cArgs = $using:commonArgs
        $noDelete = $using:NoDelete
        $doSemantic = $using:SemanticSearch

        $id = "$prefix-$i"
        $title = "Stress instruction $i"
        $body = "Stress test body for iteration $i. Timestamp: $(Get-Date -Format o)"
        $errors = @()
        $timings = @{}

        # Helper: invoke client with merged args
        $invokeClient = {
            param([hashtable]$Params)
            $merged = $cArgs.Clone()
            foreach ($k in $Params.Keys) { $merged[$k] = $Params[$k] }
            & $clientPath @merged
        }

        # CREATE
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $addResult = & $invokeClient @{ Action = 'add'; Id = $id; Title = $title; Body = $body }
        $sw.Stop()
        $timings['add'] = $sw.ElapsedMilliseconds
        $addJson = $addResult | ConvertFrom-Json -ErrorAction SilentlyContinue
        if (-not $addJson -or $addJson.isError) { $errors += "ADD failed: $addResult" }

        # READ
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $getResult = & $invokeClient @{ Action = 'get'; Id = $id }
        $sw.Stop()
        $timings['get'] = $sw.ElapsedMilliseconds

        # SEARCH (keyword)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $searchResult = & $invokeClient @{ Action = 'search'; Keywords = @($prefix, "$i") }
        $sw.Stop()
        $timings['search'] = $sw.ElapsedMilliseconds

        # SEMANTIC SEARCH (when enabled)
        if ($doSemantic) {
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $semResult = & $invokeClient @{ Action = 'search'; Keywords = @("stress test instruction $i"); Mode = 'semantic' }
            $sw.Stop()
            $timings['semantic'] = $sw.ElapsedMilliseconds
            $semJson = $semResult | ConvertFrom-Json -ErrorAction SilentlyContinue
            if (-not $semJson -or $semJson.isError) { $errors += "SEMANTIC failed: $semResult" }
        }

        # UPDATE (overwrite)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $updateResult = & $invokeClient @{ Action = 'add'; Id = $id; Title = "$title (updated)"; Body = "$body UPDATED"; Overwrite = $true }
        $sw.Stop()
        $timings['update'] = $sw.ElapsedMilliseconds
        $updateJson = $updateResult | ConvertFrom-Json -ErrorAction SilentlyContinue
        if (-not $updateJson -or $updateJson.isError) { $errors += "UPDATE failed: $updateResult" }

        # DELETE
        if (-not $noDelete) {
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $removeResult = & $invokeClient @{ Action = 'remove'; Id = $id }
            $sw.Stop()
            $timings['remove'] = $sw.ElapsedMilliseconds

            # VERIFY DELETED
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $verifyResult = & $invokeClient @{ Action = 'get'; Id = $id }
            $sw.Stop()
            $timings['verify_deleted'] = $sw.ElapsedMilliseconds
        }

        [PSCustomObject]@{
            Iteration = $i
            Id        = $id
            Timings   = $timings
            Errors    = $errors
            TotalMs   = ($timings.Values | Measure-Object -Sum).Sum
        }
    }

    # Report parallel results
    foreach ($r in $results) {
        $status = if ($r.Errors.Count -eq 0) { 'OK' } else { 'FAIL' }
        $color = if ($status -eq 'OK') { 'Green' } else { 'Red' }
        Write-Host ("  [{0,4}/{1}] {2} {3}ms" -f `
            $r.Iteration, $Iterations, $status, $r.TotalMs) -ForegroundColor $color
    }
}

$totalSw.Stop()

# Summary
$passed = @($results | Where-Object { $_.Errors.Count -eq 0 }).Count
$failed = @($results | Where-Object { $_.Errors.Count -gt 0 }).Count
$allTimings = $results | ForEach-Object { $_.TotalMs }
$avgMs = if ($allTimings.Count -gt 0) { [math]::Round(($allTimings | Measure-Object -Average).Average, 1) } else { 0 }
$maxMs = if ($allTimings.Count -gt 0) { ($allTimings | Measure-Object -Maximum).Maximum } else { 0 }
$minMs = if ($allTimings.Count -gt 0) { ($allTimings | Measure-Object -Minimum).Minimum } else { 0 }

$opTimings = @{}
foreach ($op in @('add','get','search','semantic','update','remove')) {
    $vals = $results | ForEach-Object { $_.Timings[$op] } | Where-Object { $_ -ne $null }
    if ($vals.Count -gt 0) {
        $opTimings[$op] = @{
            Avg = [math]::Round(($vals | Measure-Object -Average).Average, 1)
            Max = ($vals | Measure-Object -Maximum).Maximum
            Min = ($vals | Measure-Object -Minimum).Minimum
        }
    }
}

Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
Write-Host "Total time : $([math]::Round($totalSw.Elapsed.TotalSeconds, 1))s"
Write-Host "Iterations : $Iterations"
Write-Host "Passed     : $passed" -ForegroundColor Green
Write-Host "Failed     : $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })
Write-Host ""
Write-Host "Cycle time (ms): avg=$avgMs  min=$minMs  max=$maxMs"
Write-Host ""
Write-Host "Per-operation avg (ms):"
foreach ($op in @('add','get','search','semantic','update','remove')) {
    if ($opTimings.ContainsKey($op)) {
        $t = $opTimings[$op]
        Write-Host ("  {0,-8} avg={1,6}  min={2,6}  max={3,6}" -f $op, $t.Avg, $t.Min, $t.Max)
    }
}

if ($failed -gt 0) {
    Write-Host ""
    Write-Host "=== Errors ===" -ForegroundColor Red
    foreach ($r in ($results | Where-Object { $_.Errors.Count -gt 0 })) {
        Write-Host "  Cycle $($r.Iteration):" -ForegroundColor Yellow
        foreach ($e in $r.Errors) { Write-Host "    $e" -ForegroundColor Red }
    }
    exit 1
}

Write-Host ""
Write-Host "All cycles passed." -ForegroundColor Green

# Post-run embedding compute (after CRUD cycles modified the index)
# Brief pause to avoid rate-limit after stress cycles
Start-Sleep -Seconds 2
if ($EmbeddingsCompute) {
    Write-Host ""
    Write-Host "── Embedding Compute (post-run) ──" -ForegroundColor Magenta
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $emb = Invoke-Dashboard -Method POST -Path '/api/embeddings/compute'
    $sw.Stop()
    if ($emb.success) {
        Write-Host ("  OK: {0} embeddings in {1}ms (model={2} device={3})" -f $emb.count, $sw.ElapsedMilliseconds, $emb.model, $emb.device) -ForegroundColor Green
    } else {
        Write-Host ("  FAIL: {0}" -f ($emb.error ?? 'Unknown error')) -ForegroundColor Red
    }
}

if ($EmbeddingsProjection) {
    Write-Host "── Embedding Projection (post-run) ──" -ForegroundColor Magenta
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proj = Invoke-Dashboard -Method GET -Path '/api/embeddings/projection'
    $sw.Stop()
    if ($proj.success) {
        Write-Host ("  OK: {0} points, avgCosSim={1:N4} ({2}ms)" -f $proj.count, $proj.stats.avgCosineSim, $sw.ElapsedMilliseconds) -ForegroundColor Green
    } else {
        Write-Host ("  FAIL: {0}" -f ($proj.error ?? 'Unknown error')) -ForegroundColor Red
    }
}

exit 0
