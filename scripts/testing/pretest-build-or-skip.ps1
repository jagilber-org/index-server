param()
$force = $env:INDEX_SERVER_FORCE_REBUILD -eq '1'
$skip = ($env:SKIP_PRETEST_BUILD -eq '1') -and -not $force
if($skip){
  Write-Host "[pretest] Skipping build (SKIP_PRETEST_BUILD=1)" -ForegroundColor DarkGray
} else {
  if($force){ Write-Host "[pretest] Forcing rebuild due to INDEX_SERVER_FORCE_REBUILD=1" -ForegroundColor Yellow }
  else { Write-Host "[pretest] Performing build (no SKIP_PRETEST_BUILD flag)" -ForegroundColor DarkGray }
  npm run build
}

# Always attempt compatibility shim creation: some tests expect dist/server/index-server.js while tsc outputs dist/src/server/index-server.js
$legacyDir = Join-Path (Get-Location) 'dist/server'
$legacyIndex = Join-Path $legacyDir 'index-server.js'
$modernIndex = Join-Path (Get-Location) 'dist/src/server/index-server.js'
if(Test-Path $modernIndex -PathType Leaf){
  if(-not (Test-Path $legacyIndex)){
    Write-Host "[pretest] Creating legacy dist/server/index-server.js shim -> src/server/index-server.js" -ForegroundColor DarkGray
    New-Item -ItemType Directory -Path $legacyDir -Force | Out-Null
    "// auto-generated shim for backward compatibility`nmodule.exports = require('../src/server/index-server.js');" | Out-File -FilePath $legacyIndex -Encoding utf8 -Force
  } else {
    Write-Host "[pretest] Legacy shim already present" -ForegroundColor DarkGray
  }
} else {
  Write-Host "[pretest] Modern index not found yet (dist/src/server/index-server.js); build may be in progress" -ForegroundColor DarkGray
}
