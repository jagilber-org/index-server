import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolated instructions + snapshot dir (never touch repo root data/).
const INSTR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-test-autotrack-'));
const SNAP_PATH = path.join(INSTR_DIR, 'usage-snapshot.json');
process.env.INDEX_SERVER_DIR = INSTR_DIR;
process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = SNAP_PATH;
process.env.INDEX_SERVER_FEATURES = 'usage';
process.env.INDEX_SERVER_AUTO_USAGE_TRACK = '1';

import { reloadRuntimeConfig } from '../config/runtimeConfig.js';
import { getHandler } from '../server/registry.js';
import { writeEntry, __testResetUsageState, getIndexState, invalidate } from '../services/indexContext.js';
import { enableFeature } from '../services/features.js';

const TOKEN = 'zztracktoken';

function makeEntry(id: string, body = `Sample body ${TOKEN}`) {
  return { id, title: `Title ${id} ${TOKEN}`, body, version: '1.0.0', categories: ['workspace-unit', 'testing'] } as any;
}

function countOf(id: string): { retrieved: number; applied: number; usage: number } {
  const e = getIndexState().byId.get(id);
  return { retrieved: e?.retrievedCount ?? 0, applied: e?.appliedCount ?? 0, usage: e?.usageCount ?? 0 };
}

describe('issue #418 auto-track scope', () => {
  beforeAll(async () => {
    reloadRuntimeConfig();
    enableFeature('usage');
    await import('../services/handlers.search.js');
    await import('../services/handlers.instructions.js');
    await import('../services/instructions.dispatcher.js');
    await import('../services/handlers.usage.js');
  });

  beforeEach(() => {
    __testResetUsageState();
    invalidate();
    enableFeature('usage');
  });

  afterAll(() => {
    __testResetUsageState();
    try { fs.rmSync(INSTR_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.INDEX_SERVER_AUTO_USAGE_TRACK;
  });

  it('index_search auto-tracks at most top-3 results as retrieved', async () => {
    const ids = ['ats_s1', 'ats_s2', 'ats_s3', 'ats_s4', 'ats_s5'];
    for (const id of ids) writeEntry(makeEntry(id));
    invalidate();

    const search = getHandler('index_search')!;
    const res = (await Promise.resolve(search({ keywords: [TOKEN], mode: 'keyword', limit: 50 }))) as Record<string, unknown>;
    const results = (res.results as Array<{ instructionId: string }>) || [];
    expect(results.length).toBeGreaterThanOrEqual(5);

    const tracked = ids.filter(id => countOf(id).retrieved > 0);
    expect(tracked.length).toBe(3); // min(3, results)
    // Every tracked entry advanced retrievedCount only, applied stays 0.
    for (const id of tracked) {
      const c = countOf(id);
      expect(c.retrieved).toBe(1);
      expect(c.applied).toBe(0);
      expect(c.usage).toBe(1);
    }
  });

  it('index_search tracks all results when fewer than 3 match', async () => {
    const ids = ['ats_few1', 'ats_few2'];
    for (const id of ids) writeEntry(makeEntry(id, `unique-${id}-${TOKEN}only`));
    invalidate();

    const search = getHandler('index_search')!;
    await Promise.resolve(search({ keywords: [`${TOKEN}only`], mode: 'keyword', limit: 50 }));

    const tracked = ids.filter(id => countOf(id).retrieved > 0);
    expect(tracked.length).toBeGreaterThanOrEqual(1);
    expect(tracked.length).toBeLessThanOrEqual(2);
  });

  it('dispatch query auto-tracks top-3 result ids as retrieved', async () => {
    const ids = ['atq_1', 'atq_2', 'atq_3', 'atq_4'];
    for (const id of ids) writeEntry({ ...makeEntry(id), categories: ['workspace-unit', 'queryscope'] });
    invalidate();

    const dispatch = getHandler('index_dispatch')!;
    const res = (await Promise.resolve(dispatch({ action: 'query', categoriesAny: ['queryscope'], limit: 100 }))) as Record<string, unknown>;
    const items = (res.items as Array<{ id: string }>) || [];
    expect(items.length).toBe(4);

    const tracked = ids.filter(id => countOf(id).retrieved > 0);
    expect(tracked.length).toBe(3);
  });

  it('dispatch export auto-tracks explicitly requested ids as retrieved', async () => {
    const ids = ['ate_1', 'ate_2', 'ate_3'];
    for (const id of ids) writeEntry(makeEntry(id));
    invalidate();

    const dispatch = getHandler('index_dispatch')!;
    await Promise.resolve(dispatch({ action: 'export', ids: ['ate_1', 'ate_2'] }));

    expect(countOf('ate_1').retrieved).toBe(1);
    expect(countOf('ate_2').retrieved).toBe(1);
    expect(countOf('ate_3').retrieved).toBe(0); // not requested → not tracked
  });

  it('dispatch list does NOT auto-track (browse, not retrieval)', async () => {
    const ids = ['atl_1', 'atl_2'];
    for (const id of ids) writeEntry({ ...makeEntry(id), categories: ['workspace-unit', 'listscope'] });
    invalidate();

    const dispatch = getHandler('index_dispatch')!;
    await Promise.resolve(dispatch({ action: 'list' }));

    for (const id of ids) expect(countOf(id).usage).toBe(0);
  });
});

describe('issue #418 usage_hotset split-counter ranking', () => {
  beforeAll(async () => {
    reloadRuntimeConfig();
    enableFeature('usage');
    await import('../services/handlers.usage.js');
  });

  beforeEach(() => {
    __testResetUsageState();
    invalidate();
    enableFeature('usage');
  });

  it('ranks by appliedCount, then retrievedCount, then recency', async () => {
    // a: high retrieved, zero applied. b: low total but one applied. c: medium retrieved.
    writeEntry(makeEntry('hot_a'));
    writeEntry(makeEntry('hot_b'));
    writeEntry(makeEntry('hot_c'));
    invalidate();

    const { incrementUsage } = await import('../services/indexContext.js');
    for (let i = 0; i < 5; i++) incrementUsage('hot_a', { action: 'search' }); // retrieved=5
    incrementUsage('hot_b', { action: 'applied' });                            // applied=1
    for (let i = 0; i < 3; i++) incrementUsage('hot_c', { action: 'search' }); // retrieved=3

    const hotset = getHandler('usage_hotset')!;
    const res = (await Promise.resolve(hotset({ limit: 10 }))) as Record<string, unknown>;
    const items = (res.items as Array<{ id: string; appliedCount: number; retrievedCount: number; usageCount: number }>);

    // hot_b (applied=1) must rank first despite lowest total.
    expect(items[0].id).toBe('hot_b');
    expect(items[0].appliedCount).toBe(1);
    // Among zero-applied, higher retrieved wins: hot_a (5) before hot_c (3).
    expect(items[1].id).toBe('hot_a');
    expect(items[2].id).toBe('hot_c');
    // Response exposes split counters + derived usageCount.
    expect(items[1].retrievedCount).toBe(5);
    expect(items[1].appliedCount).toBe(0);
    expect(items[1].usageCount).toBe(5);
  });
});
