/**
 * Dashboard Integration Tests - Phase 1
 *
 * Tests for the enhanced dashboard server infrastructure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MetricsCollector } from '../dashboard/server/MetricsCollector.js';
import { WebSocketManager } from '../dashboard/server/WebSocketManager.js';
import { createDashboardServer, DashboardServer } from '../dashboard/server/DashboardServer.js';

describe('Phase 1 Dashboard Infrastructure', () => {
  describe('MetricsCollector', () => {
    let collector: MetricsCollector;

    beforeEach(() => {
      collector = new MetricsCollector({
        retentionMinutes: 1,
        maxSnapshots: 10,
        collectInterval: 100, // 100ms for faster tests
      });
    });

    afterEach(() => {
      collector.stop();
    });

    it('should initialize with default metrics', () => {
      const snapshot = collector.getCurrentSnapshot();

      expect(snapshot).toBeDefined();
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.server.version).toBeDefined();
      expect(snapshot.tools).toBeDefined();
      expect(snapshot.connections).toBeDefined();
      expect(snapshot.performance).toBeDefined();
    });

    it('should record tool calls correctly', () => {
      collector.recordToolCall('test/tool', true, 150);
      collector.recordToolCall('test/tool', false, 250, 'timeout');

      const metrics = collector.getToolMetrics('test/tool') as import('../dashboard/server/MetricsCollector.js').ToolMetrics;
      expect(metrics).toBeDefined();
      expect(metrics.callCount).toBe(2);
      expect(metrics.successCount).toBe(1);
      expect(metrics.errorCount).toBe(1);
      expect(metrics.totalResponseTime).toBe(400);
      expect(metrics.errorTypes['timeout']).toBe(1);
    });

    it('should track client connections', () => {
      collector.recordConnection('client-1');
      collector.recordConnection('client-2');

      let snapshot = collector.getCurrentSnapshot();
      expect(snapshot.connections.activeConnections).toBe(2);
      expect(snapshot.connections.totalConnections).toBe(2);

      collector.recordDisconnection('client-1');
      snapshot = collector.getCurrentSnapshot();
      expect(snapshot.connections.activeConnections).toBe(1);
      expect(snapshot.connections.disconnectedConnections).toBe(1);
    });

    it('should calculate performance metrics', () => {
      // Record some test data
      collector.recordToolCall('tool1', true, 100);
      collector.recordToolCall('tool1', true, 200);
      collector.recordToolCall('tool2', false, 300, 'error');

      const snapshot = collector.getCurrentSnapshot();

      expect(snapshot.performance.avgResponseTime).toBe(200); // (100+200+300)/3
      expect(snapshot.performance.successRate).toBeCloseTo(66.67, 1); // 2/3 * 100
      expect(snapshot.performance.errorRate).toBeCloseTo(33.33, 1); // 1/3 * 100
    });

    it('should clear metrics when requested', () => {
      collector.recordToolCall('test/tool', true, 100);
      collector.recordConnection('client-1');

      let snapshot = collector.getCurrentSnapshot();
      expect(Object.keys(snapshot.tools)).toHaveLength(1);
      expect(snapshot.connections.activeConnections).toBe(1);

      collector.clearMetrics();
      snapshot = collector.getCurrentSnapshot();
      expect(Object.keys(snapshot.tools)).toHaveLength(0);
      expect(snapshot.connections.activeConnections).toBe(0);
    });
  });

  describe('WebSocketManager', () => {
    let wsManager: WebSocketManager;

    beforeEach(() => {
      wsManager = new WebSocketManager({
        path: '/test-ws',
        maxConnections: 5,
        pingInterval: 1000,
      });
    });

    afterEach(() => {
      wsManager.close();
    });

    it('should initialize with correct options', () => {
      expect(wsManager).toBeDefined();
      expect(wsManager.getClientCount()).toBe(0);
      expect(wsManager.getClients()).toHaveLength(0);
    });

    it('should broadcast messages', () => {
      // Since we can't easily test actual WebSocket connections in unit tests,
      // we test that the broadcast method doesn't throw errors
      expect(() => {
        wsManager.broadcast({
          type: 'metrics_update',
          timestamp: Date.now(),
          data: {
            timestamp: Date.now(),
            server: {
              uptime: 1000,
              version: '1.0.0',
              memoryUsage: process.memoryUsage(),
              startTime: Date.now() - 1000,
            },
            tools: {},
            connections: {
              activeConnections: 0,
              totalConnections: 0,
              disconnectedConnections: 0,
              avgSessionDuration: 0,
            },
            performance: {
              requestsPerMinute: 0,
              successRate: 100,
              avgResponseTime: 0,
              errorRate: 0,
            },
          },
        });
      }).not.toThrow();
    });
  });

  describe('DashboardServer', () => {
    let server: DashboardServer;

    beforeEach(() => {
      server = createDashboardServer({
        port: 0, // Use ephemeral port for testing
        host: '127.0.0.1',
        enableWebSockets: false, // Disable for unit tests
        maxPortTries: 3,
      });
    });

    afterEach(() => {
      server.stop();
    });

    it('should initialize with correct options', () => {
      expect(server).toBeDefined();
      expect(server.getServerInfo()).toBeNull(); // Not started yet
    });

    it('should start and stop successfully', async () => {
      const result = await server.start();

      expect(result).toBeDefined();
      expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(result.port).toBeGreaterThan(0);
      expect(typeof result.close).toBe('function');

      const serverInfo = server.getServerInfo();
      expect(serverInfo).toBeDefined();
      expect(serverInfo!.port).toBe(result.port);
      expect(serverInfo!.host).toBe('127.0.0.1');

      server.stop();

      // After stopping, server info should be null
      expect(server.getServerInfo()).toBeNull();
    }, 10000); // Longer timeout for server operations

    it('should handle port conflicts gracefully', async () => {
      // Start first server
      const server1 = createDashboardServer({
        port: 8900, // Fixed port
        host: '127.0.0.1',
        enableWebSockets: false,
        maxPortTries: 3,
      });

      const result1 = await server1.start();
      expect(result1.port).toBe(8900);

      // Start second server on same port - should auto-increment
      const server2 = createDashboardServer({
        port: 8900, // Same port
        host: '127.0.0.1',
        enableWebSockets: false,
        maxPortTries: 3,
      });

      const result2 = await server2.start();
      expect(result2.port).toBe(8901); // Should be incremented

      server1.stop();
      server2.stop();
    }, 15000);
  });
});
