/**
 * metricsAggregation.ts
 *
 * All shared type definitions and pure aggregation math for the metrics subsystem:
 * averages, percentiles, window calculations, trend detection, and tool-cleanup logic.
 * No side effects — every function here is deterministic given its inputs.
 */

// ── Exported Types ──────────────────────────────────────────────────────────

export interface ToolMetrics {
  callCount: number;
  successCount: number;
  errorCount: number;
  totalResponseTime: number;
  lastCalled?: number;
  errorTypes: { [errorType: string]: number };
}

export interface ServerMetrics {
  uptime: number;
  version: string;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  startTime: number;
}

export interface ConnectionMetrics {
  activeConnections: number;
  totalConnections: number;
  disconnectedConnections: number;
  avgSessionDuration: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  server: ServerMetrics;
  tools: { [toolName: string]: ToolMetrics };
  connections: ConnectionMetrics;
  performance: {
    requestsPerMinute: number;
    successRate: number;
    avgResponseTime: number;
    errorRate: number;
  };
}

export interface MetricsTimeSeriesEntry {
  timestamp: number;
  snapshot: MetricsSnapshot;
  performanceData: {
    responseTimeMs: number;
    requestCount: number;
    errorCount: number;
    connectionCount: number;
  };
}

export interface ToolCallEvent {
  timestamp: number;
  toolName: string;
  success: boolean;
  responseTimeMs: number;
  errorType?: string;
  clientId?: string;
}

export interface MetricsBufferConfig {
  historicalSnapshots: {
    capacity: number;
    retentionMinutes: number;
    persistenceFile?: string;
  };
  toolCallEvents: {
    capacity: number;
    retentionMinutes: number;
    persistenceFile?: string;
  };
  performanceMetrics: {
    capacity: number;
    persistenceFile?: string;
  };
}

export interface ChartDataPoint {
  timestamp: number;
  value: number;
  label?: string;
}

export interface ToolUsageChartData {
  toolName: string;
  data: ChartDataPoint[];
  color?: string;
}

export interface PerformanceChartData {
  responseTime: ChartDataPoint[];
  requestRate: ChartDataPoint[];
  errorRate: ChartDataPoint[];
  successRate: ChartDataPoint[];
}

export interface RealtimeMetrics {
  currentRpm: number;
  activeConnections: number;
  avgResponseTime: number;
  successRate: number;
  errorRate: number;
  topTools: Array<{ name: string; calls: number; avgTime: number }>;
  recentErrors: Array<{ tool: string; error: string; timestamp: number }>;
}

export interface RealtimeStreamingData {
  timestamp: number;
  systemHealth: SystemHealth;
  performanceMetrics: EnhancedPerformanceMetrics;
  recentActivity: ActivityEvent[];
  streamingStats: StreamingStats;
}

export interface SystemHealth {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkLatency: number;
  uptime: number;
  lastHealthCheck: Date;
  status: 'healthy' | 'warning' | 'critical';
}

export interface EnhancedPerformanceMetrics {
  requestThroughput: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  concurrentConnections: number;
  totalRequests: number;
  successfulRequests: number;
  requestsPerSecond: number;
  bytesTransferred: number;
}

export interface StreamingStats {
  totalStreamingConnections: number;
  dataTransferRate: number;
  latency: number;
  compressionRatio: number;
}

export interface ActivityEvent {
  tool: string;
  lastActivity: Date | null;
  recentCalls: number;
}

export interface AdvancedAnalytics {
  timeRange: string;
  hourlyStats: HourlyStats[];
  toolUsageBreakdown: ToolUsageStats[];
  errorAnalysis: ErrorAnalysis;
  performanceTrends: PerformanceTrend[];
  predictionData: PredictionData | null;
  anomalies: Anomaly[];
}

export interface HourlyStats {
  hour: string;
  requestCount: number;
  errorCount: number;
  avgResponseTime: number;
}

export interface ToolUsageStats {
  toolName: string;
  callCount: number;
  successRate: number;
  avgResponseTime: number;
  lastCalled: Date | null;
}

export interface ErrorAnalysis {
  errorTypes: { [type: string]: number };
  totalErrors: number;
  errorRate: number;
}

export interface PerformanceTrend {
  timestamp: Date;
  responseTime: number;
  throughput: number;
  errorRate: number;
}

export interface PredictionData {
  responseTimeProjection: number;
  throughputProjection: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface Anomaly {
  type: string;
  timestamp: Date;
  value: number;
  severity: 'low' | 'medium' | 'high';
}

export interface Alert {
  id: string;
  type: 'error_rate' | 'response_time' | 'memory' | 'cpu' | 'system' | 'network';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  value: number;
  threshold: number;
  source: string;
  category: string;
}

export interface MetricsCollectorOptions {
  retentionMinutes?: number;
  maxSnapshots?: number;
  collectInterval?: number;
}

export interface ResourceSample {
  timestamp: number;
  cpuPercent: number;
  heapUsed: number;
  rss: number;
}

// ── Pure Aggregation Functions ──────────────────────────────────────────────

export function getTotalRequests(tools: Map<string, ToolMetrics>): number {
  let total = 0;
  tools.forEach(m => { total += m.callCount; });
  return total;
}

export function getTotalErrors(tools: Map<string, ToolMetrics>): number {
  let total = 0;
  tools.forEach(m => { total += m.errorCount; });
  return total;
}

export function getAverageResponseTime(tools: Map<string, ToolMetrics>): number {
  let totalTime = 0;
  let totalCalls = 0;
  tools.forEach(m => { totalTime += m.totalResponseTime; totalCalls += m.callCount; });
  return totalCalls > 0 ? totalTime / totalCalls : 0;
}

export function getErrorRate(tools: Map<string, ToolMetrics>): number {
  const totalCalls = getTotalRequests(tools);
  const totalErrors = getTotalErrors(tools);
  return totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;
}

/** Requests per second derived from a sliding window of recent snapshots. */
export function calculateRequestsPerSecond(snapshots: MetricsSnapshot[]): number {
  const recent = snapshots.slice(-10);
  if (recent.length < 2) return 0;
  const latest = recent[recent.length - 1];
  const earliest = recent[0];
  const timeDiff = (latest.timestamp - earliest.timestamp) / 1000;
  const latestReqs = Object.values(latest.tools).reduce((s, t) => s + t.callCount, 0);
  const earliestReqs = Object.values(earliest.tools).reduce((s, t) => s + t.callCount, 0);
  return timeDiff > 0 ? (latestReqs - earliestReqs) / timeDiff : 0;
}

/** Linear trend slope via ordinary least squares over an array of values. */
export function calculateTrend(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((s, v) => s + v, 0);
  const sumXY = values.reduce((s, v, i) => s + i * v, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
}

/** Parse time-range strings like "1h", "30m", "2d" into whole hours. */
export function parseTimeRange(timeRange: string): number {
  const match = timeRange.match(/(\d+)([hmd])/);
  if (!match) return 1;
  const value = parseInt(match[1]);
  switch (match[2]) {
    case 'h': return value;
    case 'd': return value * 24;
    case 'm': return Math.max(1, Math.floor(value / 60));
    default:  return 1;
  }
}

/** Return an estimated percentile response-time given the average. */
export function calculatePercentileFromAvg(avg: number, percentile: number): number {
  const multiplier = percentile === 95 ? 2.5 : percentile === 99 ? 4.0 : 1.0;
  return Math.round(avg * multiplier);
}

export function categorizeAlert(type: string): string {
  const categories: Record<string, string> = {
    error_rate: 'Performance',
    response_time: 'Performance',
    memory: 'System',
    cpu: 'System',
    disk: 'System',
    network: 'Network',
  };
  return categories[type] ?? 'General';
}

export function getOverallHealthStatus(
  cpu: number,
  memory: number,
  errorRate: number,
): 'healthy' | 'warning' | 'critical' {
  if (cpu > 90 || memory > 90 || errorRate > 10) return 'critical';
  if (cpu > 75 || memory > 75 || errorRate > 5)  return 'warning';
  return 'healthy';
}

/** Estimate CPU % from recent RPM (simple heuristic, single-core basis). */
export function estimateCPUUsage(recentSnapshots: MetricsSnapshot[]): number {
  if (recentSnapshots.length === 0) return 0;
  const avgRpm = recentSnapshots.reduce((s, snap) => s + snap.performance.requestsPerMinute, 0) / recentSnapshots.length;
  return Math.min(Math.max(avgRpm / 10, 5), 95);
}

export function estimateMemoryUsage(connectionCount: number, snapshotCount: number): number {
  return Math.min(20 + connectionCount * 0.5 + snapshotCount * 0.1, 95);
}

export function estimateDiskUsage(snapshotCount: number): number {
  return Math.min(30 + snapshotCount * 0.05, 80);
}

/** Detect response-time spikes in a set of snapshots. */
export function detectAnomalies(snapshots: MetricsSnapshot[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (snapshots.length <= 10) return anomalies;
  const avg = snapshots.reduce((s, snap) => s + snap.performance.avgResponseTime, 0) / snapshots.length;
  for (const snapshot of snapshots) {
    if (snapshot.performance.avgResponseTime > avg * 2) {
      anomalies.push({
        type: 'response_time_spike',
        timestamp: new Date(snapshot.timestamp),
        value: snapshot.performance.avgResponseTime,
        severity: 'medium',
      });
    }
  }
  return anomalies;
}

/** Compute RPM from a series of snapshots (used for historical charting). */
export function calculateRPMFromSnapshots(snapshots: MetricsSnapshot[]): number {
  if (snapshots.length < 2) return 0;
  let totalRequests = 0;
  snapshots.forEach(s => { Object.values(s.tools).forEach(t => { totalRequests += t.callCount; }); });
  const spanMinutes = (snapshots[snapshots.length - 1].timestamp - snapshots[0].timestamp) / 60000;
  return spanMinutes > 0 ? totalRequests / spanMinutes : 0;
}

/** Compute per-second OLS slope for CPU % and heap memory over a sample window. */
export function calculateLinearSlopes(samples: ResourceSample[]): { cpuSlope: number; memSlope: number } {
  if (samples.length <= 5) return { cpuSlope: 0, memSlope: 0 };
  const n = samples.length;
  const firstTs = samples[0].timestamp;
  let sumX = 0, sumCpu = 0, sumMem = 0, sumXcpu = 0, sumXmem = 0, sumX2 = 0;
  for (const s of samples) {
    const x = (s.timestamp - firstTs) / 1000;
    sumX += x; sumCpu += s.cpuPercent; sumMem += s.heapUsed;
    sumXcpu += x * s.cpuPercent; sumXmem += x * s.heapUsed; sumX2 += x * x;
  }
  const denom = (n * sumX2 - sumX * sumX) || 1;
  return {
    cpuSlope: (n * sumXcpu - sumX * sumCpu) / denom,
    memSlope: (n * sumXmem - sumX * sumMem) / denom,
  };
}

/**
 * Return the set of tool names that should be evicted to keep the map under maxSize.
 * Lowest-score (least-recently-used + fewest calls) tools are evicted first.
 */
export function computeToolsToCleanup(
  tools: Map<string, ToolMetrics>,
  maxSize: number,
  staleThreshold: number,
  minCallsToKeep: number = 10,
): string[] {
  const keepCount = Math.floor(maxSize * 0.8);
  const sorted = Array.from(tools.entries())
    .map(([name, m]) => ({ name, m, score: (m.lastCalled ?? 0) + m.callCount * 1000 }))
    .sort((a, b) => b.score - a.score);
  const candidates = sorted.slice(keepCount);
  const toRemove: string[] = [];

  if (tools.size > maxSize) {
    for (const { name, m } of candidates) {
      const isStale = (m.lastCalled ?? 0) < staleThreshold;
      if ((isStale && m.callCount < minCallsToKeep) || (!isStale && m.callCount < 5)) {
        toRemove.push(name);
      }
    }
    // Hard-cap: evict more aggressively if still over capacity
    const remaining = tools.size - toRemove.length;
    if (remaining > maxSize) {
      const extra = candidates
        .filter(({ name }) => !toRemove.includes(name))
        .slice(0, remaining - keepCount)
        .map(({ name }) => name);
      toRemove.push(...extra);
    }
  } else {
    for (const { name, m } of candidates) {
      if ((m.lastCalled ?? 0) < staleThreshold && m.callCount < minCallsToKeep) {
        toRemove.push(name);
      }
    }
  }

  return toRemove;
}
