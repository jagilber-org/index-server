/**
 * Regression: imported / added entries trip "[invariant-repair] firstSeenTs
 * repair exhausted" WARN on every getIndexState() call.
 *
 * Symptom (live, observed 2026-05-01 on dev port 8687, PID 85776):
 *   1. User calls index_import → returns { verified: true, imported: 1 }.
 *   2. ~minutes later (next dashboard /api/admin/stats poll) the dev log
 *      emits a stack-traced WARN
 *      "[invariant-repair] firstSeenTs repair exhausted — no source found
 *      for diag-import-redgreen-2026-05-01-v2".
 *   3. User reads log, concludes "import is broken" (3rd loop in session).
 *
 * Root cause:
 *   - index_import / index_add never set entry.firstSeenTs at creation —
 *     it is established only on first usage_track increment.
 *   - getIndexState() walks every entry and calls restoreFirstSeenInvariant
 *     for any entry missing firstSeenTs. None of the repair sources
 *     (firstSeenAuthority / ephemeralFirstSeen / lastGoodUsageSnapshot)
 *     contain a fresh, never-used entry → "exhausted" WARN fires.
 *
 * Fix (two layers):
 *   A. Write path (writeEntry / writeEntryAsync): set firstSeenTs = createdAt
 *      (or `now` if createdAt missing) when missing, so newly persisted
 *      entries land on disk with the invariant satisfied.
 *   B. Repair path (restoreFirstSeenInvariant): before declaring "exhausted",
 *      fall back to e.createdAt — semantically valid (an entry's "first
 *      seen" timestamp can never precede its creation timestamp) and
 *      heals legacy entries already on disk without firstSeenTs.
 *
 * Constitution alignment:
 *   - TS-9: failing regression test before fix.
 *   - OB-6: fix at source — never silence the WARN by raising thresholds.
 *   - TS-12: ≥5 scenarios.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InstructionEntry } from '../../models/instruction';

interface IndexCtxInternals {
  restoreFirstSeenInvariant: (e: InstructionEntry) => void;
}
interface IndexCtxModule {
  _internal?: IndexCtxInternals;
  _resetIndexContextProcessLatches?: () => void;
}

beforeEach(() => {
  vi.resetModules();
});

describe('firstSeenTs createdAt fallback (no spurious exhausted-warn for fresh entries)', () => {
  it('1) entry with createdAt but no firstSeenTs → repaired silently from createdAt, NO exhausted-warn', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    const createdAt = '2026-05-01T21:35:43.000Z';
    const e = { id: 'fresh-import', createdAt } as unknown as InstructionEntry;
    ctx._internal?.restoreFirstSeenInvariant(e);
    expect(e.firstSeenTs).toBe(createdAt);
    const exhausted = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    );
    expect(exhausted.length).toBe(0);
  });

  it('2) entry without firstSeenTs AND without createdAt still emits exhausted-warn (truly unrecoverable)', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    const e = { id: 'truly-broken' } as unknown as InstructionEntry;
    ctx._internal?.restoreFirstSeenInvariant(e);
    const exhausted = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    );
    expect(exhausted.length).toBe(1);
  });

  it('3) 200 stats-poll storm over 10 freshly-imported entries with createdAt → ZERO exhausted-warns', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    const createdAt = '2026-05-01T00:00:00.000Z';
    const entries: InstructionEntry[] = Array.from({ length: 10 }, (_, i) =>
      ({ id: `imp-${i}`, createdAt } as unknown as InstructionEntry),
    );
    for (let poll = 0; poll < 200; poll++) {
      for (const e of entries) {
        if (!e.firstSeenTs) ctx._internal?.restoreFirstSeenInvariant(e);
      }
    }
    const exhausted = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    );
    expect(exhausted.length).toBe(0);
  });

  it('4) sanity: createdAt fallback survives across many distinct ids without leaking warns', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    const ids = Array.from({ length: 50 }, (_, i) => `bulk-${i}`);
    for (const id of ids) {
      const e = { id, createdAt: '2026-04-01T00:00:00.000Z' } as unknown as InstructionEntry;
      ctx._internal?.restoreFirstSeenInvariant(e);
      expect(e.firstSeenTs).toBe('2026-04-01T00:00:00.000Z');
    }
    const exhausted = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    );
    expect(exhausted.length).toBe(0);
  });

  it('5) mixed batch: entries WITH createdAt are silent; entries WITHOUT both fields warn-once each', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    const healable = Array.from({ length: 5 }, (_, i) =>
      ({ id: `heal-${i}`, createdAt: '2026-04-01T00:00:00.000Z' } as unknown as InstructionEntry),
    );
    const broken = Array.from({ length: 3 }, (_, i) => ({ id: `broken-${i}` } as unknown as InstructionEntry));
    for (const e of [...healable, ...broken]) ctx._internal?.restoreFirstSeenInvariant(e);
    // re-process: still no extra warns for healable, no duplicate warns for broken
    for (const e of [...healable, ...broken]) {
      if (!e.firstSeenTs) ctx._internal?.restoreFirstSeenInvariant(e);
    }
    const exhausted = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    );
    expect(exhausted.length).toBe(3);
  });
});
