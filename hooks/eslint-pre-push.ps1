<#
.SYNOPSIS
    Mandatory ESLint pre-push gate for JS/TS adopters.

.DESCRIPTION
    Mirrors CI behavior (CD-1 / GW-1 / TS-4) so local pre-push fails when
    `npm run lint` would fail in CI. JS/TS-aware: no-op for repos without
    an ESLint configuration AND a `lint` script in package.json.

    Detection (all must be true to enforce):
      * package.json present at repo root.
      * package.json declares a `scripts.lint` entry.
      * An ESLint configuration is discoverable: any of
        `.eslintrc`, `.eslintrc.js`, `.eslintrc.cjs`, `.eslintrc.mjs`,
        `.eslintrc.json`, `.eslintrc.yml`, `.eslintrc.yaml`,
        `eslint.config.js`, `eslint.config.cjs`, `eslint.config.mjs`,
        `eslint.config.ts`, OR an `eslintConfig` field in package.json.

    Severity policy:
      * The hook delegates severity to the adopter's `lint` script. If the
        adopter wants warnings to fail, they should configure
        `eslint --max-warnings=0` in their `lint` script. The hook itself
        only enforces `npm run lint` exit status (errors fail; warnings
        do not unless the adopter opts in). This keeps the gate aligned
        with whatever CI actually runs.

    Emergency override:
      * Set TEMPLATE_SKIP_LINT=1 to skip the gate. This is intentionally
        SEPARATE from any slow-suite skip flag so it cannot be bypassed
        unintentionally. The hook prints a loud warning when honored.

    Cross-platform (Windows + Linux pwsh).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Find-RepoRoot {
    try {
        $root = (& git rev-parse --show-toplevel 2>$null).Trim()
        if ($LASTEXITCODE -eq 0 -and $root) { return $root }
    } catch { }
    return (Get-Location).Path
}

$repoRoot = Find-RepoRoot
$packageJsonPath = Join-Path $repoRoot 'package.json'

if (-not (Test-Path $packageJsonPath)) {
    Write-Host '[eslint-pre-push] No package.json detected; skipping (non-JS adopter).' -ForegroundColor DarkGray
    exit 0
}

try {
    $pkg = Get-Content -Raw -Path $packageJsonPath | ConvertFrom-Json
} catch {
    Write-Host "[eslint-pre-push] Could not parse package.json: $($_.Exception.Message). Skipping lint gate." -ForegroundColor Yellow
    exit 0
}

$hasLintScript = $false
if ($pkg.PSObject.Properties.Name -contains 'scripts' -and $pkg.scripts) {
    if ($pkg.scripts.PSObject.Properties.Name -contains 'lint' -and $pkg.scripts.lint) {
        $hasLintScript = $true
    }
}

if (-not $hasLintScript) {
    Write-Host '[eslint-pre-push] No `lint` script in package.json; skipping (non-JS-lint adopter).' -ForegroundColor DarkGray
    exit 0
}

$eslintConfigCandidates = @(
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.mjs',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    'eslint.config.js',
    'eslint.config.cjs',
    'eslint.config.mjs',
    'eslint.config.ts',
    'eslint.config.mts',
    'eslint.config.cts'
)

$hasEslintConfig = $false
foreach ($candidate in $eslintConfigCandidates) {
    if (Test-Path (Join-Path $repoRoot $candidate)) {
        $hasEslintConfig = $true
        break
    }
}

if (-not $hasEslintConfig -and $pkg.PSObject.Properties.Name -contains 'eslintConfig' -and $pkg.eslintConfig) {
    $hasEslintConfig = $true
}

if (-not $hasEslintConfig) {
    Write-Host '[eslint-pre-push] No ESLint configuration detected; skipping.' -ForegroundColor DarkGray
    exit 0
}

if ($env:TEMPLATE_SKIP_LINT -eq '1') {
    Write-Host '================================================================' -ForegroundColor Yellow
    Write-Host 'WARNING: TEMPLATE_SKIP_LINT=1 detected.' -ForegroundColor Yellow
    Write-Host '         Skipping mandatory ESLint pre-push gate.' -ForegroundColor Yellow
    Write-Host '         This emergency override must NOT be a habit.' -ForegroundColor Yellow
    Write-Host '         CI lint will still run and may reject the push.' -ForegroundColor Yellow
    Write-Host '================================================================' -ForegroundColor Yellow
    exit 0
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm -and $IsWindows) {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
}
if (-not $npm) {
    Write-Host '[eslint-pre-push] npm is not on PATH but lint is configured; failing closed.' -ForegroundColor Red
    Write-Host '                 Install Node.js/npm or set TEMPLATE_SKIP_LINT=1 deliberately.' -ForegroundColor Red
    exit 1
}

Write-Host '[eslint-pre-push] Running `npm run lint` (mirrors CI lint gate)...' -ForegroundColor Cyan

Push-Location $repoRoot
try {
    # Local deviation from template v1.25.0: invoke the CommandInfo directly
    # (& $npm) instead of $npm.Source so PowerShell dispatch works uniformly
    # for paths, aliases, and functions. Tracked upstream:
    # https://github.com/jagilber-dev/template-repo/issues/63
    & $npm 'run' 'lint' '--silent'
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($code -ne 0) {
    Write-Host ''
    Write-Host "[eslint-pre-push] FAILED: npm run lint exited with code $code." -ForegroundColor Red
    Write-Host '                 Fix lint errors before pushing, or set TEMPLATE_SKIP_LINT=1' -ForegroundColor Red
    Write-Host '                 only as a deliberate emergency override.' -ForegroundColor Red
    exit $code
}

Write-Host '[eslint-pre-push] Lint passed.' -ForegroundColor Green
exit 0
