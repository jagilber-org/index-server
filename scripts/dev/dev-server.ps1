#requires -Version 7
<#
.SYNOPSIS
  Index Server dev orchestrator.

.DESCRIPTION
  Single entry point to run the dev server with one of four storage/embedding
  profiles, each fully sandboxed under .devsandbox/<profile>/. Never reads or
  writes c:\mcp\. Provides start / stop / restart / status / list / import /
  export / crud / reset-flags / reset-storage / reset-all.

  Profiles
    json           JSON store, no embeddings
    sqlite         SQLite store, no embeddings
    json-embed     JSON store, embeddings on
    sqlite-embed   SQLite store, embeddings on (note: combo currently unstable;
                   `crud` exposes failures clearly)

  Ports
    Each profile gets a port base (-PortBase, default 9100). Allocations:
       dashboard = base
       leader    = base + 1
    Override per-profile defaults in the PROFILE_BASE_PORTS table below.

.EXAMPLES
  pwsh -File scripts/dev/dev-server.ps1 -Action start    -Profile json
  pwsh -File scripts/dev/dev-server.ps1 -Action start    -Profile sqlite-embed -PortBase 9120
  pwsh -File scripts/dev/dev-server.ps1 -Action status   -Profile json
  pwsh -File scripts/dev/dev-server.ps1 -Action crud     -Profile sqlite-embed
  pwsh -File scripts/dev/dev-server.ps1 -Action crud     -Profile json -Keep
  pwsh -File scripts/dev/dev-server.ps1 -Action export   -Profile json -OutFile .\backup.json
  pwsh -File scripts/dev/dev-server.ps1 -Action import   -Profile sqlite -InFile .\backup.json -Mode overwrite
  pwsh -File scripts/dev/dev-server.ps1 -Action restart  -Profile json-embed
  pwsh -File scripts/dev/dev-server.ps1 -Action reset-flags    -Profile sqlite-embed
  pwsh -File scripts/dev/dev-server.ps1 -Action reset-storage  -Profile sqlite-embed -Yes
  pwsh -File scripts/dev/dev-server.ps1 -Action reset-all      -Profile sqlite-embed -Yes
  pwsh -File scripts/dev/dev-server.ps1 -Action list
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('start','stop','restart','status','list','crud','contenttypes','validation','import','export','reset-flags','reset-storage','reset-all')]
  [string]$Action,

  [ValidateSet('json','sqlite','json-embed','sqlite-embed')]
  [string]$Profile,

  [int]$PortBase = 0,                # 0 → use per-profile default from table

  [string]$OutFile,
  [string]$InFile,
  [ValidateSet('skip','overwrite')]
  [string]$Mode = 'skip',

  [switch]$Keep,                     # crud/contenttypes: leave entries after run
  [switch]$SkipSemantic,             # crud: don't run semantic-mode search

  [switch]$Yes,                      # reset-storage: confirm destructive op
  [switch]$Build,                    # start: force rebuild even if dist exists
  [switch]$Quiet,                    # suppress URL banner
  [hashtable]$Override               # extra env overrides for this invocation
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ── Repo root + safety guard ─────────────────────────────────────────────────
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($RepoRoot -like 'C:\mcp\*' -or $RepoRoot -like 'c:\mcp\*') {
  throw "Refusing to run: repo root $RepoRoot is under C:\mcp\."
}
$Sandbox  = Join-Path $RepoRoot '.devsandbox'
$DistJs   = Join-Path $RepoRoot 'dist\server\index-server.js'

function Test-PathSafe {
  param([string]$Path)
  $abs = [System.IO.Path]::GetFullPath($Path)
  if ($abs -like 'C:\mcp\*' -or $abs -like 'c:\mcp\*') {
    throw "Refusing path under C:\mcp\: $abs"
  }
}

# ── Per-profile defaults ─────────────────────────────────────────────────────
# Default base ports stagger so multiple profiles can run concurrently.
$PROFILE_BASE_PORTS = @{
  'json'         = 9100
  'sqlite'       = 9110
  'json-embed'   = 9120
  'sqlite-embed' = 9130
}

function Get-ProfilePaths {
  param([string]$ProfileName)
  $root = Join-Path $Sandbox $ProfileName
  return [pscustomobject]@{
    Root            = $root
    Instructions    = Join-Path $root 'instructions'
    Data            = Join-Path $root 'data'
    Logs            = Join-Path $root 'logs'
    Feedback        = Join-Path $root 'feedback'
    Models          = Join-Path $root 'data\models'
    SqliteDb        = Join-Path $root 'data\index.db'
    EmbeddingsJson  = Join-Path $root 'data\embeddings.json'
    PidFile         = Join-Path $root 'server.pid'
    EnvFile         = Join-Path $root 'server.env'
    OverridesFile   = Join-Path $root 'overrides.env'
    StdoutLog       = Join-Path $root 'logs\stdout.log'
    StderrLog       = Join-Path $root 'logs\stderr.log'
    ActivityLog     = Join-Path $root 'dev-server.log'
  }
}

function Resolve-PortBase {
  param([string]$ProfileName, [int]$Override)
  if ($Override -gt 0) { return $Override }
  return [int]$PROFILE_BASE_PORTS[$ProfileName]
}

function Get-ProfileEnv {
  param(
    [string]$ProfileName,
    [pscustomobject]$Paths,
    [int]$BasePort,
    [hashtable]$Extra
  )
  $semantic = ($ProfileName -like '*embed*')
  $isSqlite = ($ProfileName -like 'sqlite*')

  $env = [ordered]@{
    INDEX_SERVER_DIR                   = $Paths.Instructions
    INDEX_SERVER_FEEDBACK_DIR          = $Paths.Feedback
    INDEX_SERVER_LOG_DIR               = $Paths.Logs
    INDEX_SERVER_STORAGE_BACKEND       = ($(if ($isSqlite) { 'sqlite' } else { 'json' }))
    INDEX_SERVER_SQLITE_PATH           = $Paths.SqliteDb
    # SQLITE_WAL and SQLITE_MIGRATE_ON_START both default to true in featureConfig.ts — omitted.
    INDEX_SERVER_SEMANTIC_ENABLED      = ($(if ($semantic) { '1' } else { '0' }))
    INDEX_SERVER_EMBEDDING_PATH        = $Paths.EmbeddingsJson
    INDEX_SERVER_SEMANTIC_CACHE_DIR    = $Paths.Models
    # SEMANTIC_DEVICE defaults to 'cpu' in featureConfig.ts — omitted.
    # DASHBOARD_HOST defaults to '127.0.0.1' in dashboardConfig.ts — omitted.
    INDEX_SERVER_DASHBOARD_PORT        = [string]$BasePort
    INDEX_SERVER_LEADER_PORT           = [string]($BasePort + 1)
    INDEX_SERVER_AUTO_BACKUP           = '0'
    INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM = '1'
    INDEX_SERVER_LOG_LEVEL             = 'info'
    # Keep the stdio server alive even when no MCP client is attached so the
    # dashboard remains reachable and CRUD probes can be run against the same
    # on-disk sandbox. ~24h is plenty for an interactive dev session.
    INDEX_SERVER_IDLE_KEEPALIVE_MS     = '86400000'
    # Disable PPID watchdog: we spawn through `cmd /c start /B node ...`, so
    # the recorded parent (the cmd shell) exits immediately after launching
    # the node child. Without this, the watchdog kills the server ~30s in.
    INDEX_SERVER_DISABLE_PPID_WATCHDOG = '1'
  }

  # Persisted per-profile overrides (set via -Override; cleared by reset-flags)
  if (Test-Path $Paths.OverridesFile) {
    foreach ($line in Get-Content $Paths.OverridesFile) {
      $t = $line.Trim()
      if (-not $t -or $t.StartsWith('#')) { continue }
      $eq = $t.IndexOf('=')
      if ($eq -lt 0) { continue }
      $env[$t.Substring(0, $eq)] = $t.Substring($eq + 1)
    }
  }

  # In-memory overrides for this invocation; also persisted so subsequent starts inherit them.
  if ($Extra) {
    $sb = New-Object System.Text.StringBuilder
    if (Test-Path $Paths.OverridesFile) { [void]$sb.Append((Get-Content -Raw $Paths.OverridesFile)) }
    foreach ($k in $Extra.Keys) {
      $env[$k] = [string]$Extra[$k]
      [void]$sb.AppendLine("$k=$($Extra[$k])")
    }
    Set-Content -Path $Paths.OverridesFile -Value $sb.ToString().TrimEnd() -Encoding utf8
  }

  return $env
}

function Save-EnvFile {
  param([System.Collections.Specialized.OrderedDictionary]$Env, [string]$File)
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('# Generated by scripts/dev/dev-server.ps1 — do not edit by hand.')
  [void]$sb.AppendLine("# Generated: $(Get-Date -Format o)")
  foreach ($k in $Env.Keys) { [void]$sb.AppendLine("$k=$($Env[$k])") }
  Set-Content -Path $File -Value $sb.ToString().TrimEnd() -Encoding utf8
}

# ── Logging ──────────────────────────────────────────────────────────────────
function Write-Activity {
  param([string]$LogFile, [string]$Level, [string]$Action, $Detail)
  $ts = (Get-Date).ToString('o')
  $detailStr = if ($null -ne $Detail) { " " + ($Detail | ConvertTo-Json -Compress -Depth 6) } else { '' }
  $line = "$ts [$Level] [ps] $Action$detailStr"
  Add-Content -Path $LogFile -Value $line -Encoding utf8
  if (-not $Quiet) {
    $color = switch ($Level) { 'pass' { 'Green' } 'FAIL' { 'Red' } 'warn' { 'Yellow' } default { 'Cyan' } }
    Write-Host $line -ForegroundColor $color
  }
}

function Ensure-Dirs {
  param([pscustomobject]$Paths)
  foreach ($d in @($Paths.Root, $Paths.Instructions, $Paths.Data, $Paths.Logs, $Paths.Feedback, $Paths.Models)) {
    Test-PathSafe $d
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  }
}

function Ensure-Build {
  param([string]$LogFile)
  if ((-not (Test-Path $DistJs)) -or $Build) {
    Write-Activity $LogFile 'info' 'build' @{ reason = ($(if ($Build) { 'force' } else { 'missing' })) }
    Push-Location $RepoRoot
    try { npm run build 2>&1 | Out-Null }
    finally { Pop-Location }
    if (-not (Test-Path $DistJs)) { throw "Build failed: $DistJs missing" }
  }
}

# ── Process control ──────────────────────────────────────────────────────────
function Get-RunningPid {
  param([pscustomobject]$Paths)
  if (-not (Test-Path $Paths.PidFile)) { return $null }
  $pidVal = (Get-Content -Raw $Paths.PidFile).Trim()
  if (-not $pidVal -or -not ($pidVal -as [int])) { return $null }
  $proc = Get-Process -Id ([int]$pidVal) -ErrorAction SilentlyContinue
  if ($proc) { return [int]$pidVal } else { Remove-Item $Paths.PidFile -Force -ErrorAction SilentlyContinue; return $null }
}

function Stop-DevServer {
  param([pscustomobject]$Paths)
  $existing = Get-RunningPid $Paths
  if (-not $existing) {
    Write-Activity $Paths.ActivityLog 'info' 'stop-noop' @{ reason = 'no running pid' }
    return $false
  }
  Write-Activity $Paths.ActivityLog 'act' 'stop' @{ pid = $existing }
  try { Stop-Process -Id $existing -Force -ErrorAction Stop } catch {
    Write-Activity $Paths.ActivityLog 'warn' 'stop-error' @{ pid = $existing; error = $_.Exception.Message }
  }
  Start-Sleep -Milliseconds 250
  Remove-Item $Paths.PidFile -Force -ErrorAction SilentlyContinue
  Write-Activity $Paths.ActivityLog 'pass' 'stop-done' @{ pid = $existing }
  return $true
}

function Start-DevServer {
  param([pscustomobject]$Paths, [System.Collections.Specialized.OrderedDictionary]$Env, [string]$ProfileName, [int]$BasePort)
  Ensure-Dirs $Paths
  Ensure-Build $Paths.ActivityLog
  Save-EnvFile -Env $Env -File $Paths.EnvFile

  $existing = Get-RunningPid $Paths
  if ($existing) {
    Write-Activity $Paths.ActivityLog 'warn' 'start-already-running' @{ pid = $existing; profile = $ProfileName }
    return $existing
  }

  Write-Activity $Paths.ActivityLog 'act' 'start' @{ profile = $ProfileName; portBase = $BasePort; backend = $Env.INDEX_SERVER_STORAGE_BACKEND; semantic = $Env.INDEX_SERVER_SEMANTIC_ENABLED }

  # Set env in the current process so Start-Process inherits — then unset to keep
  # the parent shell clean. We use Start-Process (not [Process]::Start) so the
  # child fully detaches and survives the parent pwsh exit; stdin defaults to
  # null which the server handles via INDEX_SERVER_IDLE_KEEPALIVE_MS.
  $injected = @()
  foreach ($k in $Env.Keys) {
    $injected += $k
    [Environment]::SetEnvironmentVariable($k, [string]$Env[$k], 'Process')
  }
  try {
    $node = (Get-Command node).Source
    # Use cmd /c start to fully detach. Redirect stdio to nul so no parent
    # handles remain. The server writes structured logs via INDEX_SERVER_LOG_DIR
    # (see dev-server.log + logs/mcp-server.log) so we don't need to capture
    # stdout/stderr from this side.
    #
    # Append a per-profile sentinel arg (`--dev-profile=<name>`) so we can
    # uniquely identify THIS launch's node child via Win32_Process.CommandLine.
    # The server's parseArgs() silently ignores unknown flags
    # (src/server/index-server.ts), so the sentinel is a no-op at runtime —
    # its only purpose is to disambiguate concurrent profile launches that
    # would otherwise share the same DistJs basename and overlapping
    # creation-time windows.
    $profileMarker = "--dev-profile=$ProfileName"
    $cmdArgs = "/c start `"index-server-$ProfileName`" /B `"$node`" `"$DistJs`" $profileMarker > `"$($Paths.StdoutLog)`" 2> `"$($Paths.StderrLog)`""
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WindowStyle Hidden -PassThru
  } finally {
    foreach ($k in $injected) { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
  }
  Start-Sleep -Milliseconds 800
  # cmd.exe exits immediately after launching node; find the actual node child
  # by per-profile sentinel in CommandLine (set above). The sentinel guarantees
  # we never grab a sibling profile's node process even when launches overlap
  # within the creation-time window.
  $nodePid = $null
  $deadline = (Get-Date).AddSeconds(5)
  while (-not $nodePid -and (Get-Date) -lt $deadline) {
    $candidates = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -like "*$profileMarker*" -and
        $_.CommandLine -like "*$([System.IO.Path]::GetFileName($DistJs))*" -and
        $_.CreationDate -gt (Get-Date).AddSeconds(-10)
      }
    if ($candidates) { $nodePid = ($candidates | Sort-Object CreationDate -Descending | Select-Object -First 1).ProcessId }
    if (-not $nodePid) { Start-Sleep -Milliseconds 200 }
  }
  if (-not $nodePid) {
    $err = ''
    if (Test-Path $Paths.StderrLog) { $err = (Get-Content -Raw $Paths.StderrLog) }
    Write-Activity $Paths.ActivityLog 'FAIL' 'start-no-pid' @{ stderrTail = $err.Substring([Math]::Max(0, $err.Length - 600), [Math]::Min($err.Length, 600)) }
    throw "Could not locate node child process for profile '$ProfileName'. See $($Paths.StderrLog)"
  }
  $nodePid | Set-Content -Path $Paths.PidFile -Encoding ascii

  Write-Activity $Paths.ActivityLog 'pass' 'start-ok' @{ pid = $nodePid }
  return $nodePid
}

# ── URL banner ──────────────────────────────────────────────────────────────
function Show-Banner {
  param([string]$ProfileName, [pscustomobject]$Paths, [System.Collections.Specialized.OrderedDictionary]$Env, [int]$Port, [int]$RunningPid)
  if ($Quiet) { return }
  $bindHost = $Env.INDEX_SERVER_DASHBOARD_HOST
  $tls = if ($Env.Contains('INDEX_SERVER_DASHBOARD_TLS')) { $Env['INDEX_SERVER_DASHBOARD_TLS'] } else { '0' }
  $proto = if ($tls -eq '1') { 'https' } else { 'http' }
  Write-Host ''
  Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor DarkGray
  Write-Host ("  Profile     : {0}" -f $ProfileName) -ForegroundColor White
  Write-Host ("  PID         : {0}" -f $RunningPid)
  Write-Host ("  Backend     : {0}    Embeddings: {1}" -f $Env.INDEX_SERVER_STORAGE_BACKEND, $Env.INDEX_SERVER_SEMANTIC_ENABLED)
  Write-Host ("  Sandbox     : {0}" -f $Paths.Root)
  Write-Host ("  Instructions: {0}" -f $Paths.Instructions)
  if ($Env.INDEX_SERVER_STORAGE_BACKEND -eq 'sqlite') { Write-Host ("  SQLite DB   : {0}" -f $Paths.SqliteDb) }
  if ($Env.INDEX_SERVER_SEMANTIC_ENABLED -eq '1')    { Write-Host ("  Embeddings  : {0}" -f $Paths.EmbeddingsJson) }
  Write-Host ''
  Write-Host '  URLs (active when corresponding subsystem is enabled):' -ForegroundColor White
  Write-Host ('    Dashboard : {0}://{1}:{2}/' -f $proto, $bindHost, $Env.INDEX_SERVER_DASHBOARD_PORT) -ForegroundColor Green
  Write-Host ('    Health    : {0}://{1}:{2}/healthz' -f $proto, $bindHost, $Env.INDEX_SERVER_DASHBOARD_PORT) -ForegroundColor Green
  Write-Host ('    Leader    : {0}://{1}:{2}/' -f $proto, $bindHost, $Env.INDEX_SERVER_LEADER_PORT) -ForegroundColor DarkGreen
  Write-Host ''
  Write-Host '  Logs:' -ForegroundColor White
  Write-Host ("    stdout    : {0}" -f $Paths.StdoutLog)
  Write-Host ("    stderr    : {0}" -f $Paths.StderrLog)
  Write-Host ("    activity  : {0}" -f $Paths.ActivityLog)
  Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor DarkGray
}

# ── Reset operations ────────────────────────────────────────────────────────
function Reset-Flags {
  param([pscustomobject]$Paths)
  if (Test-Path $Paths.OverridesFile) {
    Test-PathSafe $Paths.OverridesFile
    Remove-Item $Paths.OverridesFile -Force
    Write-Activity $Paths.ActivityLog 'pass' 'reset-flags' @{ deleted = $Paths.OverridesFile }
  } else {
    Write-Activity $Paths.ActivityLog 'info' 'reset-flags-noop' @{ reason = 'no overrides file' }
  }
}

function Reset-Storage {
  param([pscustomobject]$Paths)
  if (-not $Yes) { throw "Refusing to wipe $($Paths.Root) without -Yes" }
  Test-PathSafe $Paths.Root
  if ($Paths.Root -notmatch [regex]::Escape($Sandbox)) { throw "Computed path escaped sandbox: $($Paths.Root)" }
  Stop-DevServer $Paths | Out-Null
  # Ensure root + log dirs exist BEFORE the wipe loop so Write-Activity calls
  # always have a writable parent directory, even if the activity log path is
  # ever moved under one of the wiped subdirectories. The Remove-Item below
  # only deletes the listed leaf dirs (Instructions/Data/Feedback/Logs),
  # never $Paths.Root itself, so the activity log file in $Paths.Root
  # survives the reset.
  Ensure-Dirs $Paths
  foreach ($d in @($Paths.Instructions, $Paths.Data, $Paths.Feedback, $Paths.Logs)) {
    Test-PathSafe $d
    if (Test-Path $d) {
      Remove-Item -Recurse -Force $d
      # Recreate immediately so the next iteration's logging (and any concurrent
      # readers) always sees a valid directory tree.
      New-Item -ItemType Directory -Force -Path $d | Out-Null
      Write-Activity $Paths.ActivityLog 'pass' 'reset-storage' @{ removed = $d }
    }
  }
  Ensure-Dirs $Paths
}

# ── List action ──────────────────────────────────────────────────────────────
function Invoke-List {
  if (-not (Test-Path $Sandbox)) { Write-Host "(no sandboxes yet at $Sandbox)"; return }
  $rows = @()
  foreach ($p in (Get-ChildItem $Sandbox -Directory -ErrorAction SilentlyContinue)) {
    $paths = Get-ProfilePaths $p.Name
    $pidVal = Get-RunningPid $paths
    $envSummary = ''
    if (Test-Path $paths.EnvFile) {
      $backend = (Select-String -Path $paths.EnvFile -Pattern '^INDEX_SERVER_STORAGE_BACKEND=' -SimpleMatch:$false).Line -replace '.*=',''
      $semantic = (Select-String -Path $paths.EnvFile -Pattern '^INDEX_SERVER_SEMANTIC_ENABLED=' -SimpleMatch:$false).Line -replace '.*=',''
      $port = (Select-String -Path $paths.EnvFile -Pattern '^INDEX_SERVER_DASHBOARD_PORT=' -SimpleMatch:$false).Line -replace '.*=',''
      $envSummary = "backend=$backend semantic=$semantic port=$port"
    }
    $rows += [pscustomobject]@{
      Profile = $p.Name
      PID     = ($(if ($pidVal) { $pidVal } else { '-' }))
      Status  = ($(if ($pidVal) { 'running' } else { 'stopped' }))
      Env     = $envSummary
    }
  }
  $rows | Format-Table -AutoSize
}

# ── Content-type taxonomy probe wrapper ─────────────────────────────────────
function Invoke-ContentTypes {
  param([pscustomobject]$Paths)
  Ensure-Dirs $Paths
  if (-not (Test-Path $Paths.EnvFile)) {
    throw "No env file at $($Paths.EnvFile). Run -Action start first (or -Action restart)."
  }
  Ensure-Build $Paths.ActivityLog
  $probe = Join-Path $RepoRoot 'scripts\dev\integrity\contenttype-probe.mjs'
  $args = @($probe, '--env-file', $Paths.EnvFile, '--log-file', $Paths.ActivityLog)
  if ($Keep) { $args += '--keep' }
  Write-Activity $Paths.ActivityLog 'act' 'contenttypes-start' @{ keep = [bool]$Keep }
  $output = & node @args
  $code = $LASTEXITCODE
  Write-Host ($output -join "`n")
  Write-Activity $Paths.ActivityLog ($(if ($code -eq 0) { 'pass' } else { 'FAIL' })) 'contenttypes-done' @{ exitCode = $code }
  if ($code -ne 0) { exit $code }
}

# ── Field-validation boundary probe wrapper ──────────────────────────────────
function Invoke-Validation {
  param([pscustomobject]$Paths)
  Ensure-Dirs $Paths
  if (-not (Test-Path $Paths.EnvFile)) {
    throw "No env file at $($Paths.EnvFile). Run -Action start first (or -Action restart)."
  }
  Ensure-Build $Paths.ActivityLog
  $probe = Join-Path $RepoRoot 'scripts\dev\integrity\validation-probe.mjs'
  $args = @($probe, '--env-file', $Paths.EnvFile, '--log-file', $Paths.ActivityLog)
  Write-Activity $Paths.ActivityLog 'act' 'validation-start' @{}
  $output = & node @args
  $code = $LASTEXITCODE
  $summary = $output | ConvertFrom-Json -ErrorAction SilentlyContinue | Select-Object -ExpandProperty summary -ErrorAction SilentlyContinue
  Write-Host ($output -join "`n")
  if ($summary) {
    $gapMsg = if ($summary.gapProbesFailed -gt 0) { " ($($summary.gapProbesFailed) gap-probes revealed server issues)" } else { '' }
    Write-Host "validation: $($summary.passed)/$($summary.total) passed$gapMsg"
  }
  Write-Activity $Paths.ActivityLog ($(if ($code -eq 0) { 'pass' } else { 'FAIL' })) 'validation-done' @{ exitCode = $code }
  if ($code -ne 0) { exit $code }
}

# ── CRUD lifecycle probe wrapper ─────────────────────────────────────────────
function Invoke-Crud {
  param([pscustomobject]$Paths)
  Ensure-Dirs $Paths
  if (-not (Test-Path $Paths.EnvFile)) {
    throw "No env file at $($Paths.EnvFile). Run -Action start first (or -Action restart)."
  }
  Ensure-Build $Paths.ActivityLog
  $probe = Join-Path $RepoRoot 'scripts\dev\integrity\crud-probe.mjs'
  $args = @($probe, '--env-file', $Paths.EnvFile, '--log-file', $Paths.ActivityLog)
  if ($Keep)         { $args += '--keep' }
  if ($SkipSemantic) { $args += '--skip-semantic' }
  Write-Activity $Paths.ActivityLog 'act' 'crud-start' @{ keep = [bool]$Keep; skipSemantic = [bool]$SkipSemantic }
  $output = & node @args
  $code = $LASTEXITCODE
  Write-Host ($output -join "`n")
  Write-Activity $Paths.ActivityLog ($(if ($code -eq 0) { 'pass' } else { 'FAIL' })) 'crud-done' @{ exitCode = $code }
  if ($code -ne 0) { exit $code }
}

# ── Import / export wrappers ─────────────────────────────────────────────────
function Invoke-Export {
  param([pscustomobject]$Paths)
  if (-not $OutFile) { throw '-OutFile is required for export' }
  Ensure-Dirs $Paths
  if (-not (Test-Path $Paths.EnvFile)) { throw "No env file at $($Paths.EnvFile). Run -Action start first." }
  Ensure-Build $Paths.ActivityLog
  $abs = [System.IO.Path]::GetFullPath($OutFile)
  Test-PathSafe $abs
  $helper = Join-Path $RepoRoot 'scripts\dev\util\io-helper.mjs'
  Write-Activity $Paths.ActivityLog 'act' 'export' @{ out = $abs }
  & node $helper 'export' '--env-file' $Paths.EnvFile '--out' $abs '--log-file' $Paths.ActivityLog
  $code = $LASTEXITCODE
  Write-Activity $Paths.ActivityLog ($(if ($code -eq 0) { 'pass' } else { 'FAIL' })) 'export-done' @{ exitCode = $code; out = $abs }
  if ($code -ne 0) { exit $code }
}

function Invoke-Import {
  param([pscustomobject]$Paths)
  if (-not $InFile) { throw '-InFile is required for import' }
  Ensure-Dirs $Paths
  if (-not (Test-Path $Paths.EnvFile)) { throw "No env file at $($Paths.EnvFile). Run -Action start first." }
  $abs = [System.IO.Path]::GetFullPath($InFile)
  if (-not (Test-Path $abs)) { throw "Input file not found: $abs" }
  Ensure-Build $Paths.ActivityLog
  $helper = Join-Path $RepoRoot 'scripts\dev\util\io-helper.mjs'
  Write-Activity $Paths.ActivityLog 'act' 'import' @{ in = $abs; mode = $Mode }
  & node $helper 'import' '--env-file' $Paths.EnvFile '--in' $abs '--mode' $Mode '--log-file' $Paths.ActivityLog
  $code = $LASTEXITCODE
  Write-Activity $Paths.ActivityLog ($(if ($code -eq 0) { 'pass' } else { 'FAIL' })) 'import-done' @{ exitCode = $code; in = $abs }
  if ($code -ne 0) { exit $code }
}

# ── Dispatcher ───────────────────────────────────────────────────────────────
if ($Action -eq 'list') { Invoke-List; return }

if (-not $Profile) { throw "-Profile is required for action '$Action'" }
$Paths    = Get-ProfilePaths $Profile
Test-PathSafe $Paths.Root
Ensure-Dirs  $Paths

$BasePort = Resolve-PortBase -ProfileName $Profile -Override $PortBase
$envMap   = Get-ProfileEnv -ProfileName $Profile -Paths $Paths -BasePort $BasePort -Extra $Override

switch ($Action) {
  'start' {
    $pidVal = Start-DevServer -Paths $Paths -Env $envMap -ProfileName $Profile -BasePort $BasePort
    Show-Banner -ProfileName $Profile -Paths $Paths -Env $envMap -Port $BasePort -RunningPid $pidVal
  }
  'stop' {
    [void](Stop-DevServer $Paths)
  }
  'restart' {
    [void](Stop-DevServer $Paths)
    Start-Sleep -Milliseconds 200
    $pidVal = Start-DevServer -Paths $Paths -Env $envMap -ProfileName $Profile -BasePort $BasePort
    Show-Banner -ProfileName $Profile -Paths $Paths -Env $envMap -Port $BasePort -RunningPid $pidVal
  }
  'status' {
    $pidVal = Get-RunningPid $Paths
    Save-EnvFile -Env $envMap -File $Paths.EnvFile
    if ($pidVal) {
      Write-Activity $Paths.ActivityLog 'info' 'status' @{ pid = $pidVal; running = $true }
      Show-Banner -ProfileName $Profile -Paths $Paths -Env $envMap -Port $BasePort -RunningPid $pidVal
    } else {
      Write-Activity $Paths.ActivityLog 'info' 'status' @{ running = $false }
      Write-Host "Profile '$Profile' is not running. Sandbox: $($Paths.Root)"
    }
  }
  'crud'           { Invoke-Crud         $Paths }
  'contenttypes'   { Invoke-ContentTypes  $Paths }
  'validation'     { Invoke-Validation    $Paths }
  'import'         { Invoke-Import        $Paths }
  'export'         { Invoke-Export $Paths }
  'reset-flags'    { Reset-Flags   $Paths }
  'reset-storage'  { Reset-Storage $Paths }
  'reset-all'      { Reset-Flags $Paths; Reset-Storage $Paths }
}
