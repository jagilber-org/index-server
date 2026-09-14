/**
 * RED → GREEN: Issue #605 — `POST /mcp/rpc` invoked tool handlers with no
 * schema validation, no declared-tool gate and no auth.
 *
 * `HttpTransport.ts:54-95` (pre-fix) dispatched to the same handler registry as
 * the stdio `tools/call` path while applying NONE of its three controls:
 * `validateParams` (#581 / PR #601), `isDeclaredTool` (#592, `sdkServer.ts:234`)
 * and authentication. The route is mounted on a bare `express()` app
 * (`multiInstanceStartup.ts:38,90`) that never sees the dashboard's middleware,
 * so `INDEX_SERVER_MODE=leader` + `INDEX_SERVER_DASHBOARD_HOST=0.0.0.0`
 * exposed unauthenticated tool invocation on every interface.
 *
 * TRAP CONDITIONS — each of these yields a FALSE GREEN:
 *
 *  T1 Asserting only on the response code. A 404/400 can also come from the
 *     pre-existing "no such handler" branch. Every red case registers a WORKING
 *     handler under the name it calls and asserts the invocation counter stayed
 *     0 — the handler must be reachable and still not reached.
 *  T2 Testing only the `method: 'tools/call'` envelope. The follower handler
 *     proxy sends `method: '<toolName>'` directly
 *     (`multiInstanceStartup.ts:71-77`), so both shapes must be guarded.
 *  T3 Testing auth by asserting a 403 for an unreachable address. The refusal
 *     must be driven by the real middleware with a real non-loopback `req.ip`,
 *     and the "no key set, loopback" case must still pass (cases 1 and 9),
 *     or a middleware that refuses everything would look correct.
 *  T4 Asserting an error MESSAGE for the undeclared case without comparing it
 *     to stdio. #592's whole point is that the refusal is byte-identical
 *     regardless of whether a handler exists, so case 5 compares the HTTP
 *     refusal against the refusal thrown by the real `createSdkServer`
 *     `tools/call` closure for the same name.
 *
 * Cases 1, 4 and 9 are GREEN-BOTH-SIDES guards: they pass before and after the
 * fix and fail if the guard simply refuses everything.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import { createMcpTransportRoutes, mcpTransportAuth } from '../../dashboard/server/HttpTransport';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';

/** Registered in the mock lookup but declared NOWHERE — the #592 subject. */
const UNDECLARED = '__issue605_undeclared__';
/** Not registered anywhere — the control the undeclared refusal must be indistinguishable from. */
const ABSENT = '__issue605_absent__';

const calls: Record<string, number> = {};

const mockHandlers: Record<string, (params: unknown) => Promise<unknown>> = {
  // Declared, schema'd, mutating tool — the falsification-bar subject.
  messaging_send: async (params) => { calls.messaging_send++; return { sent: true, echo: params }; },
  health_check: async () => { calls.health_check++; return { status: 'ok' }; },
  // A real, working handler behind an undeclared name.
  [UNDECLARED]: async () => { calls[UNDECLARED]++; return 42; },
};

const handlerLookup = (method: string) => mockHandlers[method];

let server: http.Server;
let baseUrl: string;

async function rpc(payload: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/mcp/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() as Record<string, never> & { error?: { code: number; message: string }; result?: unknown } };
}

describe('issue #605: POST /mcp/rpc runs the stdio guard sequence', () => {
  beforeAll(async () => {
    delete process.env.INDEX_SERVER_ADMIN_API_KEY;
    reloadRuntimeConfig();
    const app = express();
    app.use('/mcp', createMcpTransportRoutes({ handlerLookup }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    delete process.env.INDEX_SERVER_ADMIN_API_KEY;
    reloadRuntimeConfig();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    for (const key of Object.keys(mockHandlers)) calls[key] = 0;
  });

  // ── 1. normal — GUARD (green both sides) ────────────────────────────────
  it('still dispatches a declared tool with valid params (direct method form)', async () => {
    const { status, body } = await rpc({
      jsonrpc: '2.0',
      method: 'messaging_send',
      params: { channel: 'general', sender: 'a', recipients: ['*'], body: 'hi' },
      id: 1,
    });
    expect(status).toBe(200);
    expect(body.result).toMatchObject({ sent: true });
    expect(calls.messaging_send).toBe(1);
  });

  // ── 2. error — RED: the falsification bar, verbatim ─────────────────────
  it('rejects tools/call with a bad argument type as -32602 naming the field', async () => {
    const { status, body } = await rpc({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'messaging_send', arguments: { channel: 123 } },
      id: 2,
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toMatch(/channel/);
    // T1: the handler is reachable and must not have run.
    expect(calls.messaging_send).toBe(0);
  });

  // ── 3. error — RED: same, via the follower-proxy request shape (T2) ─────
  it('rejects the direct method form with bad params as -32602', async () => {
    const { status, body } = await rpc({
      jsonrpc: '2.0',
      method: 'messaging_send',
      params: { channel: 123 },
      id: 3,
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toMatch(/channel/);
    expect(calls.messaging_send).toBe(0);
  });

  // ── 4. normal — GUARD: tools/call still works and is MCP-shaped ─────────
  it('serves a valid tools/call and returns an MCP content array', async () => {
    const { status, body } = await rpc({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'health_check', arguments: {} },
      id: 4,
    });
    expect(status).toBe(200);
    expect(calls.health_check).toBe(1);
    const content = (body.result as { content?: { type: string; text: string }[] })?.content;
    expect(Array.isArray(content)).toBe(true);
    expect(JSON.parse(content![0].text)).toEqual({ status: 'ok' });
  });

  // ── 5. error — RED: declared-tool gate, no invocation ───────────────────
  it('refuses a registered-but-undeclared handler without invoking it', async () => {
    // T1: prove the handler is genuinely reachable through this lookup.
    expect(handlerLookup(UNDECLARED)).toBeDefined();
    const { status, body } = await rpc({ jsonrpc: '2.0', method: UNDECLARED, params: {}, id: 5 });
    expect(status).toBe(404);
    expect(body.error?.code).toBe(-32601);
    expect(body.error?.message).toBe(`Unknown tool: ${UNDECLARED}`);
    expect(calls[UNDECLARED]).toBe(0);
  });

  // ── 6. boundary — RED: the enumeration oracle #592 closed ───────────────
  it('is indistinguishable between an undeclared handler and an absent one', async () => {
    const present = await rpc({ jsonrpc: '2.0', method: UNDECLARED, params: {}, id: 6 });
    const absent = await rpc({ jsonrpc: '2.0', method: ABSENT, params: {}, id: 6 });
    expect(present.status).toBe(absent.status);
    expect(present.body.error?.code).toBe(absent.body.error?.code);
    // Identical modulo the echoed name — no extra field, no different wording.
    expect(present.body.error?.message.replace(UNDECLARED, 'X'))
      .toBe(absent.body.error?.message.replace(ABSENT, 'X'));
    expect(Object.keys(present.body.error!).sort()).toEqual(Object.keys(absent.body.error!).sort());
    expect(calls[UNDECLARED]).toBe(0);
  });

  // ── 7. error — RED: no key set, non-loopback caller is refused ──────────
  // Driven through the exported middleware because binding a test server to a
  // routable interface is not portable (T3).
  it('refuses a non-loopback caller with 403 when no admin key is set', () => {
    delete process.env.INDEX_SERVER_ADMIN_API_KEY;
    reloadRuntimeConfig();
    let nexted = false;
    let statusCode = 0;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json() { return this; },
    };
    mcpTransportAuth(
      { ip: '203.0.113.9', socket: { remoteAddress: '203.0.113.9' }, headers: {} } as never, // pii-allowlist: RFC 5737 TEST-NET-3
      res as never,
      () => { nexted = true; },
    );
    expect(nexted).toBe(false);
    expect(statusCode).toBe(403);
  });

  // ── 8. error — RED: key set, request without a header is refused ────────
  it('returns 401 and does not invoke the handler when the admin key is missing or wrong', async () => {
    process.env.INDEX_SERVER_ADMIN_API_KEY = 'issue605-test-key'; // pragma: allowlist secret
    reloadRuntimeConfig();
    try {
      const missing = await rpc({
        jsonrpc: '2.0',
        method: 'messaging_send',
        params: { channel: 'general', sender: 'a', recipients: ['*'], body: 'hi' },
        id: 8,
      });
      expect(missing.status).toBe(401);
      const wrong = await rpc(
        { jsonrpc: '2.0', method: 'health_check', params: {}, id: 8 },
        { Authorization: 'Bearer wrong-key' }, // pragma: allowlist secret
      );
      expect(wrong.status).toBe(401);
      expect(calls.messaging_send).toBe(0);
      expect(calls.health_check).toBe(0);
    } finally {
      delete process.env.INDEX_SERVER_ADMIN_API_KEY;
      reloadRuntimeConfig();
    }
  });

  // ── 9. normal — GUARD: the correct key still gets through ───────────────
  it('accepts a correct Bearer key', async () => {
    process.env.INDEX_SERVER_ADMIN_API_KEY = 'issue605-test-key'; // pragma: allowlist secret
    reloadRuntimeConfig();
    try {
      const { status } = await rpc(
        { jsonrpc: '2.0', method: 'health_check', params: {}, id: 9 },
        { Authorization: 'Bearer issue605-test-key' }, // pragma: allowlist secret
      );
      expect(status).toBe(200);
      expect(calls.health_check).toBe(1);
    } finally {
      delete process.env.INDEX_SERVER_ADMIN_API_KEY;
      reloadRuntimeConfig();
    }
  });
});

// ── 10. cross-transport parity (T4) ───────────────────────────────────────
// The HTTP refusal for an undeclared tool must be the SAME refusal the real
// stdio `tools/call` closure produces, not merely "some -32601".
describe('issue #605: HTTP and stdio refuse undeclared tools identically', () => {
  let toolsCall: (req: unknown) => Promise<unknown>;
  let parityServer: http.Server;
  let parityUrl: string;

  class FakeServer {
    public readonly handlers: { schema: { safeParse: (i: unknown) => { success: boolean } }; handler: (r: unknown) => Promise<unknown> }[] = [];
    constructor(_info: unknown, _opts?: unknown) { /* capture only */ }
    setRequestHandler(schema: { safeParse: (i: unknown) => { success: boolean } }, handler: (r: unknown) => Promise<unknown>) {
      this.handlers.push({ schema, handler });
    }
  }

  beforeAll(async () => {
    delete process.env.INDEX_SERVER_ADMIN_API_KEY;
    reloadRuntimeConfig();
    // @ts-expect-error dynamic side-effect import of the production handler surface
    await import('../../services/toolHandlers');
    const { registerHandler } = await import('../../server/registry.js');
    registerHandler(UNDECLARED, () => { calls[UNDECLARED] = (calls[UNDECLARED] ?? 0) + 1; return 42; });

    const { createSdkServer } = await import('../../server/sdkServer.js');
    const sdk = createSdkServer(FakeServer as unknown as new (...a: unknown[]) => unknown) as unknown as FakeServer;
    const match = sdk.handlers.find(({ schema }) => schema.safeParse({ jsonrpc: '2.0', id: 1, method: 'tools/call' }).success);
    expect(match, 'missing stdio tools/call handler').toBeDefined();
    toolsCall = match!.handler;

    const app = express();
    app.use('/mcp', createMcpTransportRoutes({ handlerLookup }));
    await new Promise<void>((resolve) => {
      parityServer = app.listen(0, '127.0.0.1', () => {
        const addr = parityServer.address();
        if (addr && typeof addr !== 'string') parityUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => parityServer.close(() => resolve()));
  });

  it('produces the same code and message on both transports', async () => {
    const stdioError = await toolsCall({ params: { name: UNDECLARED, arguments: {} } }).then(
      () => { throw new Error('stdio accepted an undeclared tool'); },
      (e: { code: number; message: string }) => e,
    );

    const res = await fetch(`${parityUrl}/mcp/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: UNDECLARED, arguments: {} }, id: 10 }),
    });
    const httpBody = await res.json() as { error: { code: number; message: string } };

    expect(httpBody.error.code).toBe(stdioError.code);
    expect(httpBody.error.message).toBe(stdioError.message);
  });

  it('also validates params identically on both transports', async () => {
    const stdioError = await toolsCall({ params: { name: 'messaging_send', arguments: { channel: 123 } } }).then(
      () => { throw new Error('stdio accepted invalid params'); },
      (e: { code: number; message: string }) => e,
    );

    const res = await fetch(`${parityUrl}/mcp/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'messaging_send', arguments: { channel: 123 } }, id: 11 }),
    });
    const httpBody = await res.json() as { error: { code: number; message: string } };

    expect(stdioError.code).toBe(-32602);
    expect(httpBody.error.code).toBe(stdioError.code);
    expect(httpBody.error.message).toBe(stdioError.message);
  });
});
