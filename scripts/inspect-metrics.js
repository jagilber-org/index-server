// Memory leak investigation script - Check MetricsCollector accumulation
// Load this in VS Code Debug Console while attached to your MCP server

function inspectMetricsCollector() {
    console.log('\n🔍 METRICS COLLECTOR MEMORY ANALYSIS');
    console.log('=' * 60);

    let collector;
    try {
        // Try to get the global metrics collector
        collector = require('../dashboard/server/MetricsCollector.js').getMetricsCollector();
    } catch (e) {
        console.log('❌ Could not access MetricsCollector:', e.message);
        return;
    }

    if (!collector) {
        console.log('❌ MetricsCollector not found or not initialized');
        return;
    }

    console.log('✅ MetricsCollector found');

    // Get current snapshots
    const snapshots = collector.getSnapshots();
    const currentSnapshot = collector.getCurrentSnapshot();

    console.log('\n📊 SNAPSHOT ACCUMULATION:');
    console.log(`  Total snapshots: ${snapshots.length}`);
    console.log(`  Max snapshots config: ${collector.options?.maxSnapshots || 'unknown'}`);
    console.log(`  Collection interval: ${collector.options?.collectInterval || 'unknown'}ms`);

    if (snapshots.length > 0) {
        const oldest = snapshots[0];
        const newest = snapshots[snapshots.length - 1];
        const ageMinutes = (newest.timestamp - oldest.timestamp) / 1000 / 60;
        console.log(`  Data age span: ${ageMinutes.toFixed(1)} minutes`);

        // Estimate memory usage
        const avgSnapshotSize = JSON.stringify(currentSnapshot).length;
        const totalSnapshotMemory = snapshots.length * avgSnapshotSize;
        console.log(`  Estimated snapshot memory: ${(totalSnapshotMemory / 1024).toFixed(1)} KB`);
        console.log(`  Average snapshot size: ${(avgSnapshotSize / 1024).toFixed(2)} KB`);
    }

    // Check tool metrics accumulation
    const toolMetrics = collector.getToolMetrics();
    const toolCount = Object.keys(toolMetrics || {}).length;
    console.log(`\n🔧 TOOL METRICS:');
    console.log(`  Tracked tools: ${toolCount}`);

    if (toolMetrics) {
        Object.entries(toolMetrics).forEach(([name, metrics]) => {
            console.log(`  ${name}: ${metrics.callCount} calls, ${Object.keys(metrics.errorTypes || {}).length} error types`);
        });
    }

    // Check recent call timestamps
    try {
        // Try to access private property (might not work)
        const recentCalls = collector.recentCallTimestamps?.length || 'unknown';
        console.log(`\n⏱️  RECENT CALL BUFFER:');
        console.log(`  Recent call timestamps: ${recentCalls}`);
        if (typeof recentCalls === 'number') {
            const estimatedCallMemory = recentCalls * 8; // 8 bytes per timestamp
            console.log(`  Estimated call buffer memory: ${(estimatedCallMemory / 1024).toFixed(1)} KB`);
        }
    } catch (e) {
        console.log('\n⏱️  RECENT CALL BUFFER: Cannot access (private property)');
    }

    // Memory usage estimate
    console.log('\n💾 MEMORY IMPACT ANALYSIS:');
    const currentMemory = process.memoryUsage();
    console.log(`  Current heap used: ${(currentMemory.heapUsed / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  Current RSS: ${(currentMemory.rss / 1024 / 1024).toFixed(1)} MB`);

    if (snapshots.length > 0) {
        const snapshotGrowthRate = snapshots.length / (ageMinutes || 1); // per minute
        console.log(`  Snapshot growth rate: ${snapshotGrowthRate.toFixed(2)} snapshots/minute`);

        if (snapshotGrowthRate > 1) {
            console.log('  🚨 HIGH SNAPSHOT GROWTH RATE - Potential leak source!');
        }
    }

    // Check for periodic collection timer
    console.log('\n⏰ COLLECTION STATUS:');
    try {
        const isCollecting = !!collector.collectTimer;
        console.log(`  Periodic collection active: ${isCollecting}`);
        if (isCollecting) {
            console.log('  📈 MetricsCollector is actively taking snapshots every minute');
        }
    } catch (e) {
        console.log('  Collection status: Unknown (cannot access timer)');
    }

    console.log('\n🎯 RECOMMENDATIONS:');
    if (snapshots.length > 100) {
        console.log('  ⚠️  Consider reducing maxSnapshots or retentionMinutes');
    }
    if (toolCount > 50) {
        console.log('  ⚠️  Many tools being tracked - check for tool name variations');
    }

    return {
        snapshotCount: snapshots.length,
        toolCount,
        estimatedMemoryKB: snapshots.length * (JSON.stringify(currentSnapshot).length / 1024),
        isActive: !!collector.collectTimer
    };
}

// Also provide a function to disable metrics collection temporarily
function disableMetricsCollection() {
    console.log('\n🛑 DISABLING METRICS COLLECTION...');
    try {
        const collector = require('../dashboard/server/MetricsCollector.js').getMetricsCollector();
        collector.stopCollection();
        console.log('✅ Metrics collection stopped');
        console.log('📊 Run memory monitoring for 10+ minutes to see if leak stops');
    } catch (e) {
        console.log('❌ Failed to stop collection:', e.message);
    }
}

// Run initial inspection
console.log('🔍 METRICS COLLECTOR INSPECTION LOADED');
console.log('📊 Run: inspectMetricsCollector()');
console.log('🛑 To test: disableMetricsCollection()');

// Auto-run inspection
inspectMetricsCollector();
