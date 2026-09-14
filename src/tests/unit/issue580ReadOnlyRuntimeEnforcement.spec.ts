/**
 * RED → GREEN: Issue #580 — `INDEX_SERVER_MUTATION=0` is not a read-only runtime.
 *
 * Constitution S-3 (severity: error) states operators MUST use
 * `INDEX_SERVER_MUTATION=0` when they need an explicit read-only runtime.
 * Measured over stdio against a seeded catalog, two holes broke that promise:
 *
 *  1. Client-forged origin flag. `guard()` skipped the mutation check whenever
 *     the params object carried `_viaDispatcher: true`. That key was stamped by
 *     the dispatcher, but `sdkServer.ts` passes `req.params.arguments` verbatim
 *     and no layer strips unknown keys, so ANY MCP client could set it and
 *     write to disk. The response came back as a clean success envelope with no
 *     marker, indistinguishable from a mutation-enabled server.
 *
 *  2. Ungated dispatcher. `index_dispatch {action:'add'}` annotated its response
 *     with `mutationEnabled:false` and then PERFORMED THE WRITE anyway;
 *     `{action:'remove', mode:'purge'}` deleted files outright.
 *
 * Expected after the fix: both paths refuse, nothing reaches disk, reads are
 * unaffected, writes still work when mutation is enabled, and the refusal is
 * audited (A-5).
 *
 * TRAP CONDITIONS these tests deliberately defend against — both would produce
 * a false green, so do not "simplify" them away:
 *
 *  a) Response-only assertions. For hole 1 the unfixed server returns a clean
 *     success; for hole 2 it ALREADY returns `mutationEnabled:false`. Asserting
 *     the envelope alone passes against the broken code. Every mutation case
 *     below therefore asserts the FILESYSTEM.
 *  b) Blocked by the wrong gate. On a fresh temp dir `mutationGatedReason()`
 *     returns 'bootstrap_confirmation_required' and the dispatcher blocks for an
 *     unrelated reason. Cases call `forceBootstrapConfirmForTests()` and assert
 *     `reason === 'mutation_disabled'` specifically, never merely that some
 *     block occurred.
 *
 * Constitution: S-3 (read-only runtime), TS-8/TS-9 (red→green, regression test
 * first), TS-10 (drives the real registry handlers, no reimplementation),
 * TS-12 (normal / edge / error / boundary / concurrent), A-5 (audit).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../server/registry';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating';
import { resetAuditLogCache, readAuditEntries } from '../../services/auditLog';

const TMP_BASE = path.join(process.cwd(), 'tmp', 'issue580-readonly-runtime');

async function loadAllHandlers() {
  // @ts-expect-error dynamic side-effect import
  await import('../../services/handlers.instructions');
  // @ts-expect-error dynamic side-effect import
  await import('../../services/instructions.dispatcher');
  // Needed for the manifest case: the dispatcher resolves manifest_status /
  // manifest_refresh out of the registry, and without this import they are
  // simply absent ("manifest_status handler not found").
  // @ts-expect-error dynamic side-effect import
  await import('../../services/handlers.manifest');
}

/**
 * Write a valid instruction record straight to disk, bypassing the write path.
 *
 * `sourceHash` MUST be 64 hex chars — the loader enforces `^[a-f0-9]{64}$` and
 * silently SKIPS a record that fails it (`[index:skip] … must match pattern`),
 * which surfaces as an empty `get` rather than an error. A short placeholder
 * here makes the read-path assertions fail for a reason unrelated to #580.
 */
function seedInstruction(dir: string, id: string) {
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
    id, title: `Seed ${id}`, body: 'seeded body', version: '1.0.0',
    priority: 5, audience: 'all', requirement: 'optional',
    sourceHash: 'a'.repeat(64), schemaVersion: '4.0.0',
  }));
}

/** Flat dispatcher `add` payload. */
function addPayload(id: string) {
  return {
    action: 'add', id, title: `Issue580 ${id}`, body: `body for ${id}`,
    priority: 50, audience: 'all', requirement: 'optional',
    categories: ['test'], lax: true,
  };
}

/** Nested `index_add` payload, plus the forged origin flag. */
function forgedAddParams(id: string) {
  return {
    entry: {
      id, title: `Issue580 ${id}`, body: `body for ${id}`,
      priority: 50, audience: 'all', requirement: 'optional',
      categories: ['test'],
    },
    lax: true,
    _viaDispatcher: true,
  };
}

describe('issue #580: INDEX_SERVER_MUTATION=0 is an enforced read-only runtime (S-3)', () => {
  const originalMutation = process.env.INDEX_SERVER_MUTATION;
  const originalDir = process.env.INDEX_SERVER_DIR;
  const originalAudit = process.env.INDEX_SERVER_AUDIT_LOG;
  let dir: string;

  beforeAll(async () => {
    // mkdtempSync needs the parent to exist; <cwd>/tmp is gitignored and absent
    // on a fresh checkout.
    fs.mkdirSync(path.dirname(TMP_BASE), { recursive: true });
    await loadAllHandlers();
  });

  afterAll(() => {
    if (originalMutation === undefined) delete process.env.INDEX_SERVER_MUTATION;
    else process.env.INDEX_SERVER_MUTATION = originalMutation;
    if (originalDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = originalDir;
    if (originalAudit === undefined) delete process.env.INDEX_SERVER_AUDIT_LOG;
    else process.env.INDEX_SERVER_AUDIT_LOG = originalAudit;
    reloadRuntimeConfig();
    resetAuditLogCache();
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(TMP_BASE + '-');
    process.env.INDEX_SERVER_DIR = dir;
    process.env.INDEX_SERVER_MUTATION = '0';
    // Keep the audit log OUT of the instruction dir; anything dropped in there
    // is scanned by the loader and pollutes the index summary.
    process.env.INDEX_SERVER_AUDIT_LOG = path.join(dir, 'audit', 'audit.jsonl');
    reloadRuntimeConfig();
    resetAuditLogCache();
    // Trap (b): remove bootstrap gating so a block can only mean mutation_disabled.
    forceBootstrapConfirmForTests('issue580-readonly');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── 1. normal — hole 1: forged origin flag on a direct mutation tool ──────
  it('refuses index_add carrying a forged _viaDispatcher flag, and writes nothing', async () => {
    const add = getHandler('index_add')!;
    await expect(add(forgedAddParams('issue580-forged'))).rejects.toMatchObject({
      code: -32601,
      data: { reason: 'mutation_disabled' },
    });
    // Load-bearing: the unfixed server resolves {created:true} and the file exists.
    expect(fs.existsSync(path.join(dir, 'issue580-forged.json'))).toBe(false);
  });

  // ── 2. error — hole 2: dispatcher-mediated write ─────────────────────────
  it('refuses index_dispatch action=add and writes nothing', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const r = await dispatch(addPayload('issue580-disp')) as Record<string, unknown>;
    expect(r.error).toBe('mutation_blocked');
    expect(r.reason).toBe('mutation_disabled');
    expect(r.mutationEnabled).toBe(false);
    expect(String(r.mutationHint)).toMatch(/INDEX_SERVER_MUTATION/);
    // Load-bearing: today r.error is undefined and this file exists.
    expect(fs.existsSync(path.join(dir, 'issue580-disp.json'))).toBe(false);
  });

  // ── 3. edge — destructive dispatcher path must not delete ────────────────
  it('refuses index_dispatch action=remove mode=purge and leaves the file on disk', async () => {
    seedInstruction(dir, 'issue580-seed');
    const seedFile = path.join(dir, 'issue580-seed.json');
    expect(fs.existsSync(seedFile)).toBe(true);

    const dispatch = getHandler('index_dispatch')!;
    const r = await dispatch({ action: 'remove', ids: ['issue580-seed'], mode: 'purge' }) as Record<string, unknown>;
    expect(r.reason).toBe('mutation_disabled');
    // Load-bearing: today this file is deleted.
    expect(fs.existsSync(seedFile)).toBe(true);
  });

  // ── 4. edge — forged flag on the destructive DIRECT path ─────────────────
  it('refuses a forged index_remove purge and leaves the file on disk', async () => {
    seedInstruction(dir, 'issue580-seed2');
    const seed2 = path.join(dir, 'issue580-seed2.json');

    const remove = getHandler('index_remove')!;
    await expect(remove({ ids: ['issue580-seed2'], mode: 'purge', _viaDispatcher: true }))
      .rejects.toMatchObject({ code: -32601 });
    // Load-bearing: today this resolves {removed:1} and the file is gone.
    expect(fs.existsSync(seed2)).toBe(true);
  });

  // ── 5. boundary — reads must NOT be over-blocked ─────────────────────────
  // Green on both sides by design. This is the falsifier for an over-broad fix:
  // it goes red if someone gates index_dispatch on its own name rather than on
  // the resolved target action.
  it('still serves read actions under a read-only runtime', async () => {
    seedInstruction(dir, 'issue580-seed');
    const dispatch = getHandler('index_dispatch')!;

    const list = await dispatch({ action: 'list' }) as Record<string, unknown>;
    expect(list.error).toBeUndefined();
    expect(Array.isArray(list.items)).toBe(true);

    const got = await dispatch({ action: 'get', id: 'issue580-seed' }) as Record<string, unknown>;
    expect(got.error).toBeUndefined();
    expect((got.item as Record<string, unknown>).id).toBe('issue580-seed');

    // governanceHash maps to index_governanceHash, deliberately NOT in mutationMethods.
    const gh = await dispatch({ action: 'governanceHash' }) as Record<string, unknown>;
    expect(gh.error).toBeUndefined();

    const caps = await dispatch({ action: 'capabilities' }) as Record<string, unknown>;
    expect(caps.error).toBeUndefined();
    expect(caps.mutationEnabled).toBe(false);
  });

  // ── 6. boundary — writes still work when mutation is enabled ─────────────
  // Green on both sides. Proves the fix is a gate, not a blanket denial, and
  // exercises the parseMutation() default-true path by unsetting the var.
  it('permits dispatcher writes when the runtime is not read-only', async () => {
    delete process.env.INDEX_SERVER_MUTATION;
    reloadRuntimeConfig();
    forceBootstrapConfirmForTests('issue580-enabled');

    const dispatch = getHandler('index_dispatch')!;
    const r = await dispatch(addPayload('issue580-enabled')) as Record<string, unknown>;
    expect(r.error).toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'issue580-enabled.json'))).toBe(true);
  });

  // ── 7. concurrent — no interleaving leaks a write through ────────────────
  it('refuses 8 concurrent forged and dispatcher writes, leaving zero files', async () => {
    const add = getHandler('index_add')!;
    const dispatch = getHandler('index_dispatch')!;

    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => i % 2
        ? add(forgedAddParams(`issue580-conc-${i}`))
        : dispatch(addPayload(`issue580-conc-${i}`))),
    );

    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (i % 2) {
        // Forged direct calls reject.
        expect(s.status).toBe('rejected');
        expect((s as PromiseRejectedResult).reason).toMatchObject({ code: -32601 });
      } else {
        // Dispatcher calls resolve with a refusal envelope.
        expect(s.status).toBe('fulfilled');
        expect((s as PromiseFulfilledResult<Record<string, unknown>>).value.reason).toBe('mutation_disabled');
      }
    }

    // Load-bearing: today all 8 land on disk.
    const written = fs.readdirSync(dir).filter(f => f.startsWith('issue580-conc'));
    expect(written).toHaveLength(0);
  });

  // ── 8b. edge — the adjacent manifest branch is gated too ─────────────────
  // manifestRefresh/manifestRepair are both in the MUTATION set and
  // manifest_refresh writes _manifest.json, but this branch checked only
  // bootstrap gating, never the mutation flag. manifestStatus is a read and
  // must stay open — that half is the falsifier for an over-broad gate.
  it('refuses dispatcher manifestRefresh but still serves manifestStatus', async () => {
    const dispatch = getHandler('index_dispatch')!;

    const refresh = await dispatch({ action: 'manifestRefresh' }) as Record<string, unknown>;
    expect(refresh.error).toBe('mutation_blocked');
    expect(refresh.reason).toBe('mutation_disabled');

    const status = await dispatch({ action: 'manifestStatus' }) as Record<string, unknown>;
    expect(status.error).toBeUndefined();
  });

  // ── 8. A-5 — the refusal is audited ──────────────────────────────────────
  it('audits the blocked dispatcher mutation (A-5)', async () => {
    const dispatch = getHandler('index_dispatch')!;
    await dispatch(addPayload('issue580-audit'));

    const { entries } = readAuditEntries();
    const blocked = entries.filter(e => (e as unknown as { action?: string }).action === 'mutation_blocked');
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.some(e => {
      const meta = (e as unknown as { meta?: Record<string, unknown> }).meta;
      return meta?.reason === 'mutation_disabled';
    })).toBe(true);
  });
});
