/**
 * Status & Health Routes
 * Routes: GET /status, GET /health, GET /system/health, GET /system/resources
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import v8 from 'v8';
import { MetricsCollector } from '../MetricsCollector.js';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';
import { logError } from '../../../services/logger.js';

/** Derive short git commit (best-effort; never throws) */
function getGitCommit(): string | null {
  try {
    const head = path.join(process.cwd(), '.git', 'HEAD');
    if (!fs.existsSync(head)) {
      // Fallback: read from deployment-manifest.json (local deploy without .git)
      return getDeployManifestField('gitCommit');
    }
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
    // Fallback: read from deployment-manifest.json (local deploy)
    return getDeployManifestField('deployedAt');
  } catch {/* ignore */}
  return null;
}

/** Read a top-level field from deployment-manifest.json (written by deploy-local.ps1) */
function getDeployManifestField(field: string): string | null {
  try {
    const manifestPath = path.join(process.cwd(), 'deployment-manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const value = manifest?.[field];
      if (typeof value === 'string' && value && !value.startsWith('<')) return value.substring(0, 64);
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
      const cfg = getRuntimeConfig();

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
        paths: {
          instructionsDir: cfg.index.baseDir,
          storageBackend: cfg.storage.backend,
          sqlitePath: cfg.storage.backend === 'sqlite' ? cfg.storage.sqlitePath : undefined,
          backupsDir: cfg.dashboard.admin.backupsDir,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      logError('[API] Status error:', error);
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
      logError('[API] Health check error:', error);
      res.status(500).json({
        status: 'error',
        error: 'Health check failed',
        timestamp: Date.now(),
      });
    }
  });

  /**
   * POST /api/system/reveal-path - Open one of the configured paths in the OS
   * file manager. Accepts only a fixed allowlist key (instructions | sqlite |
   * backups) — the server resolves the actual path from runtime config so the
   * client cannot supply an arbitrary filesystem path.
   *
   * Loopback-only by virtue of the dashboard binding to 127.0.0.1.
   */
  router.post('/system/reveal-path', (req: Request, res: Response) => {
    try {
      const key = String((req.body && (req.body as Record<string, unknown>).key) || '');
      const cfg = getRuntimeConfig();
      let target: string | undefined;
      switch (key) {
        case 'instructions': target = cfg.index.baseDir; break;
        case 'sqlite':       target = cfg.storage.backend === 'sqlite' ? cfg.storage.sqlitePath : undefined; break;
        case 'backups':      target = cfg.dashboard.admin.backupsDir; break;
        default:
          return res.status(400).json({ success: false, error: `unknown key: ${key}` });
      }
      if (!target) {
        return res.status(404).json({ success: false, error: `path not configured for key: ${key}` });
      }
      // For files (e.g. sqlite db) reveal the parent directory instead of trying
      // to open the file itself in the file manager.
      let toOpen = target;
      try {
        if (fs.existsSync(target) && fs.statSync(target).isFile()) {
          toOpen = path.dirname(target);
        } else if (!fs.existsSync(target)) {
          // Fall back to the parent if the leaf does not exist yet.
          toOpen = path.dirname(target);
        }
      } catch { /* ignore stat errors, attempt original */ }

      // Platform-appropriate "open folder" command. All args are server-derived
      // from runtime config; no user input ever reaches the spawned argv.
      let cmd: string;
      let args: string[];
      if (process.platform === 'win32') {
        cmd = 'explorer.exe';
        args = [toOpen];
      } else if (process.platform === 'darwin') {
        cmd = 'open';
        args = [toOpen];
      } else {
        cmd = 'xdg-open';
        args = [toOpen];
      }
      // nosemgrep: javascript.lang.security.audit.detect-child-process.detect-child-process -- args resolved from server-side runtimeConfig allowlist; no user input
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on('error', () => { /* ignore — best-effort */ });
      child.unref();

      res.json({ success: true, key, path: toOpen, timestamp: Date.now() });
    } catch (error) {
      logError('[API] reveal-path error:', error);
      res.status(500).json({ success: false, error: 'Failed to reveal path' });
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
      logError('[API] System health error:', error);
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
      logError('[API] System resources error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system resource history',
      });
    }
  });

  return router;
}
