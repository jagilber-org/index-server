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
import { getCatalogSampler } from '../CatalogSampler.js';
import { getRuntimeConfig } from '../../../config/runtimeConfig.js';
import { logError } from '../../../services/logger.js';

// This project emits CommonJS, so `__filename` / `__dirname` are the portable
// way to ask "where does the code I am executing live?" (import.meta is
// unavailable under a CommonJS target).
const MODULE_PATH = __filename;
const MODULE_DIR = __dirname;

/**
 * Root of the *installation this code is actually running from*.
 *
 * Everything below resolves from here, never from `process.cwd()`. The server
 * is normally launched as `node <install>/dist/server/index-server.js` by an
 * MCP client whose working directory is some unrelated project folder, so
 * cwd-relative lookups silently found nothing (build time reported "unknown")
 * or, worse, found the *wrong* thing — `<cwd>/.git/HEAD` resolved to whatever
 * repo the client happened to be sitting in, so the dashboard displayed a
 * commit that had nothing to do with the running build.
 */
function findInstallRoot(): string | null {
  let dir = MODULE_DIR;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const INSTALL_ROOT = findInstallRoot();

/** Derive short git commit (best-effort; never throws) */
function getGitCommit(): string | null {
  try {
    if (!INSTALL_ROOT) return null;
    const gitDir = path.join(INSTALL_ROOT, '.git');
    const head = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(head)) {
      // Deployed copy has no .git — use the commit the deploy recorded.
      return getDeployManifestField('gitCommit');
    }
    let ref = fs.readFileSync(head, 'utf8').trim();
    if (ref.startsWith('ref:')) {
      const refPath = path.join(gitDir, ref.split(' ')[1]);
      if (fs.existsSync(refPath)) {
        ref = fs.readFileSync(refPath, 'utf8').trim();
      } else {
        // Packed refs (fresh clone / worktree) — fall back to the manifest.
        return getDeployManifestField('gitCommit');
      }
    }
    return ref.substring(0, 12);
  } catch { return null; }
}

/**
 * Build time, resolved install-relative. Tries, in order: the compiled entry
 * point's mtime, the deploy manifest's timestamp, and finally this module's own
 * mtime — the last of which always exists, so this never returns null in a
 * running server.
 */
function getBuildTime(): string | null {
  const candidates = INSTALL_ROOT
    ? [path.join(INSTALL_ROOT, 'dist', 'server', 'index-server.js')]
    : [];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return new Date(fs.statSync(candidate).mtimeMs).toISOString();
      }
    } catch {/* ignore */}
  }
  const deployed = getDeployManifestField('deployedAt');
  if (deployed) return deployed;
  try {
    // Last resort: the file you are reading right now. Always present.
    return new Date(fs.statSync(MODULE_PATH).mtimeMs).toISOString();
  } catch {/* ignore */}
  return null;
}

/** Read a top-level field from deployment-manifest.json (written by deploy-local.ps1) */
function getDeployManifestField(field: string): string | null {
  try {
    if (!INSTALL_ROOT) return null;
    const manifestPath = path.join(INSTALL_ROOT, 'deployment-manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const value = manifest?.[field];
      // Deploy writes placeholders like '<no-git-dir>' when it cannot resolve
      // a value; those are absence, not data.
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
        features: {
          messaging: cfg.messaging.enabled !== false,
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
        // explorer.exe only understands backslash-separated paths. Config values
        // may contain forward slashes (e.g. from env vars or JSON), which cause
        // Explorer to silently open the default folder instead of the target.
        cmd = 'explorer.exe';
        args = [toOpen.replace(/\//g, '\\')];
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
      // Reject a non-numeric `since` instead of letting NaN through. Downstream
      // the predicate is `ts >= ?`, and `ts >= NaN` is false for every row, so
      // `?since=garbage` would return an EMPTY series with `success: true` —
      // a silent wrong answer that reads as "no data in this window" rather
      // than as a bad request.
      let since: number | undefined;
      if (req.query.since !== undefined) {
        const parsed = parseInt(req.query.since as string, 10);
        if (!Number.isFinite(parsed)) {
          return res.status(400).json({
            success: false,
            error: `Invalid 'since': expected an epoch-millisecond integer, got ${JSON.stringify(req.query.since)}`,
          });
        }
        since = parsed;
      }
      const history = metricsCollector.getResourceHistory(limit);
      const catalogSampler = getCatalogSampler();

      // Catalog history is the sampled series — real observations at real
      // wall-clock times.
      //
      // This replaces a synthesized `indexTimeline` that sorted entries by
      // createdAt and cumulatively summed each entry's *current* usage and
      // signal state. That plotted today's state against entry birth dates: a
      // signal recorded last week appeared at the entry's creation date months
      // earlier, the x-axis was entry rank rather than time, and the first few
      // points had denominators of 1-3 so the leading edge was pinned to 0% or
      // 100%. Every slope on it was an artifact of when entries were created.
      const catalogHistory = catalogSampler?.getDurableHistory(limit, since) ?? [];

      res.json({
        success: true,
        data: history,
        catalogHistory,
        limit,
        sampleCount: history.samples.length,
        catalogSampleCount: catalogHistory.length,
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
