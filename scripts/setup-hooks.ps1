$preCommit = Get-Command pre-commit -ErrorAction SilentlyContinue
if (-not $preCommit) {
  Write-Error 'pre-commit is not installed or not on PATH.'
  exit 1
}

Write-Host '[setup-hooks] Installing pre-commit and pre-push hooks...' -ForegroundColor Cyan
$installProcess = Start-Process -FilePath $preCommit.Source -ArgumentList 'install', '--hook-type', 'pre-commit', '--hook-type', 'pre-push' -NoNewWindow -Wait -PassThru
$installExitCode = $installProcess.ExitCode
if ($installExitCode -ne 0) {
  exit $installExitCode
}

Write-Host '[setup-hooks] Installing hook environments...' -ForegroundColor Cyan
$environmentProcess = Start-Process -FilePath $preCommit.Source -ArgumentList 'install-hooks' -NoNewWindow -Wait -PassThru
$environmentExitCode = $environmentProcess.ExitCode
exit $environmentExitCode
