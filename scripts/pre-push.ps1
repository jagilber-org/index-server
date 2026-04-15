Param()

# Optional bypass for infrastructure / documentation only commits.
# Set ALLOW_FAILING_SLOW=1 in the environment to skip executing slow regression suite.
if ($env:ALLOW_FAILING_SLOW -eq '1') {
  Write-Host '[pre-push] Bypass enabled (ALLOW_FAILING_SLOW=1) - skipping slow test suite.' -ForegroundColor Yellow
  exit 0
}

# Skip slow tests for documentation-only pushes (no src/ or test changes)
$changedFiles = git diff --name-only HEAD "@{u}" 2>$null
if ($changedFiles) {
  $codeChanges = $changedFiles | Where-Object { $_ -match '^(src/|scripts/|vitest|package)' }
  if (-not $codeChanges) {
    Write-Host '[pre-push] Documentation/config-only changes detected - skipping slow test suite.' -ForegroundColor Yellow
    exit 0
  }
}

# Maximum wall-clock time (seconds) for the entire slow suite.
# Override with PRE_PUSH_TIMEOUT_SEC env var if needed.
$timeoutSec = if ($env:PRE_PUSH_TIMEOUT_SEC) { [int]$env:PRE_PUSH_TIMEOUT_SEC } else { 120 }

Write-Host "[pre-push] Running slow test suite (test:slow) with ${timeoutSec}s timeout..."
$env:SKIP_PRETEST_BUILD='1'
$npmCommand = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  Write-Host '[pre-push] Unable to locate npm on PATH.' -ForegroundColor Red
  exit 1
}

$job = Start-Job -ScriptBlock {
  Set-Location $using:PWD
  $env:SKIP_PRETEST_BUILD = '1'
  npm run test:slow 2>&1
}

$completed = $job | Wait-Job -Timeout $timeoutSec
if (-not $completed) {
  Write-Host "[pre-push] Slow tests timed out after ${timeoutSec}s. Aborting push." -ForegroundColor Red
  Write-Host '[pre-push] To skip: set ALLOW_FAILING_SLOW=1 or increase PRE_PUSH_TIMEOUT_SEC.' -ForegroundColor Yellow
  $job | Stop-Job -PassThru | Remove-Job -Force
  exit 1
}

$output = $job | Receive-Job
$exitCode = $job.ChildJobs[0].JobStateInfo.Reason.ExitCode
$job | Remove-Job -Force

$output | ForEach-Object { Write-Host $_ }

# PowerShell jobs don't always propagate exit code reliably; check output for failure markers
if ($exitCode -and $exitCode -ne 0) {
  Write-Host '[pre-push] Slow tests failed. Aborting push.' -ForegroundColor Red
  exit $exitCode
}
if ($output -match 'Tests\s+\d+ failed') {
  Write-Host '[pre-push] Slow tests failed. Aborting push.' -ForegroundColor Red
  exit 1
}
Write-Host '[pre-push] Slow suite passed.' -ForegroundColor Green
