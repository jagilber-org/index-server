<#
.SYNOPSIS
  Builds and deploys the Index Server to a local production-style directory (default: C:\mcp\index-server).

  Write-Host "[deploy] Warning: failed to remove $($item | ForEach-Object { try { $_.FullName } catch { '<?> ' } }): $($_.Exception.Message)" -ForegroundColor Yellow
  Copies only the runtime necessities (dist, package.json, LICENSE, README excerpt, instructions directory) and
  creates convenience launch scripts (start.ps1 / start.cmd). Intended for single‑machine, non-network MCP usage.

.PARAMETER Destination
  Target root directory. Default: C:\mcp\index-server

.PARAMETER Rebuild
  When specified, runs `npm ci && npm run build` before copying.

.PARAMETER Overwrite
  When specified, existing destination content (except an existing instructions folder) is removed first.



.EXAMPLE
  pwsh scripts/deploy-local.ps1 -Destination C:\mcp\index-server -Rebuild -Overwrite

.NOTES
  Does not install devDependencies outside the build step. Runtime only needs the compiled dist.
#>
param(
  [Alias('TargetDir')]
  [string]$Destination = 'C:\mcp\index-server',
  [switch]$Rebuild,
  [switch]$Overwrite,
  # Disable automatic backup of existing destination instructions directory
  [switch]$NoBackup,
  # Maximum number of instruction backups to retain (0 = unlimited)
  [int]$BackupRetention = 10,
  # When a rebuild is requested, allow continuing with an existing dist/ directory
  # if npm ci / build fails (e.g. transient EPERM on Windows from locked executables)
  [switch]$AllowStaleDistOnRebuildFailure,
  # Force reseeding of instructions even if runtime JSON already exists (backs up first unless -NoBackup)
  [switch]$ForceSeed,
  # Deploy with an empty runtime index (no baseline JSON copied). Templates still copied/preserved.
  [switch]$EmptyIndex,
  # Prune legacy dist/src tree even without -Overwrite (new enhancement)
  [switch]$PruneLegacy,
  # Emit JSON integrity summary to stdout at end (does not contaminate protocol; deploy script only)
  [switch]$EmitSummary
  , [switch]$AssertNoConcurrentTests
)

# NOTE (stability-hardening): Recent CI/deploy flake analysis showed two intermittent issues:
#  1) Handshake test timeouts during concurrent heavy IO (npm ci + large dist copy). Mitigated by raising
#     handshake helper max timeout & adding diagnostics (INDEX_SERVER_TEST_HANDSHAKE_* env vars).
#  2) Transient ERR_MODULE_NOT_FOUND / ENOENT for node_modules packages (e.g. es-errors, debug) observed
#     only when a separate test task executed overlapping with a fresh `npm ci` from this deploy script.
#     Root cause: parallel task deleted and reinstalled node_modules while vitest worker tried to resolve.
# To prevent recurrence, ensure tests complete before invoking deploy-local.ps1 with -Rebuild, or run deploy
# first then an isolated smoke test. Future enhancement: introduce an optional `-AssertNoConcurrentTests` flag
# using a simple lock file protocol (.build.lock) or NPX sentinel. For now we only document the hazard here.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if($AssertNoConcurrentTests){
  # Simple heuristic: block if a vitest sentinel or build lock is present & recently modified (<5m)
  $lockFiles = @('.build.lock','.test-run-active.lock') | ForEach-Object { if(Test-Path $_){ Get-Item $_ } }
  $recent = $lockFiles | Where-Object { ([DateTime]::UtcNow - $_.LastWriteTimeUtc).TotalMinutes -lt 5 }
  if($recent){
    Write-Host ('[deploy] AssertNoConcurrentTests: active lock(s) detected: {0}' -f ($recent | ForEach-Object Name -join ', ')) -ForegroundColor Red
    Write-Host '[deploy] Abort to avoid race with node_modules mutation during deployment (rerun after tests complete or omit -AssertNoConcurrentTests).' -ForegroundColor Red
    exit 2
  }
}

Write-Host "[deploy] Destination: $Destination" -ForegroundColor Cyan
if($Rebuild){
  Write-Host '[deploy] Rebuilding project (npm ci && npm run build)...'
  $rebuildSucceeded = $false
  try {
    npm ci
    if($LASTEXITCODE -ne 0){ throw "npm ci failed with exit code $LASTEXITCODE" }
    npm run build
    if($LASTEXITCODE -ne 0){ throw "npm run build failed with exit code $LASTEXITCODE" }
    # Verify a core build artifact exists (dist/server/index-server.js) AND that dashboard assets copied
    if(-not (Test-Path 'dist/server/index-server.js')){ throw 'dist/server/index-server.js missing after build (compile step likely failed silently).' }
    if(-not (Test-Path 'dist/dashboard/client/admin.html')){ throw 'dist/dashboard/client/admin.html missing (asset copy step skipped – did tsc fail so copy script never ran?).' }
    $rebuildSucceeded = $true
  } catch {
    Write-Host ("[deploy] Rebuild failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if(-not (Test-Path 'dist')){
      Write-Host '[deploy] No existing dist/ to fall back to. Aborting.' -ForegroundColor Red
      exit 1
    }
    if($AllowStaleDistOnRebuildFailure){
      Write-Host '[deploy] Proceeding with existing dist/ due to -AllowStaleDistOnRebuildFailure.' -ForegroundColor Yellow
    } else {
      Write-Host '[deploy] Re-run with -AllowStaleDistOnRebuildFailure to use existing dist/, or resolve the build issue (close processes locking node_modules).' -ForegroundColor Yellow
      exit 1
    }
  }
  if($rebuildSucceeded){
    Write-Host '[deploy] Rebuild completed successfully.' -ForegroundColor Green
  }
}

if(Test-Path $Destination){
  $destInstructionsPath = Join-Path $Destination 'instructions'
  $shouldBackup = -not $NoBackup -and (Test-Path $destInstructionsPath)
  if($shouldBackup){
  try {
      $jsonFiles = Get-ChildItem -Path $destInstructionsPath -Filter *.json -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "\\_templates\\" }
      # Ensure we can safely treat as array for .Count access (fix for occasional Count property warning)
      $jsonFiles = @($jsonFiles)
      if($jsonFiles -and $jsonFiles.Count -gt 0){
        $backupRoot = Join-Path $Destination 'backups'
        if(-not (Test-Path $backupRoot)){ New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backupDir = Join-Path $backupRoot "instructions-$stamp"
        # Avoid collisions (rare); append incremental suffix if exists
        $i = 1
        while(Test-Path $backupDir){ $backupDir = Join-Path $backupRoot ("instructions-$stamp-" + ($i++)) }
        Write-Host "[deploy] Backing up instructions to $backupDir" -ForegroundColor Cyan
        New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
        foreach($f in $jsonFiles){ Copy-Item $f.FullName (Join-Path $backupDir $f.Name) }
        $backupCount = ($jsonFiles | Measure-Object).Count
        Write-Host "[deploy] Backup completed ($backupCount files)." -ForegroundColor Green
        if($BackupRetention -gt 0){
          $existing = @(Get-ChildItem -Path $backupRoot -Directory -Filter 'instructions-*' | Sort-Object Name -Descending)
          if($existing.Count -gt $BackupRetention){
            $toPrune = $existing | Select-Object -Skip $BackupRetention
            foreach($p in $toPrune){
              try { Remove-Item -Recurse -Force $p.FullName } catch { Write-Host "[deploy] Warning: failed pruning old backup $($p.Name): $($_.Exception.Message)" -ForegroundColor Yellow }
            }
            Write-Host "[deploy] Pruned $($toPrune.Count) old backup(s) (retention $BackupRetention)." -ForegroundColor DarkGray
          }
        }
      } else {
        Write-Host '[deploy] No runtime instruction JSON files to backup (only templates or empty).' -ForegroundColor DarkGray
      }
    } catch {
      Write-Host "[deploy] Warning: backup attempt failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  } elseif(-not $NoBackup) {
    Write-Host '[deploy] No existing instructions directory to backup.' -ForegroundColor DarkGray
  }

  if($Overwrite){
  Write-Host '[deploy] Overwrite requested. Preserving existing instructions & backups folders if present...' -ForegroundColor Cyan
  $preserveInstructions = $destInstructionsPath
  $hadInstructions = Test-Path $preserveInstructions
  if($hadInstructions){ Write-Host '[deploy] Preserving instructions folder.' -ForegroundColor Green }
  # New: also preserve prior backups so historical instruction backups survive repeated deploys
  $preserveBackups = Join-Path $Destination 'backups'
  $hadBackups = Test-Path $preserveBackups
  if($hadBackups){ Write-Host '[deploy] Preserving backups folder (historical instruction backups).' -ForegroundColor Green }
  # Preserve TLS certs so dashboard HTTPS survives redeployment
  $preserveCerts = Join-Path $Destination '.certs'
  $hadCerts = Test-Path $preserveCerts
  if($hadCerts){ Write-Host '[deploy] Preserving .certs folder (TLS certificates).' -ForegroundColor Green }
    # Robust removal: under concurrent test runs transient race conditions or non-filesystem
    # objects (e.g. $null placeholders) have caused pipeline objects without a FullName
    # property, aborting the script (and leaving dist/ uncopied). We defensively filter and
    # swallow per-item errors so deployment can proceed with best-effort cleanup.
    $preserveSet = @()
    if($hadInstructions){ $preserveSet += $preserveInstructions }
    if($hadBackups){ $preserveSet += $preserveBackups }
    if($hadCerts){ $preserveSet += $preserveCerts }
    Get-ChildItem -Force -LiteralPath $Destination -ErrorAction SilentlyContinue | ForEach-Object {
      $item = $_
      if(-not $item){ return }
      # Skip if not a FileSystemInfo (rare edge) or it's one of the preserved directories
      if( (Get-Member -InputObject $item -Name FullName -ErrorAction SilentlyContinue) ){
        if($preserveSet -contains $item.FullName){ return }
      }
      try {
        if((Get-Member -InputObject $item -Name FullName -ErrorAction SilentlyContinue)){
          Remove-Item -Recurse -Force $item.FullName -ErrorAction Stop
        }
      } catch {
  # Best-effort warning (avoid terminating if pipeline object is odd / lacks FullName)
  Write-Host "[deploy] Warning: failed to remove $($item | ForEach-Object { try { $_.FullName } catch { '<?>' } }): $($_.Exception.Message)" -ForegroundColor Yellow
      }
    }
    if(-not (Test-Path $Destination)) { New-Item -ItemType Directory -Force -Path $Destination | Out-Null }
  } else {
    Write-Host '[deploy] Destination exists (will update in place). Use -Overwrite to clean (instructions always preserved).' -ForegroundColor Yellow
  }
} else {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
}

New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'dist') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'instructions') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'logs') | Out-Null

# Copy compiled output
Write-Host '[deploy] Copying dist/...'
Copy-Item -Recurse -Force dist/* (Join-Path $Destination 'dist')
if(-not (Test-Path (Join-Path $Destination 'dist/server/index-server.js'))){
  Write-Host '[deploy] ERROR: dist/server/index-server.js missing after copy. Possible locked destination or partial copy.' -ForegroundColor Red
  Write-Host '[deploy] Suggestion: ensure no running process is locking the destination (stop running server) then re-run deploy, or run scripts/sync-dist.ps1.' -ForegroundColor Yellow
  exit 1
}

# Copy schema assets required at runtime. The compiled IndexLoader.js references ../../schemas/instruction.schema.json
# relative to its own location (dist/services -> dist -> project root -> schemas). In the development workspace that
# resolves to <repo>/schemas, but in the production deployment we previously did not copy the top-level schemas folder,
# leading to MODULE_NOT_FOUND at startup. We replicate the same layout here by copying the schemas directory.
if(Test-Path 'schemas'){
  Write-Host '[deploy] Copying schemas/ (runtime JSON schema assets)...'
  Copy-Item -Recurse -Force 'schemas' (Join-Path $Destination 'schemas')
  if(-not (Test-Path (Join-Path $Destination 'schemas/instruction.schema.json'))){
    Write-Host '[deploy] ERROR: instruction.schema.json missing after schemas copy.' -ForegroundColor Red
    exit 1
  }
  # If a legacy build layout (dist/src/...) exists we also place schemas under dist/ for backward compatibility
  $legacyServices = Join-Path $Destination 'dist/src/services/IndexLoader.js'
  if(Test-Path $legacyServices){
    Write-Host '[deploy] Detected legacy dist/src/* layout -> adding dist/schemas for backward compatibility.' -ForegroundColor Yellow
    if(-not (Test-Path (Join-Path $Destination 'dist/schemas'))){ New-Item -ItemType Directory -Force -Path (Join-Path $Destination 'dist/schemas') | Out-Null }
    Copy-Item -Recurse -Force 'schemas/*' (Join-Path $Destination 'dist/schemas')
  }
} else {
  Write-Host '[deploy] WARNING: schemas directory not found in source; runtime schema validation may fail.' -ForegroundColor Yellow
}

# Copy docs/panels and docs/screenshots used by the dashboard doc-link and screenshot API routes.
# DashboardServer.ts resolves these via path.join(__dirname, '..', '..', '..', 'docs', 'panels|screenshots').
foreach($sub in @('panels','screenshots')){
  $srcDir = Join-Path 'docs' $sub
  if(Test-Path $srcDir){
    $destDir = Join-Path $Destination "docs/$sub"
    # Ensure destination is a directory (older deploys may have created a file by mistake)
    if((Test-Path $destDir) -and -not (Get-Item $destDir).PSIsContainer){
      Remove-Item -Force $destDir
    }
    if(-not (Test-Path $destDir)){ New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
    Write-Host "[deploy] Copying docs/$sub/..."
    Copy-Item -Force (Join-Path $srcDir '*') $destDir
  }
}

# Detect and warn about mixed new/legacy build artifacts. Offer auto-clean of legacy tree when safe.
$newServer = Join-Path $Destination 'dist/server/index-server.js'
$legacyServer = Join-Path $Destination 'dist/src/server/index-server.js'
if((Test-Path $newServer) -and (Test-Path $legacyServer)){
  Write-Host '[deploy] WARNING: Both new layout (dist/server) and legacy layout (dist/src/server) detected. Runtime may load stale files.' -ForegroundColor Yellow
  $shouldPruneLegacy = $Overwrite -or $PruneLegacy
  try {
    if($shouldPruneLegacy){
      Write-Host '[deploy] Pruning legacy dist/src/* tree...' -ForegroundColor Cyan
      Remove-Item -Recurse -Force (Join-Path $Destination 'dist/src')
    } else {
      Write-Host '[deploy] Legacy dist/src retained (use -PruneLegacy or -Overwrite to remove).' -ForegroundColor DarkYellow
    }
  } catch {
    Write-Host "[deploy] Warning: failed to prune legacy dist/src: $($_.Exception.Message)" -ForegroundColor Yellow
  }
} elseif($PruneLegacy -and (Test-Path (Join-Path $Destination 'dist/src'))){
  try {
    Write-Host '[deploy] Pruning legacy dist/src tree (no new layout conflict).' -ForegroundColor Cyan
    Remove-Item -Recurse -Force (Join-Path $Destination 'dist/src')
  } catch { Write-Host "[deploy] Warning: failed to prune legacy dist/src: $($_.Exception.Message)" -ForegroundColor Yellow }
}

# Minimal runtime package file: strip dev deps to reduce noise
$pkgPath = Join-Path $PWD 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json

# Helper to safely read a property that may not exist under strict mode
function Get-PkgProp($obj, $name, $default){
  if($null -ne $obj -and ($obj.PSObject.Properties.Name -contains $name)){
    return $obj.$name
  }
  return $default
}

$runtime = [ordered]@{
  name = Get-PkgProp $pkg 'name' 'index-server'
  version = Get-PkgProp $pkg 'version' '0.0.0'
  type = 'commonjs'
  license = Get-PkgProp $pkg 'license' 'MIT'
  description = Get-PkgProp $pkg 'description' 'Index Server'
  repository = Get-PkgProp $pkg 'repository' @{ type = 'git'; url = '' }
  author = Get-PkgProp $pkg 'author' 'Unknown'
  dependencies = Get-PkgProp $pkg 'dependencies' @{}
  engines = Get-PkgProp $pkg 'engines' @{ node = '>=20 <21' }
  scripts = @{ start = 'node dist/server/index-server.js' }
}
$runtime | ConvertTo-Json -Depth 10 | Out-File (Join-Path $Destination 'package.json') -Encoding UTF8

# Copy package-lock.json so npm ci --production installs exact locked versions
if(Test-Path 'package-lock.json'){
  Write-Host '[deploy] Copying package-lock.json (ensures deterministic dependency installation)...'
  Copy-Item -Force 'package-lock.json' (Join-Path $Destination 'package-lock.json')
} else {
  Write-Host '[deploy] WARNING: package-lock.json not found in source; npm install will resolve from registry without lock guarantees.' -ForegroundColor Yellow
}

# Copy license
Copy-Item -Force LICENSE (Join-Path $Destination 'LICENSE')

# Instruction seeding / mirroring strategy
$destInstructions = Join-Path $Destination 'instructions'
$runtimeJson = Get-ChildItem -Path $destInstructions -Filter *.json -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "\\_templates\\" }
$hasExistingRuntime = $runtimeJson | Select-Object -First 1

if($EmptyIndex){
  if($hasExistingRuntime){
    Write-Host '[deploy] -EmptyIndex specified -> removing existing runtime instruction JSON (templates preserved)...' -ForegroundColor Cyan
    foreach($f in $runtimeJson){ try { Remove-Item -Force $f.FullName } catch { Write-Host "[deploy] Warning: failed removing $($f.Name): $($_.Exception.Message)" -ForegroundColor Yellow } }
  } else {
    Write-Host '[deploy] -EmptyIndex specified and no runtime JSON present.' -ForegroundColor DarkGray
  }
  Write-Host '[deploy] Runtime index now empty (only templates, if any, remain).' -ForegroundColor Green
} elseif($ForceSeed){
  Write-Host '[deploy] -ForceSeed specified -> reseeding baseline instruction files (after optional backup)...' -ForegroundColor Cyan
  # Remove existing non-template JSON first
  if($hasExistingRuntime){
    foreach($f in $runtimeJson){ try { Remove-Item -Force $f.FullName } catch { Write-Host "[deploy] Warning: failed removing $($f.Name): $($_.Exception.Message)" -ForegroundColor Yellow } }
  }
  Get-ChildItem instructions -Filter *.json | Where-Object { -not ($_.Name -match 'concurrent-|fuzz_|crud.cycle|temp') } | ForEach-Object {
    $target = Join-Path $destInstructions $_.Name
    Copy-Item -Force $_.FullName $target
  }
  Write-Host '[deploy] Forced reseed complete.' -ForegroundColor Green
} else {
  # Legacy behavior: seed only if empty
  if(-not $hasExistingRuntime){
    Write-Host '[deploy] Destination instructions empty -> seeding baseline (non-secret) files...' -ForegroundColor Cyan
    Get-ChildItem instructions -Filter *.json | Where-Object { -not ($_.Name -match 'concurrent-|fuzz_|crud.cycle|temp') } | ForEach-Object {
      $target = Join-Path $destInstructions $_.Name
      if(-not (Test-Path $target)){
        Copy-Item $_.FullName $target
      }
    }
  } else {
    Write-Host '[deploy] Skipping instruction seeding (existing runtime instructions preserved). Use -ForceSeed or -EmptyIndex to override.' -ForegroundColor Green
  }
}

# Create launch scripts
$startPs1 = @'
param(
  [switch]$VerboseLogging,
  [switch]$EnableMutation,
  [switch]$TraceRequire
)
Set-StrictMode -Version Latest
# Default enable dashboard unless explicitly disabled by environment. This makes
# production deployments immediately expose the admin UI without requiring users
# to remember INDEX_SERVER_DASHBOARD=1 each launch. Opt-out by setting INDEX_SERVER_DASHBOARD=0
# before invoking start.ps1 or by exporting it prior to launch.
if(-not $env:INDEX_SERVER_DASHBOARD){ $env:INDEX_SERVER_DASHBOARD = '1' }
if($VerboseLogging){ $env:INDEX_SERVER_VERBOSE_LOGGING = '1' } elseif(-not $env:INDEX_SERVER_VERBOSE_LOGGING){ $env:INDEX_SERVER_VERBOSE_LOGGING = '' }
if($EnableMutation){ $env:INDEX_SERVER_MUTATION = '1' }
[Console]::Error.WriteLine('[start] Launching Index Server...')
# Auto-install production dependencies if not present
if(-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))){
  [Console]::Error.WriteLine('[start] node_modules missing - installing production dependencies...')
  pushd $PSScriptRoot
  try {
    if(Test-Path (Join-Path $PSScriptRoot 'package-lock.json')){
      npm ci --production
    } else {
      npm install --production
    }
  } catch { [Console]::Error.WriteLine("[start] npm install failed: $($_.Exception.Message)"); exit 1 }
  finally { popd }
}
$nodeArgs = @()
if($TraceRequire){ $nodeArgs += '--trace-require' }
if(-not (Test-Path (Join-Path $PSScriptRoot 'logs'))){ New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot 'logs') | Out-Null }
# IMPORTANT: Keep stdout reserved for MCP JSON-RPC protocol frames. Write diagnostics to stderr and also append to log file.
# Avoid merging stderr into stdout (no 2>&1) to prevent protocol contamination.
node @nodeArgs dist/server/index-server.js 2>> (Join-Path $PSScriptRoot 'logs/server.log')
'@
Set-Content -Path (Join-Path $Destination 'start.ps1') -Value $startPs1 -Encoding UTF8

$startCmd = "@echo off" + "`r`nrem Set INDEX_SERVER_VERBOSE_LOGGING=1 to enable IndexCount / diagnostics" + "`r`nif not exist node_modules (echo [start] Installing production dependencies... & if exist package-lock.json (call npm ci --production) else (call npm install --production))" + "`r`nnode %* dist\server\index-server.js"
Set-Content -Path (Join-Path $Destination 'start.cmd') -Value $startCmd -Encoding ASCII

Write-Host '[deploy] Done copying files.' -ForegroundColor Green

# Always install production dependencies — the server cannot start without them
Write-Host '[deploy] Installing production dependencies...' -ForegroundColor Cyan
Push-Location $Destination
try {
  # Prefer npm ci when lock file is present (deterministic, fast) — fall back to npm install otherwise
  if(Test-Path (Join-Path $Destination 'package-lock.json')){
    npm ci --production
    if($LASTEXITCODE -ne 0){ throw "npm ci --production failed with exit code $LASTEXITCODE" }
  } else {
    npm install --production
    if($LASTEXITCODE -ne 0){ throw "npm install --production failed with exit code $LASTEXITCODE" }
  }
  # Verify critical dependencies were installed
  $criticalDeps = @('ajv','express','zod','ws')
  foreach($dep in $criticalDeps){
    if(-not (Test-Path (Join-Path $Destination "node_modules/$dep/package.json"))){
      throw "Critical dependency '$dep' missing after npm install (server requires it at runtime)"
    }
  }
  Write-Host '[deploy] Production dependencies installed and validated.' -ForegroundColor Green
} catch {
  Write-Host "[deploy] npm install failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host '[deploy] Server will fail to start without dependencies. Fix npm issues and re-deploy.' -ForegroundColor Yellow
  exit 1
} finally { Pop-Location }
Write-Host "Next: (cd $Destination ; pwsh .\\start.ps1 -VerboseLogging -EnableMutation)" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Integrity & Summary (Enhancements 2 & 4)
# ---------------------------------------------------------------------------
if($EmitSummary){
  $summary = [ordered]@{}
  try {
    $serverPath = Join-Path $Destination 'dist/server/index-server.js'
    $schemaPath = Join-Path $Destination 'schemas/instruction.schema.json'
    $summary.serverIndexExists = Test-Path $serverPath
    $summary.schemaExists = Test-Path $schemaPath
    if($summary.serverIndexExists){
      try { $hash = Get-FileHash -Algorithm SHA256 -Path $serverPath; $summary.serverIndexSha256 = $hash.Hash } catch { $summary.serverIndexSha256 = '<hash-error>' }
      try { $fileInfo = Get-Item $serverPath; $summary.serverIndexBytes = $fileInfo.Length } catch { }
    }
    if($summary.schemaExists){
      try { $hash2 = Get-FileHash -Algorithm SHA256 -Path $schemaPath; $summary.schemaSha256 = $hash2.Hash } catch { $summary.schemaSha256 = '<hash-error>' }
    }
    # Count runtime instruction JSON (excluding templates)
    $instrDir = Join-Path $Destination 'instructions'
    $runtimeFiles = @(Get-ChildItem -Path $instrDir -Filter *.json -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "\\_templates\\" })
    $summary.runtimeInstructionCount = $runtimeFiles.Count
    $summary.mode = if($EmptyIndex){ 'empty-index' } elseif($ForceSeed){ 'force-seed' } elseif(-not $runtimeFiles.Count){ 'empty-post-seed' } else { 'preserve-or-seeded-once' }
    $summary.timestamp = (Get-Date).ToString('o')
    # Attempt to read runtime package version
    try { $pkgDest = Get-Content (Join-Path $Destination 'package.json') -Raw | ConvertFrom-Json; $summary.version = $pkgDest.version } catch { $summary.version = 'unknown' }
  } catch {
    $summary.error = $_.Exception.Message
  }
  # Emit as single JSON line (machine-friendly). Using Write-Host to ensure stdout visibility.
  Write-Host (ConvertTo-Json $summary -Depth 5)
}

# ---------------------------------------------------------------------------
# Deployment Manifest (always written)
# ---------------------------------------------------------------------------
try {
  $manifestServerPath = Join-Path $Destination 'dist/server/index-server.js'
  $manifestSchemaPath = Join-Path $Destination 'schemas/instruction.schema.json'
  $instrDir2 = Join-Path $Destination 'instructions'
  $runtimeFiles2 = @(Get-ChildItem -Path $instrDir2 -Filter *.json -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch "\\_templates\\" })
  $mode2 = if($EmptyIndex){ 'empty-index' } elseif($ForceSeed){ 'force-seed' } elseif(-not $runtimeFiles2.Count){ 'empty-post-seed' } else { 'preserve-or-seeded-once' }
  $serverHash2 = $null; if(Test-Path $manifestServerPath){ try { $serverHash2 = (Get-FileHash -Algorithm SHA256 -Path $manifestServerPath).Hash } catch { $serverHash2 = '<hash-error>' } }
  $schemaHash2 = $null; if(Test-Path $manifestSchemaPath){ try { $schemaHash2 = (Get-FileHash -Algorithm SHA256 -Path $manifestSchemaPath).Hash } catch { $schemaHash2 = '<hash-error>' } }
  $nodeVersion = $null; try { $nodeVersion = (node -v) } catch { $nodeVersion = '<node-unavailable>' }
  $gitCommit = $null; if(Test-Path (Join-Path $PSScriptRoot '..' '.git')){ try { $gitCommit = (git rev-parse HEAD) } catch { $gitCommit = '<git-error>' } } else { $gitCommit = '<no-git-dir>' }
  $deployManifest = [ordered]@{
    name = $runtime.name
    version = $runtime.version
    deployedAt = (Get-Date).ToString('o')
    destination = $Destination
    gitCommit = $gitCommit
    build = [ordered]@{
      rebuild = [bool]$Rebuild
      overwrite = [bool]$Overwrite
      bundleDeps = $true
      allowStaleDistOnRebuildFailure = [bool]$AllowStaleDistOnRebuildFailure
      forceSeed = [bool]$ForceSeed
      emptyIndex = [bool]$EmptyIndex
      pruneLegacy = [bool]$PruneLegacy
      backupRetention = $BackupRetention
    }
    environment = [ordered]@{
      nodeVersion = $nodeVersion
      platform = $env:OS
      processArch = $env:PROCESSOR_ARCHITECTURE
    }
    artifacts = [ordered]@{
      serverIndex = [ordered]@{ exists = (Test-Path $manifestServerPath); sha256 = $serverHash2 }
      instructionSchema = [ordered]@{ exists = (Test-Path $manifestSchemaPath); sha256 = $schemaHash2 }
    }
    instructions = [ordered]@{
      runtimeCount = $runtimeFiles2.Count
      mode = $mode2
    }
  }
  $manifestPath = Join-Path $Destination 'deployment-manifest.json'
  $deployManifest | ConvertTo-Json -Depth 10 | Out-File $manifestPath -Encoding UTF8
  Write-Host "[deploy] Deployment manifest written: $manifestPath" -ForegroundColor Green
} catch {
  Write-Host "[deploy] Warning: failed to write deployment-manifest.json: $($_.Exception.Message)" -ForegroundColor Yellow
}
