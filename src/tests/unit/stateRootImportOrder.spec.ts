/**
 * Import-order assertion for the STATE_ROOT invariant (#607, part 2).
 *
 * `stateRootNotOverlayControllable.spec.ts` pins the WRITE side: the admin
 * config API and `writeOverride()` both refuse `INDEX_SERVER_STATE_ROOT`
 * because it is registered `editable:false` in FLAG_REGISTRY.
 *
 * This suite pins the APPLY side, which is the layer underneath that one. A
 * refusal at write time does nothing about an overlay file that already
 * contains the key — hand-edited, restored from a backup, or written by a
 * build of the server that predates the readonly registration. On the next
 * boot `applyOverlay()` replays that file straight into `process.env`.
 *
 * The only reason such an entry is inert is ordering: `STATE_ROOT` is an
 * `export const` in `configUtils.ts` that reads the env var exactly once, at
 * module evaluation. If `configUtils` is evaluated first, the value is frozen
 * before the overlay can touch `process.env`. If the overlay is evaluated and
 * applied first, `STATE_ROOT` adopts the overlay's value and an authenticated
 * admin-config write becomes an audit-log redirection primitive — the audit
 * log, activity DB, trace logs and server log all move with the state root.
 *
 * Nothing in the type system or the linter expresses that. It is enforced by
 * the load-order anchor at the top of `runtimeOverrides.ts` (`import
 * './configUtils'`) and observed here. Remove or defer that import and the
 * `overlay applied first` case below goes red.
 *
 * Falsification note: the `control` case exists because "STATE_ROOT did not
 * change" would also be satisfied by a STATE_ROOT that can never change, e.g.
 * if the env var stopped being consulted at all. The control proves the
 * harness genuinely observes the hijack when the env var is set before
 * `configUtils` loads, so the assertion above it is about ordering rather than
 * about a dead code path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ENV_KEYS = [
  'INDEX_SERVER_OVERRIDES_FILE',
  'INDEX_SERVER_DISABLE_OVERRIDES',
  'INDEX_SERVER_STATE_ROOT',
];

describe('STATE_ROOT is resolved before the overlay is applied (#607)', () => {
  const saved: Record<string, string | undefined> = {};
  let dir = '';
  let hijack = '';
  let overlayFile = '';

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-root-order-'));
    hijack = path.join(dir, 'attacker-controlled-state');
    overlayFile = path.join(dir, 'runtime-overrides.json');
    // Written directly rather than through writeOverride(): that function
    // refuses this key, which is the point — this file models an overlay that
    // already contains it despite the refusal.
    fs.writeFileSync(overlayFile, JSON.stringify({ INDEX_SERVER_STATE_ROOT: hijack }, null, 2));
    process.env.INDEX_SERVER_OVERRIDES_FILE = overlayFile;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = '';
    vi.resetModules();
  });

  it('an overlay entry for INDEX_SERVER_STATE_ROOT does not move STATE_ROOT', async () => {
    vi.resetModules();

    // Deliberately import the overlay FIRST and apply it before anything in
    // this test touches configUtils — the worst case for the invariant.
    const { applyOverlay } = await import('../../config/runtimeOverrides.js');
    const result = applyOverlay();

    // Sanity: the overlay really did fire and really did write the key into
    // process.env. Without this the test could pass because the overlay was
    // silently disabled or the file was unreadable.
    expect(result.disabled).toBe(false);
    expect(result.missing).toBe(false);
    expect(result.applied).toBe(1);
    expect(process.env.INDEX_SERVER_STATE_ROOT).toBe(hijack);

    const { STATE_ROOT } = await import('../../config/configUtils.js');

    // ...and STATE_ROOT is still the pre-overlay value, because configUtils was
    // already evaluated (by runtimeOverrides' load-order anchor) when the
    // overlay wrote to process.env.
    expect(STATE_ROOT).not.toBe(path.resolve(hijack));
    expect(STATE_ROOT.startsWith(dir)).toBe(false);
  });

  it('the audit-log-adjacent paths derived from STATE_ROOT stay put too', async () => {
    vi.resetModules();

    const { applyOverlay } = await import('../../config/runtimeOverrides.js');
    applyOverlay();

    const { toStateAbsolute } = await import('../../config/configUtils.js');

    // toStateAbsolute() is how the audit log, activity DB and server log
    // resolve their relative defaults. If STATE_ROOT had moved, every one of
    // them would follow it in the same breath.
    expect(toStateAbsolute('logs/audit.log').startsWith(dir)).toBe(false);
  });

  it('control: STATE_ROOT does track the env var when it is set before load', async () => {
    vi.resetModules();

    // Same variable, same value — the only difference is that nothing has
    // frozen STATE_ROOT yet. This must succeed, otherwise the assertions above
    // are vacuous: they would also hold against a STATE_ROOT that ignores
    // INDEX_SERVER_STATE_ROOT entirely.
    process.env.INDEX_SERVER_STATE_ROOT = hijack;

    const { STATE_ROOT } = await import('../../config/configUtils.js');

    expect(STATE_ROOT).toBe(path.resolve(hijack));
  });

  it('loading runtimeOverrides evaluates configUtils as a side effect', async () => {
    vi.resetModules();

    // The mechanism, asserted directly rather than only through its
    // consequence. `vi.resetModules()` clears the registry, so a spy installed
    // before the overlay import observes whether configUtils is pulled in by
    // the import itself.
    const loaded: string[] = [];
    vi.doMock('../../config/configUtils.js', async (importOriginal) => {
      loaded.push('configUtils');
      return await importOriginal<typeof import('../../config/configUtils.js')>();
    });

    await import('../../config/runtimeOverrides.js');

    expect(loaded, 'runtimeOverrides must import configUtils (load-order anchor, #607)').toContain('configUtils');
    vi.doUnmock('../../config/configUtils.js');
  });
});
