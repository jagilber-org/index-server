/**
 * Dashboard overview counters invariant (#356).
 *
 * The three counters surfaced on the dashboard overview — "index Accepted",
 * "index Files", "index Skipped" — MUST satisfy
 *
 *     files === accepted + skipped
 *
 * Prior to this fix `rawFileCount` was overwritten with the *current*
 * `ensureLoaded().list.length` while `accepted` / `skipped` came from the
 * load-time `loadSummary` snapshot. That produced numbers like
 * `accepted=687, files=689, skipped=9` where accepted+skipped !== files.
 *
 * Refs: jagilber-dev/index-server#356
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface MockLoadSummary { scanned: number; accepted: number; skipped: number }
interface MockIndexState { list: unknown[]; loadSummary?: MockLoadSummary; loadDebug?: { scanned: number; accepted: number } }

let mockState: MockIndexState = { list: [], loadSummary: { scanned: 0, accepted: 0, skipped: 0 } };

vi.mock('../../services/indexContext', () => ({
  getIndexState: () => mockState,
  ensureLoaded: () => mockState,
  invalidate: () => undefined,
  touchIndexVersion: () => undefined,
}));

import { AdminPanel } from '../../dashboard/server/AdminPanel';

function setState(scanned: number, accepted: number, skipped: number, listLen = accepted): void {
  mockState = {
    list: Array.from({ length: listLen }, (_, i) => ({ id: `i${i}`, schemaVersion: '1.0.0' })),
    loadSummary: { scanned, accepted, skipped },
  };
}

function setStateWithoutSummary(listLen: number): void {
  mockState = {
    list: Array.from({ length: listLen }, (_, i) => ({ id: `i${i}`, schemaVersion: '1.0.0' })),
  };
}

describe('dashboard overview counters invariant (#356)', () => {
  let panel: AdminPanel;

  beforeEach(() => {
    panel = new AdminPanel();
  });

  it('files === accepted + skipped on a clean load (no in-memory drift)', () => {
    setState(/*scanned*/ 100, /*accepted*/ 95, /*skipped*/ 5);
    const stats = panel.getAdminStats();
    const { acceptedInstructions, rawFileCount, skippedInstructions } = stats.indexStats;
    expect(acceptedInstructions).toBe(95);
    expect(skippedInstructions).toBe(5);
    expect(rawFileCount).toBe(100);
    expect(acceptedInstructions + skippedInstructions).toBe(rawFileCount);
  });

  it('files counter does NOT drift with in-memory list.length after mutations (regression for #356)', () => {
    // Simulate the bug condition: loadSummary says scanned=689/accepted=687/skipped=2,
    // but the in-memory list has grown to 700 entries after mutations. The
    // overview must still report scanned-coherent numbers, not the current list size.
    setState(/*scanned*/ 689, /*accepted*/ 687, /*skipped*/ 2, /*listLen*/ 700);
    const stats = panel.getAdminStats();
    const { acceptedInstructions, rawFileCount, skippedInstructions } = stats.indexStats;
    expect(rawFileCount).toBe(689);
    expect(acceptedInstructions).toBe(687);
    expect(skippedInstructions).toBe(2);
    expect(acceptedInstructions + skippedInstructions).toBe(rawFileCount);
  });

  it('reconciles invariant violation by deriving skipped = scanned - accepted', () => {
    // Original reported bug example: 687 / 689 / 9. accepted+skipped=696 != 689.
    setState(/*scanned*/ 689, /*accepted*/ 687, /*skipped*/ 9);
    const stats = panel.getAdminStats();
    const { acceptedInstructions, rawFileCount, skippedInstructions } = stats.indexStats;
    expect(acceptedInstructions).toBe(687);
    expect(rawFileCount).toBe(689);
    // Reported 9 was inconsistent; derived value enforces the invariant.
    expect(skippedInstructions).toBe(2);
    expect(acceptedInstructions + skippedInstructions).toBe(rawFileCount);
  });

  it('without loadSummary, derives skipped so invariant still holds', () => {
    setStateWithoutSummary(50);
    const stats = panel.getAdminStats();
    const { acceptedInstructions, rawFileCount, skippedInstructions } = stats.indexStats;
    expect(acceptedInstructions).toBe(50);
    // rawFileCount falls back to scanned (= accepted when no loadDebug),
    // or disk count if instructions dir exists. Either way the invariant holds.
    expect(acceptedInstructions + skippedInstructions).toBe(rawFileCount);
  });
});
