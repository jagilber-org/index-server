/**
 * RED: CatalogSampler — server-side catalog history sampling (issue #525 Phase 1).
 *
 * Module under test: src/dashboard/server/CatalogSampler.ts (Phase 2 creates it).
 * Interface under test: CatalogSample in src/dashboard/server/metricsAggregation.ts.
 *
 * Every test here MUST fail until Phase 2 (Trinity) implements the module.
 * Failure reason: CatalogSampler module does not exist yet.
 *
 * Data formulas (from ADR, AMENDED):
 *   indexCount  = getRawIndexState()?.list.length
 *   usageTotal  = Sum(entry.retrievedCount + entry.appliedCount) -- NOT deprecated usageCount
 *   signalCount = count of entries with non-null lastSignal in usage snapshot
 *
 * Constitution: TS-8 (TDD red gate), Q-6 (5s timeout), OB-2/OB-3 (tracing + visible logging).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { IndexState } from '../services/indexContext';
import type { UsagePersistRecord } from '../services/indexUsage';

// -- Dynamic import of the module that Phase 2 will create --
// Wrapped in beforeAll so individual tests report meaningful failures
// ("CatalogSampler is undefined") rather than the whole file erroring out.
let CatalogSampler: any;
let SqliteActivityStore: any;

const SAMPLER_MODULE = '../dashboard/server/CatalogSampler.js';
const ACTIVITY_STORE_MODULE = '../services/storage/sqliteActivityStore.js';

beforeAll(async () => {
  try {
    const mod = await import(/* @vite-ignore */ SAMPLER_MODULE);
    CatalogSampler = mod.CatalogSampler ?? mod.default;
  } catch {
    // Expected: module does not exist yet (Phase 2)
  }
  const store = await import(/* @vite-ignore */ ACTIVITY_STORE_MODULE);
  SqliteActivityStore = store.SqliteActivityStore;
});

// -- Test fixtures --

function makeIndexState(count: number): IndexState {
  const list = Array.from({ length: count }, (_, i) => ({
    id: `entry-${i}`,
    title: `Entry ${i}`,
    body: '',
    priority: 50,
    audience: 'all' as const,
    requirement: 'recommended' as const,
    categories: [],
    contentType: 'guidance' as const,
    sourceHash: 'abc',
    schemaVersion: '8',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    retrievedCount: 10 + i,
    appliedCount: 5 + i,
  }));
  return {
    loadedAt: '2026-01-01T00:00:00Z',
    hash: 'test-hash',
    byId: new Map(list.map(e => [e.id, e as any])),
    list: list as any[],
    fileCount: count,
    versionMTime: 0,
    versionToken: 'v1',
  };
}

function makeUsageSnapshot(
  entries: Array<{ id: string; retrievedCount: number; appliedCount: number; lastSignal?: string | null }>,
): Record<string, UsagePersistRecord> {
  const snap: Record<string, UsagePersistRecord> = {};
  for (const e of entries) {
    snap[e.id] = {
      retrievedCount: e.retrievedCount,
      appliedCount: e.appliedCount,
      lastSignal: e.lastSignal ?? undefined,
    };
  }
  return snap;
}

// -- CatalogSample shape (interface contract) --

describe('CatalogSample interface (metricsAggregation.ts)', () => {
  it('CatalogSampler module can be imported', () => {
    expect(CatalogSampler).toBeDefined();
  });

  it('sample output has indexCount, usageTotal, signalCount, timestamp', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(3);
    const snapshot = makeUsageSnapshot([
      { id: 'entry-0', retrievedCount: 10, appliedCount: 5 },
      { id: 'entry-1', retrievedCount: 11, appliedCount: 6 },
      { id: 'entry-2', retrievedCount: 12, appliedCount: 7 },
    ]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    sampler.sample();
    const history = sampler.getHistory();
    expect(history).toHaveLength(1);
    const s = history[0];
    expect(s).toHaveProperty('indexCount');
    expect(s).toHaveProperty('usageTotal');
    expect(s).toHaveProperty('signalCount');
    expect(s).toHaveProperty('timestamp');
    expect(typeof s.timestamp).toBe('number');
  });
});

// -- Ring semantics --

describe('CatalogSampler ring semantics', () => {
  const CAPACITY = 5;

  function makeSampler(indexCount = 10) {
    const state = makeIndexState(indexCount);
    const snapshot = makeUsageSnapshot(
      state.list.map((e: any) => ({
        id: e.id,
        retrievedCount: e.retrievedCount ?? 0,
        appliedCount: e.appliedCount ?? 0,
      })),
    );
    return new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      capacity: CAPACITY,
    });
  }

  it('fills the ring up to capacity', () => {
    expect(CatalogSampler).toBeDefined();
    const sampler = makeSampler();
    for (let i = 0; i < CAPACITY; i++) sampler.sample();
    expect(sampler.getHistory()).toHaveLength(CAPACITY);
  });

  it('wraps at capacity, dropping oldest (OverflowStrategy.DROP_OLDEST)', () => {
    expect(CatalogSampler).toBeDefined();
    const sampler = makeSampler();
    for (let i = 0; i < CAPACITY + 3; i++) sampler.sample();
    const history = sampler.getHistory();
    expect(history).toHaveLength(CAPACITY);
    for (let i = 1; i < history.length; i++) {
      expect(history[i].timestamp).toBeGreaterThanOrEqual(history[i - 1].timestamp);
    }
  });

  it('retains chronological order (oldest first)', () => {
    expect(CatalogSampler).toBeDefined();
    const sampler = makeSampler();
    for (let i = 0; i < 3; i++) sampler.sample();
    const history = sampler.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].timestamp).toBeLessThanOrEqual(history[1].timestamp);
    expect(history[1].timestamp).toBeLessThanOrEqual(history[2].timestamp);
  });

  it('default capacity is 72 (6h at 5-min intervals)', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(1);
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    for (let i = 0; i < 80; i++) sampler.sample();
    expect(sampler.getHistory()).toHaveLength(72);
  });

  it('capacity is configurable via the capacity option', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(1);
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      capacity: 10,
    });
    for (let i = 0; i < 15; i++) sampler.sample();
    expect(sampler.getHistory()).toHaveLength(10);
  });
});

// -- Null-guard: getRawIndexState() returns null (AMENDED item b) --

describe('CatalogSampler null-guard (getRawIndexState is null)', () => {
  it('does not throw when getRawIndexState returns null', () => {
    expect(CatalogSampler).toBeDefined();
    const sampler = new CatalogSampler({
      getRawIndexState: () => null,
      loadUsageSnapshot: () => ({}),
    });
    expect(() => sampler.sample()).not.toThrow();
  });

  it('emits no sample when state is null', () => {
    expect(CatalogSampler).toBeDefined();
    const sampler = new CatalogSampler({
      getRawIndexState: () => null,
      loadUsageSnapshot: () => ({}),
    });
    sampler.sample();
    expect(sampler.getHistory()).toHaveLength(0);
  });

  it('logs once at visible severity when state is null (OB-3)', () => {
    expect(CatalogSampler).toBeDefined();
    const logSpy = vi.fn();
    const sampler = new CatalogSampler({
      getRawIndexState: () => null,
      loadUsageSnapshot: () => ({}),
      onLogWarn: logSpy,
    });
    sampler.sample();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('null'));
  });
});

// -- Data formulas --

describe('CatalogSampler data formulas', () => {
  it('indexCount = getRawIndexState().list.length', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(42);
    const snapshot = makeUsageSnapshot(
      state.list.map((e: any) => ({ id: e.id, retrievedCount: 0, appliedCount: 0 })),
    );
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    sampler.sample();
    expect(sampler.getHistory()[0].indexCount).toBe(42);
  });

  it('usageTotal = Sum(retrievedCount + appliedCount), NOT deprecated usageCount', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(0);
    // Inject entries with usageCount that differs from the split-counter sum
    state.list = [
      { id: 'a', retrievedCount: 100, appliedCount: 50, usageCount: 999 },
      { id: 'b', retrievedCount: 200, appliedCount: 30, usageCount: 999 },
      { id: 'c', retrievedCount: 10, appliedCount: 5, usageCount: 999 },
    ] as any[];
    const snapshot = makeUsageSnapshot([
      { id: 'a', retrievedCount: 100, appliedCount: 50 },
      { id: 'b', retrievedCount: 200, appliedCount: 30 },
      { id: 'c', retrievedCount: 10, appliedCount: 5 },
    ]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    sampler.sample();
    // (100+50) + (200+30) + (10+5) = 395, NOT 999*3
    expect(sampler.getHistory()[0].usageTotal).toBe(395);
  });

  it('signalCount = entries with non-null lastSignal in usage snapshot', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(4);
    const snapshot = makeUsageSnapshot([
      { id: 'entry-0', retrievedCount: 1, appliedCount: 0, lastSignal: 'helpful' },
      { id: 'entry-1', retrievedCount: 1, appliedCount: 0, lastSignal: null },
      { id: 'entry-2', retrievedCount: 1, appliedCount: 0, lastSignal: 'outdated' },
      { id: 'entry-3', retrievedCount: 1, appliedCount: 0 },
    ]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    sampler.sample();
    // entry-0 has 'helpful', entry-2 has 'outdated' -> 2 with non-null lastSignal
    expect(sampler.getHistory()[0].signalCount).toBe(2);
  });

  it('usageTotal treats missing retrievedCount/appliedCount as zero', () => {
    expect(CatalogSampler).toBeDefined();
    const state: IndexState = makeIndexState(2);
    state.list = [
      { id: 'a', retrievedCount: undefined, appliedCount: 10 },
      { id: 'b', retrievedCount: 5, appliedCount: undefined },
    ] as any[];
    const snapshot = makeUsageSnapshot([
      { id: 'a', retrievedCount: 0, appliedCount: 10 },
      { id: 'b', retrievedCount: 5, appliedCount: 0 },
    ]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    sampler.sample();
    // (0+10) + (5+0) = 15
    expect(sampler.getHistory()[0].usageTotal).toBe(15);
  });
});

// -- Cadence --

describe('CatalogSampler cadence', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('samples at 5-minute (300_000ms) intervals when started', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(1);
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    sampler.start();
    expect(sampler.getHistory()).toHaveLength(1);
    vi.advanceTimersByTime(300_000);
    expect(sampler.getHistory()).toHaveLength(2);
    vi.advanceTimersByTime(300_000);
    expect(sampler.getHistory()).toHaveLength(3);
    sampler.stop();
  });

  it('stop() halts the sampling interval', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(1);
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    sampler.start();
    expect(sampler.getHistory()).toHaveLength(1);
    sampler.stop();
    vi.advanceTimersByTime(600_000);
    expect(sampler.getHistory()).toHaveLength(1);
  });

  it('retries priming sample after 10s when state is null at start (cold-start fix)', () => {
    expect(CatalogSampler).toBeDefined();
    let state: any = null;
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      onLogWarn: vi.fn(),
    });
    sampler.start();
    expect(sampler.getHistory()).toHaveLength(0);

    state = makeIndexState(1);
    vi.advanceTimersByTime(10_000);
    expect(sampler.getHistory()).toHaveLength(1);

    sampler.stop();
  });

  it('keeps retrying priming until state becomes available (multi-retry)', () => {
    expect(CatalogSampler).toBeDefined();
    let state: any = null;
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      onLogWarn: vi.fn(),
    });
    sampler.start();
    expect(sampler.getHistory()).toHaveLength(0);

    vi.advanceTimersByTime(10_000);
    expect(sampler.getHistory()).toHaveLength(0);

    vi.advanceTimersByTime(10_000);
    expect(sampler.getHistory()).toHaveLength(0);

    state = makeIndexState(1);
    vi.advanceTimersByTime(10_000);
    expect(sampler.getHistory()).toHaveLength(1);

    sampler.stop();
  });

  it('does not schedule priming retry when T+0 sample succeeds', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(1);
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    sampler.start();
    expect(sampler.getHistory()).toHaveLength(1);

    vi.advanceTimersByTime(10_000);
    // Should still be 1 (no retry sample), next one at 300s
    expect(sampler.getHistory()).toHaveLength(1);

    sampler.stop();
  });
});

// -- OB-2/OB-3: enter/exit tracing and visible-severity logging --

describe('CatalogSampler observability (OB-2/OB-3)', () => {
  it('emits enter/exit trace on each sample cycle', () => {
    expect(CatalogSampler).toBeDefined();
    const traceSpy = vi.fn();
    const state = makeIndexState(1);
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      onTrace: traceSpy,
    });
    sampler.sample();
    const messages = traceSpy.mock.calls.map((c: any[]) => c[0]);
    expect(messages.some((m: string) => /enter|start|begin/i.test(m))).toBe(true);
    expect(messages.some((m: string) => /exit|end|complete/i.test(m))).toBe(true);
  });

  it('logs at visible severity when loadUsageSnapshot throws', () => {
    expect(CatalogSampler).toBeDefined();
    const logSpy = vi.fn();
    const state = makeIndexState(1);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => { throw new Error('disk I/O failure'); },
      onLogWarn: logSpy,
    });
    expect(() => sampler.sample()).not.toThrow();
    expect(logSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('disk I/O failure'));
  });

  it('does not emit a sample when loadUsageSnapshot fails', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(1);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => { throw new Error('fail'); },
      onLogWarn: vi.fn(),
    });
    sampler.sample();
    expect(sampler.getHistory()).toHaveLength(0);
  });
});

// -- /api/system/resources payload contract (AR-2) --

describe('/api/system/resources payload contract (AR-2)', () => {
  it('getHistory returns CatalogSample[] with correct field types', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(5);
    const snapshot = makeUsageSnapshot(
      state.list.map((e: any) => ({
        id: e.id,
        retrievedCount: e.retrievedCount ?? 0,
        appliedCount: e.appliedCount ?? 0,
        lastSignal: 'helpful',
      })),
    );
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    sampler.sample();
    sampler.sample();
    const history = sampler.getHistory();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThan(0);
    for (const sample of history) {
      expect(typeof sample.indexCount).toBe('number');
      expect(typeof sample.usageTotal).toBe('number');
      expect(typeof sample.signalCount).toBe('number');
      expect(typeof sample.timestamp).toBe('number');
    }
  });

  it('getHistory(limit) returns the most recent N samples', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(1);
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
    });
    for (let i = 0; i < 10; i++) sampler.sample();
    expect(sampler.getHistory(3)).toHaveLength(3);
    const full = sampler.getHistory();
    const limited = sampler.getHistory(3);
    expect(limited).toEqual(full.slice(-3));
  });
});

// -- DI-1: persistence across restarts --

describe('CatalogSampler signal-bucket derivation', () => {
  it('derives a CatalogSample field name for every canonical usage signal', async () => {
    const sampler = await import(/* @vite-ignore */ SAMPLER_MODULE);
    const enums = await import(/* @vite-ignore */ '../services/protocolEnums.js');

    // The sampler builds its buckets by transforming USAGE_SIGNALS rather than
    // hand-listing them. If either side is renamed without the other, the
    // bucket silently reads zero forever -- so pin the mapping here.
    const derived = enums.USAGE_SIGNALS.map((s: string) => sampler.signalBucketKey(s));
    expect(derived).toEqual(['sigHelpful', 'sigNotRelevant', 'sigOutdated', 'sigApplied']);
  });

  it('counts a signal into its derived bucket rather than the unsignalled ones', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(4);
    // Coverage is decided by the INDEX entry's counters, not the snapshot's,
    // so entry-3 must be zeroed on the state to read as never-used.
    (state.list as any[])[2].retrievedCount = 1;
    (state.list as any[])[2].appliedCount = 0;
    (state.list as any[])[3].retrievedCount = 0;
    (state.list as any[])[3].appliedCount = 0;

    const snapshot = makeUsageSnapshot([
      { id: 'entry-0', retrievedCount: 1, appliedCount: 0, lastSignal: 'not-relevant' },
      { id: 'entry-1', retrievedCount: 1, appliedCount: 0, lastSignal: 'applied' },
      { id: 'entry-2', retrievedCount: 1, appliedCount: 0 },
      { id: 'entry-3', retrievedCount: 0, appliedCount: 0 },
    ]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      recordSample: () => { /* isolated from the durable store */ },
      readSamples: () => [],
    });
    sampler.sample();

    const s = sampler.getHistory()[0];
    expect(s.sigNotRelevant).toBe(1);
    expect(s.sigApplied).toBe(1);
    expect(s.sigHelpful).toBe(0);
    expect(s.sigOutdated).toBe(0);
    expect(s.signalCount).toBe(2);
    // The two unsignalled entries split by whether they were ever retrieved.
    expect(s.retrievedOnly).toBe(1);
    expect(s.neverUsed).toBe(1);
    // Buckets partition the index: no entry counted twice or dropped.
    expect(s.signalCount + s.retrievedOnly + s.neverUsed).toBe(s.indexCount);
  });

  it('does not let a stale snapshot id inflate signalCount past indexCount', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(2);
    // Snapshot retains a record for an entry that has since been removed.
    const snapshot = makeUsageSnapshot([
      { id: 'entry-0', retrievedCount: 1, appliedCount: 0, lastSignal: 'applied' },
      { id: 'entry-1', retrievedCount: 1, appliedCount: 0, lastSignal: 'helpful' },
      { id: 'long-gone', retrievedCount: 9, appliedCount: 9, lastSignal: 'outdated' },
      { id: 'also-gone', retrievedCount: 9, appliedCount: 9, lastSignal: 'outdated' },
    ]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      recordSample: () => { /* isolated */ },
      readSamples: () => [],
    });
    sampler.sample();

    const s = sampler.getHistory()[0];
    // Counting snapshot keys would give 4 signals over 2 entries -- a 200%
    // "signal share" with no clamp. Walking the index gives 2.
    expect(s.signalCount).toBe(2);
    expect(s.sigOutdated).toBe(0);
    expect(s.signalCount).toBeLessThanOrEqual(s.indexCount);
  });
});

describe('CatalogSampler persistence (DI-1)', () => {
  let tmpDir: string;
  let dbPath: string;
  let openStores: any[];
  let now: number;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-persist-'));
    dbPath = path.join(tmpDir, 'activity.db');
    openStores = [];
    // Samples are keyed on ts and upserted, so two calls inside the same
    // millisecond collapse into one row. Drive Date.now() explicitly rather
    // than hoping the wall clock ticks between synchronous sample() calls.
    now = 1_788_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Windows holds a lock on the SQLite file (plus -wal/-shm) until close,
    // so an un-closed handle turns cleanup into EPERM and masks the real
    // assertion failure. Close every store the test opened, even on failure.
    for (const s of openStores) {
      try { s.close(); } catch { /* already closed */ }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Open a store that afterEach is guaranteed to close. */
  function openStore(): any {
    const s = new SqliteActivityStore(dbPath);
    openStores.push(s);
    return s;
  }

  /** Take a sample at a distinct timestamp. */
  function sampleAt(sampler: any): void {
    sampler.sample();
    now += 1;
  }

  it('persists samples to SQLite and restores them on a new instance', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(5);
    const snapshot = makeUsageSnapshot(
      state.list.map((e: any) => ({ id: e.id, retrievedCount: e.retrievedCount ?? 0, appliedCount: e.appliedCount ?? 0 })),
    );

    const store = openStore();
    const wiring = {
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      recordSample: (s: any) => store.recordSample(s),
      readSamples: (o: any) => store.getSamples(o),
    };

    const sampler1 = new CatalogSampler(wiring);
    sampleAt(sampler1);
    sampleAt(sampler1);
    sampleAt(sampler1);

    expect(sampler1.getHistory()).toHaveLength(3);
    expect(store.countSamples()).toBe(3);
    sampler1.stop();

    // A fresh instance has an empty ring but must still see the durable rows.
    const sampler2 = new CatalogSampler(wiring);
    expect(sampler2.getHistory()).toHaveLength(0);

    const restored = sampler2.getDurableHistory();
    expect(restored).toHaveLength(3);
    expect(restored[0].indexCount).toBe(5);
    // Ascending by time, so the chart can plot it directly.
    const stamps = restored.map((r: { timestamp: number }) => r.timestamp);
    expect(stamps).toEqual([...stamps].sort((a: number, b: number) => a - b));
  });

  it('falls back to the in-memory ring when the durable store is empty', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(1);
    const snapshot = makeUsageSnapshot([{ id: 'entry-0', retrievedCount: 1, appliedCount: 0 }]);
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      recordSample: () => { /* drop */ },
      readSamples: () => [],
    });
    sampler.sample();
    expect(sampler.getHistory()).toHaveLength(1);
    // Store returns nothing, so the chart still gets this process's samples
    // rather than an empty series.
    expect(sampler.getDurableHistory()).toHaveLength(1);
  });

  it('records a sample durably even when the ring has wrapped', () => {
    expect(CatalogSampler).toBeDefined();
    const state = makeIndexState(3);
    const snapshot = makeUsageSnapshot(
      state.list.map((e: any) => ({ id: e.id, retrievedCount: 0, appliedCount: 0 })),
    );
    const store = openStore();
    const sampler = new CatalogSampler({
      getRawIndexState: () => state,
      loadUsageSnapshot: () => snapshot,
      capacity: 2,
      recordSample: (s: any) => store.recordSample(s),
      readSamples: (o: any) => store.getSamples(o),
    });

    for (let i = 0; i < 5; i++) sampleAt(sampler);

    // Ring drops the oldest three; SQLite keeps all five.
    expect(sampler.getHistory()).toHaveLength(2);
    expect(sampler.getDurableHistory()).toHaveLength(5);
  });
});

// -- Playwright E2E flag (TS-11) --
// NOTE: tests/playwright/baseline.spec.ts will need a visual snapshot refresh
// once the chart renders in the Performance panel. Phase 5 (Morpheus) owns
// the baseline refresh. Flagged here per TS-11/TS-12.
