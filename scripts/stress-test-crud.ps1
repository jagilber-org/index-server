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

.EXAMPLE
  .\stress-test-crud.ps1
  .\stress-test-crud.ps1 -BaseUrl http://localhost:4600 -Count 100 -Cycles 5
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://localhost:4600',
    [string]$ClientScript = '',
    [int]$Count = 50,
    [int]$Cycles = 3,
    [int]$Parallel = 5,
    [string]$AdminKey = $env:INDEX_SERVER_ADMIN_API_KEY
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
