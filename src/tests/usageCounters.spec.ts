import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { resolveUsageKind, deriveUsageCount, backfillLegacyCounters } from '../services/usageCounters';

// Isolated instructions + snapshot dir (never touch repo root data/).
const INSTR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-test-counters-'));
const SNAP_PATH = path.join(INSTR_DIR, 'usage-snapshot.json');
process.env.INDEX_SERVER_DIR = INSTR_DIR;
process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = SNAP_PATH;
process.env.INDEX_SERVER_FEATURES = 'usage';

import { writeEntry, incrementUsage, __testResetUsageState, getIndexState, invalidate } from '../services/indexContext';
import { enableFeature } from '../services/features';

function makeEntry(id: string) {
  return { id, title: `Title ${id}`, body: 'Sample body', version: '1.0.0', categories: ['workspace-unit', 'testing'] } as any;
}

function readSnap(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8')); } catch { return {}; }
}

describe('usageCounters.resolveUsageKind', () => {
  it('maps retrieval actions to retrieved', () => {
    for (const a of ['search', 'get', 'query', 'export', 'retrieved', 'list', 'listScoped']) {
      expect(resolveUsageKind(a)).toBe('retrieved');
    }
  });
  it('maps applied/cited actions to applied', () => {
    expect(resolveUsageKind('applied')).toBe('applied');
    expect(resolveUsageKind('cited')).toBe('applied');
  });
  it('maps signal:applied to applied even without action', () => {
    expect(resolveUsageKind(undefined, 'applied')).toBe('applied');
  });
  it('applied action takes precedence over feedback signal', () => {
    expect(resolveUsageKind('cited', 'helpful')).toBe('applied');
  });
  it('feedback signals with no action advance nothing', () => {
    for (const s of ['helpful', 'not-relevant', 'outdated']) {
      expect(resolveUsageKind(undefined, s)).toBe('none');
    }
  });
  it('missing action and signal defaults to retrieved', () => {
    expect(resolveUsageKind()).toBe('retrieved');
  });
  it('unknown action with no signal defaults to retrieved', () => {
    expect(resolveUsageKind('mystery')).toBe('retrieved');
  });
});

describe('usageCounters.derive/backfill', () => {
  it('derives usageCount as sum of split counters', () => {
    expect(deriveUsageCount({ retrievedCount: 3, appliedCount: 2 })).toBe(5);
    expect(deriveUsageCount({ retrievedCount: 4 })).toBe(4);
    expect(deriveUsageCount({})).toBe(0);
  });
  it('backfills a legacy record (only usageCount) as retrieved with applied=0', () => {
    const rec = backfillLegacyCounters({ usageCount: 7 });
    expect(rec.retrievedCount).toBe(7);
    expect(rec.appliedCount).toBe(0);
    expect(rec.usageCount).toBe(7);
  });
  it('does not clobber a consistent already-split record', () => {
    const rec = backfillLegacyCounters({ retrievedCount: 2, appliedCount: 5, usageCount: 7 });
    expect(rec.retrievedCount).toBe(2);
    expect(rec.appliedCount).toBe(5);
    expect(rec.usageCount).toBe(7); // recomputed from split (== explicit)
  });
  it('honors an explicit usageCount above the split as a monotonic floor (surplus → retrieved)', () => {
    // DI-1: counts must never regress. When a record carries a higher explicit
    // total than its known split (e.g. legacy increments that bumped the total
    // but not the breakdown), the surplus is attributed to retrievals.
    const rec = backfillLegacyCounters({ retrievedCount: 2, appliedCount: 0, usageCount: 4 });
    expect(rec.appliedCount).toBe(0);
    expect(rec.retrievedCount).toBe(4); // 2 known + 2 surplus
    expect(rec.usageCount).toBe(4);
  });
});

describe('incrementUsage split counters', () => {
  beforeAll(() => { __testResetUsageState(); enableFeature('usage'); });
  beforeEach(() => { __testResetUsageState(); enableFeature('usage'); });
  afterAll(() => { __testResetUsageState(); try { fs.rmSync(INSTR_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('retrieved kind bumps retrievedCount, not appliedCount', () => {
    const id = 'split_retrieved_' + Date.now();
    writeEntry(makeEntry(id));
    const r = incrementUsage(id, { action: 'search' }) as any;
    expect(r.retrievedCount).toBe(1);
    expect(r.appliedCount).toBe(0);
    expect(r.usageCount).toBe(1);
    expect(r.lastRetrievedAt).toBeTruthy();
    expect(r.lastAppliedAt).toBeUndefined();
    expect(r.lastUsedAt).toBeTruthy();
  });

  it('applied kind bumps appliedCount, not retrievedCount', () => {
    const id = 'split_applied_' + Date.now();
    writeEntry(makeEntry(id));
    const r = incrementUsage(id, { action: 'applied' }) as any;
    expect(r.appliedCount).toBe(1);
    expect(r.retrievedCount).toBe(0);
    expect(r.usageCount).toBe(1);
    expect(r.lastAppliedAt).toBeTruthy();
    expect(r.lastRetrievedAt).toBeUndefined();
  });

  it('signal-only feedback advances neither counter but records lastSignal', () => {
    const id = 'split_signal_' + Date.now();
    writeEntry(makeEntry(id));
    const r = incrementUsage(id, { signal: 'helpful' }) as any;
    expect(r.usageCount).toBe(0);
    expect(r.retrievedCount).toBe(0);
    expect(r.appliedCount).toBe(0);
    expect(r.signal).toBe('helpful');
    const snap = readSnap();
    expect(snap[id]?.lastSignal).toBe('helpful');
  });

  it('mixed sequence accumulates per counter and usageCount=sum', () => {
    const id = 'split_mixed_' + Date.now();
    writeEntry(makeEntry(id));
    incrementUsage(id, { action: 'search' });
    incrementUsage(id, { action: 'get' });
    const r = incrementUsage(id, { action: 'applied' }) as any;
    expect(r.retrievedCount).toBe(2);
    expect(r.appliedCount).toBe(1);
    expect(r.usageCount).toBe(3);
  });

  it('snapshot round-trip preserves split counters across reload', () => {
    const id = 'split_roundtrip_' + Date.now();
    writeEntry(makeEntry(id));
    incrementUsage(id, { action: 'search' });
    incrementUsage(id, { action: 'applied' });
    invalidate();
    const st = getIndexState();
    const e = st.byId.get(id) as any;
    expect(e.retrievedCount).toBe(1);
    expect(e.appliedCount).toBe(1);
    expect(e.usageCount).toBe(2);
  });

  it('legacy snapshot (usageCount only) loads as retrieved=usageCount, applied=0', () => {
    const id = 'split_legacy_' + Date.now();
    writeEntry(makeEntry(id));
    // Simulate a pre-#418 snapshot containing only usageCount.
    const legacy: Record<string, any> = {};
    legacy[id] = { usageCount: 5, firstSeenTs: new Date().toISOString(), lastUsedAt: new Date().toISOString() };
    fs.writeFileSync(SNAP_PATH, JSON.stringify(legacy, null, 2));
    __testResetUsageState();
    // __testResetUsageState deletes snapshot; rewrite it after reset to model an on-disk legacy file.
    fs.writeFileSync(SNAP_PATH, JSON.stringify(legacy, null, 2));
    invalidate();
    const st = getIndexState();
    const e = st.byId.get(id) as any;
    expect(e.usageCount).toBe(5);
    expect(e.retrievedCount).toBe(5);
    expect(e.appliedCount).toBe(0);
  });
});
