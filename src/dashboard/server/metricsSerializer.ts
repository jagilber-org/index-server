/**
 * metricsSerializer.ts
 *
 * Pure builder functions that convert raw metrics state into JSON-ready output shapes
 * for dashboard charts, analytics, and streaming endpoints.
 * Every function here is side-effect-free and receives all data it needs as parameters.
 */

import {
  type ToolMetrics,
  type MetricsSnapshot,
  type ToolCallEvent,
  type RealtimeMetrics,
  type ToolUsageChartData,
  type PerformanceChartData,
  type ToolUsageStats,
  type HourlyStats,
  type ErrorAnalysis,
  type PerformanceTrend,
  type PredictionData,
  type AdvancedAnalytics,
  type ActivityEvent,
  calculateTrend,
  parseTimeRange,
} from './metricsAggregation.js';

// ── Real-time widgets ────────────────────────────────────────────────────────

export function buildRealtimeMetrics(
  snapshot: MetricsSnapshot,
  tools: Map<string, ToolMetrics>,
): RealtimeMetrics {
  const topTools = Array.from(tools.entries())
    .sort((a, b) => b[1].callCount - a[1].callCount)
    .slice(0, 5)
    .map(([name, m]) => ({
      name,
      calls: m.callCount,
      avgTime: m.callCount > 0 ? m.totalResponseTime / m.callCount : 0,
    }));

  return {
    currentRpm: snapshot.performance.requestsPerMinute,
    activeConnections: snapshot.connections.activeConnections,
    avgResponseTime: snapshot.performance.avgResponseTime,
    successRate: snapshot.performance.successRate,
    errorRate: snapshot.performance.errorRate,
    topTools,
    recentErrors: [],
  };
}

export function buildRecentActivity(tools: Map<string, ToolMetrics>): ActivityEvent[] {
  const cutoff = Date.now() - 300_000; // 5 min
  return Array.from(tools.entries())
    .filter(([, m]) => m.lastCalled && m.lastCalled >= cutoff)
    .map(([name, m]) => ({
      tool: name,
      lastActivity: m.lastCalled ? new Date(m.lastCalled) : null,
      recentCalls: m.callCount,
    }))
    .sort((a, b) => (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0))
    .slice(0, 10);
}

// ── Chart data builders ──────────────────────────────────────────────────────

const CHART_COLORS = [
  '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
  '#9966FF', '#FF9F40', '#FF6384', '#C9CBCF',
];

export function buildToolUsageChartData(
  snapshots: MetricsSnapshot[],
  minutes: number,
): ToolUsageChartData[] {
  const cutoff = Date.now() - minutes * 60_000;
  const relevant = snapshots.filter(s => s.timestamp >= cutoff);
  if (relevant.length === 0) return [];

  const toolNames = new Set<string>();
  relevant.forEach(s => Object.keys(s.tools).forEach(n => toolNames.add(n)));

  return Array.from(toolNames).map((toolName, i) => ({
    toolName,
    color: CHART_COLORS[i % CHART_COLORS.length],
    data: relevant.map(s => ({
      timestamp: s.timestamp,
      value: s.tools[toolName]?.callCount ?? 0,
      label: new Date(s.timestamp).toLocaleTimeString(),
    })),
  }));
}

export function buildPerformanceChartData(
  snapshots: MetricsSnapshot[],
  minutes: number,
): PerformanceChartData {
  const cutoff = Date.now() - minutes * 60_000;
  const relevant = snapshots.filter(s => s.timestamp >= cutoff);
  const toPoint = (s: MetricsSnapshot, value: number) => ({
    timestamp: s.timestamp,
    value,
    label: new Date(s.timestamp).toLocaleTimeString(),
  });
  return {
    responseTime: relevant.map(s => toPoint(s, s.performance.avgResponseTime)),
    requestRate:  relevant.map(s => toPoint(s, s.performance.requestsPerMinute)),
    errorRate:    relevant.map(s => toPoint(s, s.performance.errorRate)),
    successRate:  relevant.map(s => toPoint(s, s.performance.successRate)),
  };
}

export function buildPerformanceTimeSeriesData(
  performanceData: Array<{ timestamp: number; responseTime: number; throughput: number; errorRate: number }>,
  minutes: number,
): PerformanceChartData {
  const cutoff = Date.now() - minutes * 60_000;
  const recent = performanceData.filter(m => m.timestamp >= cutoff);
  return {
    responseTime: recent.map(m => ({ timestamp: m.timestamp, value: m.responseTime })),
    requestRate:  recent.map(m => ({ timestamp: m.timestamp, value: m.throughput })),
    errorRate:    recent.map(m => ({ timestamp: m.timestamp, value: m.errorRate })),
    successRate:  recent.map(m => ({ timestamp: m.timestamp, value: 100 - m.errorRate })),
  };
}

// ── Analytics builders ───────────────────────────────────────────────────────

export function buildToolUsageAnalytics(
  events: ToolCallEvent[],
  minutes: number,
): ToolUsageStats[] {
  const cutoff = Date.now() - minutes * 60_000;
  const recent = events.filter(e => e.timestamp >= cutoff);
  const map = new Map<string, { calls: number; successes: number; totalTime: number; lastUsed: number }>();

  recent.forEach(e => {
    const s = map.get(e.toolName) ?? { calls: 0, successes: 0, totalTime: 0, lastUsed: 0 };
    s.calls++;
    if (e.success) s.successes++;
    s.totalTime += e.responseTimeMs;
    s.lastUsed = Math.max(s.lastUsed, e.timestamp);
    map.set(e.toolName, s);
  });

  return Array.from(map.entries()).map(([toolName, s]) => ({
    toolName,
    callCount: s.calls,
    successRate: s.calls > 0 ? (s.successes / s.calls) * 100 : 100,
    avgResponseTime: s.calls > 0 ? s.totalTime / s.calls : 0,
    lastCalled: s.lastUsed > 0 ? new Date(s.lastUsed) : null,
  }));
}

export function buildHourlyStats(
  snapshots: MetricsSnapshot[],
  timeRange: string,
  errorRate: number,
): HourlyStats[] {
  const hours = parseTimeRange(timeRange);
  const now = Date.now();
  const stats: HourlyStats[] = [];

  for (let i = hours - 1; i >= 0; i--) {
    const hourStart = now - i * 3_600_000;
    const hourEnd   = hourStart + 3_600_000;
    const hourSnaps = snapshots.filter(s => s.timestamp >= hourStart && s.timestamp < hourEnd);
    if (hourSnaps.length === 0) continue;

    const latestReqs  = Object.values(hourSnaps[hourSnaps.length - 1].tools).reduce((s, t) => s + t.callCount, 0);
    const earliestReqs = Object.values(hourSnaps[0].tools).reduce((s, t) => s + t.callCount, 0);
    const requests = latestReqs - earliestReqs;

    stats.push({
      hour: new Date(hourStart).toISOString().slice(11, 16),
      requestCount: requests,
      errorCount: Math.round(requests * errorRate / 100),
      avgResponseTime: hourSnaps.reduce((s, snap) => s + snap.performance.avgResponseTime, 0) / hourSnaps.length,
    });
  }
  return stats;
}

export function buildToolUsageBreakdown(tools: Map<string, ToolMetrics>): ToolUsageStats[] {
  return Array.from(tools.entries()).map(([name, m]) => ({
    toolName: name,
    callCount: m.callCount,
    successRate: m.callCount > 0 ? ((m.callCount - m.errorCount) / m.callCount) * 100 : 100,
    avgResponseTime: m.totalResponseTime / Math.max(m.callCount, 1),
    lastCalled: m.lastCalled ? new Date(m.lastCalled) : null,
  }));
}

export function buildErrorAnalysis(
  tools: Map<string, ToolMetrics>,
  errorRate: number,
): ErrorAnalysis {
  const errors: Record<string, number> = {};
  let totalErrors = 0;
  tools.forEach(m => {
    totalErrors += m.errorCount;
    errors['TimeoutError']    = (errors['TimeoutError']    ?? 0) + Math.floor(m.errorCount * 0.3);
    errors['ValidationError'] = (errors['ValidationError'] ?? 0) + Math.floor(m.errorCount * 0.4);
    errors['SystemError']     = (errors['SystemError']     ?? 0) + Math.floor(m.errorCount * 0.3);
  });
  return { errorTypes: errors, totalErrors, errorRate };
}

export function buildPerformanceTrends(snapshots: MetricsSnapshot[]): PerformanceTrend[] {
  const points = Math.min(snapshots.length, 20);
  return snapshots.slice(-points).map(s => ({
    timestamp: new Date(s.timestamp),
    responseTime: s.performance.avgResponseTime,
    throughput: s.performance.requestsPerMinute,
    errorRate: s.performance.errorRate,
  }));
}

export function buildPredictionData(snapshots: MetricsSnapshot[]): PredictionData | null {
  const recent = snapshots.slice(-10);
  if (recent.length < 2) return null;
  return {
    responseTimeProjection: calculateTrend(recent.map(s => s.performance.avgResponseTime)),
    throughputProjection:   calculateTrend(recent.map(s => s.performance.requestsPerMinute)),
    confidence: recent.length >= 5 ? 'high' : 'low',
  };
}

export function buildAdvancedAnalytics(
  timeRange: string,
  snapshots: MetricsSnapshot[],
  tools: Map<string, ToolMetrics>,
  errorRate: number,
  anomalies: import('./metricsAggregation.js').Anomaly[],
): AdvancedAnalytics {
  return {
    timeRange,
    hourlyStats: buildHourlyStats(snapshots, timeRange, errorRate),
    toolUsageBreakdown: buildToolUsageBreakdown(tools),
    errorAnalysis: buildErrorAnalysis(tools, errorRate),
    performanceTrends: buildPerformanceTrends(snapshots),
    predictionData: buildPredictionData(snapshots),
    anomalies,
  };
}
