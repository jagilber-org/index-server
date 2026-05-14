/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable */
/**
 * DashboardServer - Enhanced Phase 2 Dashboard with Real-time Features
 *
 * Coordinator class that wires together:
 *  - Express middleware and routes (via mountDashboardRoutes)
 *  - HTTP/HTTPS server lifecycle (via httpLifecycle)
 *  - WebSocket initialization and metrics broadcast (via wsInit)
 */

import crypto from 'crypto';
import express, { Express } from 'express';
import { Server as HttpServer } from 'http';
import path from 'path';
import { getMetricsCollector } from './MetricsCollector.js';
import { getWebSocketManager } from './WebSocketManager.js';
import { buildHttpServer, bindToPort, closeHttpServer, TlsOptions } from './httpLifecycle.js';
import { initWebSocket, startMetricsBroadcast } from './wsInit.js';
import { mountDashboardRoutes } from './routes/index.js';
import { logInfo } from '../../services/logger.js';
import { applyOverlay } from '../../config/runtimeOverrides.js';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';

export interface DashboardServerOptions {
  host?: string;
  port?: number;
  maxPortTries?: number;
  enableWebSockets?: boolean;
  enableCors?: boolean;
  /** Interval (ms) for broadcasting metrics_update messages over WebSocket (default 5000). */
  metricsBroadcastIntervalMs?: number;
  /** TLS certificate and key for HTTPS. When provided the dashboard serves over HTTPS/WSS. */
  tls?: TlsOptions;
  /** Enable the Graph visualization tab (loads ~4.5MB of mermaid+elkjs). Default false. */
  graphEnabled?: boolean;
}

interface ServerInfo {
  port: number;
  host: string;
  url: string;
}

export class DashboardServer {
  private app: Express;
  private server: HttpServer | null = null;
  private metricsCollector = getMetricsCollector();
  private webSocketManager = getWebSocketManager();
  private metricsBroadcastTimer: NodeJS.Timeout | null = null;

  private options: Required<Omit<DashboardServerOptions, 'tls'>> & { tls?: TlsOptions };

  private get tlsEnabled(): boolean { return !!this.options.tls; }
  private get httpProtocol(): 'https' | 'http' { return this.tlsEnabled ? 'https' : 'http'; }
  private get wsProtocol(): 'wss' | 'ws' { return this.tlsEnabled ? 'wss' : 'ws'; }

  constructor(options: DashboardServerOptions = {}) {
    this.options = {
      host: options.host || '127.0.0.1',
      port: options.port ?? 8989,
      maxPortTries: options.maxPortTries || 10,
      enableWebSockets: options.enableWebSockets ?? true,
      enableCors: options.enableCors ?? true,
      metricsBroadcastIntervalMs: options.metricsBroadcastIntervalMs || 5000,
      tls: options.tls,
      graphEnabled: options.graphEnabled ?? false,
    };

    this.app = express();
    this.setupMiddleware();
    mountDashboardRoutes(this.app, {
      metricsCollector: this.metricsCollector,
      enableWebSockets: this.options.enableWebSockets,
      enableCors: this.options.enableCors,
      graphEnabled: this.options.graphEnabled,
      wsProtocol: this.wsProtocol,
      getServerInfo: () => this.getServerInfo(),
    });
  }

  async start(): Promise<{ url: string; port: number; close: () => void }> {
    // Apply the runtime overrides overlay before binding so the dashboard
    // surfaces the same `process.env` state that downstream consumers will see.
    // applyOverlay() captures the pre-overlay env snapshot needed for
    // `overlayShadowsEnv` on /api/admin/config. We follow with reloadRuntimeConfig()
    // so the cached singleton reflects the merged env state.
    try {
      applyOverlay();
      reloadRuntimeConfig();
    } catch (err) {
      logInfo(`[DashboardServer] applyOverlay/reload failed (continuing): ${(err as Error).message}`);
    }
    for (let attempt = 0; attempt < this.options.maxPortTries; attempt++) {
      const currentPort = this.options.port + attempt;
      try {
        this.server = buildHttpServer(this.app, this.options.tls);
        await bindToPort(this.server, currentPort, this.options.host);
        // When port:0 is requested the OS assigns a free port. Resolve the
        // actual bound port from the listening socket so the URL we return
        // (and the URL we log) reach the right place. Falling back to
        // currentPort keeps behavior identical for fixed-port callers.
        const addr = this.server.address();
        const actualPort = (addr && typeof addr === 'object' && typeof addr.port === 'number') ? addr.port : currentPort;
        logInfo(`[DashboardServer] Server started on ${this.httpProtocol}://${this.options.host}:${actualPort}`);

        if (this.options.enableWebSockets) {
          initWebSocket(this.server, this.webSocketManager);
          logInfo(`[DashboardServer] WebSocket support enabled on ${this.wsProtocol}://${this.options.host}:${actualPort}/ws`);
          this.metricsBroadcastTimer = startMetricsBroadcast(
            this.webSocketManager,
            this.metricsCollector,
            this.options.metricsBroadcastIntervalMs,
          );
        }

        return {
          url: `${this.httpProtocol}://${this.options.host}:${actualPort}/`,
          port: actualPort,
          close: () => this.stop(),
        };
      } catch (error) {
        if ((error as { code?: string })?.code === 'EADDRINUSE') {
          logInfo(`[DashboardServer] Port ${currentPort} in use, trying ${currentPort + 1}`);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Failed to start dashboard server after ${this.options.maxPortTries} attempts`);
  }

  async stop(): Promise<void> {
    if (this.server) {
      if (this.options.enableWebSockets) {
        this.webSocketManager.close();
        if (this.metricsBroadcastTimer) {
          clearInterval(this.metricsBroadcastTimer);
          this.metricsBroadcastTimer = null;
        }
      }
      await closeHttpServer(this.server);
    }
  }

  getServerInfo(): ServerInfo | null {
    if (!this.server?.listening) {
      return null;
    }

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      return null;
    }

    return {
      port: address.port,
      host: this.options.host,
      url: `${this.httpProtocol}://${this.options.host}:${address.port}`,
    };
  }

  private setupMiddleware(): void {
    if (this.options.enableCors) {
      // Security: only allow loopback origins (localhost, 127.0.0.1, [::1]).
      // No wildcard (*) origins; credentials are not exposed cross-origin.
      this.app.use((req, res, next) => {
        const origin = req.headers.origin;
        // nosemgrep: javascript.express.security.cors-misconfiguration.cors-misconfiguration -- origin is validated against loopback-only regex; not user-controlled
        if (origin && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
          res.header('Access-Control-Allow-Origin', origin); // lgtm[js/cors-misconfiguration] — origin validated against loopback-only regex above
        }
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

        if (req.method === 'OPTIONS') {
          res.sendStatus(200);
          return;
        }

        next();
      });
    }

    // Remove X-Powered-By (technology fingerprinting) and enforce strong ETags
    this.app.disable('x-powered-by');
    this.app.set('etag', 'strong');

    // Per-request CSP nonce + security headers
    this.app.use((_req, res, next) => {
      const nonce = crypto.randomBytes(16).toString('base64');
      res.locals.cspNonce = nonce;
      res.header('X-Content-Type-Options', 'nosniff');
      res.header('X-Frame-Options', 'DENY');
      res.header('X-XSS-Protection', '1; mode=block');
      res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.header(
        'Content-Security-Policy',
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' ${this.tlsEnabled ? 'wss:' : 'ws:'}; frame-ancestors 'none'; form-action 'self'`,
      );
      if (this.tlsEnabled) {
        res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
      next();
    });

    // Structured request logger — every dashboard HTTP hit lands in mcp-server.log.
    // Critical for diagnosing import/restore failures where stderr output is lost
    // when the MCP server runs under stdio transport without an attached TTY.
    this.app.use((req, res, next) => {
      const start = Date.now();
      const ctype = req.header('content-type') || '';
      const clen = req.header('content-length') || '';
      logInfo('[http] request', { method: req.method, url: req.originalUrl || req.url, ctype, clen });
      res.on('finish', () => {
        logInfo('[http] response', { method: req.method, url: req.originalUrl || req.url, status: res.statusCode, ms: Date.now() - start });
      });
      next();
    });

    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '..', 'client'), {
      etag: true,
      lastModified: true,
    }));
  }
}

export function createDashboardServer(options: DashboardServerOptions = {}): DashboardServer {
  return new DashboardServer(options);
}

export default createDashboardServer;
