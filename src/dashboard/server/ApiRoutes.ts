/**
 * ApiRoutes - Dashboard REST API Orchestrator
 *
 * Thin composition layer that mounts route modules from ./routes/ and applies
 * shared middleware (CORS, JSON parsing, HTTP metrics instrumentation, error
 * handling). Individual route handlers live in their own focused modules.
 */

import express, { Router, Request, Response } from 'express';
import expressRateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { getMetricsCollector } from './MetricsCollector.js';
import { logHttpAudit } from '../../services/auditLog';
import { getRuntimeConfig } from '../../config/runtimeConfig.js';
import {
  createStatusRoutes,
  createMetricsRoutes,
  createAdminRoutes,
  createGraphRoutes,
  createInstructionsRoutes,
  createKnowledgeRoutes,
  createAlertsRoutes,
  createLogsRoutes,
  createSyntheticRoutes,
  createInstancesRoutes,
  createToolsRoutes,
  createEmbeddingsRoutes,
  createUsageRoutes,
  createScriptsRoutes,
  createMessagingRoutes,
  createSqliteRoutes,
  createAdminFeedbackRoutes,
} from './routes/index.js';
import { ensureLoadedMiddleware } from './middleware/ensureLoadedMiddleware.js';
import { logError } from '../../services/logger.js';

export interface ApiRoutesOptions {
  enableCors?: boolean;
  /**
   * Optional override for the rate-limit (requests per 60s window).
   * `0` disables. When omitted, falls back to `httpCfg.rateLimitPerMinute`.
   */
  rateLimitPerMinute?: number;
}

/**
 * Path prefixes whose endpoints are *unconditionally* exempt from the dashboard
 * HTTP rate limiter. These are bulk-shaped, operator-driven operations
 * (backup, restore, import/export, normalize) where the size of a single
 * request — not the *frequency* of requests — is the natural cost driver.
 *
 * Matching is done with `req.path.startsWith(prefix)` against the path *as
 * mounted on the /api router* (so prefixes do not include the leading "/api").
 *
 * Note: the MCP tool surface (index_import / index_export / promote_from_repo
 * / restore handlers) is already outside this HTTP limiter, so no entries are
 * needed for those.
 */
const BULK_EXEMPT_PREFIXES: readonly string[] = [
  '/admin/maintenance/normalize',
  '/admin/maintenance/backup',          // covers backup, backup/import, backup/:id, backup/:id/export
  '/admin/maintenance/backups',         // covers backups, backups/prune
  '/admin/maintenance/restore',
  '/charts/export',
  '/sqlite/backup',                     // covers /sqlite/backup and /sqlite/backups
  '/sqlite/restore',
  '/sqlite/export',
];

function isBulkExempt(reqPath: string): boolean {
  for (const prefix of BULK_EXEMPT_PREFIXES) {
    if (reqPath === prefix || reqPath.startsWith(prefix + '/')) return true;
  }
  return false;
}

export function createApiRoutes(options: ApiRoutesOptions = {}): Router {
  const router = Router();
  const metricsCollector = getMetricsCollector();
  const httpCfg = getRuntimeConfig().dashboard.http;
  const perMinute = options.rateLimitPerMinute ?? httpCfg.rateLimitPerMinute;

  // CORS middleware (if enabled)
  // Security: only allow loopback origins (localhost, 127.0.0.1, [::1]) to prevent
  // cross-origin attacks. No wildcard (*) origins; credentials are not exposed.
  if (options.enableCors) {
    router.use((req: Request, res: Response, next: () => void) => {
      const origin = req.headers.origin;
      // nosemgrep: javascript.express.security.cors-misconfiguration.cors-misconfiguration -- origin is validated against loopback-only regex; not user-controlled
      if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
        res.header('Access-Control-Allow-Origin', origin); // lgtm[js/cors-misconfiguration] — origin validated against loopback-only regex above
      }
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });
  }

  // JSON middleware
  router.use(express.json());

  // Rate limit (single tier, fixed 60s window). Disabled when perMinute === 0.
  // Bulk routes (backup/restore/import/export/normalize) are unconditionally
  // exempt via BULK_EXEMPT_PREFIXES — see `skip` below.
  if (perMinute > 0) {
    const windowMs = 60_000;
    router.use(expressRateLimit({
      windowMs,
      max: perMinute,
      standardHeaders: true,
      legacyHeaders: true,
      validate: { ip: false },
      skip: (req: Request) => req.method === 'OPTIONS' || isBulkExempt(req.path),
      keyGenerator: (req: Request) => {
        const clientIp = req.ip || req.socket.remoteAddress;
        return clientIp ? ipKeyGenerator(clientIp) : 'unknown';
      },
      handler: (_req: Request, res: Response) => {
        const retryAfter = Number(res.getHeader('Retry-After') || Math.ceil(windowMs / 1000));
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${retryAfter} second(s).`,
          retryAfterSeconds: retryAfter,
          timestamp: Date.now(),
        });
      },
    }));
  }

  // --- HTTP Metrics Instrumentation ---------------------------------------
  try {
    const enableHttpMetrics = getRuntimeConfig().dashboard.http.enableHttpMetrics;
    if (enableHttpMetrics) {
      const normalizeRoute = (req: Request): string => {
        if (req.route?.path) return req.route.path;
        return req.path
          .replace(/\/[0-9a-f]{8,}/gi, '/:id')
          .replace(/\/\d+/g, '/:id');
      };
      router.use((req: Request, res: Response, next: () => void) => {
        const startNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
        res.on('finish', () => {
          try {
            const endNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
            const ms = Number(endNs - startNs) / 1_000_000;
            const success = res.statusCode < 500;
            const route = normalizeRoute(req);
            const toolId = `http/${req.method} ${route}`;
            metricsCollector.recordToolCall(toolId, success, ms, success ? undefined : `http_${res.statusCode}`);
          } catch { /* never block response path */ }
        });
        next();
      });
    }
  } catch { /* ignore instrumentation failures */ }
  // -------------------------------------------------------------------------

  // --- HTTP Audit Logging -------------------------------------------------
  // Logs every HTTP request to the audit trail with client IP, method, route,
  // status code, and duration. Fires on response finish (non-blocking).
  router.use((req: Request, res: Response, next: () => void) => {
    const startNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
    res.on('finish', () => {
      try {
        const endNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
        const ms = Number(endNs - startNs) / 1_000_000;
        const route = req.route?.path ?? req.path;
        const clientIp = req.ip || req.socket?.remoteAddress;
        const userAgent = req.get('user-agent');
        logHttpAudit(req.method, route, res.statusCode, ms, clientIp, userAgent);
      } catch { /* never block response path */ }
    });
    next();
  });

  // Cache-control: API responses should not be cached (pen test I2 fix)
  router.use((_req: Request, res: Response, next: () => void) => {
    res.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.header('Pragma', 'no-cache');
    next();
  });
  // -------------------------------------------------------------------------

  // Pre-load instruction index once per request so route handlers can use
  // res.locals.indexState instead of calling ensureLoaded() repeatedly.
  // See: https://github.com/jagilber-dev/index-server/issues/45
  router.use(ensureLoadedMiddleware);

  // Mount route modules
  router.use(createStatusRoutes(metricsCollector));
  router.use(createMetricsRoutes(metricsCollector));
  router.use(createAdminRoutes(metricsCollector));
  router.use(createGraphRoutes());
  router.use(createInstructionsRoutes());
  router.use(createKnowledgeRoutes());
  router.use(createAlertsRoutes(metricsCollector));
  router.use(createLogsRoutes());
  router.use(createSyntheticRoutes(metricsCollector));
  router.use(createInstancesRoutes());
  router.use(createToolsRoutes());
  router.use(createEmbeddingsRoutes());
  router.use(createUsageRoutes());
  router.use(createScriptsRoutes());
  router.use(createMessagingRoutes());
  router.use(createSqliteRoutes());
  router.use(createAdminFeedbackRoutes());

  // Error handling middleware
  router.use((error: Error, _req: Request, res: Response, _next: () => void) => {
    logError('[API] Unhandled error:', error);
    const exposeDetails = getRuntimeConfig().dashboard.http.verboseLogging;
    res.status(500).json({
      error: 'Internal server error',
      message: exposeDetails ? error.message : 'An unexpected error occurred.',
      timestamp: Date.now(),
    });
  });

  return router;
}

export default createApiRoutes;
