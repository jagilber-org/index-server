<#
.SYNOPSIS
  Stress test for Index Server CRUD operations via index-server-client.ps1

.DESCRIPTION
  Exercises Create, Read, Update (overwrite), Delete, Search, and List
  operations against a running Index Server instance. Reports timing,
  success/failure counts, and error details.

.PARAMETER BaseUrl
  Server URL (default: http://localhost:4600)

.PARAMETER ClientScript
  Path to index-server-client.ps1

.PARAMETER Count
  Number of instructions to create per cycle (default: 50)

.PARAMETER Cycles
  Number of full CRUD cycles (default: 3)

.PARAMETER Parallel
  Max concurrent operations per phase (default: 5)

.PARAMETER SemanticSearch
  Include semantic search phase in each cycle (requires INDEX_SERVER_SEMANTIC_ENABLED=1)

.PARAMETER EmbeddingsCompute
  Trigger embedding compute via /api/embeddings/compute pre/post and after CREATE

.PARAMETER SkipCertCheck
  Skip TLS cert validation for dashboard HTTP endpoints

.EXAMPLE
  .\stress-test-crud.ps1
  .\stress-test-crud.ps1 -BaseUrl https://localhost:8687 -Count 100 -Cycles 5
  .\stress-test-crud.ps1 -BaseUrl https://localhost:8687 -SemanticSearch -EmbeddingsCompute -SkipCertCheck
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:4600',
    [string]$ClientScript = '',
    [int]$Count = 50,
    [int]$Cycles = 3,
    [int]$Parallel = 5,
    [string]$AdminKey = $env:INDEX_SERVER_ADMIN_API_KEY,
    [switch]$SemanticSearch,
    [switch]$EmbeddingsCompute,
    [switch]$SkipCertCheck
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $ClientScript) {
    $ClientScript = Join-Path $PSScriptRoot 'dist' 'index-server-client.ps1'
}
if (-not (Test-Path $ClientScript)) {
    Write-Error "Client script not found: $ClientScript"
    return
}

# ── Helpers ──────────────────────────────────────────────────────────────
function Invoke-Client {
    param([hashtable]$Params)
    $splat = @{ BaseUrl = $BaseUrl } + $Params
    if ($AdminKey) { $splat.AdminKey = $AdminKey }
    if ($SkipCertCheck) { $splat.SkipCertCheck = $true }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $raw = & $ClientScript @splat 2>&1
            $text = ($raw | Where-Object { $_ -is [string] -or $_ -is [System.Management.Automation.PSObject] }) | Out-String
            if (-not $text.Trim()) {
                return [PSCustomObject]@{ success = $false; error = 'Empty response' }
            }
            $json = $text | ConvertFrom-Json
            $statusCode = $null
            try { $statusCode = $json.status } catch {}
            if ($statusCode -eq 429) {
                Start-Sleep -Seconds ([Math]::Max(1, $attempt))
                continue
            }
            return $json
        } catch {
            if ($attempt -eq 3) {
                return [PSCustomObject]@{ success = $false; error = $_.Exception.Message }
            }
            Start-Sleep -Seconds 1
        }
    }
    return [PSCustomObject]@{ success = $false; error = 'Exhausted retries' }
}

function Measure-Phase {
    param([string]$Name, [scriptblock]$Block)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $result = & $Block
    $sw.Stop()
    Write-Host ("  {0,-20} {1,8:N0}ms" -f $Name, $sw.ElapsedMilliseconds) -ForegroundColor Cyan
    return $result
}

# ── Dashboard helper for embedding HTTP endpoints ────────────────────────
$dashboardArgs = @{}
if ($SkipCertCheck) { $dashboardArgs['SkipCertificateCheck'] = $true }

function Invoke-Dashboard {
    param([string]$Method, [string]$Path, [int]$TimeoutSec = 120)
    $url = "$BaseUrl$Path"
    $splat = @{ Uri = $url; Method = $Method; TimeoutSec = $TimeoutSec } + $script:dashboardArgs
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

# ── Stats ────────────────────────────────────────────────────────────────
$stats = @{
    TotalOps   = 0
    Succeeded  = 0
    Failed     = 0
    Errors     = [System.Collections.ArrayList]::new()
    Phases     = [System.Collections.ArrayList]::new()
}

function Record-Op {
    param([string]$Phase, $Result, [string]$Id)
    $stats.TotalOps++
    $ok = $false
    if ($null -ne $Result) {
        if ($Result -is [hashtable]) {
            $ok = $Result.ContainsKey('success') -and $Result.success -eq $true
            if (-not $ok) { $ok = $Result.ContainsKey('result') -and $null -ne $Result.result }
        } else {
            try { $ok = ($Result.success -eq $true) -or ($null -ne $Result.result) } catch { $ok = $false }
        }
    }
    if ($ok) {
        $stats.Succeeded++
    } else {
        $stats.Failed++
        $errMsg = 'Unknown error'
        try { if ($Result.error) { $errMsg = $Result.error } } catch {}
        [void]$stats.Errors.Add("[$Phase] $Id : $errMsg")
    }
}

# ── Pre-flight ───────────────────────────────────────────────────────────
Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "║  Index Server CRUD Stress Test                              ║" -ForegroundColor Yellow
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host "  Target:     $BaseUrl"
Write-Host "  Count:      $Count instructions per cycle"
Write-Host "  Cycles:     $Cycles"
Write-Host "  Parallel:   $Parallel"
Write-Host "  Auth:       $(if ($AdminKey) { 'Bearer token' } else { 'none' })"
Write-Host ""

Write-Host "── Pre-flight health check ──" -ForegroundColor Green
$health = Invoke-Client @{ Action = 'health' }
$healthOk = $false
try { $healthOk = ($health.success -eq $true) -or ($null -ne $health.result) } catch {}
if (-not $healthOk) {
    Write-Error "Health check failed: $($health | ConvertTo-Json -Compress -ErrorAction SilentlyContinue)"
    return
}
Write-Host "  Server is healthy" -ForegroundColor Green

# Get baseline instruction count
$baseline = Invoke-Client @{ Action = 'list'; Limit = 1 }
$baselineCount = 0
try { if ($baseline.result) { $baselineCount = $baseline.result.count } } catch {}
Write-Host "  Baseline instructions: $baselineCount"
Write-Host ""

$totalSw = [System.Diagnostics.Stopwatch]::StartNew()

# ── Pre-run embedding baseline ───────────────────────────────────────────
if ($EmbeddingsCompute) {
    Write-Host "── Embedding Compute (pre-run baseline) ──" -ForegroundColor Magenta
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $emb = Invoke-Dashboard -Method POST -Path '/api/embeddings/compute'
    $sw.Stop()
    if ($emb.success) {
        Write-Host ("  OK: {0} embeddings in {1}ms" -f $emb.count, $sw.ElapsedMilliseconds) -ForegroundColor Green
    } else {
        Write-Host ("  WARN: {0}" -f ($emb.error ?? 'Unknown error')) -ForegroundColor Yellow
    }
    Write-Host ""
}

# ── CRUD Cycles ──────────────────────────────────────────────────────────
for ($cycle = 1; $cycle -le $Cycles; $cycle++) {
    Write-Host "── Cycle $cycle / $Cycles ──" -ForegroundColor Green
    $prefix = "stress-test-c${cycle}"
    $ids = 1..$Count | ForEach-Object { "${prefix}-$('{0:D4}' -f $_)" }

    # ── CREATE ───────────────────────────────────────────────────────────
    Measure-Phase "CREATE ($Count)" {
        $createResults = $ids | ForEach-Object -ThrottleLimit $Parallel -Parallel {
            $id = $_
            $params = @{
                Action   = 'add'
                Id       = $id
                Title    = "Stress Test: $id"
                Body     = "This is stress test instruction $id. Created at $(Get-Date -Format o). Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."
                Priority = Get-Random -Minimum 1 -Maximum 100
                BaseUrl  = $using:BaseUrl
            }
            if ($using:AdminKey) { $params.AdminKey = $using:AdminKey }
            if ($using:SkipCertCheck) { $params.SkipCertCheck = $true }
            try {
                $raw = & $using:ClientScript @params 2>&1 | Out-String
                $json = $raw | ConvertFrom-Json
                [PSCustomObject]@{ Id = $id; Success = [bool]($json.success -or $json.result); Error = $null }
            } catch {
                [PSCustomObject]@{ Id = $id; Success = $false; Error = $_.Exception.Message }
            }
        }
        foreach ($r in $createResults) {
            $stats.TotalOps++
            if ($r.Success) { $stats.Succeeded++ }
            else {
                $stats.Failed++
                [void]$stats.Errors.Add("[CREATE] $($r.Id) : $($r.Error ?? 'Unknown error')")
            }
        }
    } | Out-Null

    # ── READ (individual gets) ───────────────────────────────────────────
    $sampleIds = $ids | Get-Random -Count ([Math]::Min(10, $Count))
    Measure-Phase "READ ($($sampleIds.Count) samples)" {
        foreach ($id in $sampleIds) {
            $result = Invoke-Client @{ Action = 'get'; Id = $id }
            Record-Op 'READ' $result $id
        }
    } | Out-Null

    # ── LIST ─────────────────────────────────────────────────────────────
    Measure-Phase "LIST" {
        $result = Invoke-Client @{ Action = 'list'; Limit = 200 }
        Record-Op 'LIST' $result 'all'
    } | Out-Null

    # ── SEARCH ───────────────────────────────────────────────────────────
    Measure-Phase "SEARCH (keyword)" {
        $result = Invoke-Client @{ Action = 'search'; Keywords = @('stress','test'); Limit = 100 }
        Record-Op 'SEARCH' $result 'keyword'
    } | Out-Null

    # ── SEMANTIC SEARCH ──────────────────────────────────────────────────
    if ($SemanticSearch) {
        Measure-Phase "SEMANTIC SEARCH" {
            $result = Invoke-Client @{ Action = 'search'; Keywords = @('stress test instructions for load testing'); Mode = 'semantic' }
            Record-Op 'SEMANTIC' $result 'semantic-1'
            $result2 = Invoke-Client @{ Action = 'search'; Keywords = @("instruction $prefix"); Mode = 'semantic' }
            Record-Op 'SEMANTIC' $result2 'semantic-2'
        } | Out-Null
    }

    # ── EMBEDDINGS COMPUTE (mid-cycle) ───────────────────────────────────
    if ($EmbeddingsCompute) {
        Measure-Phase "EMBEDDINGS COMPUTE" {
            $emb = Invoke-Dashboard -Method POST -Path '/api/embeddings/compute'
            if ($emb.success) {
                Write-Host ("     {0} embeddings, model={1}, device={2}" -f $emb.count, $emb.model, $emb.device) -ForegroundColor DarkGray
                $stats.TotalOps++; $stats.Succeeded++
            } else {
                $stats.TotalOps++; $stats.Failed++
                [void]$stats.Errors.Add("[EMBEDDINGS] compute : $($emb.error ?? 'Unknown')")
            }
        } | Out-Null

        Measure-Phase "EMBEDDINGS PROJECTION" {
            $proj = Invoke-Dashboard -Method GET -Path '/api/embeddings/projection'
            if ($proj.success) {
                Write-Host ("     {0} points, dims={1}, avgCosSim={2:N4}" -f $proj.count, $proj.dimensions, $proj.stats.avgCosineSim) -ForegroundColor DarkGray
                $stats.TotalOps++; $stats.Succeeded++
            } else {
                $stats.TotalOps++; $stats.Failed++
                [void]$stats.Errors.Add("[EMBEDDINGS] projection : $($proj.error ?? 'Unknown')")
            }
        } | Out-Null
    }

    # ── UPDATE (overwrite) ───────────────────────────────────────────────
    $updateIds = $ids | Get-Random -Count ([Math]::Min(10, $Count))
    Measure-Phase "UPDATE ($($updateIds.Count) overwrites)" {
        foreach ($id in $updateIds) {
            $result = Invoke-Client @{
                Action    = 'add'
                Id        = $id
                Title     = "UPDATED: $id"
                Body      = "Updated at $(Get-Date -Format o). This instruction was overwritten during stress testing cycle $cycle."
                Overwrite = $true
            }
            Record-Op 'UPDATE' $result $id
        }
    } | Out-Null

    # ── TRACK (usage) ────────────────────────────────────────────────────
    $trackIds = $ids | Get-Random -Count ([Math]::Min(5, $Count))
    Measure-Phase "TRACK ($($trackIds.Count) signals)" {
        foreach ($id in $trackIds) {
            $signal = @('helpful', 'not-relevant', 'outdated', 'applied') | Get-Random
            $result = Invoke-Client @{ Action = 'track'; Id = $id; Signal = $signal }
            Record-Op 'TRACK' $result $id
        }
    } | Out-Null

    # ── HOTSET ───────────────────────────────────────────────────────────
    Measure-Phase "HOTSET" {
        $result = Invoke-Client @{ Action = 'hotset'; Limit = 10 }
        Record-Op 'HOTSET' $result 'top10'
    } | Out-Null

    # ── DELETE ───────────────────────────────────────────────────────────
    Measure-Phase "DELETE ($Count)" {
        foreach ($id in $ids) {
            $result = Invoke-Client @{ Action = 'remove'; Id = $id }
            Record-Op 'DELETE' $result $id
        }
    } | Out-Null

    Write-Host ""
}

$totalSw.Stop()

# ── Post-run embedding compute ───────────────────────────────────────────
if ($EmbeddingsCompute) {
    Write-Host "── Embedding Compute (post-run) ──" -ForegroundColor Magenta
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $emb = Invoke-Dashboard -Method POST -Path '/api/embeddings/compute'
    $sw.Stop()
    if ($emb.success) {
        Write-Host ("  OK: {0} embeddings in {1}ms" -f $emb.count, $sw.ElapsedMilliseconds) -ForegroundColor Green
    } else {
        Write-Host ("  FAIL: {0}" -f ($emb.error ?? 'Unknown error')) -ForegroundColor Red
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proj = Invoke-Dashboard -Method GET -Path '/api/embeddings/projection'
    $sw.Stop()
    if ($proj.success) {
        Write-Host ("  Projection: {0} points, avgCosSim={1:N4} ({2}ms)" -f $proj.count, $proj.stats.avgCosineSim, $sw.ElapsedMilliseconds) -ForegroundColor Green
    } else {
        Write-Host ("  Projection FAIL: {0}" -f ($proj.error ?? 'Unknown error')) -ForegroundColor Red
    }
    Write-Host ""
}

# ── Final health check ──────────────────────────────────────────────────
Write-Host "── Post-test health check ──" -ForegroundColor Green
$postHealth = Invoke-Client @{ Action = 'health' }
$postList = Invoke-Client @{ Action = 'list'; Limit = 1 }
$postCount = 0
try { if ($postList.result) { $postCount = $postList.result.count } } catch {}
Write-Host "  Instructions after test: $postCount (baseline: $baselineCount)"

# ── Summary ──────────────────────────────────────────────────────────────
Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "║  Results                                                    ║" -ForegroundColor Yellow
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ("  Total operations:  {0}" -f $stats.TotalOps)
Write-Host ("  Succeeded:         {0}" -f $stats.Succeeded) -ForegroundColor Green
Write-Host ("  Failed:            {0}" -f $stats.Failed) -ForegroundColor $(if ($stats.Failed -gt 0) { 'Red' } else { 'Green' })
Write-Host ("  Success rate:      {0:P1}" -f $(if ($stats.TotalOps -gt 0) { $stats.Succeeded / $stats.TotalOps } else { 0 }))
Write-Host ("  Total time:        {0:N1}s" -f ($totalSw.ElapsedMilliseconds / 1000))
Write-Host ("  Ops/sec:           {0:N1}" -f $(if ($totalSw.ElapsedMilliseconds -gt 0) { $stats.TotalOps / ($totalSw.ElapsedMilliseconds / 1000) } else { 0 }))

if ($stats.Errors.Count -gt 0) {
    Write-Host "`n── Errors (first 20) ──" -ForegroundColor Red
    $stats.Errors | Select-Object -First 20 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    if ($stats.Errors.Count -gt 20) {
        Write-Host "  ... and $($stats.Errors.Count - 20) more" -ForegroundColor Red
    }
}

Write-Host ""
