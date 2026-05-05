param(
    [string]$MessageFile
)
# Enforce presence of BASELINE-CR: marker when INTERNAL-BASELINE.md is modified.
$diff = git diff --cached --name-only 2>$null
if($LASTEXITCODE -ne 0){ exit 0 }
if($diff -notmatch 'INTERNAL-BASELINE.md'){ exit 0 }
$message = Get-Content -Raw -ErrorAction SilentlyContinue $MessageFile
if(-not $message){ $message = '' }
if($message -notmatch 'BASELINE-CR:'){
  Write-Host 'Commit blocked: INTERNAL-BASELINE.md modified without BASELINE-CR: marker in commit message.' -ForegroundColor Red
  exit 1
}
exit 0
