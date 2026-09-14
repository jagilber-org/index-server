/**
 * httpLifecycle — HTTP/HTTPS server creation, port binding, and graceful shutdown.
 * Extracted from DashboardServer.ts to keep the coordinator within line limits.
 */

import { Express } from 'express';
import { Server as HttpServer, createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { logInfo, logWarn } from '../../services/logger.js';

export interface TlsOptions {
  cert: string;
  key: string;
  ca?: string;
}

/** Creates an HTTP or HTTPS server wrapping the given Express app. */
export function buildHttpServer(app: Express, tls?: TlsOptions): HttpServer {
  if (tls) {
    return createHttpsServer(
      { cert: tls.cert, key: tls.key, ca: tls.ca },
      app,
    ) as unknown as HttpServer;
  }
  return createServer(app);
}

/** Wraps `server.listen` in a promise; rejects on EADDRINUSE or any other error. */
export function bindToPort(server: HttpServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on('error', reject);
  });
}

/**
 * Stop accepting connections and wait briefly for active requests to finish.
 * Idle sockets are closed immediately; stalled connections are terminated after
 * the grace period so shutdown cannot wait forever on a half-open client.
 */
export function closeHttpServer(server: HttpServer, gracePeriodMs = 1_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      logInfo('[httpLifecycle] Server stopped');
      resolve();
    };

    try {
      server.close(finish);
      server.closeIdleConnections();
      if (settled) return;
      forceTimer = setTimeout(() => {
        logWarn('[httpLifecycle] Graceful shutdown timed out; closing active connections', { gracePeriodMs });
        server.closeAllConnections();
        finish();
      }, Math.max(0, gracePeriodMs));
    } catch {
      finish();
    }
  });
}
