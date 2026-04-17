<#
.SYNOPSIS
  Stress test for Index Server — loops CRUD operations via the client script.

.PARAMETER BaseUrl
  Server URL (default: $env:INDEX_SERVER_URL or http://localhost:8787)

.PARAMETER Iterations
  Number of CRUD cycles to run (default: 100)

.PARAMETER Prefix
  ID prefix for test instructions (default: stress-test)

.PARAMETER Parallel
  Number of concurrent jobs (default: 1, sequential)

.PARAMETER SkipCertCheck
  Skip TLS cert validation

.PARAMETER CleanupOnly
  Only remove leftover stress-test instructions

.EXAMPLE
  .\stress-test.ps1 -Iterations 50
  .\stress-test.ps1 -Iterations 200 -Parallel 4
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

    # SEARCH
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $searchResult = Invoke-Client @{ Action = 'search'; Keywords = @($Prefix, "$i") }
    $sw.Stop()
    $timings['search'] = $sw.ElapsedMilliseconds

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
    # Parallel using jobs
    $jobs = @()
    for ($i = 1; $i -le $Iterations; $i++) {
        while (($jobs | Where-Object { $_.State -eq 'Running' }).Count -ge $Parallel) {
            Start-Sleep -Milliseconds 100
            $done = $jobs | Where-Object { $_.State -eq 'Completed' }
            foreach ($j in $done) {
                $r = Receive-Job $j
                $results += $r
                Remove-Job $j
                $jobs = $jobs | Where-Object { $_.Id -ne $j.Id }
            }
        }
        $idx = $i
        $jobs += Start-Job -ScriptBlock {
            param($scriptDir, $baseUrl, $prefix, $idx, $skipCert, $adminKey)
            . "$scriptDir\stress-test.ps1" -BaseUrl $baseUrl -Prefix $prefix -Iterations 1 2>$null
        } -ArgumentList $scriptDir, $BaseUrl, $Prefix, $idx, $SkipCertCheck.IsPresent, $AdminKey

        Write-Host "  Started cycle $i" -ForegroundColor DarkGray
    }
    # Wait for remaining
    $jobs | Wait-Job | ForEach-Object {
        $r = Receive-Job $_
        $results += $r
        Remove-Job $_
    }
}

$totalSw.Stop()

# Summary
$passed = ($results | Where-Object { $_.Errors.Count -eq 0 }).Count
$failed = ($results | Where-Object { $_.Errors.Count -gt 0 }).Count
$allTimings = $results | ForEach-Object { $_.TotalMs }
$avgMs = if ($allTimings.Count -gt 0) { [math]::Round(($allTimings | Measure-Object -Average).Average, 1) } else { 0 }
$maxMs = if ($allTimings.Count -gt 0) { ($allTimings | Measure-Object -Maximum).Maximum } else { 0 }
$minMs = if ($allTimings.Count -gt 0) { ($allTimings | Measure-Object -Minimum).Minimum } else { 0 }

$opTimings = @{}
foreach ($op in @('add','get','search','update','remove')) {
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
foreach ($op in @('add','get','search','update','remove')) {
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
exit 0
