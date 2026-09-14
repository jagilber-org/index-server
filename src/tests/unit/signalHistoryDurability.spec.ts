/**
 * signalHistory must survive a restart (schema v9).
 *
 * `usage_track` records a signal by mutating the loaded `InstructionEntry`:
 *
 *   e.signalHistory = history;
 *   e.lastSignaledAt = signalTs;
 *
 * But `incrementUsage()` performs no catalog write — `usageSnapshotFile.ts`
 * says so in its own header: "incrementUsage flushes counters to
 * data/usage-snapshot.json and does NOT rewrite the instruction entry files".
 * The only durability path is `flushUsageSnapshot()` → `UsagePersistRecord`.
 *
 * `lastSignaledAt` was added to that record; `signalHistory` was not. The
 * result is an ASYMMETRIC ROUND-TRIP: after a restart the entry reads
 * `lastSignaledAt: "<ts>"` with an empty history — a new split between the
 * timestamp and the record it timestamps, which is exactly the split the
 * feature exists to close. Constitution DI-4 forbids this shape.
 *
 * Every other usage-derived field on the entry has three durability
 * mechanisms (an in-memory authority map, a snapshot field, and explicit
 * restore logic in `incrementUsage`). `signalHistory` had none.
 *
 * These tests operate on the persistence layer directly rather than driving a
 * server, because that is where the defect lives and it keeps them fast and
 * deterministic.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { InstructionEntry, SignalHistoryItem } from '../../models/instruction.js';

/** mergeUsageRecord is generic over Record<string, unknown>; these aliases keep the fixtures honest without fighting the signature. */
type Rec = Record<string, unknown>;
type Ent = InstructionEntry & { signalHistory?: SignalHistoryItem[] };

const ENV_KEYS = ['INDEX_SERVER_USAGE_SNAPSHOT_PATH', 'INDEX_SERVER_STORAGE_BACKEND'] as const;

describe('signalHistory durability across a restart', () => {
  let tmpDir: string;
  let snapPath: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-durability-'));
    snapPath = path.join(tmpDir, 'usage-snapshot.json');
    saved = {};
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = snapPath;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('carries signalHistory onto the persisted usage record', async () => {
    const { mergeUsageRecord } = await import('../../services/storage/usageSnapshotFile.js');

    const entry: Rec = { id: 'alpha' };
    const merged = mergeUsageRecord(entry, {
      lastSignaledAt: '2026-09-11T10:00:00.000Z',
      signalHistory: [
        { signal: 'helpful', ts: '2026-09-11T10:00:00.000Z', comment: 'worked' },
        { signal: 'outdated', ts: '2026-09-11T09:00:00.000Z' },
      ],
    }) as unknown as Ent;

    // The defect: lastSignaledAt round-trips and signalHistory does not, so the
    // entry reads as "signalled at T" with nothing recording what the signal was.
    expect(merged.lastSignaledAt).toBe('2026-09-11T10:00:00.000Z');
    expect(merged.signalHistory, 'signalHistory must survive the snapshot round-trip').toBeDefined();
    expect(merged.signalHistory).toHaveLength(2);
    expect(merged.signalHistory?.[0]).toMatchObject({ signal: 'helpful', comment: 'worked' });
  });

  it('unions history from two processes rather than letting one overwrite the other', async () => {
    const { mergeUsageRecord } = await import('../../services/storage/usageSnapshotFile.js');

    // Process A's in-memory entry and process B's persisted record hold
    // different events for the same id — the multi-client case.
    const entry: Rec = {
      id: 'alpha',
      signalHistory: [{ signal: 'helpful', ts: '2026-09-11T10:00:00.000Z' }],
    };

    const merged = mergeUsageRecord(entry, {
      signalHistory: [{ signal: 'outdated', ts: '2026-09-11T09:00:00.000Z' }],
    }) as unknown as Ent;

    expect(merged.signalHistory).toHaveLength(2);
    expect(merged.signalHistory?.map(h => h.signal)).toEqual(['helpful', 'outdated']);
  });

  it('keeps the merged history newest-first and capped at 10', async () => {
    const { mergeUsageRecord } = await import('../../services/storage/usageSnapshotFile.js');

    // 8 in memory + 8 persisted, disjoint timestamps => 16 candidates, cap 10.
    const mem = Array.from({ length: 8 }, (_, i) => ({
      signal: 'helpful',
      ts: `2026-09-11T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
    }));
    const disk = Array.from({ length: 8 }, (_, i) => ({
      signal: 'outdated',
      ts: `2026-09-10T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
    }));

    const merged = mergeUsageRecord(
      { id: 'alpha', signalHistory: mem } as Rec,
      { signalHistory: disk },
    ) as unknown as Ent;

    const hist = merged.signalHistory ?? [];
    expect(hist).toHaveLength(10);
    // newest first
    const ts = hist.map(h => h.ts);
    expect([...ts].sort().reverse()).toEqual(ts);
    // the 8 newest (all from `mem`) must be present; the oldest disk ones drop
    expect(hist[0].ts).toBe('2026-09-11T17:00:00.000Z');
  });

  it('de-duplicates identical events seen by both sides', async () => {
    const { mergeUsageRecord } = await import('../../services/storage/usageSnapshotFile.js');

    const shared = { signal: 'helpful', ts: '2026-09-11T10:00:00.000Z' };
    const merged = mergeUsageRecord(
      { id: 'alpha', signalHistory: [shared] } as Rec,
      { signalHistory: [{ ...shared }] },
    ) as unknown as Ent;

    expect(merged.signalHistory, 'the same event recorded twice must not duplicate').toHaveLength(1);
  });

  it('tolerates a corrupt signalHistory on either side without throwing', async () => {
    const { mergeUsageRecord } = await import('../../services/storage/usageSnapshotFile.js');

    // A hand-edited or partially-written catalog entry can carry a non-array.
    // `[...e.signalHistory]` would throw on this, taking down the merge for
    // every OTHER entry in the same pass.
    expect(() => mergeUsageRecord(
      { id: 'alpha', signalHistory: 'not-an-array' as unknown as [] } as Rec,
      { signalHistory: [{ signal: 'helpful', ts: '2026-09-11T10:00:00.000Z' }] },
    )).not.toThrow();

    expect(() => mergeUsageRecord(
      { id: 'alpha' } as Rec,
      { signalHistory: { bogus: true } as unknown as [] },
    )).not.toThrow();
  });

  it('flushUsageSnapshot writes signalHistory to disk', async () => {
    const { writePersistedUsage, readPersistedUsage, closeUsagePersistence } =
      await import('../../services/usagePersistence.js');

    writePersistedUsage({
      alpha: {
        usageCount: 1,
        retrievedCount: 1,
        appliedCount: 0,
        lastSignaledAt: '2026-09-11T10:00:00.000Z',
        signalHistory: [{ signal: 'helpful', ts: '2026-09-11T10:00:00.000Z' }],
      },
    });

    const back = readPersistedUsage();
    closeUsagePersistence();

    expect(back.alpha?.signalHistory, 'signalHistory must be persisted, not dropped by the writer')
      .toBeDefined();
    expect(back.alpha?.signalHistory).toHaveLength(1);
    expect(back.alpha?.signalHistory?.[0].signal).toBe('helpful');
  });
});
