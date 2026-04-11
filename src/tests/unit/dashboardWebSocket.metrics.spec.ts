/**
 * Dashboard WebSocket Metrics Broadcast Integration Test
 *
 * Validates that the dashboard periodically broadcasts `metrics_update` messages
 * over WebSocket and that the payload structure matches expectations.
 */

import { describe, it, expect } from 'vitest';
import { createDashboardServer, DashboardServer } from '../../dashboard/server/DashboardServer.js';
import WebSocket from 'ws';

// Helper: wait for a single metrics_update message
function waitForMetricsMessage(ws: WebSocket, timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Did not receive metrics_update within ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg && msg.type === 'metrics_update' && msg.data) {
          clearTimeout(timeout);
          resolve(msg);
        }
      } catch {
        /* ignore non-JSON */
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

describe('Dashboard WebSocket metrics_update broadcast (P1)', () => {
  it('broadcasts periodic metrics_update messages with expected shape', async () => {
    let server: DashboardServer | null = null;
    let close: (() => void) | null = null;

    try {
      server = createDashboardServer({
        host: '127.0.0.1',
        port: 0,
        maxPortTries: 3,
        enableWebSockets: true,
        metricsBroadcastIntervalMs: 200, // fast interval for test
      });
      const started = await server.start();
      close = started.close;

      const info = server.getServerInfo();
      expect(info).not.toBeNull();
      const wsUrl = `ws://${info!.host}:${info!.port}/ws`;

      const ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('WebSocket open timeout')), 2000);
        ws.on('open', () => { clearTimeout(to); resolve(); });
        ws.on('error', (e) => { clearTimeout(to); reject(e); });
      });

      const msg: any = await waitForMetricsMessage(ws, 5000);
      expect(msg.type).toBe('metrics_update');
      expect(typeof msg.timestamp).toBe('number');
      expect(msg.data).toBeDefined();

      // Basic structural assertions
      const data = msg.data;
      expect(data).toHaveProperty('server');
      expect(data).toHaveProperty('performance');
      expect(data).toHaveProperty('connections');
      expect(data.performance).toHaveProperty('requestsPerMinute');
      expect(data.performance).toHaveProperty('successRate');
      expect(data.performance).toHaveProperty('avgResponseTime');
      expect(data.performance).toHaveProperty('errorRate');

      // Reasonable numeric types
      expect(typeof data.performance.requestsPerMinute).toBe('number');
      expect(typeof data.performance.successRate).toBe('number');
      expect(typeof data.performance.avgResponseTime).toBe('number');
      expect(typeof data.performance.errorRate).toBe('number');

      ws.close();
    } finally {
      try { close && close(); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 50));
    }
  }, 15000);
});
