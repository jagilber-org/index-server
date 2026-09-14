import type { IndexState } from '../../services/indexContext.js';
import type { UsagePersistRecord } from '../../services/indexUsage.js';
import type { CatalogSample } from './metricsAggregation.js';
import { BufferRing, OverflowStrategy } from '../../utils/BufferRing.js';
import { getCatalogSamples, recordCatalogSample, type CatalogSampleRow } from '../../services/activityLog.js';
import { isIndexSettling } from '../../services/indexContext.js';
import { USAGE_SIGNALS } from '../../services/protocolEnums.js';

/**
 * Map a usage signal to its CatalogSample bucket field: `not-relevant` ->
 * `sigNotRelevant`. Derived rather than hand-listed so the sampler cannot
 * drift from src/services/protocolEnums.ts (USAGE_SIGNALS).
 *
 * catalogSampler.spec.ts asserts the derived names match the declared
 * CatalogSample fields, so renaming a field without updating the enum (or vice
 * versa) fails loudly instead of silently zeroing a bucket.
 */
export function signalBucketKey(signal: string): string {
  return 'sig' + signal
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join('');
}

const DEFAULT_CAPACITY = 72;
const SAMPLE_INTERVAL_MS = 300_000;
const PRIMING_RETRY_MS = 10_000;

export interface CatalogSamplerOptions {
  getRawIndexState: () => IndexState | null;
  loadUsageSnapshot: () => Record<string, UsagePersistRecord>;
  capacity?: number;
  /**
   * @deprecated Ignored. Sample history is persisted to SQLite via
   * `recordCatalogSample`; the ring is now in-memory only. Retained so
   * existing callers keep compiling.
   */
  persistPath?: string;
  onLogWarn?: (msg: string) => void;
  onTrace?: (msg: string) => void;
  /**
   * Durable-store seams (DI-1). Default to the process-global activity log;
   * tests inject to stay off the real metrics database.
   */
  recordSample?: (sample: CatalogSampleRow) => void;
  readSamples?: (opts: { since?: number; limit?: number }) => CatalogSampleRow[];
  /**
   * "Is the index mid-rebuild?" seam. Defaults to the process-global guard in
   * indexContext; tests inject to drive both branches without a real import.
   */
  isSettling?: () => boolean;
}

let _instance: CatalogSampler | null = null;

export function getCatalogSampler(): CatalogSampler | null {
  return _instance;
}

export function setCatalogSampler(sampler: CatalogSampler | null): void {
  _instance = sampler;
}

export class CatalogSampler {
  private ring: BufferRing<CatalogSample>;
  private opts: CatalogSamplerOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private nullStateLogged = false;

  constructor(options: CatalogSamplerOptions) {
    this.opts = options;
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    // In-memory only. Durable history lives in SQLite (see recordCatalogSample).
    //
    // The ring previously persisted to metrics/catalog-history.json in append
    // mode, which rewrote ring state on every add: the on-disk file reached
    // 17,094 records representing only 312 distinct samples (2.0 MB for three
    // days of 5-minute sampling) and was never compacted.
    this.ring = new BufferRing<CatalogSample>({
      capacity,
      overflowStrategy: OverflowStrategy.DROP_OLDEST,
      maxPersistEntries: 0,
      enableIntegrityCheck: false,
      suppressPersistLog: true,
    });
  }

  sample(): void {
    this.opts.onTrace?.('CatalogSampler: enter sample cycle');

    const state = this.opts.getRawIndexState();
    if (state === null) {
      if (!this.nullStateLogged) {
        this.opts.onLogWarn?.('CatalogSampler: getRawIndexState() returned null — skipping sample');
        this.nullStateLogged = true;
      }
      this.opts.onTrace?.('CatalogSampler: exit sample cycle');
      return;
    }

    // A bulk import or backup restore grows the live state.list one entry at a
    // time, so its length mid-loop is a count the catalog never actually had.
    // Persisting one would put a permanent full-height spike on the chart (we
    // recorded index_count=2 and 112 against a real catalog of 284), and unlike
    // a missing point a wrong point cannot be distinguished from real data
    // later. Skipping costs at most one sample; the next tick is 5 minutes out.
    if ((this.opts.isSettling ?? isIndexSettling)()) {
      this.opts.onTrace?.('CatalogSampler: index settling (bulk mutation) — skipping sample');
      this.opts.onTrace?.('CatalogSampler: exit sample cycle');
      return;
    }

    let snapshot: Record<string, UsagePersistRecord>;
    try {
      snapshot = this.opts.loadUsageSnapshot();
    } catch (err) {
      this.opts.onLogWarn?.(
        `CatalogSampler: loadUsageSnapshot failed — ${(err as Error).message}`,
      );
      this.opts.onTrace?.('CatalogSampler: exit sample cycle');
      return;
    }

    // Walk the index (not the snapshot) so every bucket shares one
    // denominator. The snapshot retains records for ids that have since been
    // removed; counting its keys made signalCount exceed indexCount.
    const indexCount = state.list.length;
    let usageTotal = 0;
    let retrievedOnly = 0;
    let neverUsed = 0;

    // Buckets are derived from USAGE_SIGNALS rather than hand-listed, so a new
    // signal value added to the protocol enum gets counted here automatically
    // instead of falling through to "unsignalled" and quietly deflating the
    // signal total.
    const signalBuckets: Record<string, number> = {};
    for (const signal of USAGE_SIGNALS) signalBuckets[signalBucketKey(signal)] = 0;

    for (const entry of state.list) {
      const used = (entry.retrievedCount || 0) + (entry.appliedCount || 0);
      usageTotal += used;

      const signal = snapshot[entry.id]?.lastSignal;
      const bucket = signal ? signalBucketKey(signal) : null;
      if (bucket !== null && bucket in signalBuckets) {
        signalBuckets[bucket]++;
      } else if (used > 0) {
        // Unsignalled: split by whether it has ever been exercised at all.
        retrievedOnly++;
      } else {
        neverUsed++;
      }
    }

    let signalCount = 0;
    for (const key of Object.keys(signalBuckets)) signalCount += signalBuckets[key];

    const sample = {
      timestamp: Date.now(),
      indexCount,
      usageTotal,
      signalCount,
      retrievedOnly,
      neverUsed,
      ...signalBuckets,
    } as CatalogSample;

    this.ring.add(sample);

    // Durable history. The ring is a hot cache bounded at DEFAULT_CAPACITY;
    // SQLite is what survives a restart and what the chart actually reads.
    (this.opts.recordSample ?? recordCatalogSample)({
      ts: sample.timestamp,
      indexCount,
      usageTotal,
      signalCount,
      retrievedOnly,
      neverUsed,
      ...signalBuckets,
    } as CatalogSampleRow);

    this.opts.onTrace?.('CatalogSampler: exit sample cycle');
  }

  private primingRetry(): void {
    this.retryTimer = setTimeout(() => {
      const before = this.ring.getAll().length;
      this.sample();
      if (this.ring.getAll().length === before) {
        this.primingRetry();
      } else {
        this.retryTimer = null;
      }
    }, PRIMING_RETRY_MS);
  }

  start(): void {
    this.sample();
    if (this.ring.getAll().length === 0) {
      this.primingRetry();
    }
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
  }

  stop(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * In-memory ring contents, oldest first — only the last `capacity` samples,
   * and empty after a restart.
   *
   * Deliberately NOT the durable series: `getDurableHistory()` is what the
   * chart reads. Keeping these separate matters because they answer different
   * questions ("what has this process seen" vs "what has ever been sampled"),
   * and silently widening this one would make ring capacity untestable.
   */
  getHistory(limit?: number): CatalogSample[] {
    const all = this.ring.getAll();
    if (limit !== undefined) {
      return all.slice(-limit);
    }
    return all;
  }

  /**
   * Durable sample history, oldest first.
   *
   * Reads SQLite so history survives restarts. Falls back to the ring when the
   * store is unavailable (disabled, or failed to open) so the chart degrades
   * to "since this restart" rather than to empty.
   */
  getDurableHistory(limit?: number, since?: number): CatalogSample[] {
    const rows = this.opts.readSamples
      ? this.opts.readSamples({ since, limit })
      : getCatalogSamples({ since, limit });

    if (rows.length) {
      return rows.map((r) => ({
        timestamp: r.ts,
        indexCount: r.indexCount,
        usageTotal: r.usageTotal,
        signalCount: r.signalCount,
        sigApplied: r.sigApplied,
        sigHelpful: r.sigHelpful,
        sigNotRelevant: r.sigNotRelevant,
        sigOutdated: r.sigOutdated,
        retrievedOnly: r.retrievedOnly,
        neverUsed: r.neverUsed,
      }));
    }

    return this.getHistory(limit);
  }
}
