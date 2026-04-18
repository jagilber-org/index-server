/**
 * Configurable Buffer Ring - Generic circular buffer implementation
 *
 * Provides a high-performance, memory-efficient circular buffer with configurable
 * size limits, overflow strategies, and optional persistence support.
 *
 * Features:
 * - Configurable capacity with automatic overflow handling
 * - Multiple overflow strategies (drop-oldest, drop-newest, resize)
 * - Optional persistence to disk with atomic writes
 * - Type-safe generic implementation
 * - Memory usage tracking and cleanup
 * - Event notifications for buffer state changes
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { logInfo, logError } from '../services/logger';
import { getRuntimeConfig } from '../config/runtimeConfig';

/**
 * Buffer overflow strategies
 */
export enum OverflowStrategy {
  /** Drop the oldest entries when buffer is full (default) */
  DROP_OLDEST = 'drop-oldest',
  /** Drop the newest entry when buffer is full */
  DROP_NEWEST = 'drop-newest',
  /** Resize the buffer to accommodate new entries */
  RESIZE = 'resize',
  /** Throw an error when buffer is full */
  ERROR = 'error'
}

/**
 * Buffer ring configuration
 */
export interface BufferRingConfig {
  /** Maximum number of entries in the buffer */
  capacity: number;
  /** Strategy to use when buffer overflows */
  overflowStrategy: OverflowStrategy;
  /** Optional file path for persistence */
  persistPath?: string;
  /** Enable automatic persistence on changes */
  autoPersist: boolean;
  /** Maximum entries to persist (0 = all) */
  maxPersistEntries: number;
  /** Enable integrity checking with checksums */
  enableIntegrityCheck: boolean;
  /** Custom serializer for entries */
  serializer?: <U>(entry: U) => U;
  /** Custom deserializer for entries */
  deserializer?: <U>(data: U) => U;
  /** Suppress persist/load info logs (for high-frequency buffers) */
  suppressPersistLog?: boolean;
  /** Append mode (JSONL incremental writes instead of full snapshot rewrites) */
  appendMode?: boolean;
}

/**
 * Buffer ring statistics
 */
export interface BufferRingStats {
  /** Current number of entries */
  count: number;
  /** Maximum capacity */
  capacity: number;
  /** Total entries added (including dropped) */
  totalAdded: number;
  /** Total entries dropped due to overflow */
  totalDropped: number;
  /** Number of buffer resizes */
  resizeCount: number;
  /** Memory usage estimate in bytes */
  memoryUsage: number;
  /** Last operation timestamp */
  lastModified: Date;
  /** Buffer utilization percentage */
  utilization: number;
}

/**
 * Persisted buffer data structure
 */
interface PersistedBufferData<T> {
  config: BufferRingConfig;
  entries: T[];
  stats: BufferRingStats;
  checksum?: string;
  version: string;
  createdAt: string;
  lastSaved: string;
}

/**
 * Buffer ring events
 */
export interface BufferRingEvents<T> {
  'entry-added': (entry: T, index: number) => void;
  'entry-dropped': (entry: T, reason: 'overflow' | 'clear') => void;
  'buffer-resized': (oldCapacity: number, newCapacity: number) => void;
  'buffer-full': (capacity: number) => void;
  'persisted': (path: string, entryCount: number) => void;
  'loaded': (path: string, entryCount: number) => void;
  'error': (error: Error, operation: string) => void;
}

/**
 * Generic configurable buffer ring implementation
 */
export class BufferRing<T = unknown> extends EventEmitter {
  private buffer: T[] = [];
  private writeIndex = 0;
  private isFull = false;
  private config: BufferRingConfig;
  private stats: BufferRingStats;
  /** Sequence counter for append mode records */
  private appendSeq = 0;
  /** Track whether append mode file has been lazily loaded */
  private appendLoaded = false;

  constructor(config: Partial<BufferRingConfig> = {}) {
    super();

    this.config = {
      capacity: 1000,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      autoPersist: false,
      maxPersistEntries: 0,
      enableIntegrityCheck: true,
      appendMode: true,
      ...config
    };

    // Environment override via config: allow disable or enable explicitly
    const bufferRingCfg = getRuntimeConfig().bufferRing;
    this.config.appendMode = bufferRingCfg.append;

    this.stats = {
      count: 0,
      capacity: this.config.capacity,
      totalAdded: 0,
      totalDropped: 0,
      resizeCount: 0,
      memoryUsage: 0,
      lastModified: new Date(),
      utilization: 0
    };

    // Load from persistence if configured
    if (this.config.persistPath) {
      if (this.config.appendMode) {
        // Lazy load for append mode occurs on first access; optionally preload if config set
        if (bufferRingCfg.preload) {
          try {
                  this.loadFromAppendSync();
                } catch (error: unknown) {
                  const err = error instanceof Error ? error : new Error('Unknown append preload error');
                  this.emit('error', err, 'load');
                  logError(`[BufferRing] Failed (append) to load from ${this.config.persistPath}`, err);
          }
        }
      } else {
        this.loadFromDisk().catch(error => {
          this.emit('error', error, 'load');
          logError(`[BufferRing] Failed to load from ${this.config.persistPath}`, error);
        });
      }
    }
  }

  /**
   * Add an entry to the buffer
   */
  add(entry: T): boolean {
    try {
      const serializedEntry = this.config.serializer ? this.config.serializer(entry) : entry;
      let dropped: T | undefined;

      if (this.isFull) {
        switch (this.config.overflowStrategy) {
          case OverflowStrategy.DROP_OLDEST:
            dropped = this.buffer[this.writeIndex];
            this.buffer[this.writeIndex] = serializedEntry;
            this.writeIndex = (this.writeIndex + 1) % this.config.capacity;
            this.stats.totalDropped++;
            if (dropped !== undefined) {
              this.emit('entry-dropped', dropped, 'overflow');
            }
            break;

          case OverflowStrategy.DROP_NEWEST:
            this.emit('entry-dropped', serializedEntry, 'overflow');
            this.stats.totalDropped++;
            return false;

          case OverflowStrategy.RESIZE:
            this.resize(this.config.capacity * 2);
            this.buffer[this.writeIndex] = serializedEntry;
            this.writeIndex++;
            this.stats.count++;
            break;

          case OverflowStrategy.ERROR:
            throw new Error(`Buffer overflow: capacity ${this.config.capacity} exceeded`);
        }
      } else {
        this.buffer[this.writeIndex] = serializedEntry;
        this.writeIndex++;
        this.stats.count++;

        if (this.writeIndex >= this.config.capacity) {
          this.isFull = true;
          this.writeIndex = 0;
          this.emit('buffer-full', this.config.capacity);
        }
      }

      this.stats.totalAdded++;
      this.stats.lastModified = new Date();
      this.updateStats();
      this.emit('entry-added', serializedEntry, this.writeIndex - 1);

      // Auto-persist if enabled
      if (this.config.autoPersist && this.config.persistPath) {
        if (this.config.appendMode) {
          try {
            this.appendToDisk(serializedEntry);
          } catch (err) {
            this.emit('error', err as Error, 'auto-append');
          }
        } else {
          this.saveToDisk().catch(error => {
            this.emit('error', error, 'auto-persist');
          });
        }
      }

      return true;
    } catch (error) {
      this.emit('error', error as Error, 'add');
      return false;
    }
  }

  /**
   * Get all entries in chronological order (oldest first)
   */
  getAll(): T[] {
    // Lazy load append file on first read if in append mode
    if (this.config.appendMode && this.config.persistPath && !this.appendLoaded) {
      try { this.loadFromAppendSync(); } catch (err) { this.emit('error', err as Error, 'load-append'); }
    }
    if (!this.isFull) {
      return this.buffer.slice(0, this.writeIndex).map(this.deserializeEntry.bind(this));
    }

    // Buffer is full, need to reorder from oldest to newest
    const oldest = this.buffer.slice(this.writeIndex).map(this.deserializeEntry.bind(this));
    const newest = this.buffer.slice(0, this.writeIndex).map(this.deserializeEntry.bind(this));
    return [...oldest, ...newest] as T[];
  }

  /**
   * Get the last N entries (newest first)
   */
  getLast(n: number): T[] {
    const all = this.getAll();
    return all.slice(-n).reverse();
  }

  /**
   * Get the first N entries (oldest first)
   */
  getFirst(n: number): T[] {
    const all = this.getAll();
    return all.slice(0, n);
  }

  /**
   * Get entries within a range
   */
  getRange(start: number, end: number): T[] {
    const all = this.getAll();
    return all.slice(start, end);
  }

  /**
   * Filter entries based on predicate
   */
  filter(predicate: (entry: T, index: number) => boolean): T[] {
    return this.getAll().filter(predicate);
  }

  /**
   * Find first entry matching predicate
   */
  find(predicate: (entry: T, index: number) => boolean): T | undefined {
    return this.getAll().find(predicate);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    const droppedCount = this.stats.count;
    this.buffer.forEach(entry => {
      if (entry !== undefined) {
        this.emit('entry-dropped', entry, 'clear');
      }
    });

    this.buffer = [];
    this.writeIndex = 0;
    this.isFull = false;
    this.stats.count = 0;
    this.stats.totalDropped += droppedCount;
    this.stats.lastModified = new Date();
    this.updateStats();

    logInfo(`[BufferRing] Cleared ${droppedCount} entries`);
  }

  /**
   * Resize the buffer capacity
   */
  resize(newCapacity: number): void {
    if (newCapacity <= 0) {
      throw new Error('Buffer capacity must be positive');
    }

    const oldCapacity = this.config.capacity;
    const currentEntries = this.getAll();

    this.config.capacity = newCapacity;
    this.buffer = [];
    this.writeIndex = 0;
    this.isFull = false;
    this.stats.count = 0;
    this.stats.capacity = newCapacity;
    this.stats.resizeCount++;

    // Re-add entries up to new capacity
    const entriesToKeep = currentEntries.slice(-newCapacity);
    entriesToKeep.forEach(entry => this.add(entry));

    this.emit('buffer-resized', oldCapacity, newCapacity);
    logInfo(`[BufferRing] Resized from ${oldCapacity} to ${newCapacity} entries`);
  }

  /**
   * Get buffer statistics
   */
  getStats(): BufferRingStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get buffer configuration
   */
  getConfig(): BufferRingConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<BufferRingConfig>): void {
    const oldCapacity = this.config.capacity;
    this.config = { ...this.config, ...newConfig };

    // Handle capacity changes
    if (this.config.capacity !== oldCapacity) {
      this.resize(this.config.capacity);
    }
  }

  /**
   * Save buffer to disk
   */
  async saveToDisk(): Promise<void> {
    if (!this.config.persistPath) {
      throw new Error('No persist path configured');
    }

    try {
      const entries = this.getAll();
      const entriesToSave = this.config.maxPersistEntries > 0
        ? entries.slice(-this.config.maxPersistEntries)
        : entries;

      const data: PersistedBufferData<T> = {
        config: this.config,
        entries: entriesToSave,
        stats: this.getStats(),
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        lastSaved: new Date().toISOString()
      };

      if (this.config.enableIntegrityCheck) {
        data.checksum = this.computeChecksum(data);
      }

      // Ensure directory exists
      const dir = path.dirname(this.config.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Atomic write
      const tempPath = this.config.persistPath + '.tmp';
      const serialized = JSON.stringify(data, null, 2);
      fs.writeFileSync(tempPath, serialized);
      fs.renameSync(tempPath, this.config.persistPath);

      this.emit('persisted', this.config.persistPath, entriesToSave.length);
      if (!this.config.suppressPersistLog) {
        logInfo(`[BufferRing] Persisted ${entriesToSave.length} entries to ${this.config.persistPath}`);
      }
    } catch (error) {
      this.emit('error', error as Error, 'save');
      throw error;
    }
  }

  /**
   * Load buffer from disk
   */
  async loadFromDisk(): Promise<void> {
    if (!this.config.persistPath || !fs.existsSync(this.config.persistPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.config.persistPath, 'utf8');
      const data: PersistedBufferData<T> = JSON.parse(raw);

      // Verify integrity if enabled
      if (this.config.enableIntegrityCheck && data.checksum) {
        const expectedChecksum = this.computeChecksum(data);
        if (data.checksum !== expectedChecksum) {
          throw new Error('Integrity check failed: checksum mismatch');
        }
      }

      // Clear current buffer
      this.clear();

      // Restore entries
      data.entries.forEach(entry => this.add(entry));

      // Update stats (preserve some current values)
      this.stats = {
        ...data.stats,
        lastModified: new Date(),
        memoryUsage: this.estimateMemoryUsage()
      };

      this.emit('loaded', this.config.persistPath, data.entries.length);
      if (!this.config.suppressPersistLog) {
        logInfo(`[BufferRing] Loaded ${data.entries.length} entries from ${this.config.persistPath}`);
      }
    } catch (error) {
      this.emit('error', error as Error, 'load');
      throw error;
    }
  }

  /**
   * Append a single entry (JSONL) instead of rewriting full snapshot.
   * Record shape: { t: ISO timestamp, i: sequence, v: serializedEntry }
   */
  private appendToDisk(entry: T): void {
    if (!this.config.persistPath) return;
    const dir = path.dirname(this.config.persistPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const rec = { t: new Date().toISOString(), i: this.appendSeq++, v: entry };
    fs.appendFileSync(this.config.persistPath, JSON.stringify(rec) + '\n'); // lgtm[js/http-to-file-access] — persist path from constructor config
    if (!this.config.suppressPersistLog && this.appendSeq % 250 === 0) {
      // Throttle log noise (every 250 appends)
      logInfo(`[BufferRing] Appended ${this.appendSeq} records to ${this.config.persistPath}`);
    }
  }

  /**
   * Synchronous load for append mode (reads JSONL file)
   */
  private loadFromAppendSync(): void {
    if (!this.config.persistPath || !fs.existsSync(this.config.persistPath)) { this.appendLoaded = true; return; }
    try {
      const raw = fs.readFileSync(this.config.persistPath, 'utf8');
      const lines = raw.split(/\r?\n/).filter(l => l.trim().length);
      const max = this.config.maxPersistEntries > 0 ? this.config.maxPersistEntries : this.config.capacity;
      const slice = lines.slice(-max);
      // Clear existing buffer first (without emitting per-drop noise)
      this.buffer = [];
      this.writeIndex = 0; this.isFull = false; this.stats.count = 0;
      slice.forEach(line => {
        try {
          const rec = JSON.parse(line);
          this.add(rec.v as T); // reuse add for ordering & stats
          if (typeof rec.i === 'number' && rec.i >= this.appendSeq) this.appendSeq = rec.i + 1;
        } catch { /* skip malformed line */ }
      });
      this.appendLoaded = true;
      if (!this.config.suppressPersistLog) {
        logInfo(`[BufferRing] Loaded (append mode) ${slice.length}/${lines.length} entries from ${this.config.persistPath}`);
      }
    } catch (err) {
      this.appendLoaded = true; // avoid retry loop
      throw err;
    }
  }

  /**
   * Get memory usage estimate
   */
  getMemoryUsage(): number {
    return this.estimateMemoryUsage();
  }

  /**
   * Compact buffer by removing undefined entries
   */
  compact(): void {
    const validEntries = this.getAll();
    this.clear();
    validEntries.forEach(entry => this.add(entry));
    logInfo(`[BufferRing] Compacted buffer, retained ${validEntries.length} entries`);
  }

  /**
   * Private helper methods
   */
  private deserializeEntry(entry: T): T {
    return this.config.deserializer ? this.config.deserializer(entry) : entry;
  }

  private updateStats(): void {
    this.stats.utilization = (this.stats.count / this.config.capacity) * 100;
    this.stats.memoryUsage = this.estimateMemoryUsage();
  }

  private estimateMemoryUsage(): number {
    // Rough estimate: 8 bytes per pointer + JSON stringified size
    const baseSize = this.buffer.length * 8;
    const dataSize = JSON.stringify(this.buffer.filter(x => x !== undefined)).length * 2; // UTF-16
    return baseSize + dataSize;
  }

  private computeChecksum(data: PersistedBufferData<T>): string {
    const dataWithoutChecksum = { ...data };
    delete dataWithoutChecksum.checksum;
    const serialized = JSON.stringify(dataWithoutChecksum, Object.keys(dataWithoutChecksum).sort());
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }
}

/**
 * Factory function for creating commonly used buffer rings
 */
export class BufferRingFactory {
  /**
   * Create a log buffer ring
   */
  static createLogBuffer(capacity = 1000, persistPath?: string): BufferRing<string> {
    return new BufferRing<string>({
      capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      persistPath,
      autoPersist: !!persistPath,
      maxPersistEntries: capacity * 0.8, // Persist 80% of capacity
      enableIntegrityCheck: true
    });
  }

  /**
   * Create a metrics buffer ring
   */
  static createMetricsBuffer(capacity = 500, persistPath?: string): BufferRing<Record<string, unknown>> {
    return new BufferRing<Record<string, unknown>>({
      capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      persistPath,
      autoPersist: false, // Manual persistence for performance
      maxPersistEntries: 0, // Persist all
      enableIntegrityCheck: true,
      serializer: (entry) => ({
        ...entry,
        timestamp: (entry as Record<string, unknown>).timestamp || new Date().toISOString()
      })
    });
  }

  /**
   * Create an event buffer ring
   */
  static createEventBuffer(capacity = 200): BufferRing<Record<string, unknown>> {
    return new BufferRing<Record<string, unknown>>({
      capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      autoPersist: false,
      enableIntegrityCheck: false // Events are transient
    });
  }

  /**
   * Create a resizable buffer ring
   */
  static createResizableBuffer<T>(initialCapacity = 100, _maxCapacity = 10000): BufferRing<T> {
    return new BufferRing<T>({
      capacity: initialCapacity,
      overflowStrategy: OverflowStrategy.RESIZE,
      autoPersist: false,
      enableIntegrityCheck: false
    });
  }
}

export default BufferRing;
