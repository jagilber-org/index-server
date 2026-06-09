/**
 * RED → GREEN: Issue #358 — index_dispatch action=add silently skipped after
 * bootstrap confirmation when INDEX_SERVER_MUTATION is not set to '1'.
 *
 * Problem: the bootstrap confirmation handler did not surface the runtime
 * mutation flag, and the add-write duplicate-with-invisible-file branch
 * returned a `success:true, skipped:true, visibilityWarning:'skipped_file_not_in_index'`
 * envelope. From the agent's perspective, this looks like a no-op success
 * even though nothing was persisted.
 *
 * Expected:
 *  1. `bootstrap_confirmFinalize` and `bootstrap action=confirm` responses
 *     include `mutationEnabled` and (when disabled) `mutationHint` naming
 *     the env var and how to set it.
 *  2. The dispatcher exposes the same `mutationEnabled` + `mutationHint`
 *     fields on its response for mutation actions when mutations are off so
 *     callers see actionable guidance at the moment they need it.
 *  3. The silent post-write visibility-anomaly skip in `instructions.add`
 *     is upgraded to a structured `success:false, error:'mutation_persist_failed'`
 *     envelope that names INDEX_SERVER_MUTATION in its hint.
 *
 * Constitution: TS-8/TS-9 TDD red→green; no silent success on guarded
 * mutation paths; structured envelopes only.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../server/registry';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating';

const TMP_BASE = path.join(process.cwd(), 'tmp', 'issue358-mutation-guard');

async function loadAllHandlers() {
  // @ts-expect-error dynamic side-effect import
  await import('../../services/handlers.instructions');
  // @ts-expect-error dynamic side-effect import
  await import('../../services/instructions.dispatcher');
  // @ts-expect-error dynamic side-effect import
  await import('../../services/handlers.bootstrap');
}

describe('issue #358: mutation guard returns actionable error (not silent skip)', () => {
  const originalMutation = process.env.INDEX_SERVER_MUTATION;
  const originalDir = process.env.INDEX_SERVER_DIR;

  beforeAll(async () => {
    await loadAllHandlers();
  });

  afterAll(() => {
    if (originalMutation === undefined) delete process.env.INDEX_SERVER_MUTATION;
    else process.env.INDEX_SERVER_MUTATION = originalMutation;
    if (originalDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = originalDir;
    reloadRuntimeConfig();
  });

  // ──────────────────────────────────────────────────────────────────────
  // bootstrap_confirmFinalize: surface mutation status in response
  // ──────────────────────────────────────────────────────────────────────
  describe('bootstrap_confirmFinalize response', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(TMP_BASE + '-bf-'));
      fs.mkdirSync(dir, { recursive: true });
      process.env.INDEX_SERVER_DIR = dir;
    });
    afterEach(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('reports mutationEnabled:false AND mutationHint naming INDEX_SERVER_MUTATION when disabled', async () => {
      process.env.INDEX_SERVER_MUTATION = '0';
      reloadRuntimeConfig();
      forceBootstrapConfirmForTests('issue358-test-disabled');
      const handler = getHandler('bootstrap_confirmFinalize')!;
      const res = await handler({ token: 'irrelevant-already-confirmed' }) as Record<string, unknown>;
      expect(res).toBeDefined();
      expect(res.mutationEnabled).toBe(false);
      expect(typeof res.mutationHint).toBe('string');
      expect(res.mutationHint as string).toMatch(/INDEX_SERVER_MUTATION/);
      expect(res.mutationHint as string).toMatch(/set\s+INDEX_SERVER_MUTATION\s*=\s*1/i);
    });

    it('reports mutationEnabled:true and omits mutationHint when enabled', async () => {
      process.env.INDEX_SERVER_MUTATION = '1';
      reloadRuntimeConfig();
      forceBootstrapConfirmForTests('issue358-test-enabled');
      const handler = getHandler('bootstrap_confirmFinalize')!;
      const res = await handler({ token: 'irrelevant-already-confirmed' }) as Record<string, unknown>;
      expect(res).toBeDefined();
      expect(res.mutationEnabled).toBe(true);
      expect(res.mutationHint).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // bootstrap action=confirm (unified handler): same contract
  // ──────────────────────────────────────────────────────────────────────
  describe('bootstrap action=confirm (unified handler) response', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(TMP_BASE + '-ba-'));
      fs.mkdirSync(dir, { recursive: true });
      process.env.INDEX_SERVER_DIR = dir;
    });
    afterEach(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('action=confirm: surfaces mutationEnabled:false and mutationHint when disabled', async () => {
      process.env.INDEX_SERVER_MUTATION = '0';
      reloadRuntimeConfig();
      forceBootstrapConfirmForTests('issue358-unified-disabled');
      const handler = getHandler('bootstrap')!;
      const res = await handler({ action: 'confirm', token: 'whatever' }) as Record<string, unknown>;
      expect(res.mutationEnabled).toBe(false);
      expect(typeof res.mutationHint).toBe('string');
      expect(res.mutationHint as string).toMatch(/INDEX_SERVER_MUTATION/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // dispatcher: when mutation is disabled, mutation actions return actionable
  // envelope (mutationEnabled:false + mutationHint) — they DO NOT silently
  // proceed without telling the caller. (The dispatcher is still permitted
  // to run the operation per design intent; the caller gets the warning so
  // they can interpret subsequent behavior.)
  // ──────────────────────────────────────────────────────────────────────
  describe('index_dispatch mutation envelope when INDEX_SERVER_MUTATION=0', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(TMP_BASE + '-disp-'));
      fs.mkdirSync(dir, { recursive: true });
      process.env.INDEX_SERVER_DIR = dir;
      process.env.INDEX_SERVER_MUTATION = '0';
      reloadRuntimeConfig();
      forceBootstrapConfirmForTests('issue358-dispatcher');
    });
    afterEach(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('add action: includes mutationEnabled and mutationHint in response when mutation disabled', async () => {
      const dispatch = getHandler('index_dispatch')!;
      const result = await dispatch({
        action: 'add',
        id: 'issue358-disp-disabled',
        body: 'Body for disabled-mutation dispatcher test',
        title: 'Issue 358 Dispatcher',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
        lax: true,
      }) as Record<string, unknown>;
      expect(result).toBeDefined();
      expect(result.mutationEnabled).toBe(false);
      expect(typeof result.mutationHint).toBe('string');
      expect(result.mutationHint as string).toMatch(/INDEX_SERVER_MUTATION/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Positive regression: with mutation=1 + bootstrap confirmed, add succeeds
  // and the entry persists. Mirrors the user's happy path from issue #358.
  // ──────────────────────────────────────────────────────────────────────
  describe('happy path regression', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(TMP_BASE + '-happy-'));
      fs.mkdirSync(dir, { recursive: true });
      process.env.INDEX_SERVER_DIR = dir;
      process.env.INDEX_SERVER_MUTATION = '1';
      reloadRuntimeConfig();
      forceBootstrapConfirmForTests('issue358-happy');
    });
    afterEach(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('dispatcher add with mutation=1 succeeds and persists', async () => {
      const dispatch = getHandler('index_dispatch')!;
      const result = await dispatch({
        action: 'add',
        id: 'issue358-happy-path-1',
        body: 'Body for happy path',
        title: 'Happy Path',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
        lax: true,
      }) as Record<string, unknown>;
      expect(result.created).toBe(true);
      expect(result.id).toBe('issue358-happy-path-1');
      expect(result.error).toBeUndefined();
      // Verify persistence on disk
      const persisted = fs.existsSync(path.join(dir, 'issue358-happy-path-1.json'));
      expect(persisted).toBe(true);
      // Verify listing reports it
      const listed = await dispatch({ action: 'list' }) as Record<string, unknown>;
      const items = (listed.items as Array<{ id: string }>) || [];
      expect(items.some(it => it.id === 'issue358-happy-path-1')).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Silent skip upgraded to structured error: when writeEntryAsync reports
  // a duplicate-at-write and the post-reload index still does NOT see the
  // entry (and the file is NOT in loadErrors), we must NOT return
  // `success:true, skipped:true, visibilityWarning:...` — that is the exact
  // silent skip the issue complains about. The new contract is
  // `success:false, error:'mutation_persist_failed'` with a hint naming
  // INDEX_SERVER_MUTATION.
  // ──────────────────────────────────────────────────────────────────────
  describe('instructions.add: post-write visibility anomaly returns structured error', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(TMP_BASE + '-vis-'));
      fs.mkdirSync(dir, { recursive: true });
      process.env.INDEX_SERVER_DIR = dir;
      process.env.INDEX_SERVER_MUTATION = '1';
      reloadRuntimeConfig();
      forceBootstrapConfirmForTests('issue358-visibility');
    });
    afterEach(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      vi.restoreAllMocks();
    });

    it('returns success:false with mutation_persist_failed + INDEX_SERVER_MUTATION hint', async () => {
      // Mock the indexContext module to force the visibility-anomaly path:
      //  - writeEntryAsync throws a duplicate-write error
      //  - ensureLoadedAsync returns a state where byId does NOT contain the id
      //  - loadErrors does NOT mention the file (so we hit the silent branch)
      const indexContext = await import('../../services/indexContext.js');
      const dupErr = Object.assign(new Error('duplicate'), { code: 'DUPLICATE_INSTRUCTION_WRITE' }) as Error & { code: string };
      const fakeState = {
        loadedAt: new Date().toISOString(),
        hash: 'fake-hash',
        byId: new Map(),
        list: [],
        fileCount: 0,
        versionMTime: 0,
        versionToken: 'v0',
        loadErrors: [],
      };
      vi.spyOn(indexContext, 'writeEntryAsync').mockImplementation(async () => { throw dupErr; });
      vi.spyOn(indexContext, 'ensureLoadedAsync').mockImplementation(async () => fakeState as unknown as Awaited<ReturnType<typeof indexContext.ensureLoadedAsync>>);
      vi.spyOn(indexContext, 'isDuplicateInstructionWriteError').mockImplementation(() => true);
      vi.spyOn(indexContext, 'invalidate').mockImplementation(() => { /* no-op */ });

      const addHandler = getHandler('index_add')!;
      const result = await addHandler({
        entry: {
          id: 'issue358-visibility-anomaly',
          title: 'Visibility Anomaly',
          body: 'Body for visibility anomaly test',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          categories: ['test'],
        },
        overwrite: false,
        lax: true,
        _viaDispatcher: true,
      }) as Record<string, unknown>;

      expect(result).toBeDefined();
      // The fix turns this into a structured error envelope.
      expect(result.success).toBe(false);
      expect(result.error).toBe('mutation_persist_failed');
      expect(typeof result.message).toBe('string');
      expect(typeof result.hint).toBe('string');
      expect(result.hint as string).toMatch(/INDEX_SERVER_MUTATION/);
      // It must NOT masquerade as a successful skip.
      expect(result.skipped).not.toBe(true);
    });
  });
});
