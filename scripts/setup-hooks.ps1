<##
.SYNOPSIS
  Install and optionally validate the repository hook model.
#>
param(
  [switch]$Validate
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot 'template-manifest.json'
$templateVersion = $null

if (Test-Path $manifestPath) {
  try {
    $manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
    $templateVersion = $manifest.templateVersion
  }
  catch {
    Write-Host 'Warning: template-manifest.json could not be parsed.' -ForegroundColor Yellow
  }
}

$preCommit = Get-Command pre-commit -ErrorAction SilentlyContinue
if (-not $preCommit) {
  Write-Host 'pre-commit is not installed.' -ForegroundColor Red
  Write-Host 'Install with: pip install pre-commit detect-secrets' -ForegroundColor Yellow
  exit 1
}

$ggshield = Get-Command ggshield -ErrorAction SilentlyContinue
if ($ggshield) {
  Write-Host 'ggshield CLI detected.' -ForegroundColor DarkGray
  Write-Host 'If you have not authenticated yet, run: ggshield auth login' -ForegroundColor DarkGray
}
elseif (-not $env:GITGUARDIAN_API_KEY) {
  Write-Host 'Warning: ggshield authentication is not configured yet.' -ForegroundColor Yellow
  Write-Host 'Set GITGUARDIAN_API_KEY or install ggshield and run: ggshield auth login' -ForegroundColor Yellow
}

if ($templateVersion) {
  Write-Host ("Template version: {0}" -f $templateVersion) -ForegroundColor DarkGray
}

Write-Host 'pre-commit will manage the gitleaks pre-commit and Semgrep/ggshield pre-push hook environments automatically.' -ForegroundColor DarkGray

Write-Host 'Installing pre-commit and pre-push hooks...' -ForegroundColor Cyan
pre-commit install --install-hooks --hook-type pre-commit --hook-type pre-push
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if ($Validate) {
  if (-not $ggshield -and -not $env:GITGUARDIAN_API_KEY) {
    Write-Host 'Validation may fail until ggshield authentication is configured.' -ForegroundColor Yellow
  }
  Write-Host 'Running pre-commit validation across the working tree...' -ForegroundColor Cyan
  pre-commit run --all-files
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  Write-Host 'Running pre-push validation across the working tree...' -ForegroundColor Cyan
  pre-commit run --all-files --hook-stage pre-push
  exit $LASTEXITCODE
}

Write-Host 'Hook installation complete.' -ForegroundColor Green
