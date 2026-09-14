/**
 * activityStore.spec.ts — persistent activity telemetry (#525 follow-up).
 *
 * Covers the two pieces the dashboard flow view depends on:
 *   - SqliteActivityStore: append, bucket, summarize, upsert, retention
 *   - activityLog.activityTypeFromAudit: which audit rows become activity
 *
 * Bucketing is the highest-risk piece and is asserted on real boundaries: an
 * early version used `(ts / ?) * ?`, which node:sqlite evaluates as floating
 * point, so every event landed in its own bucket and no aggregation happened.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SqliteActivityStore,
  ACTIVITY_TYPES,
  type ActivityType,
} from '../services/storage/sqliteActivityStore.js';
import { activityTypeFromAudit } from '../services/activityLog.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
// A known day boundary in UTC, so bucket maths is checkable by hand.
const T0 = Date.UTC(2026, 8, 1, 0, 0, 0);

describe('SqliteActivityStore', () => {
  let tmpDir: string;
  let store: SqliteActivityStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-store-'));
    store = new SqliteActivityStore(path.join(tmpDir, 'activity.db'));
  });

  afterEach(() => {
    // Windows keeps a lock on the db + WAL until close; leaving it open turns
    // cleanup into EPERM and masks the real assertion.
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates its parent directory rather than failing to open', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c', 'activity.db');
    const s = new SqliteActivityStore(nested);
    expect(fs.existsSync(nested)).toBe(true);
    s.close();
  });

  it('round-trips an event including the previous signal value', () => {
    store.recordActivity({
      ts: T0, type: 'signaled', instructionId: 'alpha',
      signal: 'applied', prevSignal: 'helpful',
      instance: 'i1', correlationId: 'corr-1',
    });

    const [ev] = store.listActivity({ since: T0 - 1, until: T0 + 1 });
    expect(ev.type).toBe('signaled');
    expect(ev.instructionId).toBe('alpha');
    expect(ev.signal).toBe('applied');
    // The transition is the whole point: the usage snapshot keeps only the
    // latest value, so without prevSignal a helpful->applied change is
    // indistinguishable from a first-ever applied.
    expect(ev.prevSignal).toBe('helpful');
    expect(ev.instance).toBe('i1');
  });

  describe('bucketActivity', () => {
    beforeEach(() => {
      // Day 0: two adds and one applied signal. Day 1: one modify and two
      // signals. Spread across the day so any per-event bucketing shows up.
      store.recordActivity({ ts: T0 + 1_000, type: 'added', instructionId: 'a', instance: 'i1' });
      store.recordActivity({ ts: T0 + 5 * HOUR, type: 'added', instructionId: 'b', instance: 'i1' });
      store.recordActivity({ ts: T0 + 9 * HOUR, type: 'signaled', instructionId: 'a', signal: 'applied', instance: 'i1' });
      store.recordActivity({ ts: T0 + DAY + 1_000, type: 'modified', instructionId: 'a', instance: 'i2' });
      store.recordActivity({ ts: T0 + DAY + 2 * HOUR, type: 'signaled', instructionId: 'a', signal: 'helpful', instance: 'i2' });
      store.recordActivity({ ts: T0 + DAY + 3 * HOUR, type: 'signaled', instructionId: 'b', signal: 'outdated', instance: 'i2' });
    });

    it('aggregates events into day buckets aligned to the epoch', () => {
      const buckets = store.bucketActivity({ since: T0, until: T0 + 2 * DAY, bucketMs: DAY });

      expect(buckets).toHaveLength(2);
      // Aligned to an absolute epoch multiple, not to `since`, so the same
      // wall-clock day lands in the same bucket for any query window.
      expect(buckets[0].ts).toBe(T0);
      expect(buckets[1].ts).toBe(T0 + DAY);

      expect(buckets[0].added).toBe(2);
      expect(buckets[0].signaled).toBe(1);
      expect(buckets[0].signals).toEqual({ applied: 1 });

      expect(buckets[1].modified).toBe(1);
      expect(buckets[1].signaled).toBe(2);
      expect(buckets[1].signals).toEqual({ helpful: 1, outdated: 1 });
    });

    it('returns identical bucket boundaries for a shifted query window', () => {
      const a = store.bucketActivity({ since: T0, until: T0 + 2 * DAY, bucketMs: DAY });
      const b = store.bucketActivity({ since: T0 - 7 * HOUR, until: T0 + 2 * DAY, bucketMs: DAY });
      expect(b.map(x => x.ts)).toEqual(a.map(x => x.ts));
    });

    it('splits into hour buckets at the same width', () => {
      const buckets = store.bucketActivity({ since: T0, until: T0 + 2 * DAY, bucketMs: HOUR });
      // Six events at six distinct hours.
      expect(buckets).toHaveLength(6);
      for (const b of buckets) expect(b.ts % HOUR).toBe(0);
    });

    it('filters to one instance', () => {
      const buckets = store.bucketActivity({ since: T0, until: T0 + 2 * DAY, bucketMs: DAY, instance: 'i2' });
      expect(buckets).toHaveLength(1);
      expect(buckets[0].modified).toBe(1);
      expect(buckets[0].added).toBe(0);
    });

    it('excludes events outside the window', () => {
      const buckets = store.bucketActivity({ since: T0 + DAY, until: T0 + 2 * DAY, bucketMs: DAY });
      expect(buckets).toHaveLength(1);
      expect(buckets[0].ts).toBe(T0 + DAY);
    });

    it('ignores an unrecognised event type instead of corrupting the bucket', () => {
      store.recordActivity({ ts: T0 + 2_000, type: 'ts' as ActivityType, instructionId: 'x' });
      store.recordActivity({ ts: T0 + 3_000, type: 'signals' as ActivityType, instructionId: 'x' });

      const buckets = store.bucketActivity({ since: T0, until: T0 + DAY, bucketMs: DAY });
      // `ts` and `signals` are real keys on the bucket object; a permissive
      // `type in bucket` check would let them be overwritten with a count.
      expect(buckets[0].ts).toBe(T0);
      expect(buckets[0].signals).toEqual({ applied: 1 });
      expect(buckets[0].added).toBe(2);
    });
  });

  it('summarizes per instance across the window', () => {
    store.recordActivity({ ts: T0, type: 'added', instructionId: 'a', instance: 'i1' });
    store.recordActivity({ ts: T0 + HOUR, type: 'added', instructionId: 'b', instance: 'i1' });
    store.recordActivity({ ts: T0 + 2 * HOUR, type: 'signaled', instructionId: 'a', signal: 'applied', instance: 'i1' });
    store.recordActivity({ ts: T0 + 3 * HOUR, type: 'modified', instructionId: 'a', instance: 'i2' });
    store.recordActivity({ ts: T0 + 4 * HOUR, type: 'removed', instructionId: 'c' });

    const rows = store.summarizeByInstance({ since: T0 - 1, until: T0 + DAY });
    const byName = Object.fromEntries(rows.map(r => [r.instance, r]));

    expect(byName['i1'].added).toBe(2);
    expect(byName['i1'].signals).toEqual({ applied: 1 });
    expect(byName['i2'].modified).toBe(1);
    // An event with no instance is attributed, not dropped.
    expect(byName['unknown'].removed).toBe(1);
  });

  describe('catalog samples', () => {
    function sample(ts: number, indexCount: number) {
      return {
        ts, indexCount, usageTotal: 0, signalCount: 0,
        sigApplied: 0, sigHelpful: 0, sigNotRelevant: 0, sigOutdated: 0,
        retrievedOnly: 0, neverUsed: 0,
      };
    }

    it('upserts on ts so re-sampling the same instant does not duplicate', () => {
      store.recordSample(sample(T0, 278));
      store.recordSample(sample(T0, 279));
      expect(store.countSamples()).toBe(1);
      expect(store.getSamples()[0].indexCount).toBe(279);
    });

    it('keeps the most RECENT n when limited, returned oldest-first', () => {
      for (let i = 0; i < 6; i++) store.recordSample(sample(T0 + i * HOUR, 100 + i));

      const tail = store.getSamples({ limit: 3 });
      // A plain `ORDER BY ts ASC LIMIT n` would return 100,101,102 -- pinning
      // the chart to ancient history as the table grows.
      expect(tail.map(r => r.indexCount)).toEqual([103, 104, 105]);
    });

    it('filters by since', () => {
      for (let i = 0; i < 6; i++) store.recordSample(sample(T0 + i * HOUR, 100 + i));
      const recent = store.getSamples({ since: T0 + 4 * HOUR });
      expect(recent.map(r => r.indexCount)).toEqual([104, 105]);
    });
  });

  it('checkpoint makes WAL data visible to a fresh connection', () => {
    store.recordActivity({ ts: T0, type: 'added', instructionId: 'wal-test' });
    store.recordSample({
      ts: T0, indexCount: 42, usageTotal: 0, signalCount: 0,
      sigApplied: 0, sigHelpful: 0, sigNotRelevant: 0, sigOutdated: 0,
      retrievedOnly: 0, neverUsed: 0,
    });
    store.checkpoint();

    const fresh = new SqliteActivityStore(path.join(tmpDir, 'activity.db'));
    expect(fresh.countActivity()).toBe(1);
    expect(fresh.countSamples()).toBe(1);
    fresh.close();
  });

  describe('importFrom', () => {
    it('imports activity and sample rows from a legacy database', () => {
      const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
      const legacyPath = path.join(legacyDir, 'activity.db');
      const legacy = new SqliteActivityStore(legacyPath);
      legacy.recordActivity({ ts: T0, type: 'added', instructionId: 'old-entry' });
      legacy.recordSample({
        ts: T0, indexCount: 10, usageTotal: 5, signalCount: 1,
        sigApplied: 1, sigHelpful: 0, sigNotRelevant: 0, sigOutdated: 0,
        retrievedOnly: 2, neverUsed: 7,
      });
      legacy.checkpoint();
      legacy.close();

      store.recordActivity({ ts: T0 + DAY, type: 'modified', instructionId: 'new-entry' });
      const result = store.importFrom(legacyPath);
      expect(result.activity).toBe(1);
      expect(result.samples).toBe(1);
      expect(store.countActivity()).toBe(2);
      expect(store.countSamples()).toBe(1);

      const events = store.listActivity();
      expect(events.some(e => e.instructionId === 'old-entry')).toBe(true);
      fs.rmSync(legacyDir, { recursive: true, force: true });
    });

    it('skips rows newer than the target to avoid duplicates', () => {
      store.recordActivity({ ts: T0, type: 'added', instructionId: 'existing' });

      const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
      const legacyPath = path.join(legacyDir, 'activity.db');
      const legacy = new SqliteActivityStore(legacyPath);
      legacy.recordActivity({ ts: T0 + DAY, type: 'added', instructionId: 'future' });
      legacy.checkpoint();
      legacy.close();

      const result = store.importFrom(legacyPath);
      expect(result.activity).toBe(0);
      expect(store.countActivity()).toBe(1);
      fs.rmSync(legacyDir, { recursive: true, force: true });
    });

    it('returns zeros for a nonexistent source', () => {
      const result = store.importFrom('/nonexistent/activity.db');
      expect(result).toEqual({ activity: 0, samples: 0 });
    });
  });

  it('prunes both tables by age and leaves newer rows intact', () => {
    store.recordActivity({ ts: T0, type: 'added', instructionId: 'old' });
    store.recordActivity({ ts: T0 + 10 * DAY, type: 'added', instructionId: 'new' });
    store.recordSample({
      ts: T0, indexCount: 1, usageTotal: 0, signalCount: 0,
      sigApplied: 0, sigHelpful: 0, sigNotRelevant: 0, sigOutdated: 0,
      retrievedOnly: 0, neverUsed: 0,
    });
    store.recordSample({
      ts: T0 + 10 * DAY, indexCount: 2, usageTotal: 0, signalCount: 0,
      sigApplied: 0, sigHelpful: 0, sigNotRelevant: 0, sigOutdated: 0,
      retrievedOnly: 0, neverUsed: 0,
    });

    const removed = store.prune(T0 + 5 * DAY);
    expect(removed).toEqual({ activity: 1, samples: 1 });
    expect(store.countActivity()).toBe(1);
    expect(store.countSamples()).toBe(1);
    expect(store.listActivity()[0].instructionId).toBe('new');
  });
});

describe('activityTypeFromAudit', () => {
  it('maps a fresh add to "added"', () => {
    expect(activityTypeFromAudit('add', { created: true, overwritten: false })).toBe('added');
  });

  it('maps an overwriting add to "modified", not a second create', () => {
    // Overwrite is how an existing entry is rewritten wholesale; counting it
    // as "added" would show growth that never happened.
    expect(activityTypeFromAudit('add', { created: false, overwritten: true })).toBe('modified');
    expect(activityTypeFromAudit('add', { created: false })).toBe('modified');
  });

  it('ignores adds that changed nothing', () => {
    expect(activityTypeFromAudit('add', { skipped: true })).toBeNull();
    expect(activityTypeFromAudit('add', { mutation_persist_failed: true })).toBeNull();
  });

  it('only counts a patch that actually changed the body', () => {
    expect(activityTypeFromAudit('patch', { changed: true })).toBe('modified');
    // A rejected precondition or a no-op patch is not a catalog change.
    expect(activityTypeFromAudit('patch', { changed: false })).toBeNull();
    expect(activityTypeFromAudit('patch', undefined)).toBeNull();
  });

  it('maps the archive lifecycle actions', () => {
    expect(activityTypeFromAudit('archive', {})).toBe('archived');
    expect(activityTypeFromAudit('restore', {})).toBe('restored');
    expect(activityTypeFromAudit('purge', {})).toBe('removed');
    expect(activityTypeFromAudit('remove', {})).toBe('removed');
    expect(activityTypeFromAudit('archive_edit', {})).toBe('modified');
  });

  it('ignores audit rows that are not catalog mutations', () => {
    // The audit stream also carries per-tool and per-HTTP-request rows; the
    // dashboard polls several endpoints every 10s, so an allowlist miss here
    // would bury real activity under request noise.
    for (const action of ['index_add', 'usage_track', 'GET /instances', 'rpc_error', 'add_write_failed', 'purge_blocked']) {
      expect(activityTypeFromAudit(action, { success: true })).toBeNull();
    }
  });

  it('only ever returns a declared activity type', () => {
    for (const action of ['add', 'patch', 'archive', 'restore', 'purge', 'remove', 'archive_edit']) {
      const type = activityTypeFromAudit(action, { created: true, changed: true });
      expect(type === null || ACTIVITY_TYPES.includes(type)).toBe(true);
    }
  });
});
