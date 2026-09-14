/**
 * Catalog sampling must not record a partially-rebuilt index.
 *
 * Observed defect (metrics/activity.db on a live install, 2026-09-06): the
 * catalog_samples table held index_count=2 at 10:51 and index_count=112 at
 * 12:18 while the catalog actually contained 284 entries. Those points render
 * as full-height spikes on the dashboard's index-composition chart.
 *
 * Cause: `ensureLoaded()` swaps index state atomically, but
 * `materializeWrittenEntry()` pushes into the LIVE `state.list` one entry at a
 * time. During a bulk import or a backup restore, `state.list.length` climbs
 * from ~0 to its final value across many event-loop turns, and a sampler tick
 * landing in that window measures a size the catalog never actually had.
 *
 * Fix under test: `beginBulkMutation()` / `endBulkMutation()` in indexContext,
 * consulted by CatalogSampler via `isIndexSettling()`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IndexState } from '../services/indexContext';
import {
  beginBulkMutation,
  endBulkMutation,
  isIndexSettling,
  withBulkMutation,
  withBulkMutationAsync,
  _resetBulkMutationGuard,
} from '../services/indexContext';
import { CatalogSampler } from '../dashboard/server/CatalogSampler.js';

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
    retrievedCount: 0,
    appliedCount: 0,
  }));
  return {
    loadedAt: '2026-01-01T00:00:00Z',
    hash: 'h',
    byId: new Map(list.map((e) => [e.id, e as never])),
    list: list as never[],
    fileCount: count,
    versionMTime: 0,
    versionToken: '',
  };
}

beforeEach(() => {
  _resetBulkMutationGuard();
});

describe('bulk-mutation guard (indexContext)', () => {
  it('is closed by default', () => {
    expect(isIndexSettling()).toBe(false);
  });

  it('reports settling between begin and end', () => {
    beginBulkMutation();
    expect(isIndexSettling()).toBe(true);
    endBulkMutation();
    expect(isIndexSettling()).toBe(false);
  });

  it('nests — an inner scope closing does not release the outer one', () => {
    beginBulkMutation();
    beginBulkMutation();
    endBulkMutation();
    expect(isIndexSettling()).toBe(true);
    endBulkMutation();
    expect(isIndexSettling()).toBe(false);
  });

  it('never drops below zero, so a stray release cannot arm the guard negatively', () => {
    endBulkMutation();
    endBulkMutation();
    beginBulkMutation();
    expect(isIndexSettling()).toBe(true);
    endBulkMutation();
    expect(isIndexSettling()).toBe(false);
  });

  it('withBulkMutation releases even when the body throws', () => {
    expect(() => withBulkMutation(() => { throw new Error('boom'); })).toThrow('boom');
    expect(isIndexSettling()).toBe(false);
  });

  it('withBulkMutationAsync releases even when the body rejects', async () => {
    await expect(withBulkMutationAsync(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(isIndexSettling()).toBe(false);
  });

  it('self-expires after 5 minutes so a leaked scope cannot stop sampling forever', () => {
    beginBulkMutation();
    expect(isIndexSettling()).toBe(true);

    // A scope that is opened and never closed (killed mid-import, forgotten
    // pairing) would otherwise suppress every future sample.
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 300_001;
      expect(isIndexSettling()).toBe(false);
    } finally {
      Date.now = realNow;
    }
    // And it stays released once expired.
    expect(isIndexSettling()).toBe(false);
  });
});

describe('CatalogSampler honours the settling guard', () => {
  const snapshot = {};

  it('records a sample when the index is settled', () => {
    const recorded: unknown[] = [];
    const sampler = new CatalogSampler({
      getRawIndexState: () => makeIndexState(284),
      loadUsageSnapshot: () => snapshot,
      recordSample: (s) => recorded.push(s),
      isSettling: () => false,
    });
    sampler.sample();
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { indexCount: number }).indexCount).toBe(284);
  });

  it('records NOTHING while a bulk mutation is in flight', () => {
    const recorded: unknown[] = [];
    const sampler = new CatalogSampler({
      getRawIndexState: () => makeIndexState(2), // the partial count we observed
      loadUsageSnapshot: () => snapshot,
      recordSample: (s) => recorded.push(s),
      isSettling: () => true,
    });
    sampler.sample();
    expect(recorded).toEqual([]);
    // The in-memory ring must not keep it either — the chart falls back to the
    // ring when the store is unavailable, so a spike parked there is still a
    // spike on screen.
    expect(sampler.getHistory()).toEqual([]);
  });

  it('falsification: without the guard the partial count IS persisted', () => {
    // If this ever fails, the test above has stopped proving anything: it would
    // mean the sampler drops the sample for some unrelated reason rather than
    // because of the guard.
    const recorded: unknown[] = [];
    const sampler = new CatalogSampler({
      getRawIndexState: () => makeIndexState(2),
      loadUsageSnapshot: () => snapshot,
      recordSample: (s) => recorded.push(s),
      isSettling: () => false,
    });
    sampler.sample();
    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { indexCount: number }).indexCount).toBe(2);
  });

  it('defaults to the real indexContext guard when no seam is injected', () => {
    const recorded: unknown[] = [];
    const sampler = new CatalogSampler({
      getRawIndexState: () => makeIndexState(284),
      loadUsageSnapshot: () => snapshot,
      recordSample: (s) => recorded.push(s),
      // no isSettling — must fall through to isIndexSettling()
    });

    withBulkMutation(() => sampler.sample());
    expect(recorded).toEqual([]);

    sampler.sample();
    expect(recorded).toHaveLength(1);
  });

  it('reproduces the real failure: an import burst leaves no partial points', () => {
    // Walk the index up from 0 to 284 the way materializeWrittenEntry does,
    // sampling on every tick. Only the settled value may survive.
    const recorded: Array<{ indexCount: number }> = [];
    let size = 0;
    const sampler = new CatalogSampler({
      getRawIndexState: () => makeIndexState(size),
      loadUsageSnapshot: () => snapshot,
      recordSample: (s) => recorded.push(s as { indexCount: number }),
    });

    beginBulkMutation();
    for (size = 1; size <= 284; size++) sampler.sample();
    size = 284; // the loop's exit value is 285; settle on the real final size
    endBulkMutation();
    sampler.sample();

    expect(recorded.map((r) => r.indexCount)).toEqual([284]);
  });
});

describe('activity telemetry cannot be aimed at a shared database from a test run', () => {
  const KEYS = ['INDEX_SERVER_ACTIVITY_LOG', 'INDEX_SERVER_ACTIVITY_DB'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    vi.resetModules();
  });

  async function health() {
    const mod = await import('../services/activityLog.js');
    mod.resetActivityLog();
    return mod.getActivityLogHealth();
  }

  function restore() {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }

  it('is off under the test runner by default', async () => {
    try {
      expect((await health()).enabled).toBe(false);
    } finally { restore(); }
  });

  it('stays off under the test runner even when explicitly switched ON', async () => {
    // Regression: INDEX_SERVER_ACTIVITY_LOG used to be read before the vitest
    // check, so "=1" re-armed writes and — with no DB path set — sent them to
    // the installation's own metrics/activity.db. That is how fixture ids like
    // `bulk-rm-0` and `ci-test-<run>-c0-op0` reached a production catalog's
    // telemetry (902 of 907 rows referenced ids absent from the catalog).
    process.env.INDEX_SERVER_ACTIVITY_LOG = '1';
    try {
      expect((await health()).enabled).toBe(false);
    } finally { restore(); }
  });

  it('can be enabled under the test runner only by also naming the database', async () => {
    process.env.INDEX_SERVER_ACTIVITY_LOG = '1';
    process.env.INDEX_SERVER_ACTIVITY_DB = 'tmp/telemetry-opt-in.db';
    try {
      expect((await health()).enabled).toBe(true);
    } finally { restore(); }
  });

  it('an explicit OFF still wins over an explicit database path', async () => {
    process.env.INDEX_SERVER_ACTIVITY_LOG = '0';
    process.env.INDEX_SERVER_ACTIVITY_DB = 'tmp/telemetry-opt-in.db';
    try {
      expect((await health()).enabled).toBe(false);
    } finally { restore(); }
  });
});
