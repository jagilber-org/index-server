/**
 * Detailed Memory & Event Listener Inspector
 *
 * This script can be injected into your running Node.js process
 * to get detailed event listener and memory information.
 */

// Function to inspect process state in detail
function inspectProcessState() {
    const memUsage = process.memoryUsage();
    const eventNames = process.eventNames();

    console.log('\n=== DETAILED PROCESS INSPECTION ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('PID:', process.pid);

    // Memory details
    console.log('\n--- Memory Usage ---');
    console.log('Heap Used:', formatBytes(memUsage.heapUsed));
    console.log('Heap Total:', formatBytes(memUsage.heapTotal));
    console.log('External:', formatBytes(memUsage.external));
    console.log('Array Buffers:', formatBytes(memUsage.arrayBuffers));
    console.log('RSS:', formatBytes(memUsage.rss));

    // Event listeners on process
    console.log('\n--- Process Event Listeners ---');
    eventNames.forEach(eventName => {
        const listenerCount = process.listenerCount(eventName);
        if (listenerCount > 0) {
            console.log(`${String(eventName)}: ${listenerCount} listeners`);
        }
    });

    // Check stdin/stdout/stderr listeners
    console.log('\n--- Stream Event Listeners ---');
    ['stdin', 'stdout', 'stderr'].forEach(streamName => {
        const stream = process[streamName];
        if (stream && typeof stream.eventNames === 'function') {
            const streamEvents = stream.eventNames();
            streamEvents.forEach(eventName => {
                const count = stream.listenerCount(eventName);
                if (count > 0) {
                    console.log(`${streamName}.${String(eventName)}: ${count} listeners`);
                }
            });
        }
    });

    // Global object inspection
    console.log('\n--- Global Object Keys (potential leaks) ---');
    const globalKeys = Object.keys(global).filter(key =>
        !['process', 'global', 'Buffer', 'console', 'require', 'module', '__dirname', '__filename', 'exports', 'clearImmediate', 'clearInterval', 'clearTimeout', 'setImmediate', 'setInterval', 'setTimeout'].includes(key)
    );
    console.log('Custom global keys:', globalKeys.length);
    if (globalKeys.length > 0) {
        globalKeys.slice(0, 10).forEach(key => {
            try {
                const value = global[key];
                const type = typeof value;
                const isArray = Array.isArray(value);
                const size = isArray ? value.length : (type === 'object' && value ? Object.keys(value).length : 'N/A');
                console.log(`  ${key}: ${type}${isArray ? '[]' : ''} (size: ${size})`);
            } catch (e) {
                console.log(`  ${key}: <inspection failed>`);
            }
        });
        if (globalKeys.length > 10) {
            console.log(`  ... and ${globalKeys.length - 10} more`);
        }
    }

    // Timer counts
    console.log('\n--- Active Handles ---');
    try {
        // This requires Node.js internal access
        if (process._getActiveHandles) {
            const handles = process._getActiveHandles();
            console.log('Active handles:', handles.length);

            // Group handles by type
            const handleTypes = {};
            handles.forEach(handle => {
                const type = handle.constructor.name;
                handleTypes[type] = (handleTypes[type] || 0) + 1;
            });

            Object.entries(handleTypes).forEach(([type, count]) => {
                console.log(`  ${type}: ${count}`);
            });
        }

        if (process._getActiveRequests) {
            const requests = process._getActiveRequests();
            console.log('Active requests:', requests.length);
        }
    } catch (e) {
        console.log('Handle inspection not available:', e.message);
    }

    console.log('\n=== END INSPECTION ===\n');
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    const sign = bytes < 0 ? '-' : '';
    return `${sign}${parseFloat((Math.abs(bytes) / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// Make functions globally available
global.inspectProcessState = inspectProcessState;
global.formatBytes = formatBytes;

// Additional monitoring functions
function monitorEventListeners() {
    console.log('\n=== EVENT LISTENER DEEP DIVE ===');

    // Process listeners
    const processListeners = process.eventNames().map(name => ({
        event: String(name),
        count: process.listenerCount(name)
    })).filter(e => e.count > 0);

    console.log('Process Event Listeners:');
    processListeners.forEach(e => console.log(`  ${e.event}: ${e.count}`));

    // Stream listeners (critical for MCP servers)
    ['stdin', 'stdout', 'stderr'].forEach(streamName => {
        const stream = process[streamName];
        if (stream && typeof stream.eventNames === 'function') {
            const listeners = stream.eventNames().map(name => ({
                event: String(name),
                count: stream.listenerCount(name)
            })).filter(e => e.count > 0);

            if (listeners.length > 0) {
                console.log(`${streamName} Event Listeners:`);
                listeners.forEach(e => console.log(`  ${e.event}: ${e.count}`));
            }
        }
    });

    // Check for specific leak-prone listeners
    const dataListeners = process.stdin.listenerCount('data');
    const closeListeners = process.stdin.listenerCount('close');
    const endListeners = process.stdin.listenerCount('end');

    console.log('\nCritical MCP Listeners:');
    console.log(`  stdin.data: ${dataListeners} ${dataListeners > 2 ? '⚠️  HIGH' : '✅'}`);
    console.log(`  stdin.close: ${closeListeners} ${closeListeners > 1 ? '⚠️  HIGH' : '✅'}`);
    console.log(`  stdin.end: ${endListeners} ${endListeners > 1 ? '⚠️  HIGH' : '✅'}`);

    return { processListeners, dataListeners, closeListeners, endListeners };
}

function monitorActiveHandles() {
    console.log('\n=== ACTIVE HANDLES ANALYSIS ===');
    try {
        if (process._getActiveHandles) {
            const handles = process._getActiveHandles();
            console.log(`Total active handles: ${handles.length}`);

            // Group by type and show details
            const handleTypes = {};
            const timerCount = handles.filter(h => h.constructor.name.includes('Timer')).length;
            const socketCount = handles.filter(h => h.constructor.name.includes('Socket')).length;
            const pipeCount = handles.filter(h => h.constructor.name.includes('Pipe')).length;

            handles.forEach(h => {
                const type = h.constructor.name;
                handleTypes[type] = (handleTypes[type] || 0) + 1;
            });

            console.log('Handle breakdown:');
            Object.entries(handleTypes).forEach(([type, count]) => {
                const warning = count > 10 ? ' ⚠️  HIGH' : '';
                console.log(`  ${type}: ${count}${warning}`);
            });

            console.log('\nKey handle types:');
            console.log(`  Timers: ${timerCount} ${timerCount > 5 ? '⚠️  HIGH' : '✅'}`);
            console.log(`  Sockets: ${socketCount}`);
            console.log(`  Pipes: ${pipeCount}`);

            return { total: handles.length, timers: timerCount, sockets: socketCount, pipes: pipeCount };
        }
    } catch (e) {
        console.log('Handle inspection failed:', e.message);
        return null;
    }
}

function startContinuousMonitoring(intervalMs = 30000) {
    console.log(`\n=== STARTING CONTINUOUS MONITORING (${intervalMs}ms intervals) ===`);

    let monitoringInterval;
    let monitorCount = 0;
    let baselineMemory = null;
    let memoryHistory = [];

    function runMonitoringCycle() {
        monitorCount++;
        const timestamp = new Date().toISOString();
        console.log(`\n📊 MONITORING CYCLE #${monitorCount} - ${timestamp}`);

        // Memory snapshot
        const memUsage = process.memoryUsage();
        const currentMemory = {
            cycle: monitorCount,
            timestamp,
            rss: memUsage.rss,
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
            arrayBuffers: memUsage.arrayBuffers
        };

        // Store history
        memoryHistory.push(currentMemory);
        if (memoryHistory.length > 100) {
            memoryHistory.shift(); // Keep last 100 entries
        }

        // Set baseline on first run
        if (!baselineMemory) {
            baselineMemory = currentMemory;
            console.log(`📍 BASELINE SET: RSS=${formatBytes(memUsage.rss)} Heap=${formatBytes(memUsage.heapUsed)}`);
        } else {
            // Calculate growth since baseline
            const rssGrowth = memUsage.rss - baselineMemory.rss;
            const heapGrowth = memUsage.heapUsed - baselineMemory.heapUsed;
            const externalGrowth = memUsage.external - baselineMemory.external;

            console.log(`📈 MEMORY GROWTH SINCE BASELINE (${monitorCount} cycles):`);
            console.log(`  RSS: ${formatBytes(rssGrowth)} (${formatBytes(memUsage.rss)} total)`);
            console.log(`  Heap: ${formatBytes(heapGrowth)} (${formatBytes(memUsage.heapUsed)} total)`);
            console.log(`  External: ${formatBytes(externalGrowth)} (${formatBytes(memUsage.external)} total)`);

            // Calculate rate (last 10 cycles)
            if (memoryHistory.length >= 10) {
                const tenCyclesAgo = memoryHistory[memoryHistory.length - 10];
                const timeDiff = (Date.now() - new Date(tenCyclesAgo.timestamp).getTime()) / 1000; // seconds
                const rssRate = (memUsage.rss - tenCyclesAgo.rss) / timeDiff; // bytes per second
                const heapRate = (memUsage.heapUsed - tenCyclesAgo.heapUsed) / timeDiff;

                console.log(`� GROWTH RATE (last 10 cycles):`);
                console.log(`  RSS: ${formatBytes(rssRate * 60)}/minute`);
                console.log(`  Heap: ${formatBytes(heapRate * 60)}/minute`);

                // Leak detection
                const rssRatePerMin = rssRate * 60;
                if (rssRatePerMin > 100 * 1024) { // > 100KB/min
                    console.log('🚨 SIGNIFICANT RSS GROWTH DETECTED!');
                }
                if (heapRate * 60 > 50 * 1024) { // > 50KB/min
                    console.log('🚨 SIGNIFICANT HEAP GROWTH DETECTED!');
                }
            }
        }

        // Event listeners (quick check)
        const stdinListeners = process.stdin.listenerCount('data');
        console.log(`🎧 Event Listeners: stdin.data=${stdinListeners} ${stdinListeners > 4 ? '⚠️' : '✅'}`);

        // Active handles
        try {
            if (process._getActiveHandles) {
                const handles = process._getActiveHandles();
                const timers = handles.filter(h => h.constructor.name.includes('Timer')).length;
                console.log(`� Active Handles: total=${handles.length} timers=${timers} ${handles.length > 20 ? '⚠️' : '✅'}`);
            }
        } catch (e) {
            console.log('🔧 Handle check failed:', e.message);
        }

        console.log('─'.repeat(80));
    }

    // Run initial cycle
    runMonitoringCycle();

    // Start interval
    monitoringInterval = setInterval(runMonitoringCycle, intervalMs);

    // Enhanced stop function with summary
    global.stopContinuousMonitoring = () => {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;

            // Show summary
            console.log('\n📋 MONITORING SUMMARY:');
            console.log(`Total cycles: ${monitorCount}`);
            if (baselineMemory && memoryHistory.length > 0) {
                const final = memoryHistory[memoryHistory.length - 1];
                const totalTime = (new Date(final.timestamp).getTime() - new Date(baselineMemory.timestamp).getTime()) / 1000 / 60; // minutes
                const totalRssGrowth = final.rss - baselineMemory.rss;
                const totalHeapGrowth = final.heapUsed - baselineMemory.heapUsed;

                console.log(`Duration: ${totalTime.toFixed(1)} minutes`);
                console.log(`Total RSS growth: ${formatBytes(totalRssGrowth)}`);
                console.log(`Total Heap growth: ${formatBytes(totalHeapGrowth)}`);
                console.log(`Average RSS rate: ${formatBytes(totalRssGrowth / totalTime)}/minute`);
                console.log(`Average Heap rate: ${formatBytes(totalHeapGrowth / totalTime)}/minute`);
            }

            console.log('✅ Continuous monitoring stopped');
        }
    };

    // Add function to get current history
    global.getMemoryHistory = () => memoryHistory;

    console.log('📡 Enhanced continuous monitoring started.');
    console.log('📊 Commands: stopContinuousMonitoring(), getMemoryHistory()');
    return monitoringInterval;
}

// Export additional functions globally
global.monitorEventListeners = monitorEventListeners;
global.monitorActiveHandles = monitorActiveHandles;
global.startContinuousMonitoring = startContinuousMonitoring;

// Auto-run inspection
console.log('Memory inspector loaded. Available functions:');
console.log('  inspectProcessState() - Full detailed inspection');
console.log('  monitorEventListeners() - Focus on event listeners');
console.log('  monitorActiveHandles() - Focus on handles/timers');
console.log('  startContinuousMonitoring(30000) - Start continuous monitoring');
console.log('  stopContinuousMonitoring() - Stop continuous monitoring');

inspectProcessState();

// Your addition - check stdin data listeners immediately
const stdinDataListeners = process.stdin.listenerCount('data');
console.log(`\n🔍 IMMEDIATE CHECK: stdin 'data' listeners = ${stdinDataListeners}`);
if (stdinDataListeners > 2) {
    console.log('⚠️  WARNING: High number of stdin data listeners detected!');
    console.log('   This is a common source of memory leaks in MCP servers.');
}
