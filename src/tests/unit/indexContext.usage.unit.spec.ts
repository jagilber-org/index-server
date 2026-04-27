import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Isolate test instructions to a temp dir (never write to repo root)
const INSTR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-test-usage-unit-'));
process.env.INDEX_SERVER_DIR = INSTR_DIR;
// Redirect usage snapshot to temp dir to avoid writing to repo root data/
process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = path.join(INSTR_DIR, 'usage-snapshot.json');

// Enable usage feature
process.env.INDEX_SERVER_FEATURES = 'usage';

// Defer import until after env prepared
import { ensureLoaded, writeEntry, incrementUsage, __testResetUsageState, getIndexState } from '../../services/indexContext';
import { enableFeature } from '../../services/features';

// Minimal instruction factory
function makeEntry(id: string){
  return { id, title: `Title ${id}`, body: 'Sample body', version: '1.0.0', categories: ['scope-workspace-unit', 'type-test'] } as any;
}

describe('indexContext usage + materialization (P0)', () => {
  const created: string[] = [];
  beforeAll(() => {
    __testResetUsageState();
    enableFeature('usage');
  });
  afterAll(() => { __testResetUsageState(); });

  afterAll(() => {
    try { fs.rmSync(INSTR_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });


  it('writeEntry opportunistically materializes when index already loaded (no reload race)', async () => {
    // Warm index to ensure state object allocated (enables opportunistic path in writeEntry)
    ensureLoaded();
    const id = 'unit_p0_materialize_' + Date.now();
    const filePath = path.join(INSTR_DIR, id + '.json');
    if(fs.existsSync(filePath)) fs.unlinkSync(filePath);
    writeEntry(makeEntry(id));
    let present = false;
    // First check: in‑memory opportunistic path should have inserted without reload
    const st0 = getIndexState();
    if(st0.byId.has(id)) present = true;
    // If not yet visible, allow a few short async waits giving Windows FS a chance to surface file metadata
    for(let attempt=0; attempt<8 && !present; attempt++){
      await new Promise(r=>setTimeout(r, 8));
      const st = getIndexState();
      if(st.byId.has(id)) present = true;
    }
    if(!present){
      // Final diagnostic snapshot to aid debugging if ever flaky
      const finalState = getIndexState();
      // eslint-disable-next-line no-console
      console.error('[materialization-test] missing id after retries', { id, count: finalState.list.length });
    }
    expect(present).toBe(true);
  });

  it('incrementUsage establishes firstSeenTs + lastUsedAt and increments monotonically (no double increment)', () => {
  const id = 'unit_usage_monotonic_' + Date.now();
  const filePath = path.join(INSTR_DIR, id + '.json');
  if(fs.existsSync(filePath)) fs.unlinkSync(filePath);
    writeEntry(makeEntry(id));
  created.push(filePath);
    const r1 = incrementUsage(id) as any;
    expect(r1.usageCount).toBe(1);
    const r2 = incrementUsage(id) as any;
    expect(r2.usageCount).toBe(2);
    // Third increment (may still be within same second but below rate limit threshold) should become 3 unless rate limited
    const r3 = incrementUsage(id) as any;
    if(r3.rateLimited){
      // Accept 2 if rate-limited path engaged early
      expect(r3.usageCount).toBe(2);
    } else {
      expect(r3.usageCount).toBe(3);
    }
  });

  afterAll(()=>{
    for(const f of created){ try { if(fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ } }
  });
});
