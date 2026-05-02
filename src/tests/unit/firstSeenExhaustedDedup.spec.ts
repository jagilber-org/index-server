/**
 * Regression: invariant-repair "exhausted" warning spam.
 *
 * Symptom (live, observed 2026-05-01 on dev port 8687):
 *   Each /api/admin/stats request → getIndexState() walks every entry, and
 *   for every entry whose firstSeenTs cannot be recovered, emits a stack-
 *   traced WARN. With 707 unrecoverable entries this synchronously serialized
 *   707 stack traces per request, dominating CPU and pushing 707 records into
 *   the dashboard events ring per call.
 *
 * Constitution alignment:
 *   - TS-9: failing regression test before fix.
 *   - OB-5: error/fallback paths still log at WARN (preserved); we only
 *     deduplicate per-id within a process so the channel stays usable.
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

function fakeEntry(id: string): InstructionEntry {
  // firstSeenTs deliberately undefined — this is the unrecoverable case.
  return { id } as unknown as InstructionEntry;
}

beforeEach(() => {
  vi.resetModules();
});

describe('restoreFirstSeenInvariant: exhausted-warn deduplication', () => {
  it('1) logs exhausted-warn at most once per id across many invocations', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    const entry = fakeEntry('alpha');
    for (let i = 0; i < 50; i++) ctx._internal?.restoreFirstSeenInvariant(entry);
    const exhausted = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    );
    expect(exhausted.length).toBe(1);
  });

  it('2) logs exhausted-warn once per distinct id', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    for (const id of ['a', 'b', 'c']) {
      const e = fakeEntry(id);
      for (let i = 0; i < 5; i++) ctx._internal?.restoreFirstSeenInvariant(e);
    }
    const exhausted = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    );
    expect(exhausted.length).toBe(3);
  });

  it('3) emits no warn at all when firstSeenTs is already set', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    const e = { id: 'happy', firstSeenTs: '2026-05-01T00:00:00.000Z' } as unknown as InstructionEntry;
    for (let i = 0; i < 10; i++) ctx._internal?.restoreFirstSeenInvariant(e);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('4) reset latch re-arms the dedup so a subsequent call re-warns', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    const e = fakeEntry('reset-id');
    ctx._internal?.restoreFirstSeenInvariant(e);
    ctx._internal?.restoreFirstSeenInvariant(e);
    const before = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    ).length;
    expect(before).toBe(1);

    ctx._resetIndexContextProcessLatches?.();
    ctx._internal?.restoreFirstSeenInvariant(e);
    const after = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    ).length;
    expect(after).toBe(2);
  });

  it('5) under simulated stats-poll storm (200 calls × 10 ids), warn count is exactly 10', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../../services/logger.js', () => ({
      logWarn: warnSpy, logInfo: vi.fn(), logError: vi.fn(), logDebug: vi.fn(),
    }));
    const ctx = await import('../../services/indexContext.js') as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    const ids = Array.from({ length: 10 }, (_, i) => `id-${i}`);
    for (let poll = 0; poll < 200; poll++) {
      for (const id of ids) ctx._internal?.restoreFirstSeenInvariant(fakeEntry(id));
    }
    const exhausted = warnSpy.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('repair exhausted'),
    );
    expect(exhausted.length).toBe(10);
  });
});
