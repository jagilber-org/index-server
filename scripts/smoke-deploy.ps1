<#!
.SYNOPSIS
  Post-deployment smoke validation for Index Server deployment directory.
.DESCRIPTION
  Validates key runtime artifacts and the deployment-manifest.json produced by deploy-local.ps1.
  Exits with non-zero code on failure. Intended to run AFTER deployment, optionally in CI.
.PARAMETER Path
  Root deployment path (directory containing deployment-manifest.json).
.PARAMETER Json
  Emit machine-readable JSON result to stdout (human-readable messages still go to stderr).
.PARAMETER Strict
  Fail if any optional warnings occur (e.g., missing schema file) instead of soft pass.
.PARAMETER TimeoutSeconds
  Maximum seconds to wait for server readiness if -Start is used (future enhancement placeholder).
.EXAMPLE
  pwsh scripts/smoke-deploy.ps1 -Path C:\mcp\index-server -Json
#>
param(
  [Parameter(Mandatory=$true)][string]$Path,
  [switch]$Json,
  [switch]$Strict,
  [int]$TimeoutSeconds = 15
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Fail($msg){
  [Console]::Error.WriteLine("[smoke] FAIL: $msg")
  throw $msg
}
function Warn($msg){ [Console]::Error.WriteLine("[smoke] WARN: $msg") }
function Info($msg){ [Console]::Error.WriteLine("[smoke] $msg") }

if(-not (Test-Path $Path)){ Fail "Deployment path not found: $Path" }
$manifestPath = Join-Path $Path 'deployment-manifest.json'
if(-not (Test-Path $manifestPath)){ Fail 'deployment-manifest.json missing (deploy-local.ps1 should have created it).' }

$manifestRaw = Get-Content $manifestPath -Raw
try { $manifest = $manifestRaw | ConvertFrom-Json } catch { Fail "Malformed deployment-manifest.json: $($_.Exception.Message)" }

$results = [ordered]@{ ok = $true; checks = @(); path = $Path; version = $manifest.version; gitCommit = $manifest.gitCommit }

# Helper to record a check
function Add-Check($name, $pass, $details){
  $results.checks += [ordered]@{ name = $name; pass = $pass; details = $details }
  if(-not $pass){ $results.ok = $false }
}

# Check: server executable
$serverPath = Join-Path $Path 'dist/server/index-server.js'
Add-Check 'server-index-exists' (Test-Path $serverPath) $serverPath
if(Test-Path $serverPath){
  try { $hash = (Get-FileHash -Algorithm SHA256 -Path $serverPath).Hash; Add-Check 'server-index-hash' ($hash -eq $manifest.artifacts.serverIndex.sha256) "expected=$($manifest.artifacts.serverIndex.sha256) actual=$hash" } catch { Add-Check 'server-index-hash' $false 'hash-error' }
}

# Check: schema present (soft if missing and not strict)
$schemaPath = Join-Path $Path 'schemas/instruction.schema.json'
$schemaExists = Test-Path $schemaPath
Add-Check 'schema-exists' ($schemaExists -or -not $Strict) ($schemaExists ? $schemaPath : 'missing')
if($schemaExists){
  try { $hash2 = (Get-FileHash -Algorithm SHA256 -Path $schemaPath).Hash; Add-Check 'schema-hash' ($hash2 -eq $manifest.artifacts.instructionSchema.sha256) "expected=$($manifest.artifacts.instructionSchema.sha256) actual=$hash2" } catch { Add-Check 'schema-hash' $false 'hash-error' }
}

# Check: instruction runtime count
$instrDir = Join-Path $Path 'instructions'
$runtimeFiles = @(Get-ChildItem -Path $instrDir -Filter *.json -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "\\_templates\\" })
Add-Check 'instruction-count' ($runtimeFiles.Count -eq $manifest.instructions.runtimeCount) "expected=$($manifest.instructions.runtimeCount) actual=$($runtimeFiles.Count)"

# Mode matches expectation derivation re-run
$modeExpected = if($manifest.build.emptyIndex){ 'empty-index' } elseif($manifest.build.forceSeed){ 'force-seed' } elseif(-not $runtimeFiles.Count){ 'empty-post-seed' } else { 'preserve-or-seeded-once' }
Add-Check 'instruction-mode-derived' ($modeExpected -eq $manifest.instructions.mode) "expected=$modeExpected actual=$($manifest.instructions.mode)"

# Node version (non-fatal) check
try { $currentNode = (node -v) } catch { $currentNode = '<node-missing>' }
Add-Check 'node-version-match' ($currentNode -eq $manifest.environment.nodeVersion) "expected=$($manifest.environment.nodeVersion) actual=$currentNode"

if(-not $results.ok){
  if($Json){
    $results | ConvertTo-Json -Depth 6
  } else {
    $results.checks | ForEach-Object { if(-not $_.pass){ [Console]::Error.WriteLine("[smoke] CHECK FAILED: $($_.name) :: $($_.details)") } }
    [Console]::Error.WriteLine('[smoke] One or more checks failed.')
  }
  exit 1
}

if($Json){ $results | ConvertTo-Json -Depth 6 } else { [Console]::Error.WriteLine('[smoke] All checks passed.') }
