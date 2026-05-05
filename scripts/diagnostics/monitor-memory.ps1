# Enhanced Memory Monitoring Script for Node.js MCP Server
param(
    [int]$IntervalSeconds = 5,
    [int]$MaxSamples = 0,  # 0 = infinite
    [string]$OutputFile = "",
    [switch]$ShowGrowthRate
)

Write-Host "🔍 Enhanced Node.js MCP Server Memory Monitor" -ForegroundColor Green
Write-Host "📊 Interval: ${IntervalSeconds}s | Max Samples: $(if($MaxSamples -eq 0) {'∞'} else {$MaxSamples})" -ForegroundColor Cyan

$sampleCount = 0
$startTime = Get-Date
$baselineMemory = $null
$previousMemory = $null
$memoryHistory = @()

# CSV header if output file specified
if ($OutputFile) {
    "Timestamp,ElapsedMinutes,PID,Name,RSS_MB,Virtual_MB,Handles,Threads,RSS_Change_KB,Virtual_Change_KB,Handles_Change,RSS_Rate_KB_Min,Virtual_Rate_KB_Min" | Out-File -FilePath $OutputFile -Encoding UTF8
    Write-Host "📝 Logging to: $OutputFile" -ForegroundColor Yellow
}

while ($true) {
    $sampleCount++
    $currentTime = Get-Date
    $elapsed = ($currentTime - $startTime).TotalMinutes

    try {
        # Find Node.js processes (prioritize those with 'mcp' in command line)
        $nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
                [PSCustomObject]@{
                    Process = $_
                    CommandLine = $cmdLine
                    IsMCP = $cmdLine -like "*mcp*" -or $cmdLine -like "*index*"
                }
            } catch {
                [PSCustomObject]@{
                    Process = $_
                    CommandLine = "Unknown"
                    IsMCP = $false
                }
            }
        } | Sort-Object IsMCP -Descending

        if ($nodeProcesses.Count -eq 0) {
            Write-Host "❌ No Node.js processes found. Waiting..." -ForegroundColor Red
            Start-Sleep -Seconds $IntervalSeconds
            continue
        }

        # Monitor the first (most likely MCP) process
        $targetProcess = $nodeProcesses[0]
        $proc = $targetProcess.Process

        $current = [PSCustomObject]@{
            Timestamp = $currentTime
            ElapsedMinutes = [math]::Round($elapsed, 2)
            PID = $proc.Id
            Name = $proc.ProcessName
            RSS_MB = [math]::Round($proc.WorkingSet64 / 1MB, 2)
            Virtual_MB = [math]::Round($proc.VirtualMemorySize64 / 1MB, 2)
            Handles = $proc.HandleCount
            Threads = $proc.Threads.Count
            CommandHint = if ($targetProcess.CommandLine.Length -gt 50) {
                $targetProcess.CommandLine.Substring(0, 50) + "..."
            } else {
                $targetProcess.CommandLine
            }
        }

        # Add to history
        $memoryHistory += $current
        if ($memoryHistory.Count -gt 20) {
            $memoryHistory = $memoryHistory[-20..-1]  # Keep last 20 samples
        }

        # Set baseline on first sample
        if ($null -eq $baselineMemory) {
            $baselineMemory = $current
            Write-Host "📍 BASELINE SET: PID $($proc.Id) | RSS: $($current.RSS_MB) MB | Handles: $($current.Handles)" -ForegroundColor Cyan
        }

        # Calculate changes
        $rssChange = if ($previousMemory) { [math]::Round(($current.RSS_MB - $previousMemory.RSS_MB) * 1024, 1) } else { 0 }
        $virtualChange = if ($previousMemory) { [math]::Round(($current.Virtual_MB - $previousMemory.Virtual_MB) * 1024, 1) } else { 0 }
        $handlesChange = if ($previousMemory) { $current.Handles - $previousMemory.Handles } else { 0 }

        # Calculate growth rates (over last 5 samples)
        $rssRate = 0
        $virtualRate = 0
        if ($memoryHistory.Count -ge 5) {
            $fiveSamplesAgo = $memoryHistory[-5]
            $timeSpan = ($current.ElapsedMinutes - $fiveSamplesAgo.ElapsedMinutes)
            if ($timeSpan -gt 0) {
                $rssRate = [math]::Round((($current.RSS_MB - $fiveSamplesAgo.RSS_MB) * 1024) / $timeSpan, 1)
                $virtualRate = [math]::Round((($current.Virtual_MB - $fiveSamplesAgo.Virtual_MB) * 1024) / $timeSpan, 1)
            }
        }

        # Display current status
        $timeStr = $currentTime.ToString("HH:mm:ss")
        $changeIndicator = switch ($true) {
            ($rssChange -gt 1000) { "📈" }
            ($rssChange -lt -1000) { "📉" }
            default { "📊" }
        }

        Write-Host "`n$changeIndicator [$timeStr] Sample #$sampleCount (${elapsed:F1}m)" -ForegroundColor White
        Write-Host "  PID: $($proc.Id) | $($current.CommandHint)" -ForegroundColor Gray
        Write-Host "  RSS: $($current.RSS_MB) MB ($(if($rssChange -gt 0){'+'})$($rssChange) KB)" -ForegroundColor $(if($rssChange -gt 500) {'Red'} elseif($rssChange -gt 100) {'Yellow'} else {'Green'})
        Write-Host "  Virtual: $($current.Virtual_MB) MB ($(if($virtualChange -gt 0){'+'})$($virtualChange) KB)" -ForegroundColor Gray
        Write-Host "  Handles: $($current.Handles) ($(if($handlesChange -gt 0){'+'})$($handlesChange))" -ForegroundColor $(if($handlesChange -gt 5) {'Yellow'} else {'Gray'})
        Write-Host "  Threads: $($current.Threads)" -ForegroundColor Gray

        if ($ShowGrowthRate -and $memoryHistory.Count -ge 5) {
            Write-Host "  Growth Rate: RSS ${rssRate} KB/min | Virtual ${virtualRate} KB/min" -ForegroundColor $(if($rssRate -gt 100) {'Red'} elseif($rssRate -gt 20) {'Yellow'} else {'Green'})
        }

        # Growth since baseline
        $totalRssGrowth = [math]::Round(($current.RSS_MB - $baselineMemory.RSS_MB) * 1024, 1)
        $totalHandleGrowth = $current.Handles - $baselineMemory.Handles
        if ($elapsed -gt 0) {
            $avgRssRate = [math]::Round($totalRssGrowth / $elapsed, 1)
            Write-Host "  Since Baseline: RSS +$($totalRssGrowth) KB (${avgRssRate} KB/min avg) | Handles +$($totalHandleGrowth)" -ForegroundColor Magenta
        }

        # Leak warnings
        if ($rssRate -gt 100) {
            Write-Host "  🚨 HIGH RSS GROWTH RATE!" -ForegroundColor Red
        }
        if ($handlesChange -gt 5) {
            Write-Host "  ⚠️  Handle count increasing" -ForegroundColor Yellow
        }
        if ($current.Handles -gt 200) {
            Write-Host "  🚨 HIGH HANDLE COUNT!" -ForegroundColor Red
        }

        # Log to CSV
        if ($OutputFile) {
            "$($currentTime.ToString('yyyy-MM-dd HH:mm:ss')),$($current.ElapsedMinutes),$($current.PID),$($current.Name),$($current.RSS_MB),$($current.Virtual_MB),$($current.Handles),$($current.Threads),$($rssChange),$($virtualChange),$($handlesChange),$($rssRate),$($virtualRate)" |
                Out-File -FilePath $OutputFile -Append -Encoding UTF8
        }

        $previousMemory = $current

        # Check if we've reached max samples
        if ($MaxSamples -gt 0 -and $sampleCount -ge $MaxSamples) {
            Write-Host "`n✅ Reached maximum samples ($MaxSamples). Stopping." -ForegroundColor Green
            break
        }

    } catch {
        Write-Host "❌ Error monitoring process: $($_.Exception.Message)" -ForegroundColor Red
    }

    Start-Sleep -Seconds $IntervalSeconds
}

# Final summary
Write-Host "`n📋 MONITORING SUMMARY:" -ForegroundColor Green
Write-Host "Duration: ${elapsed:F1} minutes" -ForegroundColor White
Write-Host "Samples: $sampleCount" -ForegroundColor White
if ($baselineMemory -and $previousMemory) {
    $totalGrowth = [math]::Round(($previousMemory.RSS_MB - $baselineMemory.RSS_MB) * 1024, 1)
    $avgRate = if ($elapsed -gt 0) { [math]::Round($totalGrowth / $elapsed, 1) } else { 0 }
    Write-Host "Total RSS Growth: $totalGrowth KB" -ForegroundColor White
    Write-Host "Average Growth Rate: $avgRate KB/minute" -ForegroundColor White
}
