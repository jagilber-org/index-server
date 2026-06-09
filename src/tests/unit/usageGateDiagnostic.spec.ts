import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Regression for feedback e24abd10d5a92882: usage_track returned bare
// { featureDisabled:true } with no clue which env var/flag was checked or
// what the observed value was. Forces incrementUsage to surface the gate,
// the required flag value, and the observed env value.

const TEST_ID = 'usage-gate-diag-test-entry';

async function loadCtx(dir: string, features?: string) {
  if (features === undefined) delete process.env.INDEX_SERVER_FEATURES;
  else process.env.INDEX_SERVER_FEATURES = features;
  process.env.INDEX_SERVER_DIR = dir;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, TEST_ID + '.json'), JSON.stringify({
    id: TEST_ID, title: 'Test', body: 'body', schemaVersion: '1',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }));
  const runtimeConfig = await import('../../config/runtimeConfig.js');
  runtimeConfig.reloadRuntimeConfig();
  const ctx = await import('../../services/indexContext.js');
  ctx.invalidate();
  return ctx;
}

describe('usage_track gate diagnostic envelope', () => {
  let tmp: string;
  const origFeatures = process.env.INDEX_SERVER_FEATURES;
  const origDir = process.env.INDEX_SERVER_DIR;

  beforeEach(() => {
    vi.resetModules();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-gate-diag-'));
  });

  afterEach(() => {
    if (origFeatures === undefined) delete process.env.INDEX_SERVER_FEATURES;
    else process.env.INDEX_SERVER_FEATURES = origFeatures;
    if (origDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = origDir;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns featureDisabled:true plus gate/required/observed when env unset', async () => {
    const { incrementUsage } = await loadCtx(tmp, undefined);
    const result = incrementUsage(TEST_ID);
    expect(result).toMatchObject({
      featureDisabled: true,
      gate: 'INDEX_SERVER_FEATURES',
      required: 'usage',
      observed: null,
    });
  });

  it('returns observed=current env csv when feature absent from a populated env', async () => {
    const { incrementUsage } = await loadCtx(tmp, 'drift,window');
    const result = incrementUsage(TEST_ID);
    expect(result).toMatchObject({
      featureDisabled: true,
      gate: 'INDEX_SERVER_FEATURES',
      required: 'usage',
      observed: 'drift,window',
    });
  });

  it('exposes an actionable hint in the disabled response', async () => {
    const { incrementUsage } = await loadCtx(tmp, '');
    const result = incrementUsage(TEST_ID) as Record<string, unknown>;
    expect(typeof result.hint).toBe('string');
    expect(String(result.hint)).toMatch(/INDEX_SERVER_FEATURES/);
    expect(String(result.hint)).toMatch(/usage/);
  });

  it('does NOT emit gate envelope when feature is enabled (no leak on happy path)', async () => {
    const { incrementUsage } = await loadCtx(tmp, 'usage');
    const result = incrementUsage(TEST_ID) as Record<string, unknown>;
    expect(result).not.toHaveProperty('featureDisabled');
    expect(result).not.toHaveProperty('gate');
    expect(result).not.toHaveProperty('required');
  });

  it('preserves backward-compatible featureDisabled:true flag for legacy clients', async () => {
    const { incrementUsage } = await loadCtx(tmp, undefined);
    const result = incrementUsage(TEST_ID) as Record<string, unknown>;
    // Legacy contract: featureDisabled === true must remain truthy/present.
    expect(result.featureDisabled).toBe(true);
  });
});
