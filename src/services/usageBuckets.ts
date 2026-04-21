/**
 * Usage Buckets Service - Phase 2 Temporal Windowing Implementation
 *
 * Provides time-windowed usage tracking with bucket rotation and persistence.
 * Maintains usage-buckets.json sidecar file for temporal analytics.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logInfo, logError } from './logger';

/**
 * Time bucket configuration
 */
export interface BucketConfig {
  /** Bucket size in minutes (default: 60 = 1 hour) */
  bucketSizeMinutes: number;
  /** Number of buckets to maintain (default: 24 = 24 hours) */
  bucketCount: number;
  /** Maximum entries per bucket (default: 1000) */
  maxEntriesPerBucket: number;
}

/**
 * Usage entry within a time bucket
 */
export interface UsageEntry {
  timestamp: string; // ISO 8601 UTC
  operation: string; // 'list', 'get', 'add', 'update', 'remove', etc.
  instructionId?: string;
  clientInfo?: string;
  durationMs?: number;
  success: boolean;
  errorCode?: string;
}

/**
 * Time bucket containing usage entries
 */
export interface UsageBucket {
  /** Bucket start time (ISO 8601 UTC) */
  startTime: string;
  /** Bucket end time (ISO 8601 UTC) */
  endTime: string;
  /** Usage entries in this bucket */
  entries: UsageEntry[];
  /** Entry count for quick access */
  entryCount: number;
  /** Bucket creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  lastUpdated: string;
}

/**
 * Usage buckets container with metadata
 */
export interface UsageBucketsContainer {
  /** Configuration used */
  config: BucketConfig;
  /** Current bucket index (0 to bucketCount-1) */
  currentBucketIndex: number;
  /** Ring of time buckets */
  buckets: UsageBucket[];
  /** Container creation timestamp */
  createdAt: string;
  /** Last rotation timestamp */
  lastRotation: string;
  /** Total entries across all buckets */
  totalEntries: number;
  /** Metrics summary */
  metrics: {
    rotationCount: number;
    totalOperations: number;
    successRate: number;
    avgDurationMs: number;
  };
  /** Integrity hash (sha256) over critical fields */
  containerHash?: string;
}

/**
 * Default bucket configuration
 */
const DEFAULT_CONFIG: BucketConfig = {
  bucketSizeMinutes: 60, // 1 hour buckets
  bucketCount: 24,       // 24 hours of history
  maxEntriesPerBucket: 1000
};

/**
 * Usage Buckets Service
 */
export class UsageBucketsService {
  private container: UsageBucketsContainer | null = null;
  private bucketsFilePath: string;
  private config: BucketConfig;
  private timeProvider: () => Date;

  constructor(instructionsDir: string, config: Partial<BucketConfig> = {}, opts: { timeProvider?: () => Date } = {}) {
    this.bucketsFilePath = path.join(instructionsDir, 'usage-buckets.json');
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.timeProvider = opts.timeProvider ?? (() => new Date());
  }

  /**
   * Initialize or load existing buckets container
   */
  async initialize(): Promise<void> {
    try {
      if (fs.existsSync(this.bucketsFilePath)) {
        await this.loadContainer();
        logInfo(`[usageBuckets] Loaded existing container from ${this.bucketsFilePath}`);
      } else {
        await this.createContainer();
        logInfo(`[usageBuckets] Created new container at ${this.bucketsFilePath}`);
      }

      // Check if rotation is needed
      await this.maybeRotate();
    } catch (error) {
      logError(`[usageBuckets] Failed to initialize`, error);
      // Fallback: create new container
      await this.createContainer();
    }
  }

  /**
   * Record a usage entry
   */
  async recordUsage(entry: Omit<UsageEntry, 'timestamp'>): Promise<void> {
    if (!this.container) {
      await this.initialize();
    }

    const usageEntry: UsageEntry = {
      ...entry,
  timestamp: this.timeProvider().toISOString()
    };

    // Add to current bucket
    const currentBucket = this.getCurrentBucket();
    currentBucket.entries.push(usageEntry);
    currentBucket.entryCount++;
    currentBucket.lastUpdated = usageEntry.timestamp;

    // Update container metrics
    this.updateMetrics(usageEntry);

    // Check for rotation and persistence
    await this.maybeRotate();

    // Persist immediately for reliability
    await this.saveContainer();
  }

  /**
   * Get current usage statistics
   */
  getStats(): {
    currentBucket: UsageBucket;
    totalEntries: number;
    metrics: UsageBucketsContainer['metrics'];
    bucketCount: number;
  } {
    if (!this.container) {
      throw new Error('UsageBuckets not initialized');
    }

    return {
      currentBucket: this.getCurrentBucket(),
      totalEntries: this.container.totalEntries,
      metrics: this.container.metrics,
      bucketCount: this.container.buckets.length
    };
  }

  /**
   * Get usage entries for a time range
   */
  getEntriesInRange(startTime: string, endTime: string): UsageEntry[] {
    if (!this.container) {
      return [];
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    const entries: UsageEntry[] = [];

    for (const bucket of this.container.buckets) {
      const bucketStart = new Date(bucket.startTime);
      const bucketEnd = new Date(bucket.endTime);

      // Check if bucket overlaps with requested range
      if (bucketEnd >= start && bucketStart <= end) {
        // Filter entries within the exact time range
        const filteredEntries = bucket.entries.filter(entry => {
          const entryTime = new Date(entry.timestamp);
          return entryTime >= start && entryTime <= end;
        });
        entries.push(...filteredEntries);
      }
    }

    return entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Force a bucket rotation (for testing)
   */
  async forceRotation(): Promise<void> {
    if (!this.container) {
      await this.initialize();
    }

    await this.rotateBuckets();
    await this.saveContainer();
    logInfo('[usageBuckets] Forced bucket rotation');
  }

  /**
   * Get the current bucket
   */
  private getCurrentBucket(): UsageBucket {
    if (!this.container) {
      throw new Error('Container not initialized');
    }
    return this.container.buckets[this.container.currentBucketIndex];
  }

  /**
   * Check if bucket rotation is needed and perform it
   */
  private async maybeRotate(): Promise<void> {
    if (!this.container) return;

    const currentBucket = this.getCurrentBucket();
  const now = this.timeProvider();
    const bucketEnd = new Date(currentBucket.endTime);

    if (now >= bucketEnd) {
      await this.rotateBuckets();
      logInfo(`[usageBuckets] Rotated buckets at ${now.toISOString()}`);
    }
  }

  /**
   * Rotate buckets and create new current bucket
   */
  private async rotateBuckets(): Promise<void> {
    if (!this.container) return;

  const now = this.timeProvider();
    const bucketStartTime = this.getBucketStartTime(now);
    const bucketEndTime = new Date(bucketStartTime.getTime() + this.config.bucketSizeMinutes * 60 * 1000);

    // Move to next bucket index (circular)
    this.container.currentBucketIndex = (this.container.currentBucketIndex + 1) % this.config.bucketCount;

    // Replace the bucket at current index
    const newBucket: UsageBucket = {
      startTime: bucketStartTime.toISOString(),
      endTime: bucketEndTime.toISOString(),
      entries: [],
      entryCount: 0,
      createdAt: now.toISOString(),
      lastUpdated: now.toISOString()
    };

    // Update total entries count (subtract old bucket entries)
    const oldBucket = this.container.buckets[this.container.currentBucketIndex];
    this.container.totalEntries -= oldBucket.entryCount;

    // Replace bucket
    this.container.buckets[this.container.currentBucketIndex] = newBucket;

    // Update container metadata
    this.container.lastRotation = now.toISOString();
    this.container.metrics.rotationCount++;
  }

  /**
   * Create a new container
   */
  private async createContainer(): Promise<void> {
  const now = this.timeProvider();
    const buckets: UsageBucket[] = [];

    // Create initial buckets
    for (let i = 0; i < this.config.bucketCount; i++) {
  const bucketStart = new Date(now.getTime() - (this.config.bucketCount - 1 - i) * this.config.bucketSizeMinutes * 60 * 1000);
      const bucketStartTime = this.getBucketStartTime(bucketStart);
      const bucketEndTime = new Date(bucketStartTime.getTime() + this.config.bucketSizeMinutes * 60 * 1000);

      buckets.push({
        startTime: bucketStartTime.toISOString(),
        endTime: bucketEndTime.toISOString(),
        entries: [],
        entryCount: 0,
        createdAt: now.toISOString(),
        lastUpdated: now.toISOString()
      });
    }

    this.container = {
      config: { ...this.config },
      currentBucketIndex: this.config.bucketCount - 1, // Latest bucket
      buckets,
      createdAt: now.toISOString(),
      lastRotation: now.toISOString(),
      totalEntries: 0,
      metrics: {
        rotationCount: 0,
        totalOperations: 0,
        successRate: 1.0,
        avgDurationMs: 0
      }
    };

  await this.saveContainer();
  }

  /**
   * Load container from disk
   */
  private async loadContainer(): Promise<void> {
    const attemptLoad = (file: string): UsageBucketsContainer | null => {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed: UsageBucketsContainer = JSON.parse(raw);
        if (!parsed || !parsed.buckets || !Array.isArray(parsed.buckets)) {
          throw new Error('Invalid format');
        }
        return parsed;
      } catch (e) {
        logError(`[usageBuckets] Failed to load ${file}`, e);
        return null;
      }
    };

    const primary = attemptLoad(this.bucketsFilePath);
    const backupPath = this.bucketsFilePath + '.bak';
    let container = primary;
    if (!container || !this.verifyHash(container)) {
      logError('[usageBuckets] Primary container missing or hash mismatch, attempting backup');
      const backup = fs.existsSync(backupPath) ? attemptLoad(backupPath) : null;
      if (backup && this.verifyHash(backup)) {
        container = backup;
      } else {
        logError('[usageBuckets] Backup container invalid or hash mismatch; rebuilding new container');
        await this.createContainer();
        return;
      }
    }

    // Update config if changed
    container.config = { ...container.config, ...this.config };
    this.container = container;
  }

  /**
   * Save container to disk
   */
  private async saveContainer(): Promise<void> {
    if (!this.container) return;

    // Ensure directory exists
    const dir = path.dirname(this.bucketsFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write atomically
    // Update hash prior to save
    this.container.containerHash = this.computeHash(this.container);

    const serialized = JSON.stringify(this.container, null, 2);
    const tempFile = this.bucketsFilePath + '.tmp';
    fs.writeFileSync(tempFile, serialized);
    fs.renameSync(tempFile, this.bucketsFilePath);

    // Maintain backup copy for recovery
    try {
      fs.writeFileSync(this.bucketsFilePath + '.bak', serialized);
    } catch (e) {
      logError(`[usageBuckets] Failed to write backup`, e);
    }
  }

  /**
   * Get bucket start time aligned to bucket boundaries
   */
  private getBucketStartTime(date: Date): Date {
    const minutes = date.getMinutes();
    const alignedMinutes = Math.floor(minutes / this.config.bucketSizeMinutes) * this.config.bucketSizeMinutes;

    const aligned = new Date(date);
    aligned.setMinutes(alignedMinutes, 0, 0); // Clear seconds and milliseconds

    return aligned;
  }

  /**
   * Update container metrics
   */
  private updateMetrics(entry: UsageEntry): void {
    if (!this.container) return;

    this.container.totalEntries++;
    this.container.metrics.totalOperations++;

    // Update success rate
    const totalOps = this.container.metrics.totalOperations;
    const currentSuccessCount = Math.round(this.container.metrics.successRate * (totalOps - 1));
    const newSuccessCount = currentSuccessCount + (entry.success ? 1 : 0);
    this.container.metrics.successRate = newSuccessCount / totalOps;

    // Update average duration
    if (entry.durationMs !== undefined) {
      const currentAvg = this.container.metrics.avgDurationMs;
      const currentCount = totalOps - 1;
      this.container.metrics.avgDurationMs = (currentAvg * currentCount + entry.durationMs) / totalOps;
    }
  }

  /**
   * Compute integrity hash for container (excluding containerHash field itself)
   */
  private computeHash(container: UsageBucketsContainer): string {
  const { containerHash: _unusedHash, ...rest } = container; // exclude hash field
  void _unusedHash; // satisfy linter for intentional discard
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(rest));
    return hash.digest('hex');
  }

  /**
   * Verify integrity hash of a loaded container
   */
  private verifyHash(container: UsageBucketsContainer): boolean {
    if (!container.containerHash) return false;
    const expected = this.computeHash(container);
    return expected === container.containerHash;
  }

  /**
   * Exposed only for testing: return internal container snapshot
   */
  /* @internal */
  public _debugGetContainer(): UsageBucketsContainer | null {
    return this.container ? JSON.parse(JSON.stringify(this.container)) : null;
  }
}

// Singleton instance for server use
let usageBucketsInstance: UsageBucketsService | null = null;

/**
 * Get or create the global usage buckets service instance
 */
export function getUsageBucketsService(instructionsDir?: string, config: Partial<BucketConfig> = {}): UsageBucketsService {
  if (!usageBucketsInstance && instructionsDir) {
    usageBucketsInstance = new UsageBucketsService(instructionsDir, config);
  }

  if (!usageBucketsInstance) {
    throw new Error('Usage buckets service not initialized - call with instructionsDir first');
  }

  return usageBucketsInstance;
}

/**
 * Record usage for the global instance
 */
export async function recordUsage(entry: Omit<UsageEntry, 'timestamp'>): Promise<void> {
  const service = getUsageBucketsService();
  await service.recordUsage(entry);
}
