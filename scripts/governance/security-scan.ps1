Param()
Write-Host 'Running security scan...' -ForegroundColor Cyan
$issues = @()
# Dependency audit
try {
  $audit = npm audit --json 2>$null | ConvertFrom-Json
  if($audit.metadata.vulnerabilities.total -gt 0){
    $issues += "Vulnerabilities found: $($audit.metadata.vulnerabilities.total)"
  }
} catch { $issues += 'npm audit failed' }

# Simple PII pattern scan in staged & src (exclude node_modules, tmp, test artifacts)
$piiPatterns = @('[0-9]{3}-[0-9]{2}-[0-9]{4}','\b\d{16}\b')
$files = Get-ChildItem -Recurse -Include *.ts,*.md |
  Where-Object {
    $_.FullName -notlike "*node_modules*" -and
    $_.FullName -notlike "*tmp*" -and
    $_.FullName -notlike "*test-results*" -and
    $_.FullName -notlike "*coverage*" -and
    $_.FullName -notlike "*dist*" -and
    $_.FullName -notlike "*\.d\.ts" -and
    $_.DirectoryName -notlike "*test*"
  } |
  Select-Object -ExpandProperty FullName

Write-Host "Scanning $($files.Count) files for PII patterns (excluding dependencies)..." -ForegroundColor Cyan
foreach($f in $files){
  try {
    $text = Get-Content -Raw -Path $f -ErrorAction SilentlyContinue
    if ($text) {
      foreach($pat in $piiPatterns){
        if($text -match $pat){
          $issues += "PII-like pattern in $f ($pat)"
        }
      }
    }
  } catch {
    Write-Host "Warning: Could not scan $f" -ForegroundColor Yellow
  }
}

if($issues.Count -gt 0){
  Write-Host 'Security scan issues:' -ForegroundColor Red
  $issues | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
  exit 1
}
Write-Host 'Security scan passed.' -ForegroundColor Green
exit 0
