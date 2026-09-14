/**
 * RED → GREEN: Issue #581 — INPUT_SCHEMAS are never validated on the live
 * tools/call path.
 *
 * Before this fix, `validateParams` was only called in `transport.ts` (dead
 * code — no non-test importer). The live `sdkServer.ts` tools/call handler
 * called `getHandler(name)` → `handler(args)` with no schema check, making
 * every INPUT_SCHEMA purely cosmetic.
 *
 * Falsification bar from the issue: send `index_search` with `limit: "fifty"`
 * over the wire — before fix it reaches the handler; after, it must return
 * `-32602` naming the field. Send a valid call and confirm unchanged response.
 *
 * Constitution: A-2 (registry must be updated), TS-8/TS-9 (red first),
 * TS-10 (drives the real `createSdkServer` closure).
 */
import { describe, it, expect, beforeAll } from 'vitest';

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

let toolsCall: (req: unknown) => Promise<unknown>;

describe('issue #581: INPUT_SCHEMAS validated on live tools/call path', () => {
  beforeAll(async () => {
    // @ts-expect-error dynamic side-effect import
    await import('../../services/toolHandlers');
    // @ts-expect-error dynamic side-effect import
    await import('../../services/instructions.dispatcher');

    const { createSdkServer } = await import('../../server/sdkServer.js');
    const server = createSdkServer(FakeServer as unknown as new (...a: unknown[]) => unknown) as unknown as FakeServer;
    toolsCall = getRegisteredHandler(server, 'tools/call');
  });

  // ── 1. guard: valid call still works ────────────────────────────────────
  it('accepts a valid health_check call', async () => {
    const res = await toolsCall({ params: { name: 'health_check', arguments: {} } }) as { content: unknown[] };
    expect(Array.isArray(res.content)).toBe(true);
  });

  // ── 2. RED: the issue's own falsification bar ───────────────────────────
  it('rejects index_search with limit: "fifty" as -32602', async () => {
    await expect(toolsCall({
      params: { name: 'index_search', arguments: { query: 'test', limit: 'fifty' } },
    })).rejects.toMatchObject({ code: -32602 });
  });

  // ── 3. RED: wrong type on a required field ──────────────────────────────
  it('rejects index_dispatch with action as a number', async () => {
    await expect(toolsCall({
      params: { name: 'index_dispatch', arguments: { action: 123 } },
    })).rejects.toMatchObject({ code: -32602 });
  });

  // ── 4. guard: valid index_search still works ────────────────────────────
  it('accepts a valid index_search call', async () => {
    const res = await toolsCall({
      params: { name: 'index_search', arguments: { query: 'test' } },
    }) as { content: unknown[] };
    expect(Array.isArray(res.content)).toBe(true);
  });

  // ── 5. error response includes field path ───────────────────────────────
  it('error message names the invalid field', async () => {
    try {
      await toolsCall({
        params: { name: 'index_search', arguments: { query: 'test', limit: 'fifty' } },
      });
      expect.fail('should have thrown');
    } catch (e: unknown) {
      const err = e as { code: number; message: string };
      expect(err.code).toBe(-32602);
      expect(err.message).toContain('limit');
    }
  });

  // ── Ajv-only arm (tools with no Zod schema) ─────────────────────────────
  //
  // Cases 1-5 above all exercise `health_check` / `index_search` /
  // `index_dispatch`, which are Zod-backed. `buildValidator` takes the
  // Ajv-only branch whenever `reg.zodSchema` is absent — which is true for 17
  // of 61 tools in the DEFAULT configuration (the whole archive surface, the
  // messaging surface and `trace_dump`), not only under
  // INDEX_SERVER_VALIDATION_MODE=ajv. That branch returned a bare arrow
  // wrapper carrying neither `ajvFn` nor its own `.errors`, so `validateParams`
  // fell through to `[]` and `sdkServer` produced the contentless string
  // "Invalid params: " with `errors: []` — strictly less information than the
  // handler's own error gave before validation was wired up.
  //
  // These cases fail against that shape and pass once the Ajv-only return
  // carries `ajvFn: compiled`.

  it('rejects messaging_read with a non-string channel (Ajv-only arm)', async () => {
    await expect(toolsCall({
      params: { name: 'messaging_read', arguments: { channel: 123 } },
    })).rejects.toMatchObject({ code: -32602 });
  });

  it('names the offending field on the Ajv-only arm rather than returning an empty error array', async () => {
    try {
      await toolsCall({ params: { name: 'messaging_read', arguments: { channel: 123 } } });
      expect.fail('should have thrown');
    } catch (e: unknown) {
      const err = e as { code: number; message: string; data?: { errors?: unknown[] } };
      expect(err.code).toBe(-32602);
      // The regression guard: an empty array here is the defect, and it is
      // invisible to a test that only asserts the -32602 code.
      expect(err.data?.errors ?? []).not.toHaveLength(0);
      expect(err.message).not.toBe('Invalid params: ');
      expect(err.message).toContain('channel');
    }
  });

  it('reports a missing required property on the Ajv-only arm', async () => {
    try {
      await toolsCall({ params: { name: 'messaging_ack', arguments: {} } });
      expect.fail('should have thrown');
    } catch (e: unknown) {
      const err = e as { code: number; message: string; data?: { errors?: unknown[] } };
      expect(err.code).toBe(-32602);
      expect(err.data?.errors ?? []).not.toHaveLength(0);
      expect(err.message).toMatch(/messageIds|reader/);
    }
  });

  it('rejects an undeclared property on the Ajv-only arm (additionalProperties: false)', async () => {
    try {
      await toolsCall({ params: { name: 'messaging_read', arguments: { nope: 1 } } });
      expect.fail('should have thrown');
    } catch (e: unknown) {
      const err = e as { code: number; message: string; data?: { errors?: unknown[] } };
      expect(err.code).toBe(-32602);
      expect(err.data?.errors ?? []).not.toHaveLength(0);
    }
  });
});
