/**
 * SqliteUsageStore contract tests.
 * TDD RED phase: tests first.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteUsageStore } from '../../../services/storage/sqliteUsageStore.js';

describe('SqliteUsageStore', () => {
  let store: SqliteUsageStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-store-'));
    store = new SqliteUsageStore(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for unknown instruction', () => {
    expect(store.get('nonexistent')).toBeNull();
  });

  it('increments usage and sets timestamps', () => {
    const rec = store.increment('inst-1');
    expect(rec.usageCount).toBe(1);
    expect(rec.firstSeenTs).toBeTruthy();
    expect(rec.lastUsedAt).toBeTruthy();
  });

  it('increments existing usage', () => {
    store.increment('inst-2');
    const rec = store.increment('inst-2');
    expect(rec.usageCount).toBe(2);
  });

  it('preserves firstSeenTs on subsequent increments', () => {
    const first = store.increment('inst-3');
    const second = store.increment('inst-3');
    expect(second.firstSeenTs).toBe(first.firstSeenTs);
  });

  it('records action/signal/comment', () => {
    store.increment('inst-4', { action: 'applied', signal: 'helpful', comment: 'great' });
    const rec = store.get('inst-4');
    expect(rec!.lastAction).toBe('applied');
    expect(rec!.lastSignal).toBe('helpful');
    expect(rec!.lastComment).toBe('great');
  });

  it('snapshot returns all records', () => {
    store.increment('a');
    store.increment('b');
    store.increment('a');
    const snap = store.snapshot();
    expect(Object.keys(snap).length).toBe(2);
    expect(snap['a'].usageCount).toBe(2);
    expect(snap['b'].usageCount).toBe(1);
  });

  it('flush removes specific instruction', () => {
    store.increment('x');
    store.increment('y');
    store.flush('x');
    expect(store.get('x')).toBeNull();
    expect(store.get('y')).not.toBeNull();
  });

  it('flush without arg clears all', () => {
    store.increment('a');
    store.increment('b');
    store.flush();
    expect(store.count()).toBe(0);
  });

  it('count reflects tracked instructions', () => {
    expect(store.count()).toBe(0);
    store.increment('c1');
    store.increment('c2');
    expect(store.count()).toBe(2);
  });
});
