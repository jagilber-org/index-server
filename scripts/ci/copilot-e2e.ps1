<#
.SYNOPSIS
    End-to-end smoke test for index-server via GitHub Copilot CLI.

.DESCRIPTION
    Uses the Copilot CLI programmatic interface (-p) to validate that
    the index-server MCP tools are accessible and functional.

    Prerequisites:
    - copilot CLI installed (https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli)
    - index-server configured in ~/.copilot/mcp-config.json
    - Authenticated via 'copilot /login'

.EXAMPLE
    .\scripts\copilot-e2e.ps1
    .\scripts\copilot-e2e.ps1 -ServerName "index-server"
#>
[CmdletBinding()]
param(
    [string]$ServerName = "index-server",
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

function Test-CopilotCli {
    try {
        $null = Get-Command copilot -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Write-TestResult {
    param([string]$Name, [bool]$Passed, [string]$Detail = "")
    $icon = if ($Passed) { "[PASS]" } else { "[FAIL]" }
    $color = if ($Passed) { "Green" } else { "Red" }
    Write-Host "$icon $Name" -ForegroundColor $color
    if ($Detail -and $Verbose) {
        Write-Host "       $Detail" -ForegroundColor Gray
    }
}

# --- Preflight ---
Write-Host "`n=== Copilot CLI E2E Smoke Test ===" -ForegroundColor Cyan
Write-Host "Server: $ServerName"
Write-Host "Date:   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"

if (-not (Test-CopilotCli)) {
    Write-Host "[SKIP] copilot CLI not found. Install from:" -ForegroundColor Yellow
    Write-Host "       https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"
    exit 0
}

# Check mcp-config.json
$mcpConfig = Join-Path $env:USERPROFILE ".copilot" "mcp-config.json"
if (-not (Test-Path $mcpConfig)) {
    Write-Host "[WARN] ~/.copilot/mcp-config.json not found." -ForegroundColor Yellow
    Write-Host "       Configure the server with: copilot /mcp add"
    Write-Host "       Or create $mcpConfig with:" -ForegroundColor Yellow
    Write-Host @"
{
  "mcpServers": {
    "$ServerName": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/server/index-server.js"],
      "cwd": "<user-data-dir>/index-server"
    }
  }
}
"@
}

$passed = 0
$failed = 0
$total = 3

# --- Test 1: MCP server connection ---
Write-Host "`n--- Test 1: MCP server reachable ---"
try {
    $output = copilot -p "Use the $ServerName MCP server to run help_overview and return the result" --allow-tool $ServerName 2>&1
    $success = $LASTEXITCODE -eq 0 -and $output -match "tool|instruction|Index|MCP"
    Write-TestResult "MCP server reachable" $success ($output | Select-Object -First 3 | Out-String)
    if ($success) { $passed++ } else { $failed++ }
} catch {
    Write-TestResult "MCP server reachable" $false $_.Exception.Message
    $failed++
}

# --- Test 2: Instructions search ---
Write-Host "`n--- Test 2: Instructions search ---"
try {
    $output = copilot -p "Use the $ServerName MCP server to search instructions with keywords 'bootstrap' and return the count" --allow-tool $ServerName 2>&1
    $success = $LASTEXITCODE -eq 0 -and $output -match "\d+"
    Write-TestResult "Instructions search" $success ($output | Select-Object -First 3 | Out-String)
    if ($success) { $passed++ } else { $failed++ }
} catch {
    Write-TestResult "Instructions search" $false $_.Exception.Message
    $failed++
}

# --- Test 3: Health check ---
Write-Host "`n--- Test 3: Health check ---"
try {
    $output = copilot -p "Use the $ServerName MCP server to run instructions_health and tell me if it reports healthy" --allow-tool $ServerName 2>&1
    $success = $LASTEXITCODE -eq 0
    Write-TestResult "Health check" $success ($output | Select-Object -First 3 | Out-String)
    if ($success) { $passed++ } else { $failed++ }
} catch {
    Write-TestResult "Health check" $false $_.Exception.Message
    $failed++
}

# --- Summary ---
Write-Host "`n=== Results: $passed/$total passed ===" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })
exit $failed
