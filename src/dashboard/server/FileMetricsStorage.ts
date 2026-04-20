import fs from 'fs';
import path from 'path';
import { MetricsSnapshot } from './MetricsCollector';
import { logInfo, logError, logWarn } from '../../services/logger.js';

/**
 * File-based storage for metrics snapshots to prevent memory accumulation
 * Stores snapshots as individual JSON files with timestamp-based naming
 */
export class FileMetricsStorage {
  private storageDir: string;
  private maxFiles: number;
  private retentionMinutes: number;

  constructor(options: {
    storageDir?: string;
    maxFiles?: number;
    retentionMinutes?: number;
  } = {}) {
    this.storageDir = options.storageDir || path.join(process.cwd(), 'metrics');
    this.maxFiles = options.maxFiles || 720; // 12 hours at 1-minute intervals
    this.retentionMinutes = options.retentionMinutes || 60;

    this.ensureStorageDir();
  }

  /**
   * Store a metrics snapshot to disk
   */
  async storeSnapshot(snapshot: MetricsSnapshot): Promise<void> {
    try {
      const filename = `metrics-${snapshot.timestamp}.json`;
      const filepath = path.join(this.storageDir, filename);

      await fs.promises.writeFile(filepath, JSON.stringify(snapshot, null, 2), 'utf8');

      // Clean up old files periodically (every 10th write)
      if (snapshot.timestamp % 10 === 0) {
        await this.cleanupOldFiles();
      }
    } catch (error) {
      logError('[FileMetricsStorage] Failed to store metrics snapshot', error);
    }
  }

  /**
   * Get recent snapshots from disk (for dashboard/analysis)
   */
  async getRecentSnapshots(count: number = 60): Promise<MetricsSnapshot[]> {
    try {
      const files = await this.getSnapshotFiles();
      const recentFiles = files.slice(-count);

      const snapshots: MetricsSnapshot[] = [];
      for (const file of recentFiles) {
        try {
          const content = await fs.promises.readFile(
            path.join(this.storageDir, file),
            'utf8'
          );
          snapshots.push(JSON.parse(content));
        } catch (error) {
          logWarn(`[FileMetricsStorage] Failed to read metrics file ${file}`, error);
        }
      }

      return snapshots.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      logError('[FileMetricsStorage] Failed to load recent snapshots', error);
      return [];
    }
  }

  /**
   * Get snapshots within a time range
   */
  async getSnapshotsInRange(startTime: number, endTime: number): Promise<MetricsSnapshot[]> {
    try {
      const files = await this.getSnapshotFiles();
      const snapshots: MetricsSnapshot[] = [];

      for (const file of files) {
        const timestamp = this.extractTimestampFromFilename(file);
        if (timestamp >= startTime && timestamp <= endTime) {
          try {
            const content = await fs.promises.readFile(
              path.join(this.storageDir, file),
              'utf8'
            );
            snapshots.push(JSON.parse(content));
          } catch (error) {
            logWarn(`[FileMetricsStorage] Failed to read metrics file ${file}`, error);
          }
        }
      }

      return snapshots.sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
      logError('[FileMetricsStorage] Failed to load snapshots in range', error);
      return [];
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    fileCount: number;
    totalSizeKB: number;
    oldestTimestamp?: number;
    newestTimestamp?: number;
  }> {
    try {
      const files = await this.getSnapshotFiles();

      if (files.length === 0) {
        return { fileCount: 0, totalSizeKB: 0 };
      }

      let totalSize = 0;
      for (const file of files) {
        try {
          const stat = await fs.promises.stat(path.join(this.storageDir, file));
          totalSize += stat.size;
        } catch {
          // Ignore individual file errors
        }
      }

      const timestamps = files.map(f => this.extractTimestampFromFilename(f)).filter(t => t > 0);

      return {
        fileCount: files.length,
        totalSizeKB: Math.round(totalSize / 1024),
        oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
        newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
      };
    } catch (error) {
      logError('[FileMetricsStorage] Failed to get storage stats', error);
      return { fileCount: 0, totalSizeKB: 0 };
    }
  }

  /**
   * Clear all stored metrics
   */
  async clearAll(): Promise<void> {
    try {
      const files = await this.getSnapshotFiles();
      await Promise.all(
        files.map(file =>
          fs.promises.unlink(path.join(this.storageDir, file)).catch(() => {})
        )
      );
    } catch (error) {
      logError('[FileMetricsStorage] Failed to clear metrics storage', error);
    }
  }

  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.promises.mkdir(this.storageDir, { recursive: true });
    } catch (error) {
      logError('[FileMetricsStorage] Failed to create metrics storage directory', error);
    }
  }

  private async getSnapshotFiles(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.storageDir);
      return files
        .filter(f => f.startsWith('metrics-') && f.endsWith('.json'))
        .sort(); // Chronological order due to timestamp-based naming
    } catch {
      return [];
    }
  }

  private extractTimestampFromFilename(filename: string): number {
    const match = filename.match(/^metrics-(\d+)\.json$/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private async cleanupOldFiles(): Promise<void> {
    try {
      const files = await this.getSnapshotFiles();
      const now = Date.now();
      const cutoffTime = now - (this.retentionMinutes * 60 * 1000);

      // Remove files older than retention period
      const expiredFiles = files.filter(file => {
        const timestamp = this.extractTimestampFromFilename(file);
        return timestamp < cutoffTime;
      });

      // Remove excess files (keep only maxFiles most recent)
      let filesToDelete = expiredFiles;
      if (files.length > this.maxFiles) {
        const excessCount = files.length - this.maxFiles;
        const oldestFiles = files.slice(0, excessCount);
        filesToDelete = [...new Set([...expiredFiles, ...oldestFiles])];
      }

      if (filesToDelete.length > 0) {
        await Promise.all(
          filesToDelete.map(file =>
            fs.promises.unlink(path.join(this.storageDir, file)).catch(() => {})
          )
        );

        logInfo('[FileMetricsStorage] Cleaned up old metrics files', { count: filesToDelete.length });
      }
    } catch (error) {
      logError('[FileMetricsStorage] Failed to cleanup old metrics files', error);
    }
  }
}

/**
 * Global file storage instance
 */
let globalFileStorage: FileMetricsStorage | null = null;

export function getFileMetricsStorage(options?: {
  storageDir?: string;
  maxFiles?: number;
  retentionMinutes?: number;
}): FileMetricsStorage {
  if (!globalFileStorage) {
    globalFileStorage = new FileMetricsStorage(options);
  }
  return globalFileStorage;
}
