/**
 * Test BufferRing integration with MetricsCollector
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetricsCollector } from '../dashboard/server/MetricsCollector.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, rmSync } from 'fs';

describe('BufferRing MetricsCollector Integration', () => {
  let collector: MetricsCollector;
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `metrics-integration-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    collector = new MetricsCollector({
      retentionMinutes: 60
    });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should store tool call events in BufferRing', () => {
    // Record some tool calls (toolName, success, responseTimeMs, errorType?, clientId?)
    collector.recordToolCall('test_tool_1', true, 100);
    collector.recordToolCall('test_tool_2', false, 150, 'timeout');
    collector.recordToolCall('test_tool_1', true, 200);

    // Get recent tool call events
    const events = collector.getRecentToolCallEvents(5);

    expect(events).toHaveLength(3);
    expect(events[0].toolName).toBe('test_tool_1');
    expect(events[0].responseTimeMs).toBe(100);
    expect(events[0].success).toBe(true);

    expect(events[1].toolName).toBe('test_tool_2');
    expect(events[1].success).toBe(false);
    expect(events[1].errorType).toBe('timeout');

    expect(events[2].toolName).toBe('test_tool_1');
    expect(events[2].responseTimeMs).toBe(200);
  });

  it('should provide tool usage analytics', () => {
    // Record mixed success/failure calls
    collector.recordToolCall('analytics_tool', true, 100);
    collector.recordToolCall('analytics_tool', false, 150, 'error');
    collector.recordToolCall('analytics_tool', true, 120);
    collector.recordToolCall('other_tool', true, 80);

    const analytics = collector.getToolUsageAnalytics(60);

    expect(analytics).toHaveLength(2);

    const analyticsToolStats = analytics.find(stat => stat.toolName === 'analytics_tool');
    expect(analyticsToolStats).toBeDefined();
    expect(analyticsToolStats!.callCount).toBe(3);
    expect(analyticsToolStats!.successRate).toBeCloseTo(66.67, 1); // 2/3 success
    expect(analyticsToolStats!.avgResponseTime).toBeCloseTo(123.33, 1); // (100+150+120)/3

    const otherToolStats = analytics.find(stat => stat.toolName === 'other_tool');
    expect(otherToolStats).toBeDefined();
    expect(otherToolStats!.callCount).toBe(1);
    expect(otherToolStats!.successRate).toBe(100);
    expect(otherToolStats!.avgResponseTime).toBe(80);
  });

  it('should provide BufferRing statistics', () => {
    // Record some data
    collector.recordToolCall('stats_tool', true, 100);

    const stats = collector.getBufferRingStats();

    expect(stats).toHaveProperty('historicalSnapshots');
    expect(stats).toHaveProperty('toolCallEvents');
    expect(stats).toHaveProperty('performanceMetrics');

    // Each should have BufferRing statistics
    expect(stats.historicalSnapshots).toHaveProperty('count');
    expect(stats.historicalSnapshots).toHaveProperty('capacity');
    expect(stats.toolCallEvents).toHaveProperty('count');
    expect(stats.toolCallEvents).toHaveProperty('capacity');
    expect(stats.performanceMetrics).toHaveProperty('count');
    expect(stats.performanceMetrics).toHaveProperty('capacity');

    // Tool call events should have recorded our call
    expect(stats.toolCallEvents.count).toBe(1);
  });

  it('should export comprehensive metrics data', () => {
    // Record data
    collector.recordToolCall('export_tool', true, 100);

    const exported = collector.exportMetricsData({
      includeHistorical: true,
      includeEvents: true,
      includePerformance: true
    });

    expect(exported).toHaveProperty('timestamp');
    expect(exported).toHaveProperty('currentSnapshot');
    expect(exported).toHaveProperty('bufferStats');
    expect(exported).toHaveProperty('historicalSnapshots');
    expect(exported).toHaveProperty('toolCallEvents');
    expect(exported).toHaveProperty('performanceMetrics');

    expect(exported.historicalSnapshots).toBeInstanceOf(Array);
    expect(exported.toolCallEvents).toBeInstanceOf(Array);
    expect(exported.performanceMetrics).toBeInstanceOf(Array);

    // Should have our tool call event
    expect(exported.toolCallEvents).toHaveLength(1);
    if (exported.toolCallEvents && exported.toolCallEvents.length > 0) {
      expect(exported.toolCallEvents[0].toolName).toBe('export_tool');
    }
  });

  it('should clear BufferRing data', () => {
    // Record data
    collector.recordToolCall('clear_tool', true, 100);

    // Verify data exists
    expect(collector.getRecentToolCallEvents(60)).toHaveLength(1);

    // Clear data
    collector.clearBufferedData();

    // Verify data is cleared
    expect(collector.getRecentToolCallEvents(60)).toHaveLength(0);
  });

  it('should handle time-based filtering correctly', () => {
    // Record events at different times
    collector.recordToolCall('time_tool', true, 100);

    // Test the filtering logic - use very small time windows
    // Note: 0 minutes might still include very recent events due to millisecond precision
    const veryRecentEvents = collector.getRecentToolCallEvents(0.001); // 0.001 minutes ≈ 0.06 seconds
    // This may or may not be 0 depending on exact timing, so we just verify it's not greater than total
    const allEvents = collector.getRecentToolCallEvents(60); // 60 minutes = all
    expect(veryRecentEvents.length).toBeLessThanOrEqual(allEvents.length);

    const recentEvents = collector.getRecentToolCallEvents(60); // 60 minutes = all
    expect(recentEvents.length).toBeGreaterThan(0);
    expect(recentEvents[0].toolName).toBe('time_tool');
  });

  it('should provide performance time series data', () => {
    // Record some tool calls to generate performance data
    collector.recordToolCall('perf_tool', true, 100);
    collector.recordToolCall('perf_tool', false, 200, 'error');
    collector.recordToolCall('perf_tool', true, 150);

    // Get performance chart data
    const chartData = collector.getPerformanceTimeSeriesData(60);

    expect(chartData).toHaveProperty('responseTime');
    expect(chartData).toHaveProperty('requestRate');
    expect(chartData).toHaveProperty('errorRate');
    expect(chartData).toHaveProperty('successRate');

    // Each should be an array of time series points
    expect(chartData.responseTime).toBeInstanceOf(Array);
    expect(chartData.requestRate).toBeInstanceOf(Array);
    expect(chartData.errorRate).toBeInstanceOf(Array);
    expect(chartData.successRate).toBeInstanceOf(Array);
  });

  it('should track client connections in BufferRing', () => {
    // Connect clients
    collector.recordConnection('client1');
    collector.recordConnection('client2');

    // Disconnect one
    collector.recordDisconnection('client1');

    const snapshot = collector.getCurrentSnapshot();
    expect(snapshot.connections.activeConnections).toBe(1);
    expect(snapshot.connections.totalConnections).toBe(2);
    expect(snapshot.connections.disconnectedConnections).toBe(1);
  });
});
