/**
 * wsInit — WebSocket server initialization and metrics broadcast wiring.
 * Extracted from DashboardServer.ts to keep the coordinator within line limits.
 */

import { Server as HttpServer } from 'http';
import { WebSocketManager } from './WebSocketManager.js';
import { MetricsCollector } from './MetricsCollector.js';

/** Attaches the WebSocket server to an existing HTTP/HTTPS server instance. */
export function initWebSocket(server: HttpServer, wsManager: WebSocketManager): void {
  wsManager.initialize(server);
}

/**
 * Starts a recurring timer that broadcasts the full metrics snapshot to all
 * connected WebSocket clients. Returns the timer handle so the caller can clear it.
 *
 * A lower-bound of 250 ms is enforced regardless of the configured interval.
 */
export function startMetricsBroadcast(
  wsManager: WebSocketManager,
  metricsCollector: MetricsCollector,
  intervalMs: number,
): NodeJS.Timeout {
  const safeInterval = Math.max(250, intervalMs);

  return setInterval(() => {
    try {
      const snapshot = metricsCollector.getCurrentSnapshot();
      wsManager.broadcast({
        type: 'metrics_update',
        timestamp: Date.now(),
        data: snapshot,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[Dashboard] metrics broadcast failed', e);
    }
  }, safeInterval);
}
