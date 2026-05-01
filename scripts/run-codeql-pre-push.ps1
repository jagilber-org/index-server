#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Local CodeQL gate matching the GHAS workflow (.github/workflows/codeql.yml).

.DESCRIPTION
    Runs CodeQL security-extended JS/TS suite against changed files on the
    current branch. Fails the push if ANY error/critical (>= 9.0) finding
    is introduced relative to .codeql/baseline.sarif (or absolute if no
    baseline exists).

    This closes the gap that caused PR #275 / #277: Semgrep does not run
    CodeQL queries (e.g. js/type-confusion-through-parameter-tampering).

.NOTES
    First run: cold build ~8 min (TRAP extraction across all TS files).
    Warm runs: incremental ~1-2 min if only a few files changed.
    Opt-out: SKIP_CODEQL=1 (audit-logged via process.stderr).

    Tracked: jagilber-dev/template-repo#77 (template-level rollout).
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [string]$Suite = 'codeql/javascript-queries:codeql-suites/javascript-security-extended.qls',
    [double]$FailThreshold = 9.0,
    [string]$DbPath,
    [string]$BaselinePath = '.codeql/baseline.sarif',
    [string]$OutputPath,
    [string]$LogDir,
    [string]$Language,
    [int]$Threads = -1,
    [int]$Ram = -1
)

$ErrorActionPreference = 'Stop'

# Load repo-root .env so CODEQL_* keys flow into $env:* (existing $env wins).
$loadEnv = Join-Path $PSScriptRoot 'Load-RepoEnv.ps1'
if (Test-Path -LiteralPath $loadEnv) { . $loadEnv | Out-Null }

# Resolve config: explicit param > env var > sensible default.
if (-not $DbPath)       { $DbPath       = if ($env:CODEQL_DB_PATH)     { $env:CODEQL_DB_PATH }     else { '.codeql/db-main' } }
if (-not $OutputPath)   { $OutputPath   = if ($env:CODEQL_OUTPUT_PATH) { $env:CODEQL_OUTPUT_PATH } else { '.codeql/results-prepush.sarif' } }
if (-not $LogDir)       { $LogDir       = if ($env:CODEQL_LOG_DIR)     { $env:CODEQL_LOG_DIR }     else { '.codeql/logs' } }
if (-not $Language)     { $Language     = if ($env:CODEQL_LANGUAGE)    { $env:CODEQL_LANGUAGE }    else { 'javascript' } }
if ($Threads -lt 0)     { $Threads      = if ($env:CODEQL_THREADS)     { [int]$env:CODEQL_THREADS } else { 0 } }
if ($Ram -lt 0)         { $Ram          = if ($env:CODEQL_RAM)         { [int]$env:CODEQL_RAM }     else { 8192 } }

# Ensure parent dirs for off-repo locations exist (CodeQL won't create them).
foreach ($p in @($DbPath, $OutputPath, $LogDir)) {
    $parent = Split-Path -Parent $p
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
}
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

if ($env:SKIP_CODEQL -eq '1' -and -not $Force) {
    [Console]::Error.WriteLine('[codeql-pre-push] SKIPPED (SKIP_CODEQL=1) -- audit:' + (Get-Date -Format o))
    exit 0
}

# CI environments run the authoritative CodeQL workflow (.github/workflows/codeql.yml)
# directly. The pre-push replay job (pre-commit workflow) re-running this gate is
# redundant and would require installing the CodeQL CLI on every runner. Skip when
# we detect a CI environment unless explicitly forced.
if (-not $Force -and ($env:CI -eq 'true' -or $env:GITHUB_ACTIONS -eq 'true')) {
    [Console]::Error.WriteLine('[codeql-pre-push] SKIPPED (CI detected; authoritative CodeQL workflow runs separately) -- audit:' + (Get-Date -Format o))
    exit 0
}

# 1. CLI presence check
$codeql = Get-Command codeql -ErrorAction SilentlyContinue
if (-not $codeql) {
    [Console]::Error.WriteLine(@'
[codeql-pre-push] FAIL: codeql CLI not found.
Install: https://github.com/github/codeql-cli-binaries/releases
Then: codeql pack download codeql/javascript-queries
Or set SKIP_CODEQL=1 to bypass (NOT RECOMMENDED -- GHAS will still flag).
'@)
    exit 1
}

# 2. Decide whether to (re)build DB.
#    Rebuild if: DB missing, or any tracked src/scripts file is newer than the DB.
$rebuild = $false
# Resolve to absolute path: if $DbPath is already rooted (e.g. C:\codeql\...) use it
# as-is; otherwise treat as repo-relative. Join-Path mangles absolute paths.
if ([System.IO.Path]::IsPathRooted($DbPath)) {
    $dbDir = $DbPath
} else {
    $dbDir = Join-Path (Get-Location) $DbPath
}
if (-not (Test-Path -LiteralPath $dbDir)) {
    $rebuild = $true
    Write-Host "[codeql-pre-push] DB missing at $DbPath -- building (cold ~5-8 min)"
} else {
    # Detect unfinalized / partial DB (e.g. left over from an interrupted prior run).
    # CodeQL writes codeql-database.yml only on successful finalization; if absent,
    # analyze will fail with "needs to be finalized before running queries".
    $dbYml = Join-Path $dbDir 'codeql-database.yml'
    if (-not (Test-Path $dbYml)) {
        $rebuild = $true
        Write-Host "[codeql-pre-push] DB at $DbPath is unfinalized -- rebuilding"
    } else {
        $dbStamp = (Get-Item $dbDir).LastWriteTime
        $newer = Get-ChildItem -Path src, scripts -Recurse -Include *.ts, *.tsx, *.js, *.cjs, *.mjs -File -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -gt $dbStamp } |
            Select-Object -First 1
        if ($newer) {
            $rebuild = $true
            Write-Host "[codeql-pre-push] source newer than DB ($($newer.FullName)) -- rebuilding"
        } else {
            Write-Host "[codeql-pre-push] reusing DB at $DbPath (warm run)"
        }
    }
}

if ($rebuild) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $configFile = Join-Path (Get-Location) '.github/codeql/codeql-config.yml'
    $createArgs = @(
        'database', 'create', $DbPath,
        "--language=$Language",
        '--source-root=.',
        '--overwrite',
        "--threads=$Threads",
        "--ram=$Ram",
        '--logdir', $LogDir
    )
    if (Test-Path -LiteralPath $configFile) {
        $createArgs += @('--codescanning-config', $configFile)
    }
    Write-Host "[codeql-pre-push] codeql $($createArgs -join ' ')"
    & codeql @createArgs 2>&1 | Out-File (Join-Path $LogDir 'build.log') -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        [Console]::Error.WriteLine("[codeql-pre-push] DB build FAILED -- see $LogDir\build.log")
        exit 1
    }
    Write-Host "[codeql-pre-push] DB built in $([math]::Round($sw.Elapsed.TotalSeconds,1))s"
}

# 3. Analyze
$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
& codeql database analyze $DbPath $Suite --format=sarif-latest --output=$OutputPath "--threads=$Threads" "--ram=$Ram" --quiet 2>&1 |
    Out-File (Join-Path $LogDir 'analyze.log') -Encoding utf8
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("[codeql-pre-push] analyze FAILED -- see $LogDir\analyze.log")
    exit 1
}
Write-Host "[codeql-pre-push] analyzed in $([math]::Round($sw2.Elapsed.TotalSeconds,1))s"

# 4. Triage SARIF: fail on >= $FailThreshold severity in src/ or scripts/
$sarif = Get-Content $OutputPath -Raw | ConvertFrom-Json
$rules = @{}
foreach ($r in $sarif.runs[0].tool.driver.rules) { $rules[$r.id] = $r }
$baselineKeys = @{}
if (Test-Path $BaselinePath) {
    $base = Get-Content $BaselinePath -Raw | ConvertFrom-Json
    foreach ($r in $base.runs[0].results) {
        $loc = $r.locations[0].physicalLocation
        $key = '{0}|{1}|{2}' -f $r.ruleId, $loc.artifactLocation.uri, $loc.region.startLine
        $baselineKeys[$key] = $true
    }
}

$critical = @()
foreach ($r in $sarif.runs[0].results) {
    $loc = $r.locations[0].physicalLocation
    $uri = $loc.artifactLocation.uri
    # Only enforce on first-party source (skip dist/, node_modules, etc.)
    if ($uri -notmatch '^(src|scripts)/') { continue }
    $rule = $rules[$r.ruleId]
    $sev = if ($rule.properties.'security-severity') { [double]$rule.properties.'security-severity' } else { 0.0 }
    if ($sev -lt $FailThreshold) { continue }
    $key = '{0}|{1}|{2}' -f $r.ruleId, $uri, $loc.region.startLine
    if ($baselineKeys.ContainsKey($key)) { continue }
    $critical += [pscustomobject]@{
        Severity = $sev
        Rule     = $r.ruleId
        File     = $uri
        Line     = $loc.region.startLine
        Message  = $r.message.text
    }
}

if ($critical.Count -gt 0) {
    [Console]::Error.WriteLine("`n[codeql-pre-push] FAIL: $($critical.Count) finding(s) at severity >= $FailThreshold (not in baseline):`n")
    foreach ($f in $critical) {
        [Console]::Error.WriteLine(("  [{0}] {1}" -f $f.Severity, $f.Rule))
        [Console]::Error.WriteLine(("    {0}:{1}" -f $f.File, $f.Line))
        [Console]::Error.WriteLine(("    {0}" -f ($f.Message -replace "`n", ' ')))
    }
    [Console]::Error.WriteLine("`nPush blocked. Fix the findings or update baseline:")
    [Console]::Error.WriteLine("  Copy-Item $OutputPath $BaselinePath  # accept current findings as baseline")
    exit 1
}

Write-Host "[codeql-pre-push] OK: 0 new findings >= $FailThreshold severity in src/ or scripts/"
exit 0
