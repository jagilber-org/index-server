/**
 * RED → GREEN: Issue #592 — handlers with no tool-registry entry are callable.
 *
 * Measured over stdio against the built dist: `tools/list` advertised 8 tools
 * while 62 handlers were registered and 60 registry entries existed at
 * `tier:'admin'`. The delta — `test_primitive`, `diagnostics_handshake`,
 * `dashboard_config` — was callable via `tools/call` while being invisible at
 * EVERY tier, absent from `meta_tools` and the generated artifacts, and
 * unvalidated (`validateParams` fails open when no schema is registered,
 * `validationService.ts:94`).
 *
 * This is constitution A-2 ("the tool registry must be updated for new tools"),
 * enforced at runtime rather than left to a test-time allowlist that silently
 * absorbed the drift (`toolRegistryConformance.spec.ts:30`).
 *
 * WHAT THIS IS NOT. Tiers are a `tools/list` VISIBILITY contract, not access
 * control — see `specs/002-tool-consolidation.md:33-41` ("reduces visible count
 * without removing anything"), `docs/tools.md:1646-1650` ("Tier Visibility"),
 * and `toolRegistry.ts:22` (`tier: ToolTier; // Visibility tier`). The gate
 * therefore checks membership in the FULL (`tier:'admin'`) registry, never in
 * the flag-resolved tier. Extended and admin tools such as `index_add` stay
 * callable with the tier flags off; case 4 is the falsifier that goes red if
 * anyone "upgrades" this to resolved-tier enforcement.
 *
 * TRAP CONDITIONS — every one of these produces a FALSE GREEN. Do not
 * "simplify" the cases below into any of them:
 *
 *  T1 Asserting on `tools/list`. It is ALREADY correct today (8 names). Any
 *     "X is absent from tools/list" assertion passes against the unfixed
 *     server. Red cases must invoke the real `tools/call` closure.
 *  T2 Asserting on `getToolRegistry()` membership. Also already correct today
 *     (60 entries, all three offenders absent).
 *  T3 Using only `test_primitive` as the undeclared subject. This PR deletes
 *     it, so such a case would go green because the handler VANISHED, not
 *     because the gate works. Cases 2 and 6 register a synthetic handler
 *     inside the test so the gate is the only thing that can pass them.
 *  T4 Refusing for the wrong reason. `-32601` is also what an unregistered
 *     name yields (`sdkServer.ts:214`). Red cases assert the handler IS
 *     registered at call time, and that its invocation counter stayed 0.
 *  T7 Caching membership. `INDEX_SERVER_DEBUG` is runtime-reloadable, so
 *     `isDeclaredTool` must not memoize.
 *
 * Cases 1, 4 and 5 are GREEN-BOTH-SIDES guards, labelled inline. The red set
 * is cases 2, 3, 6, 7, 8.
 *
 * Constitution: A-2, SH-9, TS-8/TS-9 (red first), TS-10 (drives the real
 * `createSdkServer` closure), TS-12 (normal/edge/error/boundary/concurrent).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getHandler, registerHandler, listRegisteredMethods } from '../../server/registry';
import { getToolRegistry } from '../../services/toolRegistry';

type HandlerRegistration = {
  schema: { safeParse: (input: unknown) => { success: boolean } };
  handler: (req: unknown) => Promise<unknown>;
};

class FakeServer {
  public readonly handlers: HandlerRegistration[] = [];
  constructor(_info: unknown, _opts?: unknown) { /* capture only */ }
  setRequestHandler(schema: HandlerRegistration['schema'], handler: HandlerRegistration['handler']) {
    this.handlers.push({ schema, handler });
  }
}

function getRegisteredHandler(server: FakeServer, method: string) {
  const match = server.handlers.find(({ schema }) =>
    schema.safeParse({ jsonrpc: '2.0', id: 1, method }).success);
  expect(match, `missing handler for ${method}`).toBeDefined();
  return match!.handler;
}

const UNDECLARED = '__issue592_undeclared__';
let undeclaredCalls = 0;

let toolsCall: (req: unknown) => Promise<unknown>;
let toolsList: (req: unknown) => Promise<unknown>;

describe('issue #592: tools/call refuses handlers with no registry entry (A-2)', () => {
  beforeAll(async () => {
    // Load the real production handler surface.
    // @ts-expect-error dynamic side-effect import
    await import('../../services/toolHandlers');
    // @ts-expect-error dynamic side-effect import
    await import('../../services/instructions.dispatcher');

    // A synthetic handler that is registered but declared NOWHERE. This is the
    // subject that survives the deletion of test_primitive (trap T3).
    registerHandler(UNDECLARED, () => { undeclaredCalls++; return 42; });

    const { createSdkServer } = await import('../../server/sdkServer.js');
    const server = createSdkServer(FakeServer as unknown as new (...a: unknown[]) => unknown) as unknown as FakeServer;
    toolsCall = getRegisteredHandler(server, 'tools/call');
    toolsList = getRegisteredHandler(server, 'tools/list');
  });

  // ── 1. normal — GUARD (green both sides) ─────────────────────────────────
  // A gate that blocks everything fails here.
  it('still serves a declared core tool', async () => {
    const res = await toolsCall({ params: { name: 'health_check', arguments: {} } }) as { content: unknown[] };
    expect(Array.isArray(res.content)).toBe(true);
  });

  // ── 2. error — RED: the core gate proof ──────────────────────────────────
  it('refuses a registered-but-undeclared handler without invoking it', async () => {
    // T4: prove the handler really is registered, so a -32601 cannot be
    // mistaken for "no such handler".
    expect(getHandler(UNDECLARED), 'synthetic handler must be registered').toBeDefined();
    undeclaredCalls = 0;

    await expect(toolsCall({ params: { name: UNDECLARED, arguments: {} } }))
      .rejects.toMatchObject({ code: -32601 });

    // The load-bearing assertion: the body never ran.
    expect(undeclaredCalls).toBe(0);
  });

  // ── 3. error — RED: diagnostics_handshake is undeclared today ────────────
  // After the fix it is registration-gated like its three siblings, so it is
  // absent unless INDEX_SERVER_DEBUG=1 / INDEX_SERVER_STRESS_DIAG=1. Either
  // way tools/call must not serve it in a default runtime (SH-9).
  it('refuses diagnostics_handshake in a default runtime', async () => {
    await expect(toolsCall({ params: { name: 'diagnostics_handshake', arguments: {} } }))
      .rejects.toMatchObject({ code: -32601 });
  });

  // ── 4. boundary — GUARD (green both sides): BLAST-RADIUS FALSIFIER ───────
  // Tiers are visibility-only. index_governanceHash is tier 'extended' and in
  // STABLE with no mutation gate, so it must remain callable even though the
  // tier flags are unset and it is absent from tools/list. This case goes RED
  // if anyone re-implements the gate against resolveActiveTier().
  it('keeps an extended-tier tool callable while it is hidden from tools/list', async () => {
    const listed = await toolsList({ params: {} }) as { tools: { name: string }[] };
    const names = listed.tools.map(t => t.name);
    expect(names, 'extended tool should be hidden from the default tier').not.toContain('index_governanceHash');

    const res = await toolsCall({ params: { name: 'index_governanceHash', arguments: {} } }) as { content: unknown[] };
    expect(Array.isArray(res.content), 'hidden-by-tier must still mean callable').toBe(true);
  });

  // ── 5. edge — GUARD (green both sides): dispatcher indirection ───────────
  // The dispatcher resolves targets via getHandler() INTERNALLY
  // (instructions.dispatcher.ts), already past the tools/call gate, so a
  // tools/call-level check must not reach them.
  it('leaves dispatcher-internal handler resolution untouched', async () => {
    const res = await toolsCall({ params: { name: 'index_dispatch', arguments: { action: 'capabilities' } } }) as { content: unknown[] };
    expect(Array.isArray(res.content)).toBe(true);
  });

  // ── 6. concurrent — RED ──────────────────────────────────────────────────
  it('refuses undeclared calls under concurrency, invoking nothing', async () => {
    expect(getHandler(UNDECLARED)).toBeDefined();
    undeclaredCalls = 0;

    const settled = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => toolsCall({
        params: { name: i % 2 ? UNDECLARED : 'health_check', arguments: {} },
      })));

    for (let i = 0; i < settled.length; i++) {
      if (i % 2) {
        expect(settled[i].status, `call ${i} (undeclared) must reject`).toBe('rejected');
        expect((settled[i] as PromiseRejectedResult).reason).toMatchObject({ code: -32601 });
      } else {
        expect(settled[i].status, `call ${i} (health_check) must resolve`).toBe('fulfilled');
      }
    }
    expect(undeclaredCalls).toBe(0);
  });

  // ── 7. error — RED: the A-2 invariant itself, no allowlist ───────────────
  it('has no registered handler outside the full tool registry', async () => {
    const declared = new Set(getToolRegistry({ tier: 'admin' }).map(t => t.name));
    const missing = listRegisteredMethods()
      .filter(n => n !== UNDECLARED)          // the synthetic subject is ours
      .filter(n => !declared.has(n));
    expect(missing, `Handlers with no registry entry: ${missing.join(', ')}`).toHaveLength(0);
  });

  // ── 8. acceptance — RED: the issue's own falsification bar ───────────────
  // NOTE: this is an ACCEPTANCE check, not proof of the gate. This PR deletes
  // test_primitive, so post-fix it passes because the handler is gone (T3).
  // Case 2 is the case that proves the gate.
  it('does not serve test_primitive', async () => {
    await expect(toolsCall({ params: { name: 'test_primitive', arguments: {} } }))
      .rejects.toMatchObject({ code: -32601 });
  });
});
