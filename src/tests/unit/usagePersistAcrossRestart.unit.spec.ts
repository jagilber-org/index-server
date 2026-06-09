import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate test instructions to a temp dir (never write to repo root)
const INSTR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-test-usage-restart-'));
process.env.INDEX_SERVER_DIR = INSTR_DIR;
process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = path.join(INSTR_DIR, 'usage-snapshot.json');
process.env.INDEX_SERVER_FEATURES = 'usage';

// Defer import until after env prepared
import {
  ensureLoaded,
  writeEntry,
  incrementUsage,
  invalidate,
  __testResetUsageState,
  _resetIndexContextStateForTests,
  getIndexState,
} from '../../services/indexContext';
import { enableFeature } from '../../services/features';

function makeEntry(id: string) {
  return {
    id,
    title: `Title ${id}`,
    body: 'Sample body',
    version: '1.0.0',
    categories: ['scope-workspace-unit', 'type-test'],
  } as any;
}

/**
 * RCA 2026-05-20 (live prod MCP):
 *
 * Bug: After `usage_track` increments and `flushUsageSnapshot()` writes the
 * authoritative count to `usage-snapshot.json`, restarting the server caused
 * `usageCount` and `lastUsedAt` to revert to whatever was baked into the
 * entry's JSON file on disk. The snapshot was silently ignored because the
 * overlay in `ensureLoaded`/`ensureLoadedAsync` only applied snapshot values
 * when the entry's field was `null`/missing.
 *
 * Constitution violations:
 *   - DI-1 (stateful data MUST persist; startup MUST auto-restore)
 *   - DI-4 (write paths MUST mirror read paths)
 *
 * Test gap: no existing test seeded a stale `usageCount` on disk and then
 * verified that a newer snapshot value wins on reload. The existing
 * `indexContext.usage.unit.spec.ts` only validated in-memory monotonic
 * increments and never simulated a restart with snapshot vs. entry conflict.
 */
describe('usage snapshot is authoritative across restart (regression: DI-1, DI-4)', () => {
  beforeAll(() => {
    __testResetUsageState();
    enableFeature('usage');
  });

  afterAll(() => {
    __testResetUsageState();
    try {
      fs.rmSync(INSTR_DIR, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  beforeEach(() => {
    __testResetUsageState();
    _resetIndexContextStateForTests();
  });

  it('snapshot usageCount overrides stale entry-file usageCount after reload', () => {
    const id = 'unit_restart_overlay_' + Date.now();
    writeEntry(makeEntry(id));

    // Simulate the pre-restart state seen live: entry file has a stale low
    // count baked in (from an earlier writeEntry that ran before later
    // increments), while the snapshot holds the newer authoritative value.
    const entryFile = path.join(INSTR_DIR, id + '.json');
    const raw = JSON.parse(fs.readFileSync(entryFile, 'utf8'));
    raw.usageCount = 1;
    raw.lastUsedAt = '2026-05-04T18:38:49.670Z';
    fs.writeFileSync(entryFile, JSON.stringify(raw, null, 2));

    const snapPath = path.join(INSTR_DIR, 'usage-snapshot.json');
    fs.writeFileSync(
      snapPath,
      JSON.stringify(
        {
          [id]: {
            usageCount: 5,
            firstSeenTs: '2026-03-23T20:28:49.652Z',
            lastUsedAt: '2026-05-20T22:39:56.235Z',
            lastAction: 'applied',
            lastSignal: 'helpful',
          },
        },
        null,
        2,
      ),
    );

    // Simulate a full restart: drop in-memory state so the next ensureLoaded()
    // rebuilds entirely from disk.
    invalidate();
    _resetIndexContextStateForTests();

    ensureLoaded();
    const e = getIndexState().byId.get(id);
    expect(e, 'entry should reload from disk').toBeTruthy();
    expect(e!.usageCount, 'snapshot count (5) must win over stale entry count (1)').toBe(5);
    expect(e!.lastUsedAt, 'snapshot lastUsedAt must win over stale entry lastUsedAt').toBe(
      '2026-05-20T22:39:56.235Z',
    );
    // firstSeenTs is immutable once set; entry-file value (stamped at writeEntry
    // from createdAt) is authoritative when present.
    expect(e!.firstSeenTs).toBeTruthy();
  });

  it('snapshot does NOT regress a newer entry-file usageCount (monotonic)', () => {
    // Defensive invariant: if entry file somehow holds a HIGHER count than the
    // snapshot (e.g. backup restored, manual edit), the loader must keep the
    // higher value. Snapshot is authoritative only when monotonically newer.
    const id = 'unit_restart_monotonic_' + Date.now();
    writeEntry(makeEntry(id));

    const entryFile = path.join(INSTR_DIR, id + '.json');
    const raw = JSON.parse(fs.readFileSync(entryFile, 'utf8'));
    raw.usageCount = 10;
    raw.lastUsedAt = '2026-06-01T00:00:00.000Z';
    fs.writeFileSync(entryFile, JSON.stringify(raw, null, 2));

    const snapPath = path.join(INSTR_DIR, 'usage-snapshot.json');
    fs.writeFileSync(
      snapPath,
      JSON.stringify(
        {
          [id]: {
            usageCount: 3,
            firstSeenTs: '2026-03-23T20:28:49.652Z',
            lastUsedAt: '2026-05-20T22:39:56.235Z',
          },
        },
        null,
        2,
      ),
    );

    invalidate();
    _resetIndexContextStateForTests();
    ensureLoaded();
    const e = getIndexState().byId.get(id);
    expect(e!.usageCount).toBe(10);
    expect(e!.lastUsedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('end-to-end: incrementUsage value survives full restart cycle', () => {
    const id = 'unit_restart_e2e_' + Date.now();
    writeEntry(makeEntry(id));

    // First two increments flush synchronously per incrementUsage contract.
    const r1 = incrementUsage(id) as any;
    expect(r1.usageCount).toBe(1);
    const r2 = incrementUsage(id) as any;
    expect(r2.usageCount).toBe(2);

    // Simulate that a subsequent writeEntry (e.g. index_update) baked the
    // then-current count into the entry file. The next increment lives only
    // in the snapshot until the next entry-file write.
    const entryFile = path.join(INSTR_DIR, id + '.json');
    const raw = JSON.parse(fs.readFileSync(entryFile, 'utf8'));
    raw.usageCount = 2;
    raw.lastUsedAt = r2.lastUsedAt;
    fs.writeFileSync(entryFile, JSON.stringify(raw, null, 2));

    // Manually advance the snapshot to count=4 (simulating later increments
    // that flushed to snapshot but did not rewrite the entry file).
    const snapPath = path.join(INSTR_DIR, 'usage-snapshot.json');
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    snap[id].usageCount = 4;
    snap[id].lastUsedAt = '2026-05-20T23:00:00.000Z';
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));

    // Restart.
    invalidate();
    _resetIndexContextStateForTests();
    ensureLoaded();

    const e = getIndexState().byId.get(id);
    expect(e!.usageCount, 'post-restart count must reflect snapshot (4), not stale entry (2)').toBe(4);
    expect(e!.lastUsedAt).toBe('2026-05-20T23:00:00.000Z');
  });
});
