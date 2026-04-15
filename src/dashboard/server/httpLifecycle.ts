/**
 * httpLifecycle — HTTP/HTTPS server creation, port binding, and graceful shutdown.
 * Extracted from DashboardServer.ts to keep the coordinator within line limits.
 */

import { Express } from 'express';
import { Server as HttpServer, createServer } from 'http';
import { createServer as createHttpsServer } from 'https';

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

/** Wraps `server.close` in a promise for graceful shutdown. */
export function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('[Dashboard] Server stopped');
      resolve();
    });
  });
}
