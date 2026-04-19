/**
 * Memory Debugging Helper Script
 *
 * Run this in the VS Code debugger console or Node.js REPL
 * to get immediate memory insights while debugging your MCP server.
 */

// Quick memory status
console.log('=== MEMORY DEBUGGING COMMANDS ===');
console.log('Available commands:');
console.log('  memStatus()     - Current memory usage');
console.log('  startMemWatch() - Start monitoring (every 5s)');
console.log('  stopMemWatch()  - Stop monitoring');
console.log('  memReport()     - Detailed analysis report');
console.log('  forceGC()       - Force garbage collection');
console.log('  checkListeners() - Check event listeners');
console.log('');

// Show current memory immediately
// eslint-disable-next-line no-undef -- memStatus loaded by require() at runtime
if (typeof memStatus === 'function') {
  memStatus(); // eslint-disable-line no-undef
} else {
  console.log('Memory monitor not yet loaded. Try: require("./dist/utils/memoryMonitor.js")');
}

// PowerShell monitoring commands for external process monitoring
console.log('=== POWERSHELL MONITORING COMMANDS ===');
console.log('Get-Process -Name node | Select-Object Id, ProcessName, WorkingSet, VirtualMemorySize, PagedMemorySize');
console.log('');
console.log('Continuous monitoring:');
console.log('while($true) { Get-Process -Name node | Select-Object Id, ProcessName, @{Name="RSS_MB";Expression={[math]::Round($_.WorkingSet/1MB,2)}}, @{Name="Virtual_MB";Expression={[math]::Round($_.VirtualMemorySize/1MB,2)}}; Start-Sleep 5 }');
