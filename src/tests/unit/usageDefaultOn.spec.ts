/**
 * Regression coverage for #495: usage tracking was off by default while the
 * switch that feeds it (INDEX_SERVER_AUTO_USAGE_TRACK) documented a default of
 * on. The two defaults contradicted each other, and because auto-track call
 * sites discard the `featureDisabled` diagnostic — and `usage_track` was not
 * exposed on the default profile — a default install silently recorded nothing.
 *
 * Usage history cannot be backfilled, so the failure was unrecoverable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const TOUCHED = [
  'INDEX_SERVER_FEATURES',
  'INDEX_SERVER_USAGE_ENABLED',
  'INDEX_SERVER_PROFILE',
];

describe('#495: usage is enabled by default with an explicit opt-out', () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const k of TOUCHED) saved[k] = process.env[k];
    for (const k of TOUCHED) delete process.env[k];
  });

  afterEach(() => {
    for (const k of TOUCHED) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function features(): Promise<Set<string>> {
    const { parseFeatureFlagsConfig } = await import('../../config/featureConfig.js');
    return parseFeatureFlagsConfig().indexFeatures;
  }

  it('enables usage on the default profile with no configuration at all', async () => {
    expect(await features()).toContain('usage');
  });

  it('honours INDEX_SERVER_USAGE_ENABLED=0 as an explicit opt-out', async () => {
    process.env.INDEX_SERVER_USAGE_ENABLED = '0';
    expect(await features()).not.toContain('usage');
  });

  it('lets the dedicated opt-out win over an INDEX_SERVER_FEATURES list', async () => {
    process.env.INDEX_SERVER_FEATURES = 'usage,hotness';
    process.env.INDEX_SERVER_USAGE_ENABLED = '0';
    const set = await features();
    expect(set).not.toContain('usage');
    expect(set).toContain('hotness');
  });

  it('preserves other features listed in INDEX_SERVER_FEATURES', async () => {
    process.env.INDEX_SERVER_FEATURES = 'drift';
    const set = await features();
    expect(set).toContain('drift');
    expect(set).toContain('usage');
  });

  it('exposes usage_track on the core tier so agents can act on the afterRetrieval hint', async () => {
    const { getToolRegistry } = await import('../../services/toolRegistry.js');
    const core = getToolRegistry({ tier: 'core' }).map((t: { name: string }) => t.name);
    expect(core).toContain('usage_track');
  });

  it('keeps usage_track out of the privileged mutation set', async () => {
    const { MUTATION } = await import('../../services/toolRegistry.js');
    expect(MUTATION.has('usage_track')).toBe(false);
  });
});
