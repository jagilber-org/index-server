# Memory Leak Monitoring Tools

This directory contains comprehensive tools for monitoring and diagnosing memory leaks in the MCP server.

## 🔧 Available Tools

### 1. Enhanced JavaScript Memory Inspector (`memory-inspector.js`)

**Purpose**: Runtime memory inspection from within the debugger
**Usage**: Load in VS Code Debug Console
```javascript
.load scripts/memory-inspector.js
startContinuousMonitoring(30000)  // 30-second intervals
```

**Features**:
- Continuous memory usage tracking with baseline comparison
- Event listener monitoring (stdin data listeners, etc.)
- Active handle counting
- Growth rate calculation with leak detection
- Automatic warnings for suspicious patterns
- Historical data storage (last 100 cycles)

**Commands**:
- `inspectProcessState()` - One-time detailed inspection
- `startContinuousMonitoring(intervalMs)` - Start continuous monitoring
- `stopContinuousMonitoring()` - Stop monitoring with summary
- `getMemoryHistory()` - Get historical data array

### 2. Enhanced PowerShell Monitor (`monitor-memory.ps1`)

**Purpose**: External process monitoring independent of debugger
**Usage**: Run in separate PowerShell window
```powershell
.\scripts\monitor-memory.ps1 -IntervalSeconds 5 -MaxSamples 120 -OutputFile "logs\memory.csv" -ShowGrowthRate
```

**Features**:
- RSS, Virtual memory, Handle, and Thread monitoring
- Growth rate calculation over rolling window
- CSV logging for data analysis
- Automatic MCP process detection
- Color-coded warnings and alerts
- Comprehensive baseline and summary reporting

**Parameters**:
- `-IntervalSeconds` (default: 5) - Monitoring interval
- `-MaxSamples` (default: 0 = infinite) - Maximum samples to collect
- `-OutputFile` - CSV file for data logging
- `-ShowGrowthRate` - Display growth rates during monitoring

### 3. Quick Start Script (`start-monitoring.ps1`)

**Purpose**: Launches comprehensive monitoring session
**Usage**: 
```powershell
.\scripts\start-monitoring.ps1 -Duration 30 -Interval 5 -OutputDir "logs"
```

**Features**:
- Automated monitoring setup
- CSV file generation with timestamps
- Instructions for dual monitoring (external + internal)
- Leak detection guidance

### 4. Memory Analysis Script (`analyze-memory.ps1`)

**Purpose**: Post-monitoring analysis of CSV data
**Usage**:
```powershell
.\scripts\analyze-memory.ps1 -CsvFile "logs\memory-monitor-20250101-120000.csv"
```

**Features**:
- Comprehensive leak assessment
- Growth rate analysis
- Pattern detection (spikes, trends)
- Actionable recommendations
- Color-coded conclusions

## 📊 Monitoring Workflow

### Step 1: Start External Monitoring
```powershell
# In a separate PowerShell window
.\scripts\start-monitoring.ps1 -Duration 60 -Interval 10
```

### Step 2: Start Internal Monitoring (VS Code Debug Console)
```javascript
.load scripts/memory-inspector.js
startContinuousMonitoring(30000)
```

### Step 3: Let It Run
- External monitor will automatically stop after specified duration
- Internal monitor can be stopped manually: `stopContinuousMonitoring()`

### Step 4: Analyze Results
```powershell
.\scripts\analyze-memory.ps1 -CsvFile "logs\memory-monitor-TIMESTAMP.csv"
```

## 🎯 What to Look For

### Memory Leak Indicators
- **RSS Growth Rate > 100 KB/min**: Significant leak
- **RSS Growth Rate 20-100 KB/min**: Moderate concern
- **Handle Count Increasing**: Resource leaks
- **Event Listener Accumulation**: Specific to Node.js/MCP issues

### Normal Patterns
- RSS baseline: 40-60 MB for typical MCP server
- Handle count: 150-200 typical, stable
- Event listeners: 4 stdin data listeners normal
- Minor fluctuations: ±5-10 MB normal for garbage collection

### Investigation Actions
1. **Immediate**: Check event listener counts and active handles
2. **Short-term**: Run 30-60 minute monitoring sessions
3. **Deep dive**: Use Chrome DevTools heap snapshots if leak confirmed
4. **Code review**: Focus on recent changes, event handler cleanup

## 📁 Output Files

### CSV Format
```
Timestamp,ElapsedMinutes,PID,Name,RSS_MB,Virtual_MB,Handles,Threads,RSS_Change_KB,Virtual_Change_KB,Handles_Change,RSS_Rate_KB_Min,Virtual_Rate_KB_Min
```

### Analysis Report
- Growth rate assessment
- Leak probability scoring
- Pattern analysis
- Actionable recommendations

## 🚨 Emergency Procedures

### If Leak Confirmed
1. **Immediate**: Stop non-essential monitoring
2. **Capture**: Take heap snapshot via Chrome DevTools
3. **Document**: Note recent changes, reproduction steps
4. **Isolate**: Test with minimal configuration
5. **Fix**: Focus on event listener cleanup, timer management

### False Positives
- Garbage collection spikes (temporary)
- Initial warmup period (first 5-10 minutes)
- Debug tools overhead (expect 10-20% overhead)

## 🔍 Advanced Usage

### Custom Analysis
```powershell
# Long-term monitoring (4 hours)
.\scripts\monitor-memory.ps1 -IntervalSeconds 60 -MaxSamples 240 -OutputFile "long-term.csv"

# High-frequency monitoring (leak reproduction)
.\scripts\monitor-memory.ps1 -IntervalSeconds 1 -MaxSamples 300 -OutputFile "high-freq.csv"
```

### Integration with CI/CD
- Run monitoring during long-running tests
- Set thresholds for automated leak detection
- Include CSV analysis in build reports

## 📚 References

- [Node.js Memory Debugging](https://nodejs.org/en/docs/guides/debugging-getting-started/)
- [Chrome DevTools Memory](https://developer.chrome.com/docs/devtools/memory/)
- [MCP Protocol Specification](https://modelcontextprotocol.io/docs/)
