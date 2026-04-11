/**
 * Metrics & Analytics Routes
 * Routes: GET /metrics, GET /metrics/history, GET /tools, GET /tools/:toolName,
 *         GET /performance, GET /performance/detailed, GET /realtime,
 *         GET /streaming/data, GET /charts/tool-usage, GET /charts/performance,
 *         GET /charts/timerange, GET /charts/export, GET /analytics/advanced
 */

import { Router, Request, Response } from 'express';
import { MetricsCollector, ToolMetrics } from '../MetricsCollector.js';
import { listRegisteredMethods } from '../../../server/registry.js';

export function createMetricsRoutes(metricsCollector: MetricsCollector): Router {
  const router = Router();

  /**
   * GET /api/tools - List all registered tools
   */
  router.get('/tools', (_req: Request, res: Response) => {
    try {
      const tools = listRegisteredMethods();
      const toolMetrics = metricsCollector.getToolMetrics() as { [toolName: string]: ToolMetrics };

      const enrichedTools = tools.map(toolName => ({
        name: toolName,
        metrics: toolMetrics[toolName] || {
          callCount: 0,
          successCount: 0,
          errorCount: 0,
          totalResponseTime: 0,
          errorTypes: {},
        },
      }));

      res.json({
        tools: enrichedTools,
        totalTools: tools.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Tools error:', error);
      res.status(500).json({
        error: 'Failed to get tools list',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/metrics - Current metrics snapshot
   */
  router.get('/metrics', (_req: Request, res: Response) => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();
      res.json(snapshot);
    } catch (error) {
      console.error('[API] Metrics error:', error);
      res.status(500).json({
        error: 'Failed to get metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/metrics/history - Historical metrics snapshots
   */
  router.get('/metrics/history', (req: Request, res: Response) => {
    try {
      const count = req.query.count ? parseInt(req.query.count as string, 10) : undefined;
      const snapshots = metricsCollector.getSnapshots(count);

      res.json({
        snapshots,
        count: snapshots.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Metrics history error:', error);
      res.status(500).json({
        error: 'Failed to get metrics history',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/tools/:toolName - Specific tool metrics
   */
  router.get('/tools/:toolName', (req: Request, res: Response) => {
    try {
      const { toolName } = req.params;
      const metrics = metricsCollector.getToolMetrics(toolName);

      if (!metrics) {
        return res.status(404).json({
          error: 'Tool not found',
          toolName,
        });
      }

      res.json({
        toolName,
        metrics,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Tool metrics error:', error);
      res.status(500).json({
        error: 'Failed to get tool metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/performance - Performance summary
   */
  router.get('/performance', (_req: Request, res: Response) => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();

      res.json({
        performance: snapshot.performance,
        server: {
          uptime: snapshot.server.uptime,
          memoryUsage: snapshot.server.memoryUsage,
          cpuUsage: snapshot.server.cpuUsage,
        },
        connections: snapshot.connections,
        timestamp: snapshot.timestamp,
      });
    } catch (error) {
      console.error('[API] Performance error:', error);
      res.status(500).json({
        error: 'Failed to get performance metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/realtime - Real-time metrics for dashboard widgets
   */
  router.get('/realtime', (_req: Request, res: Response) => {
    try {
      const realtimeMetrics = metricsCollector.getRealtimeMetrics();
      res.json({
        success: true,
        data: realtimeMetrics,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Realtime metrics error:', error);
      res.status(500).json({
        error: 'Failed to get realtime metrics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/streaming/data - Real-time streaming data for Phase 4
   */
  router.get('/streaming/data', (_req: Request, res: Response) => {
    try {
      const streamingData = metricsCollector.getRealtimeStreamingData();
      res.json({
        success: true,
        data: streamingData,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Streaming data error:', error);
      res.status(500).json({
        error: 'Failed to get streaming data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/charts/tool-usage - Tool usage chart data
   * Query params: minutes (default: 60)
   */
  router.get('/charts/tool-usage', (req: Request, res: Response) => {
    try {
      const minutes = parseInt(req.query.minutes as string) || 60;
      const chartData = metricsCollector.getToolUsageChartData(minutes);

      res.json({
        success: true,
        data: chartData,
        timeRange: `${minutes} minutes`,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Tool usage chart error:', error);
      res.status(500).json({
        error: 'Failed to get tool usage chart data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/charts/performance - Performance metrics chart data
   * Query params: minutes (default: 60)
   */
  router.get('/charts/performance', (req: Request, res: Response) => {
    try {
      const minutes = parseInt(req.query.minutes as string) || 60;
      const chartData = metricsCollector.getPerformanceChartData(minutes);

      res.json({
        success: true,
        data: chartData,
        timeRange: `${minutes} minutes`,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Performance chart error:', error);
      res.status(500).json({
        error: 'Failed to get performance chart data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/charts/timerange - Metrics for specific time ranges
   * Query params: range (1h, 6h, 24h, 7d, 30d)
   */
  router.get('/charts/timerange', (req: Request, res: Response) => {
    try {
      const range = (req.query.range as string) || '1h';
      const validRanges = ['1h', '6h', '24h', '7d', '30d'];

      if (!validRanges.includes(range)) {
        return res.status(400).json({
          error: 'Invalid time range',
          message: `Range must be one of: ${validRanges.join(', ')}`,
          validRanges,
        });
      }

      const timeRangeData = metricsCollector.getTimeRangeMetrics(range as '1h' | '6h' | '24h' | '7d' | '30d');

      res.json({
        success: true,
        data: timeRangeData,
        range,
        count: timeRangeData.length,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Time range chart error:', error);
      res.status(500).json({
        error: 'Failed to get time range data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/charts/export - Export chart data for reports
   * Query params: format (json, csv), range (1h, 6h, 24h, 7d, 30d)
   */
  router.get('/charts/export', (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || 'json';
      const range = (req.query.range as string) || '1h';

      if (!['json', 'csv'].includes(format)) {
        return res.status(400).json({
          error: 'Invalid export format',
          message: 'Format must be either json or csv',
        });
      }

      const data = metricsCollector.getTimeRangeMetrics(range as '1h' | '6h' | '24h' | '7d' | '30d');

      if (format === 'csv') {
        // Convert to CSV format
        const csvHeaders = 'timestamp,activeConnections,requestsPerMinute,successRate,errorRate,avgResponseTime\n';
        const csvRows = data.map(snapshot =>
          `${snapshot.timestamp},${snapshot.connections.activeConnections},${snapshot.performance.requestsPerMinute},${snapshot.performance.successRate},${snapshot.performance.errorRate},${snapshot.performance.avgResponseTime}`
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="metrics-${range}-${Date.now()}.csv"`);
        res.send(csvHeaders + csvRows);
      } else {
        res.json({
          success: true,
          data,
          range,
          exportedAt: Date.now(),
          format: 'json',
        });
      }
    } catch (error) {
      console.error('[API] Chart export error:', error);
      res.status(500).json({
        error: 'Failed to export chart data',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/performance/detailed - Extended performance metrics (UI convenience endpoint)
   * Supplies the fields the dashboard Monitoring panel expects without the client
   * needing to stitch multiple endpoints. P95/P99 are approximations until full
   * latency histogram support is implemented.
   */
  router.get('/performance/detailed', (_req: Request, res: Response) => {
    try {
      const snap = metricsCollector.getCurrentSnapshot();
      // Approximate p95 by avgResponseTime + (errorRate factor) as a placeholder; real implementation would use distribution.
      const avg = snap.performance.avgResponseTime;
      const p95 = avg ? Math.round(avg * 1.35) : 0;
      res.json({
        success: true,
        data: {
          requestThroughput: snap.performance.requestsPerMinute,
          averageResponseTime: avg,
          p95ResponseTime: p95,
          errorRate: snap.performance.errorRate,
          concurrentConnections: snap.connections.activeConnections,
          successRate: snap.performance.successRate ?? (100 - snap.performance.errorRate),
          activeSyntheticRequests: 0
        },
        timestamp: Date.now()
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to compute performance metrics', message: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * GET /api/analytics/advanced - Advanced analytics data
   */
  router.get('/analytics/advanced', (req: Request, res: Response) => {
    try {
      const timeRange = (req.query.timeRange as string) || '1h';
      const analytics = metricsCollector.getAdvancedAnalytics(timeRange);
      res.json({
        success: true,
        data: analytics,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] Advanced analytics error:', error);
      res.status(500).json({
        error: 'Failed to get advanced analytics',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}
