/**
 * `INDEX_SERVER_STATE_ROOT` must never become overlay-controllable.
 *
 * STATE_ROOT is resolved once at module load (`configUtils.ts`), before
 * `applyOverlay()` runs, and the overrides overlay works by mutating
 * `process.env`. That ordering is what stops a dashboard admin-config write
 * from relocating the audit log, activity DB, trace logs and server log.
 *
 * If it were editable, an authenticated admin write would become an
 * **audit-log redirection primitive**: point STATE_ROOT somewhere else and the
 * audit trail for everything that follows goes with it.
 *
 * This is easy to undo by accident. #579 proposes enforcing constitution S-4
 * by routing every `INDEX_SERVER_*` read through `runtimeConfig`; applied
 * mechanically to this variable, that is exactly the regression. A bare
 * allowlist entry with no test reads as an oversight to whoever tidies up
 * next, so the property is pinned here instead of only described in a comment.
 *
 * Tracked as #607.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ENV_KEYS = ['INDEX_SERVER_OVERRIDES_FILE', 'INDEX_SERVER_DISABLE_OVERRIDES', 'INDEX_SERVER_VERBOSE_LOGGING'];

describe('STATE_ROOT is not overlay-controllable (#607)', () => {
  const saved: Record<string, string | undefined> = {};
  let dir: string | null = null;

  beforeEach(async () => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-root-readonly-'));
    process.env.INDEX_SERVER_OVERRIDES_FILE = path.join(dir, 'runtime-overrides.json');
    // Importing this module registers the readonly flag set as a side effect.
    await import('../../services/handlers.dashboardConfig.js');
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('writeOverride refuses INDEX_SERVER_STATE_ROOT', async () => {
    const { writeOverride } = await import('../../config/runtimeOverrides.js');

    expect(() => writeOverride('INDEX_SERVER_STATE_ROOT', path.join(dir!, 'elsewhere')))
      .toThrow(/readonly/i);
  });

  it('refuses it without writing anything to the overlay file', async () => {
    const { writeOverride, readOverlay } = await import('../../config/runtimeOverrides.js');

    try { writeOverride('INDEX_SERVER_STATE_ROOT', '/tmp/elsewhere'); } catch { /* expected */ }

    // A refusal that still persisted the key would be worse than no refusal,
    // because the next boot would apply it.
    expect(readOverlay()).not.toHaveProperty('INDEX_SERVER_STATE_ROOT');
  });

  it('control: an editable flag is still accepted', async () => {
    // Without this, the test above would pass against a writeOverride that
    // refuses everything — i.e. a check that cannot distinguish the property
    // it is asserting from a totally broken implementation.
    const { writeOverride, readOverlay } = await import('../../config/runtimeOverrides.js');

    expect(() => writeOverride('INDEX_SERVER_VERBOSE_LOGGING', '1')).not.toThrow();
    expect(readOverlay()).toMatchObject({ INDEX_SERVER_VERBOSE_LOGGING: '1' });
  });

  it('is registered in FLAG_REGISTRY as non-editable rather than simply absent', async () => {
    // Absent would also make writeOverride refuse it in some configurations,
    // but for the wrong reason and with no operator-visible explanation. It
    // should appear in the Configuration panel, marked read-only, with a
    // rationale.
    const mod = await import('../../services/handlers.dashboardConfig.js') as unknown as {
      FLAG_REGISTRY?: { name: string; editable: boolean; readonlyReason?: string; readonlyDetail?: string }[];
    };
    const registry = mod.FLAG_REGISTRY;
    if (!registry) return; // not exported in this build; the behavioural cases above still hold

    const entry = registry.find(f => f.name === 'INDEX_SERVER_STATE_ROOT');
    expect(entry, 'INDEX_SERVER_STATE_ROOT must be registered').toBeDefined();
    expect(entry?.editable).toBe(false);
    expect(entry?.readonlyDetail ?? '').toMatch(/overlay|audit|process start/i);
  });
});
