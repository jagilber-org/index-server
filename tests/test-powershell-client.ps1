#Requires -Version 7.0
<#
.SYNOPSIS
    Test PowerShell MCP client connection - client spawns its own server
#>

param(
    [int]$TimeoutMs = 8000
)

$ErrorActionPreference = 'Continue'
$serverPath = Join-Path $PSScriptRoot 'dist\server\index-server.js'

Write-Host "`n[TEST] Starting PowerShell MCP Client Connection Test" -ForegroundColor Cyan
Write-Host "[TEST] Server: $serverPath" -ForegroundColor Gray
Write-Host "[TEST] Timeout: $TimeoutMs ms`n" -ForegroundColor Gray

# Enable diagnostics
$env:INDEX_SERVER_LOG_DIAG = '1'
$env:INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER = '0'

Write-Host "[TEST] Connecting PowerShell MCP client (will spawn server)..." -ForegroundColor Yellow

try {
    Import-Module $env:INDEX_SERVER_CLIENT_MODULE_PATH\SimpleMCPClient.psm1 -Force -ErrorAction Stop

    Import-Module $env:INDEX_SERVER_CLIENT_MODULE_PATH\SimpleMCPClient.psm1 -Force -ErrorAction Stop

    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    # Client will spawn server with inherited environment (INDEX_SERVER_LOG_DIAG=1)
    $session = Connect-MCP -Command 'node' `
        -ArgList @($serverPath) `
        -InitTimeoutMs $TimeoutMs `
        -ErrorAction Stop

    $elapsed = $sw.ElapsedMilliseconds

    if ($session -and $session.ServerProcess) {
        Write-Host "`n[TEST] ✅ CONNECTION SUCCESSFUL in $elapsed ms" -ForegroundColor Green
        Write-Host "[TEST] Server PID: $($session.ServerProcess.Id)" -ForegroundColor Gray

        # Try to get tools
        try {
            $tools = Get-MCPTools -Session $session -ErrorAction Stop
            Write-Host "[TEST] Tool count: $($tools.Count)" -ForegroundColor Green

            # Show first few tool names
            $tools | Select-Object -First 5 -ExpandProperty name | ForEach-Object {
                Write-Host "  - $_" -ForegroundColor Gray
            }
        } catch {
            Write-Host "[TEST] ⚠️ Failed to list tools: $_" -ForegroundColor Yellow
        }

        # Show trace if available
        $trace = Get-MCPInitTrace -Session $session
        if ($trace) {
            Write-Host "`n[TEST] Handshake trace:" -ForegroundColor Cyan
            $trace | ForEach-Object {
                Write-Host "  $_" -ForegroundColor Gray
            }
        }

        # Disconnect
        Disconnect-MCP -Session $session
        Write-Host "`n[TEST] Disconnected cleanly" -ForegroundColor Gray

    } else {
        Write-Host "`n[TEST] ❌ CONNECTION FAILED after $elapsed ms" -ForegroundColor Red
    }

} catch {
    $elapsed = if ($sw) { $sw.ElapsedMilliseconds } else { 0 }
    Write-Host "`n[TEST] ❌ EXCEPTION after $elapsed ms" -ForegroundColor Red
    Write-Host "[TEST] Error: $_" -ForegroundColor Red
    Write-Host "[TEST] Type: $($_.Exception.GetType().FullName)" -ForegroundColor Gray

    # Try to show trace even on failure
    try {
        if ($session) {
            $trace = Get-MCPInitTrace -Session $session -ErrorAction SilentlyContinue
            if ($trace) {
                Write-Host "`n[TEST] Handshake trace (failed):" -ForegroundColor Yellow
                $trace | ForEach-Object {
                    Write-Host "  $_" -ForegroundColor Gray
                }
            }
        }
    } catch {
        # Ignore
    }
}

Write-Host "`n[TEST] Test complete.`n" -ForegroundColor Cyan
