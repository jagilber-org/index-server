/**
 * ApiRoutes - Dashboard REST API Orchestrator
 *
 * Thin composition layer that mounts route modules from ./routes/ and applies
 * shared middleware (CORS, JSON parsing, HTTP metrics instrumentation, error
 * handling). Individual route handlers live in their own focused modules.
 */

import express, { Router, Request, Response } from 'express';
import expressRateLimit from 'express-rate-limit';
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
} from './routes/index.js';
import { ensureLoadedMiddleware } from './middleware/ensureLoadedMiddleware.js';

export interface ApiRoutesOptions {
  enableCors?: boolean;
  rateLimit?: {
    windowMs: number;
    max: number;
  };
}

export function createApiRoutes(options: ApiRoutesOptions = {}): Router {
  const router = Router();
  const metricsCollector = getMetricsCollector();
  const rateLimitOpts = options.rateLimit ?? { windowMs: 60_000, max: 100 };

  // CORS middleware (if enabled)
  // Security: only allow loopback origins (localhost, 127.0.0.1, [::1]) to prevent
  // cross-origin attacks. No wildcard (*) origins; credentials are not exposed.
  if (options.enableCors) {
    router.use((req: Request, res: Response, next: () => void) => {
      const origin = req.headers.origin;
      if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
      }
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });
  }

  // JSON middleware
  router.use(express.json());

  const rateLimitEnabled = getRuntimeConfig().dashboard.http.rateLimitEnabled;
  if (rateLimitEnabled && rateLimitOpts.max > 0 && rateLimitOpts.windowMs > 0) {
    router.use(expressRateLimit({
      windowMs: rateLimitOpts.windowMs,
      max: rateLimitOpts.max,
      standardHeaders: true,
      legacyHeaders: true,
      validate: { ip: false },
      skip: (req: Request) => req.method === 'OPTIONS',
      keyGenerator: (req: Request) => req.ip || req.socket.remoteAddress || 'unknown',
      handler: (_req: Request, res: Response) => {
        const retryAfter = Number(res.getHeader('Retry-After') || Math.ceil(rateLimitOpts.windowMs / 1000));
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

  // Error handling middleware
  router.use((error: Error, _req: Request, res: Response, _next: () => void) => {
    console.error('[API] Unhandled error:', error);
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
