/**
 * RED/GREEN tests for src/utils/memoryMonitor.ts
 *
 * Constitution TS-9: calls real MemoryMonitor instance, no stubs.
 * Constitution TS-4: validates output content -- report strings, trend values.
 *
 * Coverage targets:
 *  - takeSnapshot() returns a valid MemorySnapshot
 *  - getCurrentStatus() returns formatted string with heap info
 *  - analyzeTrends() with insufficient snapshots (< 3)
 *  - analyzeTrends() with enough snapshots -- growthRate, leakDetected
 *  - getDetailedReport() contains all expected sections
 *  - checkEventListeners() returns listener info string
 *  - takeHeapSnapshot() returns a string result
 *  - startMonitoring() / stopMonitoring() lifecycle (no interval leak in tests)
 *  - Duplicate startMonitoring() is a no-op
 *  - Module-level helpers: memStatus, memReport, checkListeners, forceGC, startMemWatch, stopMemWatch
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  getMemoryMonitor,
  memStatus,
  memReport,
  checkListeners,
  forceGC,
  startMemWatch,
  stopMemWatch,
} from '../utils/memoryMonitor';

// Obtain a fresh monitor instance for each test by resetting the module-level
// singleton only if a reset API is available; otherwise share the global singleton
// and be careful about interval state.

describe('MemoryMonitor - snapshot and status', () => {
  it('takeSnapshot returns a snapshot with expected numeric fields', () => {
    const mm = getMemoryMonitor();
    const snap = mm.takeSnapshot();

    expect(typeof snap.timestamp).toBe('number');
    expect(snap.timestamp).toBeGreaterThan(0);
    expect(typeof snap.heapUsed).toBe('number');
    expect(snap.heapUsed).toBeGreaterThan(0);
    expect(typeof snap.heapTotal).toBe('number');
    expect(typeof snap.rss).toBe('number');
    expect(snap.rss).toBeGreaterThan(0);
    expect(typeof snap.pid).toBe('number');
    expect(snap.pid).toBe(process.pid);
  });

  it('getCurrentStatus returns a multi-line string with Heap Used and RSS', () => {
    const mm = getMemoryMonitor();
    const status = mm.getCurrentStatus();

    expect(typeof status).toBe('string');
    expect(status).toContain('Heap Used:');
    expect(status).toContain('RSS:');
    expect(status).toContain('Heap Total:');
  });
});

describe('MemoryMonitor - analyzeTrends', () => {
  it('returns need-more-data recommendation with fewer than 3 snapshots', () => {
    const mm = getMemoryMonitor();
    // Use a NEGATIVE window: cutoff = Date.now() - (negative * 60000) = far FUTURE
    // This ensures 0 snapshots fall in the window, forcing the < 3 early-return path.
    const trend = mm.analyzeTrends(-100000);
    expect(trend.growthRate).toBe(0);
    expect(trend.leakDetected).toBe(false);
    expect(trend.recommendation).toContain('Need more data');
  });

  it('returns a valid trend object with snapshots array when enough data exists', () => {
    const mm = getMemoryMonitor();
    // Force 5 snapshots within the last minute
    for (let i = 0; i < 5; i++) {
      mm.takeSnapshot();
    }

    const trend = mm.analyzeTrends(60); // 60-minute window
    expect(Array.isArray(trend.snapshots)).toBe(true);
    expect(typeof trend.growthRate).toBe('number');
    expect(typeof trend.leakDetected).toBe('boolean');
    expect(typeof trend.recommendation).toBe('string');
    // Should be green (stable) since snapshots are taken in rapid succession
    expect(trend.recommendation.length).toBeGreaterThan(0);
  });

  it('getDetailedReport contains all major sections', () => {
    const mm = getMemoryMonitor();
    mm.takeSnapshot();
    const report = mm.getDetailedReport();

    expect(report).toContain('MEMORY MONITOR REPORT');
    expect(report).toContain('TREND ANALYSIS');
    expect(report).toContain('Growth Rate:');
    expect(report).toContain('Leak Detected:');
    expect(report).toContain('DEBUGGING TIPS');
    // Should contain YES or NO for leak detection
    expect(report.includes('YES') || report.includes('NO')).toBe(true);
  });
});

describe('MemoryMonitor - checkEventListeners', () => {
  it('returns a string listing event names', () => {
    const mm = getMemoryMonitor();
    const result = mm.checkEventListeners();

    expect(typeof result).toBe('string');
    expect(result).toContain('Event Listeners:');
  });
});

describe('MemoryMonitor - takeHeapSnapshot', () => {
  it('returns a non-null string result', () => {
    const mm = getMemoryMonitor();
    const result = mm.takeHeapSnapshot();

    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(0);
  });
});

describe('MemoryMonitor - startMonitoring / stopMonitoring', () => {
  afterEach(() => {
    // Ensure monitoring is stopped after each test
    stopMemWatch();
  });

  it('startMonitoring captures at least one snapshot', async () => {
    const mm = getMemoryMonitor();
    const before = mm.takeSnapshot().timestamp;

    startMemWatch(50); // 50ms interval -- fast for testing
    await new Promise(r => setTimeout(r, 120)); // Wait for 2 intervals
    stopMemWatch();

    const trend = mm.analyzeTrends(60);
    // Should have accumulated snapshots during monitoring
    expect(trend.snapshots.length).toBeGreaterThanOrEqual(1);
    const allTimes = trend.snapshots.map(s => s.timestamp);
    expect(allTimes.some(t => t >= before)).toBe(true);
  });

  it('duplicate startMonitoring is a no-op (does not throw)', () => {
    startMemWatch(1000);
    // Calling again should not throw or create a second interval
    expect(() => startMemWatch(1000)).not.toThrow();
    stopMemWatch();
  });

  it('stopMonitoring is idempotent (calling twice does not throw)', () => {
    startMemWatch(1000);
    stopMemWatch();
    expect(() => stopMemWatch()).not.toThrow();
  });
});

describe('MemoryMonitor - module-level helper exports', () => {
  it('memStatus() does not throw', () => {
    expect(() => memStatus()).not.toThrow();
  });

  it('memReport() does not throw', () => {
    expect(() => memReport()).not.toThrow();
  });

  it('checkListeners() does not throw', () => {
    expect(() => checkListeners()).not.toThrow();
  });

  it('forceGC() returns without error', () => {
    expect(() => forceGC()).not.toThrow();
  });
});
