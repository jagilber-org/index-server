Param()

# Pre-push log-hygiene gate.
#
# Mirrors the CI hygiene gate (scripts/crawl-logs.mjs --strict) so devs who
# run tests locally before pushing get the same WARN-with-stack / repeat-spam
# / chronic-pattern failures BEFORE a 5-minute CI round trip.
#
# Skip semantics:
#   - If neither logs/ nor test-results/test-output.log exist with non-empty
#     content, exit 0. Pre-push must not require a fresh test run; it just
#     opportunistically validates whatever the latest local run produced.
#
# No bypass flags: per constitution OB-6 / R6 (no --no-verify equivalents).

$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { exit 0 }
Set-Location $repoRoot

$logsDir = Join-Path $repoRoot 'logs'
$logFile = Join-Path $repoRoot 'test-results/test-output.log'
$latestMarkerPointer = Join-Path $repoRoot '.test-run-complete.latest'

$hasLogs = $false
if (Test-Path $logsDir) {
  $any = Get-ChildItem $logsDir -Recurse -File -Include *.log,*.jsonl,*.ndjson -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($any) { $hasLogs = $true }
}
if (-not $hasLogs -and (Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 0)) {
  $hasLogs = $true
}

if (-not $hasLogs) {
  Write-Host '[pre-push] log-hygiene: no local logs to scan (skipped). Run `npm test` then push to validate locally.' -ForegroundColor DarkYellow
  exit 0
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[pre-push] log-hygiene: node not on PATH; skipping (CI will still enforce).' -ForegroundColor DarkYellow
  exit 0
}

$since = $null
if (Test-Path $latestMarkerPointer) {
  try {
    $markerName = (Get-Content -Raw $latestMarkerPointer).Trim()
    if ($markerName -match '^\.test-run-complete\.\d+\.marker$' -and (Split-Path -Leaf $markerName) -eq $markerName) {
      $markerPath = Join-Path $repoRoot $markerName
      if (Test-Path $markerPath) {
        $summary = Get-Content -Raw $markerPath | ConvertFrom-Json
        $started = [long]$summary.started
        if ($started -gt 0) {
          $since = [DateTimeOffset]::FromUnixTimeMilliseconds($started).ToUniversalTime().ToString('o')
        }
      }
    }
  } catch {
    Write-Host '[pre-push] log-hygiene: latest test sentinel is invalid; scanning all local logs.' -ForegroundColor DarkYellow
  }
}

if ($since) {
  Write-Host "[pre-push] log-hygiene: running crawl-logs.mjs --strict for the latest test run (since $since)." -ForegroundColor DarkCyan
} else {
  Write-Host '[pre-push] log-hygiene: no valid test sentinel; running crawl-logs.mjs --strict against all local logs.' -ForegroundColor DarkCyan
}
$args = @(
  'scripts/diagnostics/crawl-logs.mjs',
  '--dir', 'logs',
  '--file', 'test-results/test-output.log',
  '--allowlist', '.crawl-logs-allowlist',
  '--summary', 'test-results/log-hygiene.json',
  '--strict'
)
if ($since) {
  $args += @('--since', $since)
}
& $node.Source @args
$code = $LASTEXITCODE
if ($code -eq 2) {
  # crawl-logs returns 2 only when it found nothing to scan; treat as skip.
  Write-Host '[pre-push] log-hygiene: nothing scanned (skipped).' -ForegroundColor DarkYellow
  exit 0
}
if ($code -ne 0) {
  Write-Host '[pre-push] log-hygiene FAILED. Fix the offending WARN/ERROR signatures or update .crawl-logs-allowlist with rationale.' -ForegroundColor Red
  exit $code
}
exit 0
