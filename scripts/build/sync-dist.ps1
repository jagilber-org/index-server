<#!
.SYNOPSIS
  Fast sync of local dist/ output to an existing deployment directory without tests or rebuild.
.DESCRIPTION
  Copies current dist/ tree into destination's dist/ (overwriting) and optionally updates package.json version.
.PARAMETER Destination
  Target deployment root.
.PARAMETER UpdatePackage
  Also copy package.json runtime subset (like deploy script generates) preserving dependencies object.
.EXAMPLE
  pwsh scripts/sync-dist.ps1 -Destination <production-install-root>
#>
param(
  [string]$Destination,
  [switch]$UpdatePackage,
  # Fail if dist/server/index-server.js missing after copy
  [switch]$Verify
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Destination) {
  $localMachineRoot = Join-Path ([System.IO.Path]::GetPathRoot((Get-Location).Path)) 'mcp'
  $Destination = if ($env:DEPLOY_PROD_PATH) { $env:DEPLOY_PROD_PATH } else { Join-Path $localMachineRoot 'index-server' }
}
if(-not (Test-Path 'dist')){ throw 'dist/ not found. Run a build first.' }
if(-not (Test-Path $Destination)){ throw "Destination not found: $Destination (run deploy first)" }
$destDist = Join-Path $Destination 'dist'
if(-not (Test-Path $destDist)){ New-Item -ItemType Directory -Force -Path $destDist | Out-Null }
Write-Host "[sync] Copying dist -> $destDist" -ForegroundColor Cyan
# Remove old JS to avoid stale deletions
Get-ChildItem -Path $destDist -Recurse -File | Remove-Item -Force
Copy-Item -Recurse -Force dist/* $destDist
# Sync docs/panels/ for dashboard help button documentation
$srcPanels = Join-Path $PWD 'docs' 'panels'
if(Test-Path $srcPanels){
  $destPanels = Join-Path $Destination 'docs' 'panels'
  if(-not (Test-Path $destPanels)){ New-Item -ItemType Directory -Force -Path $destPanels | Out-Null }
  Copy-Item -Force (Join-Path $srcPanels '*.md') $destPanels
  Write-Host "[sync] Copied docs/panels/ -> $destPanels" -ForegroundColor Cyan
}
if($UpdatePackage){
  $pkgPath = Join-Path $PWD 'package.json'
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  function Get-PkgProp($obj,$name,$default){ if($null -ne $obj -and ($obj.PSObject.Properties.Name -contains $name)){ return $obj.$name } return $default }
  $runtime = [ordered]@{
    name = Get-PkgProp $pkg 'name' 'index-server'
    version = Get-PkgProp $pkg 'version' '0.0.0'
    type = 'commonjs'
    license = Get-PkgProp $pkg 'license' 'MIT'
    description = Get-PkgProp $pkg 'description' ''
    repository = Get-PkgProp $pkg 'repository' @{ type='git'; url='' }
    author = Get-PkgProp $pkg 'author' 'Unknown'
    dependencies = Get-PkgProp $pkg 'dependencies' @{}
    engines = Get-PkgProp $pkg 'engines' @{ node = '>=20 <21' }
    scripts = @{ start = 'node dist/server/index-server.js' }
  }
  $runtime | ConvertTo-Json -Depth 10 | Out-File (Join-Path $Destination 'package.json') -Encoding UTF8
  Write-Host '[sync] Updated runtime package.json' -ForegroundColor Green
}
if($Verify){
  if(-not (Test-Path (Join-Path $destDist 'server/index-server.js'))){
    Write-Host '[sync] ERROR: dist/server/index-server.js missing after sync.' -ForegroundColor Red
    exit 1
  } else {
    Write-Host '[sync] Verified dist/server/index-server.js present.' -ForegroundColor Green
  }
}
Write-Host '[sync] Done.' -ForegroundColor Green
