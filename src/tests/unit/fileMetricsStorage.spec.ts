import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { MetricsSnapshot } from '../../dashboard/server/MetricsCollector.js';
import { FileMetricsStorage } from '../../dashboard/server/FileMetricsStorage.js';
import * as logger from '../../services/logger.js';

type FileMetricsStorageInternals = {
  cleanupOldFiles(): Promise<void>;
};

const artifactRoot = path.join(process.cwd(), 'test-artifacts', 'file-metrics-storage');

function createSnapshot(timestamp: number): MetricsSnapshot {
  return {
    timestamp,
    server: {
      uptime: 1000,
      version: '1.0.0',
      memoryUsage: process.memoryUsage(),
      startTime: timestamp - 1000,
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
  };
}

describe('FileMetricsStorage cleanup reliability', () => {
  let storageDir: string;
  let storage: FileMetricsStorage;

  beforeEach(() => {
    storageDir = path.join(artifactRoot, `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(storageDir, { recursive: true });
    storage = new FileMetricsStorage({ storageDir, retentionMinutes: 1, maxFiles: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('logs deletion failures and exposes degraded cleanup health in storage stats', async () => {
    const now = Date.now();
    const expiredFile = path.join(storageDir, `metrics-${now - 5 * 60 * 1000}.json`);
    fs.writeFileSync(expiredFile, JSON.stringify(createSnapshot(now - 5 * 60 * 1000)), 'utf8');

    const warnSpy = vi.spyOn(logger, 'logWarn').mockImplementation(() => undefined);
    vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(new Error('EPERM'));

    await (storage as unknown as FileMetricsStorageInternals).cleanupOldFiles();

    const health = storage.getCleanupHealth();
    expect(health.degraded).toBe(true);
    expect(health.deletionFailures).toBe(1);
    expect(health.lastDeletionError).toContain('EPERM');
    expect(warnSpy).toHaveBeenCalledWith(
      `[FileMetricsStorage] Failed to delete metrics file ${path.basename(expiredFile)}`,
      expect.any(Error)
    );

    const stats = await storage.getStorageStats();
    expect(stats.cleanup.degraded).toBe(true);
    expect(stats.cleanup.deletionFailures).toBe(1);
  });

  it('recovers cleanup health after a later successful deletion and clears files', async () => {
    const oldTimestamp = Date.now() - 5 * 60 * 1000;
    const snapshot = createSnapshot(oldTimestamp);
    const fileName = `metrics-${oldTimestamp}.json`;
    const filePath = path.join(storageDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(snapshot), 'utf8');

    const warnSpy = vi.spyOn(logger, 'logWarn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(logger, 'logInfo').mockImplementation(() => undefined);

    vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(new Error('EACCES'));
    await storage.clearAll();

    expect(storage.getCleanupHealth().degraded).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      `[FileMetricsStorage] Failed to delete metrics file ${fileName}`,
      expect.any(Error)
    );

    vi.restoreAllMocks();
    const recoveredInfoSpy = vi.spyOn(logger, 'logInfo').mockImplementation(() => undefined);

    await storage.clearAll();

    const health = storage.getCleanupHealth();
    expect(health.degraded).toBe(false);
    expect(health.lastDeletionRecoveredAt).toEqual(expect.any(Number));
    expect(fs.existsSync(filePath)).toBe(false);
    expect(recoveredInfoSpy).toHaveBeenCalledWith(
      '[FileMetricsStorage] Metrics file cleanup recovered',
      expect.objectContaining({
        file: fileName,
        deletionFailures: 1,
      })
    );
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
