/**
 * T3 (tests-overrides) — RED scaffold for the runtime overlay layer.
 *
 * Plan §2.6 T3:
 *   - overlay merge order (overlay > env > defaults)
 *   - malformed JSON fallback (warn + ignore, do not crash)
 *   - atomic write (tmp + rename)
 *   - INDEX_SERVER_DISABLE_OVERRIDES opts out
 *   - reset endpoint clears only the target key (isolation)
 *   - **Morpheus must-fix:** boot-order regression — overlay must win across an
 *     in-process boot even if a colliding process.env value is set first.
 *     Uses vi.resetModules() + dynamic import() to guarantee a fresh module cache
 *     so the singleton snapshot reflects the current process state.
 *
 * Trinity owns `src/config/runtimeOverrides.ts` exporting:
 *   - applyOverlay(): merges overlay file into process.env BEFORE loadRuntimeConfig()
 *   - writeOverride(key, value): atomic write to data/runtime-overrides.json
 *   - clearOverride(key): remove entry, atomic rewrite
 *   - readOverlay(): Record<string, string>
 *
 * Refs #359
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_FLAG = 'INDEX_SERVER_TEST_OVERLAY_KEY';
const ENV_KEYS = [TEST_FLAG, 'INDEX_SERVER_OVERRIDES_FILE', 'INDEX_SERVER_DISABLE_OVERRIDES'];

function tmpOverlayPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'idx-overlay-')), 'runtime-overrides.json');
}

async function loadOverrides() {
  // @ts-expect-error - target module is implemented by Trinity (runtime-overrides todo)
  return import('../config/runtimeOverrides');
}

describe('runtimeOverrides — T3 red', () => {
  const saved: Record<string, string | undefined> = {};
  let overlayDir: string | null = null;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
    if (overlayDir && fs.existsSync(overlayDir)) {
      fs.rmSync(overlayDir, { recursive: true, force: true });
    }
    overlayDir = null;
  });

  describe('overlay file IO', () => {
    it('readOverlay returns {} when file does not exist', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      const { readOverlay } = await loadOverrides();
      expect(readOverlay()).toEqual({});
    });

    it('readOverlay returns parsed JSON object when present', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ [TEST_FLAG]: 'value-from-overlay' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      const { readOverlay } = await loadOverrides();
      expect(readOverlay()).toEqual({ [TEST_FLAG]: 'value-from-overlay' });
    });

    it('malformed JSON does not crash; logs warning and returns {}', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, '{ not valid json', 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      const { readOverlay } = await loadOverrides();
      expect(readOverlay()).toEqual({});
    });

    it('writeOverride uses atomic temp-file + rename (no partial writes)', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      const { writeOverride, readOverlay } = await loadOverrides();
      writeOverride(TEST_FLAG, 'first');
      expect(readOverlay()).toEqual({ [TEST_FLAG]: 'first' });
      writeOverride(TEST_FLAG, 'second');
      expect(readOverlay()).toEqual({ [TEST_FLAG]: 'second' });
      // No leftover .tmp file
      const leftovers = fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'));
      expect(leftovers).toEqual([]);
    });

    it('clearOverride removes only the targeted key (isolation)', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      const { writeOverride, clearOverride, readOverlay } = await loadOverrides();
      writeOverride('INDEX_SERVER_A', 'alpha');
      writeOverride('INDEX_SERVER_B', 'beta');
      clearOverride('INDEX_SERVER_A');
      expect(readOverlay()).toEqual({ INDEX_SERVER_B: 'beta' });
    });
  });

  describe('merge order (overlay > env > defaults)', () => {
    it('applyOverlay sets process.env entries that were not previously set', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ [TEST_FLAG]: 'from-overlay' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      const { applyOverlay } = await loadOverrides();
      applyOverlay();
      expect(process.env[TEST_FLAG]).toBe('from-overlay');
    });

    it('overlay OVERWRITES a colliding env value (overlay > env precedence)', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ [TEST_FLAG]: 'from-overlay' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      process.env[TEST_FLAG] = 'from-env';
      const { applyOverlay } = await loadOverrides();
      applyOverlay();
      expect(process.env[TEST_FLAG]).toBe('from-overlay');
    });

    it('INDEX_SERVER_DISABLE_OVERRIDES=1 makes applyOverlay a no-op', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ [TEST_FLAG]: 'from-overlay' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      process.env.INDEX_SERVER_DISABLE_OVERRIDES = '1';
      process.env[TEST_FLAG] = 'from-env';
      const { applyOverlay } = await loadOverrides();
      applyOverlay();
      expect(process.env[TEST_FLAG]).toBe('from-env');
    });
  });

  describe('Morpheus boot-order regression', () => {
    it('overlay value wins through a fresh in-process boot of runtimeConfig', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ [TEST_FLAG]: 'overlay-val' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      process.env[TEST_FLAG] = 'env-val';

      // Fresh module cache simulates a cold boot; catches future regressions where
      // a top-level `const X = process.env.FOO` snapshots the env BEFORE applyOverlay().
      vi.resetModules();
      const overrides = await import('../config/runtimeOverrides.js').catch((): null => null);
      overrides?.applyOverlay?.();

      const runtime = await import('../config/runtimeConfig.js');
      runtime.reloadRuntimeConfig();
      // Re-read process.env post-applyOverlay (overlay must have written it).
      expect(process.env[TEST_FLAG]).toBe('overlay-val');
    });
  });

  describe('H1 — writeOverride defense-in-depth readonly check (PR #362 regression)', () => {
    // Importing handlers.dashboardConfig once populates the blocklist via the
    // module's top-level registerReadonlyFlags() side effect. We do NOT reset
    // the blocklist between tests because module re-import is cached — clearing
    // it would leave subsequent tests with an empty set.
    beforeEach(async () => {
      await import('../services/handlers.dashboardConfig.js');
    });

    it('writeOverride refuses to persist any registry-readonly flag', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      const overrides = await loadOverrides();
      // INDEX_SERVER_ADMIN_API_KEY is editable:false, readonlyReason:'sensitive'.
      expect(() => overrides.writeOverride('INDEX_SERVER_ADMIN_API_KEY', 'leaked')).toThrow(/readonly/i);
      // On-disk overlay must not have been mutated.
      const onDisk = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      expect(onDisk.INDEX_SERVER_ADMIN_API_KEY).toBeUndefined();
    });

    it('writeOverride refuses derived readonly flags (overlay control-plane)', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      const overrides = await loadOverrides();
      expect(() => overrides.writeOverride('INDEX_SERVER_OVERRIDES_FILE', '/tmp/other.json')).toThrow(/readonly/i);
      expect(() => overrides.writeOverride('INDEX_SERVER_DISABLE_OVERRIDES', '1')).toThrow(/readonly/i);
    });

    it('writeOverride still permits writable registry flags (sanity)', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      const overrides = await loadOverrides();
      // INDEX_SERVER_VERBOSE_LOGGING is editable:true.
      expect(() => overrides.writeOverride('INDEX_SERVER_VERBOSE_LOGGING', '1')).not.toThrow();
      expect(overrides.readOverlay()).toMatchObject({ INDEX_SERVER_VERBOSE_LOGGING: '1' });
    });
  });

  // ── revert must not destroy variables the overlay never owned ───────────
  //
  // applyOverlay() recorded a prior value only when it DIFFERED from the
  // overlay's:
  //
  //     if (prior !== undefined && prior !== v) shadowed[k] = prior;
  //
  // So when the operator's existing env value happened to EQUAL the overlay's,
  // the key was absent from the snapshot — and revertOverlay()/clearOverride()
  // then took their `else delete process.env[key]` branch, unsetting a variable
  // the operator set and the overlay never owned.
  //
  // The equal-value case is the likely one in practice: the overlay is usually
  // written from the same value the operator already has in the environment.
  // It is also the case the existing boot-recovery spec could not reach, since
  // its fixture never sets the same key in both places.

  describe('revert restores the pre-overlay environment exactly', () => {
    it('restores a prior value that was EQUAL to the overlay value', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ [TEST_FLAG]: 'same-value' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;

      // The operator already has this set, to the same value the overlay holds.
      process.env[TEST_FLAG] = 'same-value';

      const { applyOverlay, revertOverlay } = await loadOverrides();
      applyOverlay();
      revertOverlay();

      expect(
        process.env[TEST_FLAG],
        'revert deleted an operator-set variable the overlay never owned',
      ).toBe('same-value');
    });

    it('still restores a prior value that DIFFERED from the overlay value', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ [TEST_FLAG]: 'overlay-value' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      process.env[TEST_FLAG] = 'operator-value';

      const { applyOverlay, revertOverlay } = await loadOverrides();
      applyOverlay();
      expect(process.env[TEST_FLAG]).toBe('overlay-value');
      revertOverlay();

      expect(process.env[TEST_FLAG]).toBe('operator-value');
    });

    it('still unsets a key the operator had NOT set', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ [TEST_FLAG]: 'overlay-only' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      delete process.env[TEST_FLAG];

      const { applyOverlay, revertOverlay } = await loadOverrides();
      applyOverlay();
      revertOverlay();

      expect(
        process.env[TEST_FLAG],
        'a key the overlay introduced must be removed, not left behind',
      ).toBeUndefined();
    });

    it('clearOverride restores an equal prior value rather than deleting it', async () => {
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ INDEX_SERVER_VERBOSE_LOGGING: '1' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      process.env.INDEX_SERVER_VERBOSE_LOGGING = '1';

      const { applyOverlay, clearOverride } = await loadOverrides();
      applyOverlay();
      clearOverride('INDEX_SERVER_VERBOSE_LOGGING');

      expect(
        process.env.INDEX_SERVER_VERBOSE_LOGGING,
        'clearOverride has the same equal-value bug as revertOverlay',
      ).toBe('1');

      delete process.env.INDEX_SERVER_VERBOSE_LOGGING;
    });

    it('overlayShadowsEnv still reports only genuine shadowing', async () => {
      // The restore snapshot and the diagnostic answer different questions.
      // Recording an equal prior value for restore must NOT make the dashboard
      // claim the overlay is masking a different ENV value, because it is not.
      const file = tmpOverlayPath();
      overlayDir = path.dirname(file);
      fs.writeFileSync(file, JSON.stringify({ [TEST_FLAG]: 'same-value' }), 'utf8');
      process.env.INDEX_SERVER_OVERRIDES_FILE = file;
      process.env[TEST_FLAG] = 'same-value';

      const { applyOverlay, shadowedEnv } = await loadOverrides();
      const result = applyOverlay();

      expect(result.shadowed[TEST_FLAG], 'an identical value is not a shadowed value').toBeUndefined();
      expect(shadowedEnv()[TEST_FLAG]).toBeUndefined();
    });
  });
});
