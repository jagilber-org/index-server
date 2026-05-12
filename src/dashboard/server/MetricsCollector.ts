/**
 * MetricsCollector — coordinator class (Phase 1–4 Dashboard Foundation).
 *
 * Owns all mutable metrics state and delegates:
 *  - pure math to metricsAggregation.ts
 *  - output serialisation to metricsSerializer.ts
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import v8 from 'v8';
import { getFileMetricsStorage, FileMetricsStorage } from './FileMetricsStorage.js';
import { BufferRing, OverflowStrategy, BufferRingStats } from '../../utils/BufferRing.js';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { logInfo, logError, logWarn } from '../../services/logger.js';

/** Persistence operation taxonomy for metrics buffer writes. */
const PERSISTENCE_OPERATIONS = ['append', 'snapshot', 'truncate'] as const;
type PersistenceOperation = (typeof PERSISTENCE_OPERATIONS)[number];

// Re-export all shared types so existing importers keep working unchanged.
export type {
  ToolMetrics,
  ServerMetrics,
  ConnectionMetrics,
  MetricsSnapshot,
  MetricsTimeSeriesEntry,
  ToolCallEvent,
  MetricsBufferConfig,
  ChartDataPoint,
  ToolUsageChartData,
  PerformanceChartData,
  RealtimeMetrics,
  RealtimeStreamingData,
  SystemHealth,
  EnhancedPerformanceMetrics,
  StreamingStats,
  ActivityEvent,
  AdvancedAnalytics,
  HourlyStats,
  ToolUsageStats,
  ErrorAnalysis,
  PerformanceTrend,
  PredictionData,
  Anomaly,
  Alert,
  MetricsCollectorOptions,
  ResourceSample,
} from './metricsAggregation.js';

import {
  type ToolMetrics,
  type MetricsSnapshot,
  type MetricsTimeSeriesEntry,
  type ToolCallEvent,
  type MetricsBufferConfig,
  type RealtimeMetrics,
  type RealtimeStreamingData,
  type SystemHealth,
  type EnhancedPerformanceMetrics,
  type AdvancedAnalytics,
  type Alert,
  type MetricsCollectorOptions,
  type ResourceSample,
  getTotalRequests,
  getTotalErrors,
  getAverageResponseTime,
  getErrorRate,
  calculateRequestsPerSecond,
  calculatePercentileFromAvg,
  categorizeAlert,
  getOverallHealthStatus,
  estimateCPUUsage,
  estimateMemoryUsage,
  estimateDiskUsage,
  detectAnomalies,
  calculateLinearSlopes,
  computeToolsToCleanup,
} from './metricsAggregation.js';

import {
  buildRealtimeMetrics,
  buildRecentActivity,
  buildToolUsageChartData,
  buildPerformanceChartData,
  buildPerformanceTimeSeriesData,
  buildToolUsageAnalytics,
  buildAdvancedAnalytics,
} from './metricsSerializer.js';

import type {
  ToolUsageChartData,
  PerformanceChartData,
  ToolUsageStats,
} from './metricsAggregation.js';

export class MetricsCollector {
  private persistenceHealth = {
    degraded: false,
    totalFailures: 0,
    appendFailures: 0,
    snapshotFailures: 0,
    truncateFailures: 0,
    lastError: undefined as string | undefined,
    lastFailureAt: undefined as number | undefined,
    lastRecoveredAt: undefined as number | undefined,
  };
  private tools: Map<string, ToolMetrics> = new Map();
  // Resource usage samples (CPU/Memory) for leak/trend analysis
  private resourceSamples: BufferRing<{ timestamp: number; cpuPercent: number; heapUsed: number; rss: number }>;
  private lastCpuUsageSample: NodeJS.CpuUsage | null = null;
  private lastCpuSampleTime = 0;
  private snapshots: MetricsSnapshot[] = []; // Keep small in-memory cache for real-time queries
  private connections: Set<string> = new Set();
  private disconnectedCount = 0;
  private totalSessionTime = 0;
  private sessionStartTimes: Map<string, number> = new Map();
  private startTime = Date.now();
  private options: Required<MetricsCollectorOptions>;
  private collectTimer?: NodeJS.Timeout;
  private lastCpuUsage?: NodeJS.CpuUsage;
  // Phase 4: Advanced features
  private recentAlerts: Alert[] = [];
  private activeConnections = 0;
  // Rolling timestamp buffer for recent tool calls (used for stable RPM calculation)
  private recentCallTimestamps: number[] = [];
  private static readonly MAX_RECENT_CALLS = 10000; // cap to avoid unbounded growth
  private static readonly MAX_MEMORY_SNAPSHOTS = 60; // Keep only 1 hour in memory
  private static readonly MAX_TOOL_METRICS = 1000; // cap tool metrics to prevent memory leaks
  // File storage for historical data (optional)
  private fileStorage: FileMetricsStorage | null = null;
  private useFileStorage: boolean;

  // BufferRing-Enhanced Storage
  private historicalSnapshots: BufferRing<MetricsTimeSeriesEntry>;
  private toolCallEvents: BufferRing<ToolCallEvent>;

  // Persistence throttling state for tool call events (defined explicitly to avoid dynamic props)
  private _lastToolPersist: number = 0;
  private _pendingToolPersist: number = 0;
  private performanceMetrics: BufferRing<{ timestamp: number; responseTime: number; throughput: number; errorRate: number }>;
  private bufferConfig: MetricsBufferConfig;
  // Append/segment logging state (optional)
  private appendMode = false;
  private appendLogPath: string | null = null;
  private pendingAppendEvents: ToolCallEvent[] = [];
  private lastAppendFlush = 0;
  private lastAppendCompact = 0;
  private appendChunkSize = 250;
  private appendFlushMs = 5000;
  private appendCompactMs = 5 * 60 * 1000; // 5 min default

  constructor(options: MetricsCollectorOptions = {}) {
    this.options = {
      retentionMinutes: options.retentionMinutes ?? 60,
      maxSnapshots: options.maxSnapshots ?? 720, // 12 hours at 1-minute intervals
      collectInterval: options.collectInterval ?? 60000, // 1 minute
    };
    const metricsConfig = getRuntimeConfig().metrics;

    // Initialize resource sampling buffer (default capacity ~1h at 5s interval = 720)
    const resourceCapacity = Math.max(1, metricsConfig.resourceCapacity || 720);
    this.resourceSamples = new BufferRing<{ timestamp: number; cpuPercent: number; heapUsed: number; rss: number }>({
      capacity: resourceCapacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      autoPersist: false,
      enableIntegrityCheck: false
    });
    try {
      const intervalMs = Math.max(100, metricsConfig.sampleIntervalMs || 5000);
      setInterval(() => this.sampleResources(), intervalMs).unref();
    } catch { /* ignore */ }

    // Configure BufferRing settings
    const metricsDir = metricsConfig.dir || path.join(process.cwd(), 'metrics');
    this.bufferConfig = {
      historicalSnapshots: {
        capacity: this.options.maxSnapshots,
        retentionMinutes: this.options.retentionMinutes * 12, // Keep 12x longer than original
        persistenceFile: path.join(metricsDir, 'historical-snapshots.json')
      },
      toolCallEvents: {
        capacity: 10000, // Store last 10k tool calls
        retentionMinutes: this.options.retentionMinutes * 2, // 2 hours of tool calls
        persistenceFile: path.join(metricsDir, 'tool-call-events.json')
      },
      performanceMetrics: {
        capacity: 1440, // Store 24 hours worth of minute-by-minute metrics
        persistenceFile: path.join(metricsDir, 'performance-metrics.json')
      }
    };

    // Check if file storage should be enabled (accept "true", "1", "yes", "on")
  this.useFileStorage = metricsConfig.fileStorage;

    // Initialize BufferRing storage
    this.historicalSnapshots = new BufferRing<MetricsTimeSeriesEntry>({
      capacity: this.bufferConfig.historicalSnapshots.capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      persistPath: this.useFileStorage ? this.bufferConfig.historicalSnapshots.persistenceFile : undefined,
      autoPersist: this.useFileStorage
    });

    this.toolCallEvents = new BufferRing<ToolCallEvent>({
      capacity: this.bufferConfig.toolCallEvents.capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      persistPath: this.useFileStorage ? this.bufferConfig.toolCallEvents.persistenceFile : undefined,
      autoPersist: false, // we'll manage chunked persistence manually for performance
      suppressPersistLog: true
    });

    this.performanceMetrics = new BufferRing<{ timestamp: number; responseTime: number; throughput: number; errorRate: number }>({
      capacity: this.bufferConfig.performanceMetrics.capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      persistPath: this.useFileStorage ? this.bufferConfig.performanceMetrics.persistenceFile : undefined,
      autoPersist: this.useFileStorage
    });

    // Configure optional append-only logging for tool call events (reduces large snapshot writes)
    if (this.useFileStorage) {
      this.appendMode = metricsConfig.toolcall.appendLogEnabled;
      if (this.appendMode) {
        this.appendLogPath = path.join(path.dirname(this.bufferConfig.toolCallEvents.persistenceFile!), 'tool-call-events.ndjson');
        this.appendChunkSize = Math.max(1, metricsConfig.toolcall.chunkSize || this.appendChunkSize);
        this.appendFlushMs = Math.max(1, metricsConfig.toolcall.flushMs || this.appendFlushMs);
        this.appendCompactMs = Math.max(1, metricsConfig.toolcall.compactMs || this.appendCompactMs);
        try {
          // Load any un-compacted append log tail (best-effort)
            if (this.appendLogPath) {
              try {
                const stat = fs.statSync(this.appendLogPath);
                if (stat.size < 25 * 1024 * 1024) { // safety cap 25MB
                  const raw = fs.readFileSync(this.appendLogPath, 'utf8'); // lgtm[js/file-system-race] — appendLogPath is config-controlled metrics path; statSync above bounds size
                  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
                  for (const line of lines) {
                    try {
                      const evt = JSON.parse(line) as ToolCallEvent;
                      this.toolCallEvents.add(evt);
                    } catch {/* ignore bad line */}
                  }
                } else {
                  logWarn('[MetricsCollector] tool-call-events.ndjson too large to preload (>25MB); will rely on last snapshot');
                }
              } catch (statErr: unknown) {
                if ((statErr as NodeJS.ErrnoException).code !== 'ENOENT') throw statErr;
              }
            }
        } catch (err) {
          logWarn('[MetricsCollector] Failed to preload append log', err);
        }
      }
    }

    if (this.useFileStorage) {
      // Initialize legacy file storage for backward compatibility
      this.fileStorage = getFileMetricsStorage({
        storageDir: metricsDir,
        maxFiles: this.options.maxSnapshots,
        retentionMinutes: this.options.retentionMinutes,
      });
      logInfo('[MetricsCollector] BufferRing + File storage enabled');
    } else {
      logInfo('[MetricsCollector] BufferRing memory-only mode (set INDEX_SERVER_METRICS_FILE_STORAGE=1|true|yes|on for persistence)');
    }

    // Start periodic collection
    this.startCollection();
  }

  private formatPersistenceError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack ?? error.message;
    }
    return String(error);
  }

  private recordPersistenceFailure(
    operation: PersistenceOperation,
    error: unknown,
  ): void {
    this.persistenceHealth.degraded = true;
    this.persistenceHealth.totalFailures += 1;
    this.persistenceHealth.lastError = this.formatPersistenceError(error);
    this.persistenceHealth.lastFailureAt = Date.now();

    if (operation === 'append') {
      this.persistenceHealth.appendFailures += 1;
    } else if (operation === 'truncate') {
      this.persistenceHealth.truncateFailures += 1;
    } else {
      this.persistenceHealth.snapshotFailures += 1;
    }

    if (this.persistenceHealth.totalFailures === 1 || this.persistenceHealth.lastRecoveredAt !== undefined) {
      logWarn('[MetricsCollector] Metrics persistence degraded; in-memory buffers will retry writes', {
        operation,
        error: this.persistenceHealth.lastError,
        totalFailures: this.persistenceHealth.totalFailures,
      });
      this.persistenceHealth.lastRecoveredAt = undefined;
    }
  }

  private recordPersistenceRecovery(operation: PersistenceOperation): void {
    if (!this.persistenceHealth.degraded) return;
    this.persistenceHealth.degraded = false;
    this.persistenceHealth.lastError = undefined;
    this.persistenceHealth.lastRecoveredAt = Date.now();
    logInfo('[MetricsCollector] Metrics persistence recovered', {
      operation,
      totalFailures: this.persistenceHealth.totalFailures,
    });
  }

  getPersistenceHealth(): {
    degraded: boolean;
    totalFailures: number;
    appendFailures: number;
    snapshotFailures: number;
    truncateFailures: number;
    lastError?: string;
    lastFailureAt?: number;
    lastRecoveredAt?: number;
  } {
    return { ...this.persistenceHealth };
  }

  /**
   * Record a tool call event
   */
  recordToolCall(toolName: string, success: boolean, responseTimeMs: number, errorType?: string, clientId?: string): void {
    const now = Date.now();

    if (!this.tools.has(toolName)) {
      this.tools.set(toolName, {
        callCount: 0,
        successCount: 0,
        errorCount: 0,
        totalResponseTime: 0,
        errorTypes: {},
      });
    }

    const metrics = this.tools.get(toolName)!;
    metrics.callCount++;
    metrics.totalResponseTime += responseTimeMs;
    metrics.lastCalled = now;

    if (success) {
      metrics.successCount++;
    } else {
      metrics.errorCount++;
      if (errorType) {
        metrics.errorTypes[errorType] = (metrics.errorTypes[errorType] || 0) + 1;
      }
    }

    // Store detailed tool call event in BufferRing
    this.toolCallEvents.add({
      timestamp: now,
      toolName,
      success,
      responseTimeMs,
      errorType,
      clientId
    });
    if (this.useFileStorage) {
      if (this.appendMode) {
        this.pendingAppendEvents.push({ timestamp: now, toolName, success, responseTimeMs, errorType, clientId });
        this.flushToolCallEvents(false); // schedule conditional flush
      } else {
        // legacy snapshot batching (retain previous throttling fields)
        this._pendingToolPersist++;
        const dueTime = now - this._lastToolPersist > this.appendFlushMs;
        if (this._pendingToolPersist >= this.appendChunkSize || dueTime) {
          const pendingAtSchedule = this._pendingToolPersist;
          setTimeout(() => {
            this.toolCallEvents.saveToDisk()
              .then(() => {
                this._lastToolPersist = Date.now();
                this._pendingToolPersist = Math.max(0, this._pendingToolPersist - pendingAtSchedule);
                this.recordPersistenceRecovery('snapshot');
              })
              .catch((error) => {
                this._pendingToolPersist = Math.max(this._pendingToolPersist, pendingAtSchedule);
                this.recordPersistenceFailure('snapshot', error);
              });
          }, 0).unref?.();
        }
      }
    }

    // Track call timestamp for rolling RPM calculation (last 60s window)
    this.recentCallTimestamps.push(now);
    // Prune anything older than 5 minutes to constrain memory
    const cutoff = now - 5 * 60 * 1000;
    if (this.recentCallTimestamps.length > MetricsCollector.MAX_RECENT_CALLS || (this.recentCallTimestamps.length % 100) === 0) {
      // Periodically prune (on every 100th push or when over cap)
      let firstValidIdx = 0;
      while (firstValidIdx < this.recentCallTimestamps.length && this.recentCallTimestamps[firstValidIdx] < cutoff) firstValidIdx++;
      if (firstValidIdx > 0) this.recentCallTimestamps.splice(0, firstValidIdx);
      // Hard cap safeguard
      if (this.recentCallTimestamps.length > MetricsCollector.MAX_RECENT_CALLS) {
        this.recentCallTimestamps.splice(0, this.recentCallTimestamps.length - MetricsCollector.MAX_RECENT_CALLS);
      }
    }

    // Prevent unbounded tool metrics growth - cleanup old/unused tools after adding the new tool
    if (this.tools.size > MetricsCollector.MAX_TOOL_METRICS) {
      this.cleanupOldToolMetrics();
    }
  }

  /** Flush tool call events (append or snapshot) */
  private flushToolCallEvents(force: boolean) {
    if (!this.useFileStorage) return;
    const now = Date.now();
    if (this.appendMode) {
      const timeDue = (now - this.lastAppendFlush) >= this.appendFlushMs;
      if (!force && this.pendingAppendEvents.length < this.appendChunkSize && !timeDue) return;
      if (!this.appendLogPath || this.pendingAppendEvents.length === 0) return;
      const toWrite = this.pendingAppendEvents.splice(0, this.pendingAppendEvents.length);
      const lines = toWrite.map(e => JSON.stringify(e)).join('\n') + '\n';
      const shouldCompact = (now - this.lastAppendCompact) >= this.appendCompactMs || force;
      void fs.promises.appendFile(this.appendLogPath, lines)
        .then(async () => {
          this.lastAppendFlush = now;
          if (!shouldCompact) {
            this.recordPersistenceRecovery('append');
            return;
          }
          try {
            await this.toolCallEvents.saveToDisk();
            this.lastAppendCompact = now;
          } catch (error) {
            this.recordPersistenceFailure('snapshot', error);
            return;
          }
          if (this.appendLogPath) {
            try {
              await fs.promises.writeFile(this.appendLogPath, '');
            } catch (error) {
              this.recordPersistenceFailure('truncate', error);
              return;
            }
          }
          this.recordPersistenceRecovery('append');
        })
        .catch((error) => {
          this.pendingAppendEvents.unshift(...toWrite);
          this.lastAppendFlush = 0;
          this.recordPersistenceFailure('append', error);
        });
      // Periodic compaction: write full snapshot & truncate log
    } else {
      // snapshot mode manual force
      if (force) {
        const pendingAtForce = Math.max(this._pendingToolPersist, 1);
        void this.toolCallEvents.saveToDisk()
          .then(() => {
            this._lastToolPersist = now;
            this._pendingToolPersist = Math.max(0, this._pendingToolPersist - pendingAtForce);
            this.recordPersistenceRecovery('snapshot');
          })
          .catch((error) => {
            this._pendingToolPersist = Math.max(this._pendingToolPersist, pendingAtForce);
            this.recordPersistenceFailure('snapshot', error);
          });
      }
    }
  }

  /**
   * Record client connection
   */
  recordConnection(clientId: string): void {
    this.connections.add(clientId);
    this.sessionStartTimes.set(clientId, Date.now());
  }

  /**
   * Record client disconnection
   */
  recordDisconnection(clientId: string): void {
    if (this.connections.has(clientId)) {
      this.connections.delete(clientId);
      this.disconnectedCount++;

      const sessionStart = this.sessionStartTimes.get(clientId);
      if (sessionStart) {
        this.totalSessionTime += Date.now() - sessionStart;
        this.sessionStartTimes.delete(clientId);
      }
    }
  }

  /**
   * Get current metrics snapshot
   */
  getCurrentSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const uptime = now - this.startTime;

    // Calculate performance metrics
    const totalCalls = Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.callCount, 0);
    const totalSuccesses = Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.successCount, 0);
    const totalErrors = Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.errorCount, 0);
    const totalResponseTime = Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.totalResponseTime, 0);

    // Stable rolling Requests Per Minute based on last 60s calls (not lifetime average)
    const oneMinuteCutoff = now - 60 * 1000;
    let recentCount = 0;
    // Iterate from end backwards until we exit window (timestamps are append-only & ascending)
    for (let i = this.recentCallTimestamps.length - 1; i >= 0; i--) {
      const ts = this.recentCallTimestamps[i];
      if (ts >= oneMinuteCutoff) recentCount++; else break;
    }
    const requestsPerMinute = recentCount;
    const successRate = totalCalls > 0 ? (totalSuccesses / totalCalls) * 100 : 100;
    const avgResponseTime = totalCalls > 0 ? (totalResponseTime / totalCalls) : 0;
    const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;

    // Calculate average session duration
    const activeSessionTime = Array.from(this.sessionStartTimes.values())
      .reduce((sum, startTime) => sum + (now - startTime), 0);
    const totalSessions = this.disconnectedCount + this.connections.size;
    const avgSessionDuration = totalSessions > 0
      ? (this.totalSessionTime + activeSessionTime) / totalSessions
      : 0;

    // Get CPU usage (if available)
    let cpuUsage: NodeJS.CpuUsage | undefined;
    try {
      cpuUsage = process.cpuUsage(this.lastCpuUsage);
      this.lastCpuUsage = process.cpuUsage();
    } catch {
      // CPU usage not available on all platforms
    }

    const memUsage = process.memoryUsage();
    let heapLimit: number | undefined;
    try {
      heapLimit = v8.getHeapStatistics().heap_size_limit;
    } catch { /* v8 not available */ }

    return {
      timestamp: now,
      server: {
        uptime,
        version: this.getVersion(),
        memoryUsage: { ...memUsage, ...(heapLimit ? { heapLimit } : {}) },
        cpuUsage,
        startTime: this.startTime,
      },
      tools: Object.fromEntries(this.tools.entries()),
      connections: {
        activeConnections: this.connections.size,
        totalConnections: this.disconnectedCount + this.connections.size,
        disconnectedConnections: this.disconnectedCount,
        avgSessionDuration,
      },
      performance: {
        requestsPerMinute,
        successRate,
        avgResponseTime,
        errorRate,
      },
    };
  }

  /**
   * Get historical snapshots (from memory for recent, or from files for historical)
   */
  getSnapshots(count?: number): MetricsSnapshot[] {
    if (count) {
      return this.snapshots.slice(-count);
    }
    return [...this.snapshots];
  }

  /**
   * Get snapshots from file storage (for historical analysis)
   */
  async getHistoricalSnapshots(count: number = 720): Promise<MetricsSnapshot[]> {
    if (!this.fileStorage) {
      logWarn('[MetricsCollector] File storage not enabled, returning memory snapshots only');
      return this.getSnapshots(count);
    }

    try {
      return await this.fileStorage.getRecentSnapshots(count);
    } catch (error) {
      logError('[MetricsCollector] Failed to load historical snapshots', error);
      return [];
    }
  }

  /**
   * Get snapshots within a specific time range from files
   */
  async getSnapshotsInRange(startTime: number, endTime: number): Promise<MetricsSnapshot[]> {
    if (!this.fileStorage) {
      logWarn('[MetricsCollector] File storage not enabled, filtering memory snapshots');
      return this.snapshots.filter(s => s.timestamp >= startTime && s.timestamp <= endTime);
    }

    try {
      return await this.fileStorage.getSnapshotsInRange(startTime, endTime);
    } catch (error) {
      logError('[MetricsCollector] Failed to load snapshots in range', error);
      return [];
    }
  }

  /**
   * Get file storage statistics
   */
  async getStorageStats(): Promise<{
    fileCount: number;
    totalSizeKB: number;
    oldestTimestamp?: number;
    newestTimestamp?: number;
    memorySnapshots: number;
    persistence: ReturnType<MetricsCollector['getPersistenceHealth']>;
  }> {
    if (!this.fileStorage) {
      return {
        fileCount: 0,
        totalSizeKB: 0,
        memorySnapshots: this.snapshots.length,
        persistence: this.getPersistenceHealth(),
      };
    }

    const fileStats = await this.fileStorage.getStorageStats();
    return {
      ...fileStats,
      memorySnapshots: this.snapshots.length,
      persistence: this.getPersistenceHealth(),
    };
  }

  /**
   * Get tool-specific metrics
   */
  getToolMetrics(toolName?: string): { [toolName: string]: ToolMetrics } | ToolMetrics | null {
    if (toolName) {
      return this.tools.get(toolName) || null;
    }
    return Object.fromEntries(this.tools.entries());
  }

  /**
   * Clear all metrics data (memory and files)
   */
  async clearMetrics(): Promise<void> {
    // Clear in-memory data
    this.tools.clear();
    this.snapshots.length = 0;
    this.connections.clear();
    this.disconnectedCount = 0;
    this.totalSessionTime = 0;
    this.sessionStartTimes.clear();
    this.startTime = Date.now();
    this.recentCallTimestamps.length = 0;

    // Clear file storage if enabled
    if (this.fileStorage) {
      try {
        await this.fileStorage.clearAll();
      } catch (error) {
        logError('[MetricsCollector] Failed to clear file storage', error);
      }
    }
  }

  /**
   * Clear only memory data (keep files)
   */
  clearMemoryMetrics(): void {
    this.tools.clear();
    this.snapshots.length = 0;
    this.connections.clear();
    this.disconnectedCount = 0;
    this.totalSessionTime = 0;
    this.sessionStartTimes.clear();
    this.startTime = Date.now();
    this.recentCallTimestamps.length = 0;
  }

  /**
   * Stop metrics collection
   */
  stop(): void {
    if (this.collectTimer) {
      clearInterval(this.collectTimer);
      this.collectTimer = undefined;
    }
  }

  private startCollection(): void {
    // Take initial snapshot
    this.takeSnapshot();

    // Schedule periodic snapshots
    this.collectTimer = setInterval(() => {
      this.takeSnapshot();
    }, this.options.collectInterval);
  }

  private takeSnapshot(): void {
    const snapshot = this.getCurrentSnapshot();

    // Store enhanced snapshot in BufferRing with performance data
    const timeSeriesEntry: MetricsTimeSeriesEntry = {
      timestamp: snapshot.timestamp,
      snapshot,
      performanceData: {
        responseTimeMs: snapshot.performance.avgResponseTime,
        requestCount: Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.callCount, 0),
        errorCount: Array.from(this.tools.values()).reduce((sum, tool) => sum + tool.errorCount, 0),
        connectionCount: snapshot.connections.activeConnections
      }
    };

    this.historicalSnapshots.add(timeSeriesEntry);

    // Store performance metrics for charting
    this.performanceMetrics.add({
      timestamp: snapshot.timestamp,
      responseTime: snapshot.performance.avgResponseTime,
      throughput: snapshot.performance.requestsPerMinute,
      errorRate: snapshot.performance.errorRate
    });

    // Store to file immediately (async, non-blocking) if file storage enabled
    if (this.fileStorage) {
      this.fileStorage.storeSnapshot(snapshot).catch(error => {
        logError('[MetricsCollector] Failed to store metrics snapshot to file', error);
      });
    }

    // Keep limited snapshots in memory for real-time queries
    this.snapshots.push(snapshot);

    // Trim in-memory snapshots to prevent memory accumulation
    const maxMemorySnapshots = this.useFileStorage
      ? MetricsCollector.MAX_MEMORY_SNAPSHOTS
      : this.options.maxSnapshots;

    if (this.snapshots.length > maxMemorySnapshots) {
      this.snapshots.splice(0, this.snapshots.length - maxMemorySnapshots);
    }

    // If not using file storage, apply original retention logic
    if (!this.useFileStorage) {
      const cutoff = Date.now() - (this.options.retentionMinutes * 60 * 1000);
      const firstValidIndex = this.snapshots.findIndex(s => s.timestamp >= cutoff);
      if (firstValidIndex > 0) {
        this.snapshots.splice(0, firstValidIndex);
      }
    }

    // Periodically cleanup tool metrics (every 10 snapshots, ~10 minutes)
    if (this.snapshots.length % 10 === 0) {
      this.cleanupOldToolMetrics();
    }
  }

  private getVersion(): string {
    try {
      const candidates = [
        path.join(process.cwd(), 'package.json'),
        path.join(__dirname, '..', '..', '..', 'package.json')
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8'));
          if (pkg?.version) return pkg.version;
        }
      }
    } catch {
      // Ignore errors
    }
    return '0.0.0';
  }

  // ====== Phase 3: Real-time Chart Data Methods ======

  getRealtimeMetrics(): RealtimeMetrics {
    return buildRealtimeMetrics(this.getCurrentSnapshot(), this.tools);
  }

  getToolUsageChartData(minutes = 60): ToolUsageChartData[] {
    return buildToolUsageChartData(this.snapshots, minutes);
  }

  getPerformanceChartData(minutes = 60): PerformanceChartData {
    return buildPerformanceChartData(this.snapshots, minutes);
  }

  getTimeRangeMetrics(range: '1h' | '6h' | '24h' | '7d' | '30d'): MetricsSnapshot[] {
    const rangeMinutes = { '1h': 60, '6h': 360, '24h': 1440, '7d': 10080, '30d': 43200 };
    const cutoff = Date.now() - rangeMinutes[range] * 60_000;
    return this.snapshots.filter(s => s.timestamp >= cutoff);
  }

  // ====== Phase 4: Advanced Real-time & Analytics Methods ======

  getRealtimeStreamingData(): RealtimeStreamingData {
    const recentSnaps10 = this.snapshots.slice(-10);
    const latency = recentSnaps10.length > 0
      ? recentSnaps10.reduce((s, snap) => s + snap.performance.avgResponseTime, 0) / recentSnaps10.length
      : 0;
    return {
      timestamp: Date.now(),
      systemHealth: this.getSystemHealth(),
      performanceMetrics: this.getDetailedPerformanceMetrics(),
      recentActivity: buildRecentActivity(this.tools),
      streamingStats: {
        totalStreamingConnections: this.activeConnections,
        dataTransferRate: this.connections.size * 0.1 + Math.random() * 0.5, // nosemgrep: insecure-randomness — simulated metric jitter
        latency,
        compressionRatio: 0.7,
      },
    };
  }

  getSystemHealth(): SystemHealth {
    const cpu    = estimateCPUUsage(this.snapshots.slice(-5));
    const memory = estimateMemoryUsage(this.connections.size, this.snapshots.length);
    const baseStatus = getOverallHealthStatus(cpu, memory, getErrorRate(this.tools));
    return {
      cpuUsage: cpu,
      memoryUsage: memory,
      diskUsage: estimateDiskUsage(this.snapshots.length),
      networkLatency: getAverageResponseTime(this.tools),
      uptime: Date.now() - this.startTime,
      lastHealthCheck: new Date(),
      status: this.persistenceHealth.degraded && baseStatus === 'healthy' ? 'warning' : baseStatus,
    };
  }

  getDetailedPerformanceMetrics(): EnhancedPerformanceMetrics {
    const totalRequests = getTotalRequests(this.tools);
    const avg = getAverageResponseTime(this.tools);
    const rps = calculateRequestsPerSecond(this.snapshots);
    return {
      requestThroughput: rps * 60,
      averageResponseTime: avg,
      p95ResponseTime: calculatePercentileFromAvg(avg, 95),
      p99ResponseTime: calculatePercentileFromAvg(avg, 99),
      errorRate: getErrorRate(this.tools),
      concurrentConnections: this.activeConnections,
      totalRequests,
      successfulRequests: totalRequests - getTotalErrors(this.tools),
      requestsPerSecond: rps,
      bytesTransferred: totalRequests * 1024 * 2,
    };
  }

  getAdvancedAnalytics(timeRange = '1h'): AdvancedAnalytics {
    return buildAdvancedAnalytics(
      timeRange,
      this.snapshots,
      this.tools,
      getErrorRate(this.tools),
      detectAnomalies(this.snapshots.slice(-20)),
    );
  }

  /**
   * Generate real-time alert
   */
  generateRealTimeAlert(type: string, severity: string, message: string, value: number, threshold: number): Alert {
    const alert: Alert = {
      id: `alert_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
      type: type as Alert['type'],
      severity: severity as Alert['severity'],
      message,
      timestamp: new Date(),
      resolved: false,
      value,
      threshold,
      source: 'MetricsCollector',
      category: categorizeAlert(type)
    };

    this.recentAlerts.unshift(alert);
    if (this.recentAlerts.length > 100) {
      this.recentAlerts = this.recentAlerts.slice(0, 100);
    }

    return alert;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return this.recentAlerts.filter(alert => !alert.resolved);
  }

  /**
   * Resolve alert by ID
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.recentAlerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      return true;
    }
    return false;
  }

  // ===== Resource Sampling / Leak Detection =====
  private sampleResources(): void {
    try {
      const now = Date.now();
      const mem = process.memoryUsage();
      let cpuPercent = 0;
      const curr = process.cpuUsage();
      if (this.lastCpuUsageSample && this.lastCpuSampleTime) {
        const userDiff = curr.user - this.lastCpuUsageSample.user; // microseconds
        const systemDiff = curr.system - this.lastCpuUsageSample.system;
        const elapsedMs = now - this.lastCpuSampleTime;
        if (elapsedMs > 0) {
          // total diff in microseconds / (elapsedMs * 1000) gives fraction of single core; *100 -> percent
            cpuPercent = ((userDiff + systemDiff) / 1000) / elapsedMs * 100;
          // Clamp 0-100 (single process perspective)
          if (cpuPercent < 0) cpuPercent = 0; else if (cpuPercent > 100) cpuPercent = 100;
        }
      }
      this.lastCpuUsageSample = curr;
      this.lastCpuSampleTime = now;
      this.resourceSamples.add({ timestamp: now, cpuPercent, heapUsed: mem.heapUsed, rss: mem.rss });
    } catch { /* ignore sampling errors */ }
  }

  getResourceHistory(limit = 200): { samples: ResourceSample[]; trend?: { cpuSlope: number; memSlope: number } } {
    const all = this.resourceSamples.getAll();
    const samples = limit > 0 ? all.slice(-limit) : all;
    const trend = calculateLinearSlopes(samples);
    return { samples, trend };
  }

  /** Remove stale / low-activity tool entries to prevent unbounded map growth. */
  private cleanupOldToolMetrics(): void {
    const staleThreshold = Date.now() - 3_600_000; // 1 hour
    const toRemove = computeToolsToCleanup(this.tools, MetricsCollector.MAX_TOOL_METRICS, staleThreshold);
    let removedCount = 0;
    for (const name of toRemove) {
      if (this.tools.delete(name)) removedCount++;
    }
    if (removedCount > 0) {
      logInfo('[MetricsCollector] Cleaned up stale tool metrics', { removedCount, remaining: this.tools.size });
    }
  }

  // ====== BufferRing-Enhanced Methods ======

  /**
   * Get historical metrics data for charting
   */
  getHistoricalMetrics(minutes: number = 60): MetricsTimeSeriesEntry[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.historicalSnapshots.filter(entry => entry.timestamp >= cutoff);
  }

  /**
   * Get recent tool call events for analysis
   */
  getRecentToolCallEvents(minutes: number = 30): ToolCallEvent[] {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.toolCallEvents.filter(event => event.timestamp >= cutoff);
  }

  /**
   * Get performance metrics time series for dashboard charts (BufferRing-enhanced)
   */
  getPerformanceTimeSeriesData(minutes = 60): PerformanceChartData {
    return buildPerformanceTimeSeriesData(this.performanceMetrics.getAll(), minutes);
  }

  /**
   * Get tool usage analytics from historical data
   */
  getToolUsageAnalytics(minutes = 60): ToolUsageStats[] {
    return buildToolUsageAnalytics(this.toolCallEvents.getAll(), minutes);
  }

  /**
   * Get BufferRing statistics for monitoring
   */
  getBufferRingStats(): {
    historicalSnapshots: BufferRingStats;
    toolCallEvents: BufferRingStats;
    performanceMetrics: BufferRingStats;
  } {
    return {
      historicalSnapshots: this.historicalSnapshots.getStats(),
      toolCallEvents: this.toolCallEvents.getStats(),
      performanceMetrics: this.performanceMetrics.getStats()
    };
  }

  /**
   * Export metrics data for backup/analysis
   */
  exportMetricsData(options: { includeHistorical?: boolean; includeEvents?: boolean; includePerformance?: boolean } = {}): {
    timestamp: number;
    currentSnapshot: MetricsSnapshot;
    bufferStats: {
      historicalSnapshots: BufferRingStats;
      toolCallEvents: BufferRingStats;
      performanceMetrics: BufferRingStats;
    };
    persistence: ReturnType<MetricsCollector['getPersistenceHealth']>;
    historicalSnapshots?: MetricsTimeSeriesEntry[];
    toolCallEvents?: ToolCallEvent[];
    performanceMetrics?: Array<{ timestamp: number; responseTime: number; throughput: number; errorRate: number; }>;
  } {
    const data = {
      timestamp: Date.now(),
      currentSnapshot: this.getCurrentSnapshot(),
      bufferStats: this.getBufferRingStats(),
      persistence: this.getPersistenceHealth(),
    };

    const result: typeof data & {
      historicalSnapshots?: MetricsTimeSeriesEntry[];
      toolCallEvents?: ToolCallEvent[];
      performanceMetrics?: Array<{ timestamp: number; responseTime: number; throughput: number; errorRate: number; }>;
    } = data;

    if (options.includeHistorical !== false) {
      result.historicalSnapshots = this.historicalSnapshots.getAll();
    }

    if (options.includeEvents !== false) {
      result.toolCallEvents = this.toolCallEvents.getAll();
    }

    if (options.includePerformance !== false) {
      result.performanceMetrics = this.performanceMetrics.getAll();
    }

    return result;
  }

  /**
   * Clear all BufferRing data (for maintenance)
   */
  clearBufferedData(): void {
    this.historicalSnapshots.clear();
    this.toolCallEvents.clear();
    this.performanceMetrics.clear();
    logInfo('[MetricsCollector] Cleared all BufferRing data');
  }
}

// Global singleton instance
let globalCollector: MetricsCollector | null = null;

/**
 * Get or create the global metrics collector instance
 */
export function getMetricsCollector(): MetricsCollector {
  if (!globalCollector) {
    globalCollector = new MetricsCollector();
  }
  return globalCollector;
}

/**
 * Set a custom metrics collector instance (useful for testing)
 */
export function setMetricsCollector(collector: MetricsCollector | null): void {
  globalCollector = collector;
}

// (No changes needed in this file for the current UI fixes)
