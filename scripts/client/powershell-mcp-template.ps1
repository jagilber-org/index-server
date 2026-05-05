# PowerShell MCP Server Usage Template
# Safe operations with timeout protection and file logging
#
# Usage:
#   .\scripts\powershell-mcp-template.ps1 -LogFile "my-session.log" -Operation "build"
#

param(
    [string]$LogFile = "mcp-session-$(Get-Date -Format 'yyyy-MM-dd-HHmmss').log",
    [string]$Operation = "status",
    [int]$TimeoutSeconds = 15
)

Write-Output "🚀 Index Server - PowerShell MCP Template"
Write-Output "============================================="
Write-Output ""

# Configure environment for file logging
$env:INDEX_SERVER_LOG_FILE = $LogFile
$env:INDEX_SERVER_VERBOSE_LOGGING = "1"

Write-Output "📋 Configuration:"
Write-Output "   Log File: $LogFile"
Write-Output "   Operation: $Operation"
Write-Output "   Timeout: $TimeoutSeconds seconds"
Write-Output "   Working Dir: $PWD"
Write-Output ""

# Example operations that would be done via PowerShell MCP
switch ($Operation.ToLower()) {
    "status" {
        Write-Output "📊 Project Status Check:"

        # Check build status
        $buildReady = Test-Path "dist/server/index-server.js"
        Write-Output "   Build Status: $(if($buildReady){'✅ Ready'}else{'❌ Missing - run npm run build'})"

        # Check package info
        if (Test-Path "package.json") {
            $pkg = Get-Content "package.json" | ConvertFrom-Json
            Write-Output "   Package: $($pkg.name) v$($pkg.version)"
        }

        # Check source files
        $srcCount = (Get-ChildItem "src" -Filter "*.ts" -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
        Write-Output "   Source Files: $srcCount TypeScript files"

        # Check existing logs
        $logFiles = @(Get-ChildItem "*.log" -ErrorAction SilentlyContinue)
        Write-Output "   Log Files: $($logFiles.Count) files"
    }

    "build" {
        Write-Output "🔨 Building Index Server:"
        Write-Output "   This would run: npm run build"
        Write-Output "   With timeout protection and process cleanup"
    }

    "test" {
        Write-Output "🧪 Running Tests:"
        Write-Output "   This would run: npm test"
        Write-Output "   With structured logging to: $LogFile"
    }

    "deploy" {
        Write-Output "🚀 Deployment Operations:"
        Write-Output "   This would handle deployment tasks"
        Write-Output "   With full audit logging enabled"
    }

    default {
        Write-Output "❓ Unknown operation: $Operation"
        Write-Output "   Available: status, build, test, deploy"
    }
}

Write-Output ""
Write-Output "✅ Template Complete!"
Write-Output ""
Write-Output "💡 To use with PowerShell MCP Server:"
Write-Output "   mcp_powershell-mc_run-powershell:"
Write-Output "     aiAgentTimeoutSec: $TimeoutSeconds"
Write-Output "     confirmed: true"
Write-Output "     workingDirectory: `"<root>\index-server`""
Write-Output "     script: `".\scripts\powershell-mcp-template.ps1 -LogFile '$LogFile' -Operation '$Operation'`""
