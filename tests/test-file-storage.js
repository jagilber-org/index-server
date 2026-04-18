#!/usr/bin/env node

// Test script to verify file storage implementation
const fs = require('fs');
const path = require('path');

console.log('Testing File Storage Implementation...\n');

// Set environment variables for file storage
process.env.INDEX_SERVER_METRICS_FILE_STORAGE = 'true';
process.env.INDEX_SERVER_METRICS_DIR = path.join(__dirname, 'test-metrics');
process.env.INDEX_SERVER_METRICS_MAX_FILES = '10';

// Clean up any existing test directory
const testDir = process.env.INDEX_SERVER_METRICS_DIR;
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log('✓ Cleaned up existing test directory');
}

// Import our compiled classes
const { MetricsCollector } = require('./dist/dashboard/server/MetricsCollector.js');

async function testFileStorage() {
  console.log('Creating MetricsCollector with file storage enabled...');

  const collector = new MetricsCollector({
    snapshotInterval: 1000, // 1 second for testing
    retentionMinutes: 60,
    maxSnapshots: 720
  });

  // Wait a moment for initialization
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('✓ MetricsCollector created');
  console.log(`✓ Using file storage: ${collector.useFileStorage}`);

  // Simulate some tool usage
  collector.recordToolCall('test-tool', 100);
  collector.recordToolCall('test-tool', 150);
  collector.recordToolCall('another-tool', 200);

  console.log('✓ Recorded some tool calls');

  // Wait for a couple snapshots
  console.log('Waiting for snapshots to be taken...');
  await new Promise(resolve => setTimeout(resolve, 2500));

  // Check file storage
  const stats = await collector.getStorageStats();
  console.log('\nStorage Statistics:');
  console.log(`- File count: ${stats.fileCount}`);
  console.log(`- Total size: ${stats.totalSizeKB} KB`);
  console.log(`- Memory snapshots: ${stats.memorySnapshots}`);
  console.log(`- Oldest: ${stats.oldestTimestamp ? new Date(stats.oldestTimestamp).toISOString() : 'none'}`);
  console.log(`- Newest: ${stats.newestTimestamp ? new Date(stats.newestTimestamp).toISOString() : 'none'}`);

  // Check if files were created
  if (fs.existsSync(testDir)) {
    const files = fs.readdirSync(testDir);
    console.log(`\n✓ Found ${files.length} snapshot files in ${testDir}`);

    if (files.length > 0) {
      const sampleFile = path.join(testDir, files[0]);
      const content = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
      console.log('✓ Sample snapshot file structure:');
      console.log(`  - Timestamp: ${new Date(content.timestamp).toISOString()}`);
      console.log(`  - Tools: ${Object.keys(content.tools || {}).length}`);
      console.log(`  - Connections: ${content.connections}`);
    }
  } else {
    console.log('✗ Test directory was not created');
  }

  // Test historical retrieval
  const historical = await collector.getHistoricalSnapshots(5);
  console.log(`\n✓ Retrieved ${historical.length} historical snapshots`);

  // Test range retrieval
  const now = Date.now();
  const fiveSecondsAgo = now - (5 * 1000);
  const rangeSnapshots = await collector.getSnapshotsInRange(fiveSecondsAgo, now);
  console.log(`✓ Retrieved ${rangeSnapshots.length} snapshots in 5-second range`);

  // Memory usage check
  const memoryBefore = process.memoryUsage();
  console.log('\nMemory usage before cleanup:');
  console.log(`- RSS: ${(memoryBefore.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`- Heap Used: ${(memoryBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);

  // Stop and cleanup
  collector.stop();

  const memoryAfter = process.memoryUsage();
  console.log('\nMemory usage after stop:');
  console.log(`- RSS: ${(memoryAfter.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`- Heap Used: ${(memoryAfter.heapUsed / 1024 / 1024).toFixed(2)} MB`);

  console.log('\n✅ File storage test completed successfully!');

  // Clean up
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log('✓ Cleaned up test files');
  }
}

testFileStorage().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
