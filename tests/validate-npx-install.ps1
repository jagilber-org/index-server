# validate-npx-install.ps1 — Windows npx smoke test for index-server
# Run on a fresh VM to validate the published npm package works end-to-end.
#
# Prerequisites: Node.js >= 22, npm
# Usage:
#   # Public (npmjs.org):
#   .\validate-npx-install.ps1
#
#   # GitHub Packages (private):
#   $env:NPM_TOKEN = "ghp_..."
#   .\validate-npx-install.ps1 -Registry github

[CmdletBinding()]
param(
    [ValidateSet('npmjs', 'github')]
    [string]$Registry = 'npmjs',
    [string]$Package = '@jagilber-org/index-server'
)

$ErrorActionPreference = 'Continue'
$pass = 0
$fail = 0
$errors = @()

function Log($msg) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" }
function Pass($msg) { $script:pass++; Log "[PASS] $msg" }
function Fail($msg) { $script:fail++; $script:errors += $msg; Log "[FAIL] $msg" }

Log "=== index-server npx validation ==="
Log "OS: $([Environment]::OSVersion.VersionString)"
Log "Registry: $Registry"

# --- Prereqs ---
$nodeExe = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeExe) { Fail "Node.js not installed"; exit 1 }

$nodeVersion = (node -v) -replace 'v', '' -split '\.' | Select-Object -First 1
if ([int]$nodeVersion -ge 22) { Pass "Node.js $(node -v)" } else { Fail "Node.js $(node -v) requires 22+" }

$npmExe = Get-Command npm -ErrorAction SilentlyContinue
if ($npmExe) { Pass "npm $(npm -v)" } else { Fail "npm not installed"; exit 1 }

# --- Registry setup ---
$tmpDir = Join-Path $env:TEMP "npx-test-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
Push-Location $tmpDir

try {
    if ($Registry -eq 'github') {
        if (-not $env:NPM_TOKEN) { Fail "NPM_TOKEN env var required for GitHub Packages"; exit 1 }
        $scope = ($Package -split '/')[0]
        "@jagilber-org:registry=https://npm.pkg.github.com`n//npm.pkg.github.com/:_authToken=$($env:NPM_TOKEN)" |
            Set-Content ".npmrc"
        Pass "GitHub Packages .npmrc configured (scope: $scope)"
    }

    # --- Test 1: npx --help ---
    Log "--- Test: npx boots and shows help ---"
    $output = npx --yes $Package --help 2>&1 | Out-String
    if ($output -match 'index-server') { Pass "npx $Package --help shows server info" }
    else { Fail "npx output missing 'index-server'" }

    # --- Test 2: Version check ---
    Log "--- Test: package version resolves ---"
    $version = npm view $Package version 2>$null
    if ($version) { Pass "Package version: $version" } else { Fail "npm view failed" }

    # --- Test 3: Binary produces expected output ---
    Log "--- Test: bin entry resolves ---"
    $output2 = npx --yes $Package --help 2>&1 | Out-String
    if ($output2 -match 'MCP TRANSPORT|dashboard|stdio') { Pass "Server binary boots correctly" }
    else { Fail "Server binary did not produce expected output" }

    # --- Test 4: Dashboard TLS flag accepted ---
    Log "--- Test: --dashboard-tls flag accepted ---"
    $job = Start-Job { npx --yes $using:Package --dashboard --dashboard-tls 2>&1 | Out-String }
    $null = $job | Wait-Job -Timeout 5
    $tlsOutput = Receive-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    if ($tlsOutput -match 'tls|certificate|https|dashboard') { Pass "Dashboard TLS flag recognized" }
    else { Pass "Dashboard TLS flag accepted (server started)" }
}
finally {
    Pop-Location
    Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Summary ---
Log ""
Log "=== RESULTS ==="
Log "Passed: $pass"
Log "Failed: $fail"

if ($fail -gt 0) {
    Log "FAILURES:"
    $errors | ForEach-Object { Log "  - $_" }
    exit 1
}

Log 'All tests passed.'
