import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MetricsCollector } from '../../dashboard/server/MetricsCollector.js';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';
import * as logger from '../../services/logger.js';

type CollectorInternals = {
  flushToolCallEvents(force: boolean): void;
  pendingAppendEvents: unknown[];
  _pendingToolPersist: number;
  toolCallEvents: {
    saveToDisk(): Promise<void>;
  };
};

const artifactRoot = path.join(process.cwd(), 'test-artifacts', 'metrics-collector-persistence');
const originalEnv = {
  INDEX_SERVER_METRICS_DIR: process.env.INDEX_SERVER_METRICS_DIR,
  INDEX_SERVER_METRICS_FILE_STORAGE: process.env.INDEX_SERVER_METRICS_FILE_STORAGE,
  INDEX_SERVER_TOOLCALL_APPEND_LOG: process.env.INDEX_SERVER_TOOLCALL_APPEND_LOG,
  INDEX_SERVER_TOOLCALL_CHUNK_SIZE: process.env.INDEX_SERVER_TOOLCALL_CHUNK_SIZE,
  INDEX_SERVER_TOOLCALL_FLUSH_MS: process.env.INDEX_SERVER_TOOLCALL_FLUSH_MS,
  INDEX_SERVER_TOOLCALL_COMPACT_MS: process.env.INDEX_SERVER_TOOLCALL_COMPACT_MS,
};

function applyMetricsEnv(metricsDir: string, appendLogEnabled: boolean): void {
  process.env.INDEX_SERVER_METRICS_DIR = metricsDir;
  process.env.INDEX_SERVER_METRICS_FILE_STORAGE = '1';
  process.env.INDEX_SERVER_TOOLCALL_APPEND_LOG = appendLogEnabled ? '1' : '0';
  process.env.INDEX_SERVER_TOOLCALL_CHUNK_SIZE = '1';
  process.env.INDEX_SERVER_TOOLCALL_FLUSH_MS = '1';
  process.env.INDEX_SERVER_TOOLCALL_COMPACT_MS = '600000';
  reloadRuntimeConfig();
}

async function waitForAsyncPersistence(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 75));
}

describe('MetricsCollector persistence reliability', () => {
  let collector: MetricsCollector | undefined;
  let metricsDir: string;

  beforeEach(() => {
    metricsDir = path.join(artifactRoot, `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(metricsDir, { recursive: true });
  });

  afterEach(async () => {
    collector?.stop();
    await waitForAsyncPersistence();
    collector = undefined;
    vi.restoreAllMocks();

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    reloadRuntimeConfig();

    fs.rmSync(metricsDir, { recursive: true, force: true });
  });

  it('requeues append-log writes and reports recovery after persistence resumes', async () => {
    applyMetricsEnv(metricsDir, true);

    const warnSpy = vi.spyOn(logger, 'logWarn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(logger, 'logInfo').mockImplementation(() => undefined);
    vi.spyOn(logger, 'logError').mockImplementation(() => undefined);
    const realAppendFile = fs.promises.appendFile.bind(fs.promises);
    let appendCalls = 0;
    vi.spyOn(fs.promises, 'appendFile').mockImplementation(async (...args) => {
      appendCalls += 1;
      if (appendCalls === 1) {
        throw new Error('append failed');
      }
      return realAppendFile(...args);
    });

    collector = new MetricsCollector({ collectInterval: 60_000 });
    collector.stop();

    collector.recordToolCall('first-tool', true, 10);
    await waitForAsyncPersistence();

    const afterFailure = collector.getPersistenceHealth();
    expect(afterFailure.degraded).toBe(true);
    expect(afterFailure.totalFailures).toBe(1);
    expect(afterFailure.appendFailures).toBe(1);
    expect(afterFailure.lastError).toContain('append failed');
    expect((collector as unknown as CollectorInternals).pendingAppendEvents).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[MetricsCollector] Metrics persistence degraded; in-memory buffers will retry writes',
      expect.objectContaining({
        operation: 'append',
        totalFailures: 1,
      })
    );

    collector.recordToolCall('second-tool', true, 15);
    await waitForAsyncPersistence();

    const afterRecovery = collector.getPersistenceHealth();
    expect(afterRecovery.degraded).toBe(false);
    expect(afterRecovery.lastRecoveredAt).toEqual(expect.any(Number));
    expect((collector as unknown as CollectorInternals).pendingAppendEvents).toHaveLength(0);
    expect(appendCalls).toBeGreaterThanOrEqual(2);
    expect(infoSpy).toHaveBeenCalledWith(
      '[MetricsCollector] Metrics persistence recovered',
      expect.objectContaining({
        operation: 'append',
        totalFailures: 1,
      })
    );

    const snapshotPath = path.join(metricsDir, 'tool-call-events.json');
    const persisted = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as {
      entries: Array<{ toolName: string }>;
    };
    expect(persisted.entries.map(entry => entry.toolName)).toEqual(['first-tool', 'second-tool']);
  });

  it('surfaces snapshot persistence failures via storage stats and system health until retry succeeds', async () => {
    applyMetricsEnv(metricsDir, false);

    const warnSpy = vi.spyOn(logger, 'logWarn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(logger, 'logInfo').mockImplementation(() => undefined);
    vi.spyOn(logger, 'logError').mockImplementation(() => undefined);

    collector = new MetricsCollector({ collectInterval: 60_000 });
    collector.stop();

    const internals = collector as unknown as CollectorInternals;
    const saveSpy = vi.spyOn(internals.toolCallEvents, 'saveToDisk').mockRejectedValueOnce(new Error('snapshot failed'));

    collector.recordToolCall('snapshot-tool', true, 20);
    await waitForAsyncPersistence();

    const storageStatsAfterFailure = await collector.getStorageStats();
    expect(storageStatsAfterFailure.persistence.degraded).toBe(true);
    expect(storageStatsAfterFailure.persistence.snapshotFailures).toBe(1);
    expect(storageStatsAfterFailure.persistence.lastError).toContain('snapshot failed');
    expect(internals._pendingToolPersist).toBeGreaterThan(0);
    expect(collector.getSystemHealth().status).toBe('warning');
    expect(warnSpy).toHaveBeenCalledWith(
      '[MetricsCollector] Metrics persistence degraded; in-memory buffers will retry writes',
      expect.objectContaining({
        operation: 'snapshot',
        totalFailures: 1,
      })
    );

    saveSpy.mockRestore();

    internals.flushToolCallEvents(true);
    await waitForAsyncPersistence();

    const storageStatsAfterRecovery = await collector.getStorageStats();
    expect(storageStatsAfterRecovery.persistence.degraded).toBe(false);
    expect(storageStatsAfterRecovery.persistence.lastRecoveredAt).toEqual(expect.any(Number));
    expect(internals._pendingToolPersist).toBe(0);
    expect(infoSpy).toHaveBeenCalledWith(
      '[MetricsCollector] Metrics persistence recovered',
      expect.objectContaining({
        operation: 'snapshot',
        totalFailures: 1,
      })
    );
  });
});
