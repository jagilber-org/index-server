# Quick Start Memory Monitoring Script
# Launches enhanced monitoring for MCP server memory leak investigation

param(
    [int]$Duration = 30,  # minutes
    [int]$Interval = 5,   # seconds
    [string]$OutputDir = "logs"
)

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$csvFile = Join-Path $OutputDir "memory-monitor-$timestamp.csv"

Write-Host "🚀 STARTING ENHANCED MEMORY MONITORING" -ForegroundColor Green
Write-Host "📊 Duration: $Duration minutes | Interval: ${Interval}s" -ForegroundColor Cyan
Write-Host "📝 Output: $csvFile" -ForegroundColor Yellow
Write-Host ""

# Ensure output directory exists
if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Calculate max samples
$maxSamples = [math]::Ceiling(($Duration * 60) / $Interval)

Write-Host "📋 MONITORING INSTRUCTIONS:" -ForegroundColor White
Write-Host "1. This PowerShell window will monitor externally" -ForegroundColor Gray
Write-Host "2. In VS Code Debug Console, run: .load scripts/memory-inspector.js" -ForegroundColor Gray
Write-Host "3. Then run: startContinuousMonitoring(30000)" -ForegroundColor Gray
Write-Host "4. Both will run for $Duration minutes automatically" -ForegroundColor Gray
Write-Host ""

Write-Host "🎯 WHAT TO LOOK FOR:" -ForegroundColor White
Write-Host "• RSS growth rate > 100 KB/min = potential leak" -ForegroundColor Red
Write-Host "• Handle count consistently increasing" -ForegroundColor Yellow
Write-Host "• Event listener counts above normal baseline" -ForegroundColor Yellow
Write-Host ""

# Start the enhanced monitoring
Write-Host "▶️  Starting external monitoring..." -ForegroundColor Green
& "$PSScriptRoot\monitor-memory.ps1" -IntervalSeconds $Interval -MaxSamples $maxSamples -OutputFile $csvFile -ShowGrowthRate

Write-Host ""
Write-Host "✅ Monitoring completed! Check $csvFile for detailed data." -ForegroundColor Green
Write-Host "📊 You can import the CSV into Excel or PowerBI for analysis." -ForegroundColor Cyan
