/**
 * Status & Health Routes
 * Routes: GET /status, GET /health, GET /system/health, GET /system/resources
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import { MetricsCollector } from '../MetricsCollector.js';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';

/** Derive short git commit (best-effort; never throws) */
function getGitCommit(): string | null {
  try {
    const head = path.join(process.cwd(), '.git', 'HEAD');
    if (!fs.existsSync(head)) return null;
    let ref = fs.readFileSync(head, 'utf8').trim();
    if (ref.startsWith('ref:')) {
      const refPath = path.join(process.cwd(), '.git', ref.split(' ')[1]);
      if (fs.existsSync(refPath)) {
        ref = fs.readFileSync(refPath, 'utf8').trim();
      }
    }
    return ref.substring(0, 12);
  } catch { return null; }
}

/** Approximate build time via dist/server/index-server.js mtime (falls back to null) */
function getBuildTime(): string | null {
  try {
    const candidate = path.join(process.cwd(), 'dist', 'server', 'index-server.js');
    if (fs.existsSync(candidate)) {
      const stat = fs.statSync(candidate);
      return new Date(stat.mtimeMs).toISOString();
    }
  } catch {/* ignore */}
  return null;
}

export function createStatusRoutes(metricsCollector: MetricsCollector): Router {
  const router = Router();

  /**
   * GET /api/status - Server status and basic info
   */
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();
      const git = getGitCommit();
      const buildTime = getBuildTime();

      // Prevent stale caching of build/version metadata in browsers / proxies
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.json({
        status: 'online',
        version: snapshot.server.version,
        build: git || undefined,
        buildTime: buildTime || undefined,
        uptime: snapshot.server.uptime,
        startTime: snapshot.server.startTime,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Status error:', error);
      res.status(500).json({
        error: 'Failed to get server status',
      });
    }
  });

  /**
   * GET /api/health - Health check endpoint
   */
  router.get('/health', (_req: Request, res: Response) => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();
      const memUsage = snapshot.server.memoryUsage;
      // Thresholds (configurable via runtime configuration)
      const healthConfig = getRuntimeConfig().metrics.health;
      const memoryThreshold = healthConfig.memoryThreshold;
      const errorRateThreshold = healthConfig.errorRateThreshold;
      const minUptimeMs = healthConfig.minUptimeMs;

      // Simple health indicators (boolean flags)
      // Use V8 heap_size_limit (not heapTotal) for memory ratio -- V8 keeps
      // heapTotal only slightly above heapUsed, so heapUsed/heapTotal is
      // almost always >85% and would false-alarm on default thresholds.
      const heapLimit = v8.getHeapStatistics().heap_size_limit || memUsage.heapTotal;
      const isHealthy = {
        uptime: snapshot.server.uptime >= minUptimeMs,
        memory: (memUsage.heapUsed / Math.max(1, heapLimit)) < memoryThreshold,
        errors: snapshot.performance.errorRate < errorRateThreshold,
      } as const;

      const failingChecks = Object.entries(isHealthy)
        .filter(([, ok]) => !ok)
        .map(([k]) => k);

      const overallHealth = failingChecks.length === 0;

      res.status(overallHealth ? 200 : 503).json({
        status: overallHealth ? 'healthy' : 'degraded',
        checks: isHealthy,
        failingChecks,
        thresholds: {
          memoryRatio: memoryThreshold,
          errorRatePercent: errorRateThreshold,
          minUptimeMs
        },
        metrics: {
          uptimeMs: snapshot.server.uptime,
          memory: {
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            heapLimit: v8.getHeapStatistics().heap_size_limit,
            ratio: memUsage.heapTotal ? memUsage.heapUsed / (v8.getHeapStatistics().heap_size_limit || memUsage.heapTotal) : 0
          },
          errorRate: snapshot.performance.errorRate
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[API] Health check error:', error);
      res.status(500).json({
        status: 'error',
        error: 'Health check failed',
        timestamp: Date.now(),
      });
    }
  });

  /**
   * GET /api/system/health - Advanced system health metrics
   */
  router.get('/system/health', (_req: Request, res: Response) => {
    try {
      const systemHealth = metricsCollector.getSystemHealth();
      res.json({
        success: true,
        data: systemHealth,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] System health error:', error);
      res.status(500).json({
        error: 'Failed to get system health',
      });
    }
  });

  /**
   * GET /api/system/resources - CPU & memory sample history (for long-term monitoring UI)
   * query params: limit (number of most recent samples)
   */
  router.get('/system/resources', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
      const history = metricsCollector.getResourceHistory(limit);
      res.json({
        success: true,
        data: history,
        limit,
        sampleCount: history.samples.length,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[API] System resources error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system resource history',
      });
    }
  });

  return router;
}
