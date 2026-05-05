param(
  [string]$Dir,
  [int]$Count = 10,
  [int]$PerCallBudgetMs = 1500,
  [int]$TimeoutMs = 3000
)
<#!
.SYNOPSIS
  Runs a post-deploy production health verification (tools/call health/check).
.DESCRIPTION
  Starts the deployed server from the given directory, performs initialize, then issues a series
  of tools/call health/check requests, measuring latency and validating responses (status 'ok').
  Fails (exit 1) if any call errors, exceeds latency budget, or times out.
.PARAMETER Dir
  Deployment directory containing dist/server/index-server.js.
.PARAMETER Count
  Number of sequential health/check calls to perform (default 10).
.PARAMETER PerCallBudgetMs
  Maximum allowed latency per call (default 1500 ms).
.PARAMETER TimeoutMs
  Overall timeout per response wait (default 3000 ms).
.EXAMPLE
  pwsh scripts/prod-health.ps1 -Dir <production-install-root> -Count 20
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Dir) {
  $localMachineRoot = Join-Path ([System.IO.Path]::GetPathRoot((Get-Location).Path)) 'mcp'
  $Dir = if ($env:DEPLOY_PROD_PATH) { $env:DEPLOY_PROD_PATH } else { Join-Path $localMachineRoot 'index-server' }
}

function Fail($msg){ Write-Host "[prod-health] FAIL: $msg" -ForegroundColor Red; exit 1 }

if(-not (Test-Path $Dir)){ Fail "Deployment directory not found: $Dir" }
$entry = Join-Path $Dir 'dist/server/index-server.js'
if(-not (Test-Path $entry)){ Fail "Missing server entry: $entry" }

Write-Host "[prod-health] Starting server from $Dir" -ForegroundColor Cyan
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'node'
$psi.WorkingDirectory = $Dir
$psi.Arguments = 'dist/server/index-server.js'
$psi.RedirectStandardInput  = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError  = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$null = $proc.Start()

$stdoutBuf = New-Object System.Collections.Concurrent.BlockingCollection[string]
$stdErrLines = @()

Start-Job -ScriptBlock {
  param($proc,$bc)
  try {
    while(-not $proc.HasExited){
      $line = $proc.StandardOutput.ReadLine()
      if($null -eq $line){ break }
      if($line.Trim()){ $bc.Add($line) }
    }
  } finally { $bc.CompleteAdding() }
} -ArgumentList $proc,$stdoutBuf | Out-Null

Start-Job -ScriptBlock {
  param($proc,$errStore)
  while(-not $proc.HasExited){
    $line = $proc.StandardError.ReadLine()
    if($null -eq $line){ break }
    if($line.Trim()){ $errStore.Add($line) }
  }
} -ArgumentList $proc,([System.Collections.Generic.List[string]]$stdErrLines) | Out-Null

function SendJson($obj){
  $json = ($obj | ConvertTo-Json -Compress -Depth 10)
  $proc.StandardInput.WriteLine($json)
  $proc.StandardInput.Flush()
}

$sendTimes = @{}
function SendReq($id,$method,$params){
  $sendTimes[$id] = [DateTime]::UtcNow
  SendJson @{ jsonrpc='2.0'; id=$id; method=$method; params=$params }
}

Write-Host '[prod-health] Sending initialize' -ForegroundColor Gray
SendReq 1 'initialize' @{ protocolVersion = '2025-06-18' }

$pending = [System.Collections.Generic.HashSet[int]]::new()
1..$Count | ForEach-Object { $pending.Add(1 + $_) } # ids 2..(Count+1)

for($i=0;$i -lt $Count;$i++){
  $id = 2 + $i
  SendReq $id 'tools/call' @{ name='health/check'; arguments=@{} }
}

$results = @{}
$deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs * $Count)

while($pending.Count -gt 0){
  if([DateTime]::UtcNow -gt $deadline){ Fail "Timed out waiting for responses (remaining: $($pending.Count))" }
  $line = $null
  if($stdoutBuf.TryTake([ref]$line, 250)){
    try {
      $env = $line | ConvertFrom-Json -Depth 12
    } catch {
      Write-Host "[prod-health] Non-JSON line: $line" -ForegroundColor DarkYellow
      continue
    }
    if($env.id -and $pending.Contains([int]$env.id)){
      $results[[int]$env.id] = $env
      $pending.Remove([int]$env.id) | Out-Null
    }
  }
}

Write-Host "[prod-health] All $Count responses received" -ForegroundColor Green

$failures = @()
foreach($kv in $results.GetEnumerator()){
  $id = $kv.Key; $env = $kv.Value
  $sent = $sendTimes[$id]
  $latencyMs = [int]([DateTime]::UtcNow - $sent).TotalMilliseconds
  $status = $null
  if($env.result){
    # Attempt to extract status from potential nested formats
    if($env.result.status){ $status = $env.result.status }
    elseif($env.result.data -and $env.result.data.status){ $status = $env.result.data.status }
    elseif($env.result.content){
      $c = $env.result.content[0].text
      if($c -eq 'ok'){ $status = 'ok' }
      elseif($c -match '"status"\s*:\s*"ok"'){ $status = 'ok' }
    }
  }
  if($env.error){ $failures += "id $id error $($env.error.code) $($env.error.message)" }
  elseif($status -ne 'ok'){ $failures += "id $id missing/invalid status" }
  elseif($latencyMs -gt $PerCallBudgetMs){ $failures += "id $id latency $latencyMs ms > budget $PerCallBudgetMs" }
  else { Write-Host ("[prod-health] id {0} ok {1}ms" -f $id,$latencyMs) -ForegroundColor Cyan }
}

if($failures.Count){
  Write-Host '[prod-health] Failures:' -ForegroundColor Red
  $failures | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  try { if(-not $proc.HasExited){ $proc.Kill() | Out-Null } } catch {}
  exit 1
}

Write-Host '[prod-health] Health verification passed.' -ForegroundColor Green
try { if(-not $proc.HasExited){ $proc.Kill() | Out-Null } } catch {}
exit 0
