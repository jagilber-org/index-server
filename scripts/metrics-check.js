// Simple MetricsCollector inspection script
// Load in VS Code Debug Console: .load scripts/metrics-check.js

function checkMetricsMemory() {
    console.log('\n=== METRICS COLLECTOR ANALYSIS ===');

    try {
        // Try different import paths
        let metricsModule;
        try {
            metricsModule = require('./dist/dashboard/server/MetricsCollector.js');
        } catch {
            try {
                metricsModule = require('../dashboard/server/MetricsCollector.js');
            } catch {
                console.log('Cannot import MetricsCollector module');
                return null;
            }
        }

        const collector = metricsModule.getMetricsCollector();
        if (!collector) {
            console.log('MetricsCollector not initialized');
            return null;
        }

        console.log('✅ MetricsCollector found');

        // Get snapshots
        const snapshots = collector.getSnapshots();
        console.log('Snapshots stored:', snapshots.length);

        if (snapshots.length > 0) {
            const sample = snapshots[0];
            const sampleSize = JSON.stringify(sample).length;
            const totalMemory = snapshots.length * sampleSize;
            console.log('Sample snapshot size:', sampleSize, 'bytes');
            console.log('Total snapshots memory:', Math.round(totalMemory / 1024), 'KB');

            const first = snapshots[0];
            const last = snapshots[snapshots.length - 1];
            const spanMinutes = (last.timestamp - first.timestamp) / 60000;
            console.log('Data span:', Math.round(spanMinutes), 'minutes');
        }

        // Check tool metrics
        const tools = collector.getToolMetrics();
        console.log('Tracked tools:', Object.keys(tools || {}).length);

        return {
            snapshotCount: snapshots.length,
            toolCount: Object.keys(tools || {}).length
        };

    } catch (error) {
        console.log('Error accessing MetricsCollector:', error.message);
        return null;
    }
}

// Available as a REPL helper: call _stopMetricsCollection() manually
function _stopMetricsCollection() {
    console.log('\n=== STOPPING METRICS COLLECTION ===');
    try {
        let metricsModule;
        try {
            metricsModule = require('./dist/dashboard/server/MetricsCollector.js');
        } catch {
            metricsModule = require('../dashboard/server/MetricsCollector.js');
        }

        const collector = metricsModule.getMetricsCollector();
        if (collector && collector.stopCollection) {
            collector.stopCollection();
            console.log('✅ Metrics collection stopped');
            console.log('Monitor memory for 10+ minutes to verify leak stops');
        } else {
            console.log('❌ Cannot stop collection - method not found');
        }
    } catch (error) {
        console.log('❌ Error stopping collection:', error.message);
    }
}

console.log('📊 Commands loaded:');
console.log('  checkMetricsMemory() - Check current state');
console.log('  _stopMetricsCollection() - Stop collection to test');

// Run initial check
checkMetricsMemory();
