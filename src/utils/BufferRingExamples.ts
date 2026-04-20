/**
 * BufferRing Usage Examples
 *
 * This file demonstrates various use cases for the configurable BufferRing utility,
 * particularly for log management, metrics collection, and event handling in the
 * Index Server.
 */

import { BufferRing, BufferRingFactory, OverflowStrategy } from './BufferRing';
import path from 'path';

// Example 1: Log Buffer for Real-time Log Viewer
export function createLogViewerBuffer(logDir: string) {
  const logBuffer = BufferRingFactory.createLogBuffer(
    1000, // Keep last 1000 log entries
    path.join(logDir, 'log-buffer.json')
  );

  // Event handling for log monitoring
  logBuffer.on('entry-added', (logEntry: string) => {
    // Could trigger WebSocket broadcast to connected clients
    console.log(`New log entry: ${logEntry.slice(0, 100)}...`);
  });

  logBuffer.on('buffer-full', () => {
    console.log('Log buffer is full, oldest entries will be dropped');
  });

  return logBuffer;
}

// Example 2: Metrics Collection with Periodic Persistence
export function createMetricsCollector(dataDir: string) {
  const metricsBuffer = BufferRingFactory.createMetricsBuffer(
    500,
    path.join(dataDir, 'metrics-buffer.json')
  );

  // Periodic persistence every 30 seconds
  setInterval(async () => {
    try {
      await metricsBuffer.saveToDisk();
      console.log(`Persisted ${metricsBuffer.getStats().count} metrics entries`);
    } catch (error) {
      console.error('Failed to persist metrics:', error);
    }
  }, 30000);

  return metricsBuffer;
}

// Example 3: Event Buffer for System Events
export function createEventTracker() {
  const eventBuffer = BufferRingFactory.createEventBuffer(200);

  // Track various system events
  eventBuffer.on('entry-added', (event: Record<string, unknown>) => {
    if (event.level === 'error') {
      console.error('System error event:', event);
    }
  });

  return eventBuffer;
}

// Example 4: Custom Tool Metrics Buffer with Memory Management
export function createToolMetricsBuffer() {
  const toolMetrics = new BufferRing<{
    toolName: string;
    duration: number;
    timestamp: string;
    success: boolean;
  }>({
    capacity: 1000,
    overflowStrategy: OverflowStrategy.DROP_OLDEST,
    autoPersist: false,
    enableIntegrityCheck: false,
    serializer: (entry) => {
      const typedEntry = entry as { timestamp?: string };
      return {
        ...entry,
        timestamp: typedEntry.timestamp || new Date().toISOString()
      };
    }
  });

  // Memory cleanup when buffer gets large
  toolMetrics.on('buffer-full', () => {
    // Keep only successful calls from last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentSuccessful = toolMetrics.filter((entry: { success: boolean; timestamp: string }) =>
      entry.success && entry.timestamp > oneHourAgo
    );

    toolMetrics.clear();
    recentSuccessful.forEach(entry => toolMetrics.add(entry));

    console.log(`Cleaned tool metrics buffer, retained ${recentSuccessful.length} entries`);
  });

  return toolMetrics;
}

// Example 5: Configuration-Driven Buffer Creation
export interface BufferConfig {
  type: 'log' | 'metrics' | 'events' | 'custom';
  capacity: number;
  persistPath?: string;
  overflowStrategy?: OverflowStrategy;
  autoPersist?: boolean;
}

export function createConfiguredBuffer(config: BufferConfig): BufferRing<unknown> {
  switch (config.type) {
    case 'log':
      return BufferRingFactory.createLogBuffer(config.capacity, config.persistPath) as BufferRing<unknown>;

    case 'metrics':
      return BufferRingFactory.createMetricsBuffer(config.capacity, config.persistPath) as BufferRing<unknown>;

    case 'events':
      return BufferRingFactory.createEventBuffer(config.capacity) as BufferRing<unknown>;

    case 'custom':
      return new BufferRing<unknown>({
        capacity: config.capacity,
        persistPath: config.persistPath,
        overflowStrategy: config.overflowStrategy || OverflowStrategy.DROP_OLDEST,
        autoPersist: config.autoPersist || false,
        enableIntegrityCheck: !!config.persistPath
      });

    default:
      throw new Error(`Unknown buffer type: ${config.type}`);
  }
}

// Example 6: Integration with Log Viewer API
export class LogViewerService {
  private logBuffer: BufferRing<string>;

  constructor(logDir: string) {
    this.logBuffer = createLogViewerBuffer(logDir);
  }

  addLogEntry(logLine: string): void {
    this.logBuffer.add(logLine);
  }

  getRecentLogs(count = 100): string[] {
    return this.logBuffer.getLast(count);
  }

  getLogRange(start: number, end: number): string[] {
    return this.logBuffer.getRange(start, end);
  }

  searchLogs(pattern: string): string[] {
    const regex = new RegExp(pattern, 'i');
    return this.logBuffer.filter((line: string) => regex.test(line));
  }

  getLogStats() {
    const stats = this.logBuffer.getStats();
    return {
      totalLines: stats.count,
      bufferUtilization: stats.utilization,
      memoryUsage: stats.memoryUsage,
      totalProcessed: stats.totalAdded,
      droppedLines: stats.totalDropped
    };
  }

  clearLogs(): void {
    this.logBuffer.clear();
  }

  async persistLogs(): Promise<void> {
    await this.logBuffer.saveToDisk();
  }
}

// Example 7: Real-time Log Streaming with Buffer
export class LogStreamer {
  private logBuffer: BufferRing<string>;
  private subscribers: Set<(log: string) => void> = new Set();

  constructor(bufferSize = 500) {
    this.logBuffer = new BufferRing<string>({
      capacity: bufferSize,
      overflowStrategy: OverflowStrategy.DROP_OLDEST
    });

    // Broadcast new entries to all subscribers
    this.logBuffer.on('entry-added', (logEntry: string) => {
      this.subscribers.forEach(callback => {
        try {
          callback(logEntry);
        } catch (error) {
          console.error('Error in log subscriber:', error);
        }
      });
    });
  }

  addLog(logEntry: string): void {
    this.logBuffer.add(logEntry);
  }

  subscribe(callback: (log: string) => void): () => void {
    this.subscribers.add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  getBufferSnapshot(): string[] {
    return this.logBuffer.getAll();
  }

  getStats() {
    return {
      bufferStats: this.logBuffer.getStats(),
      subscriberCount: this.subscribers.size
    };
  }
}

export {
  BufferRing,
  BufferRingFactory,
  OverflowStrategy
};
