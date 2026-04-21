$checkMode = $false
foreach ($argument in $args) {
  if ($argument -eq '-Check' -or $argument -eq '--check') {
    $checkMode = $true
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error 'Node.js is required to run sync-constitution.cjs.'
  exit 1
}

$scriptPath = Join-Path $PSScriptRoot '..\sync-constitution.cjs'
if ($checkMode) {
  $checkProcess = Start-Process -FilePath $node.Source -ArgumentList $scriptPath, '--check' -NoNewWindow -Wait -PassThru
  $checkExitCode = $checkProcess.ExitCode
  exit $checkExitCode
}

$syncProcess = Start-Process -FilePath $node.Source -ArgumentList $scriptPath -NoNewWindow -Wait -PassThru
$syncExitCode = $syncProcess.ExitCode
exit $syncExitCode
