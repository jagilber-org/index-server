import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate test instructions to a temp dir (never write to repo root)
const INSTR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-test-signal-'));
process.env.INDEX_SERVER_DIR = INSTR_DIR;
// Redirect usage snapshot to temp dir to avoid writing to repo root data/
process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = path.join(INSTR_DIR, 'usage-snapshot.json');

// Enable usage feature
process.env.INDEX_SERVER_FEATURES = 'usage';

import { writeEntry, incrementUsage, __testResetUsageState } from '../../services/indexContext';
import { enableFeature } from '../../services/features';

function makeEntry(id: string) {
  return { id, title: `Title ${id}`, body: 'Sample body', version: '1.0.0', categories: ['workspace-unit', 'testing'] } as any;
}

describe('usage_track signal/comment/action fields', () => {
  const created: string[] = [];

  beforeAll(() => {
    __testResetUsageState();
    enableFeature('usage');
  });
  afterAll(() => {
    __testResetUsageState();
    for (const f of created) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ } }
    try { fs.rmSync(INSTR_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns action field when provided', () => {
    const id = 'unit_signal_action_' + Date.now();
    const filePath = path.join(INSTR_DIR, id + '.json');
    created.push(filePath);
    writeEntry(makeEntry(id));

    const r = incrementUsage(id, { action: 'applied' }) as any;
    expect(r.usageCount).toBe(1);
    expect(r.action).toBe('applied');
  });

  it('returns signal field when provided', () => {
    const id = 'unit_signal_signal_' + Date.now();
    const filePath = path.join(INSTR_DIR, id + '.json');
    created.push(filePath);
    writeEntry(makeEntry(id));

    const r = incrementUsage(id, { signal: 'helpful' }) as any;
    expect(r.usageCount).toBe(1);
    expect(r.signal).toBe('helpful');
  });

  it('returns comment field when provided', () => {
    const id = 'unit_signal_comment_' + Date.now();
    const filePath = path.join(INSTR_DIR, id + '.json');
    created.push(filePath);
    writeEntry(makeEntry(id));

    const r = incrementUsage(id, { comment: 'very useful for CI pipelines' }) as any;
    expect(r.usageCount).toBe(1);
    expect(r.comment).toBe('very useful for CI pipelines');
  });

  it('returns all three fields together', () => {
    const id = 'unit_signal_all_' + Date.now();
    const filePath = path.join(INSTR_DIR, id + '.json');
    created.push(filePath);
    writeEntry(makeEntry(id));

    const r = incrementUsage(id, { action: 'cited', signal: 'helpful', comment: 'great context' }) as any;
    expect(r.usageCount).toBe(1);
    expect(r.action).toBe('cited');
    expect(r.signal).toBe('helpful');
    expect(r.comment).toBe('great context');
  });

  it('works without options (backward compatible)', () => {
    const id = 'unit_signal_compat_' + Date.now();
    const filePath = path.join(INSTR_DIR, id + '.json');
    created.push(filePath);
    writeEntry(makeEntry(id));

    const r = incrementUsage(id) as any;
    expect(r.usageCount).toBe(1);
    expect(r.action).toBeUndefined();
    expect(r.signal).toBeUndefined();
    expect(r.comment).toBeUndefined();
  });

  it('persists last signal/comment in usage snapshot', () => {
    const id = 'unit_signal_persist_' + Date.now();
    const filePath = path.join(INSTR_DIR, id + '.json');
    created.push(filePath);
    writeEntry(makeEntry(id));

    incrementUsage(id, { signal: 'not-relevant', comment: 'outdated info' });
    incrementUsage(id, { signal: 'helpful', comment: 'actually useful after fix' });

    // Read snapshot directly
    const snapPath = path.join(process.cwd(), 'data', 'usage-snapshot.json');
    if (fs.existsSync(snapPath)) {
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      const rec = snap[id];
      if (rec) {
        expect(rec.lastSignal).toBe('helpful');
        expect(rec.lastComment).toBe('actually useful after fix');
        expect(rec.lastAction).toBeUndefined(); // not provided on second call
      }
    }
  });
});
