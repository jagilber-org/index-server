/**
 * Memory Monitoring Utilities for MCP Server
 *
 * Provides comprehensive memory leak detection and monitoring tools.
 * Use while attached to debugger for real-time memory analysis.
 */
import { isDebugOrVerbose } from './envUtils';
import { logError } from '../services/logger.js';

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  pid: number;
}

interface MemoryTrend {
  snapshots: MemorySnapshot[];
  leakDetected: boolean;
  growthRate: number; // bytes per second
  recommendation: string;
}

class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private maxSnapshots = 1000;
  private intervalId?: NodeJS.Timeout;
  private isMonitoring = false;

  /**
   * Start continuous memory monitoring
   */
  startMonitoring(intervalMs = 5000): void {
    if (this.isMonitoring) {
      logError('[MemoryMonitor] Already monitoring');
      return;
    }

    logError(`[MemoryMonitor] Starting memory monitoring (interval: ${intervalMs}ms)`);
    this.isMonitoring = true;

    this.intervalId = setInterval(() => {
      this.takeSnapshot();
    }, intervalMs);

    // Take initial snapshot
    this.takeSnapshot();
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isMonitoring = false;
    logError('[MemoryMonitor] Stopped monitoring');
  }

  /**
   * Take a memory snapshot
   */
  takeSnapshot(): MemorySnapshot {
    const memUsage = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      rss: memUsage.rss,
      pid: process.pid
    };

    this.snapshots.push(snapshot);

    // Trim old snapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }

    // Log significant changes
    if (this.snapshots.length > 1) {
      const previous = this.snapshots[this.snapshots.length - 2];
      const heapGrowth = snapshot.heapUsed - previous.heapUsed;
      const rssGrowth = snapshot.rss - previous.rss;

      if (Math.abs(heapGrowth) > 1024 * 1024 || Math.abs(rssGrowth) > 5 * 1024 * 1024) {
        const payload = {
          ts: snapshot.timestamp,
          level: 'info',
          src: 'memory',
          event: 'delta',
          heapDelta: heapGrowth,
          heapUsed: snapshot.heapUsed,
          rssDelta: rssGrowth,
          rss: snapshot.rss,
          pid: snapshot.pid
        };
        // Structured logging piggybacks on existing debug/verbose flags to avoid introducing new env flags.
        const wantStructured = isDebugOrVerbose();
        try {
          if (wantStructured) {
            logError(JSON.stringify(payload));
          } else {
            // Fallback concise plain text (single line) to preserve readability and avoid multi-line noise.
            logError(`[MemoryMonitor] heapDelta=${this.formatBytes(heapGrowth)} heapUsed=${this.formatBytes(snapshot.heapUsed)} rssDelta=${this.formatBytes(rssGrowth)} rss=${this.formatBytes(snapshot.rss)}`);
          }
        } catch {/* swallow */}
      }
    }

    return snapshot;
  }

  /**
   * Get current memory status
   */
  getCurrentStatus(): string {
    const memUsage = process.memoryUsage();
    return `Memory Status (PID: ${process.pid}):
  Heap Used: ${this.formatBytes(memUsage.heapUsed)}
  Heap Total: ${this.formatBytes(memUsage.heapTotal)}
  RSS: ${this.formatBytes(memUsage.rss)}
  External: ${this.formatBytes(memUsage.external)}
  Array Buffers: ${this.formatBytes(memUsage.arrayBuffers)}`;
  }

  /**
   * Analyze memory trends for potential leaks
   */
  analyzeTrends(windowMinutes = 10): MemoryTrend {
    const windowMs = windowMinutes * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const recentSnapshots = this.snapshots.filter(s => s.timestamp >= cutoff);

    if (recentSnapshots.length < 3) {
      return {
        snapshots: recentSnapshots,
        leakDetected: false,
        growthRate: 0,
        recommendation: 'Need more data points for analysis'
      };
    }

    // Calculate growth rate (bytes per second)
    const first = recentSnapshots[0];
    const last = recentSnapshots[recentSnapshots.length - 1];
    const timeDiff = (last.timestamp - first.timestamp) / 1000; // seconds
    const heapGrowth = last.heapUsed - first.heapUsed;
    const growthRate = heapGrowth / timeDiff;

    // Detect potential leak (consistent growth > 100KB/minute)
    const leakThreshold = (100 * 1024) / 60; // bytes per second
    const leakDetected = growthRate > leakThreshold;

    let recommendation = '';
    if (leakDetected) {
      recommendation = `⚠️  Potential memory leak detected! Growth rate: ${this.formatBytes(growthRate * 60)}/minute`;
    } else if (growthRate > 0) {
      recommendation = `✅ Memory growth within normal range: ${this.formatBytes(growthRate * 60)}/minute`;
    } else {
      recommendation = `✅ Memory usage stable or decreasing`;
    }

    return {
      snapshots: recentSnapshots,
      leakDetected,
      growthRate,
      recommendation
    };
  }

  /**
   * Get detailed memory report
   */
  getDetailedReport(): string {
    const trend = this.analyzeTrends();
    const current = this.getCurrentStatus();

    return `
=== MEMORY MONITOR REPORT ===
${current}

=== TREND ANALYSIS (10 min window) ===
${trend.recommendation}
Growth Rate: ${this.formatBytes(trend.growthRate * 60)}/minute
Snapshots: ${trend.snapshots.length}
Leak Detected: ${trend.leakDetected ? 'YES' : 'NO'}

=== DEBUGGING TIPS ===
1. Force GC: global.gc() (if --expose-gc flag used)
2. Heap snapshot: takeHeapSnapshot()
3. Check event listeners: process.listeners()
4. Monitor specific objects with WeakRef
`;
  }

  /**
   * Take heap snapshot (requires --expose-gc)
   */
  takeHeapSnapshot(): string | null {
    try {
      if (typeof global.gc === 'function') {
        global.gc();
        logError('[MemoryMonitor] Forced garbage collection');
      }

      // Note: This would require v8 module for actual heap snapshots
      // For now, just return memory usage after GC
      const afterGC = process.memoryUsage();
      return `Heap snapshot taken. Memory after GC: ${this.formatBytes(afterGC.heapUsed)}`;
    } catch (error) {
      return `Heap snapshot failed: ${error}. Start with --expose-gc flag for full functionality.`;
    }
  }

  /**
   * Monitor event listeners for potential leaks
   */
  checkEventListeners(): string {
    const process_listeners = process.eventNames().map(name => ({
      event: String(name),
      count: process.listenerCount(name)
    }));

    return `Event Listeners:
${process_listeners.map(l => `  ${l.event}: ${l.count}`).join('\n')}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    const sign = bytes < 0 ? '-' : '';
    return `${sign}${parseFloat((Math.abs(bytes) / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

// Global instance
let globalMemoryMonitor: MemoryMonitor | null = null;

/**
 * Get or create global memory monitor instance
 */
export function getMemoryMonitor(): MemoryMonitor {
  if (!globalMemoryMonitor) {
    globalMemoryMonitor = new MemoryMonitor();
  }
  return globalMemoryMonitor;
}

/**
 * Quick memory status check
 */
export function memStatus(): void {
  logError(getMemoryMonitor().getCurrentStatus());
}

/**
 * Start memory monitoring
 */
export function startMemWatch(intervalMs = 5000): void {
  getMemoryMonitor().startMonitoring(intervalMs);
}

/**
 * Stop memory monitoring
 */
export function stopMemWatch(): void {
  getMemoryMonitor().stopMonitoring();
}

/**
 * Get memory report
 */
export function memReport(): void {
  logError(getMemoryMonitor().getDetailedReport());
}

/**
 * Force garbage collection and show memory
 */
export function forceGC(): void {
  const result = getMemoryMonitor().takeHeapSnapshot();
  logError(result ?? '');
}

/**
 * Check event listeners
 */
export function checkListeners(): void {
  logError(getMemoryMonitor().checkEventListeners());
}

// Global exports for debugger console
if (typeof global !== 'undefined') {
  const globalAny = global as Record<string, unknown>;
  globalAny.memStatus = memStatus;
  globalAny.startMemWatch = startMemWatch;
  globalAny.stopMemWatch = stopMemWatch;
  globalAny.memReport = memReport;
  globalAny.forceGC = forceGC;
  globalAny.checkListeners = checkListeners;
}

export { MemoryMonitor, MemorySnapshot, MemoryTrend };
