/**
 * RED/GREEN tests for src/server/registry.ts
 *
 * Constitution TS-9: exercises REAL production code with no stubs.
 * Constitution TS-4: validates full pipeline round-trips with output assertions.
 *
 * Coverage targets:
 *  - registerHandler basic call + return value shape
 *  - getHandler / getLocalHandler distinction
 *  - proxy mode (installHandlerProxy / getHandlerProxy)
 *  - local handler bypasses proxy
 *  - listRegisteredMethods
 *  - getMetricsRaw accumulation
 *  - error propagation (handler that throws)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  registerHandler,
  getHandler,
  getLocalHandler,
  installHandlerProxy,
  getHandlerProxy,
  listRegisteredMethods,
  getMetricsRaw,
} from '../server/registry';

// Use unique method names per test to avoid cross-test pollution via the
// module-level handlers map (module is singleton across the test file).
let _seq = 0;
function uid(base: string) { return `${base}_${++_seq}_${Date.now()}`; }

describe('registry - handler registration and dispatch', () => {
  afterEach(() => {
    // Always remove any proxy installed during the test.
    installHandlerProxy(null);
  });

  // -----------------------------------------------------------------------
  // RED: registerHandler + call returns wrapped result
  // -----------------------------------------------------------------------
  it('registered handler returns wrapped result with content array', async () => {
    const method = uid('test/echo');
    registerHandler(method, (params: unknown) => {
      const p = params as { value?: string };
      return { echoed: p?.value ?? 'default' };
    });

    const handler = getHandler(method);
    expect(handler, 'handler should be registered').toBeDefined();

    const result = await handler!({ value: 'hello' }) as Record<string, unknown>;
    // registry.ts wraps via wrapResponse -> result should have content array or direct result shape
    expect(result).toBeDefined();

    // The wrapResponse utility wraps plain objects into { content: [...] }
    // Validate the output contains our echoed value somewhere in the response
    const raw = JSON.stringify(result);
    expect(raw).toContain('hello');
  });

  // -----------------------------------------------------------------------
  // RED: getLocalHandler returns the RAW unwrapped function
  // -----------------------------------------------------------------------
  it('getLocalHandler returns raw unwrapped handler (bypasses wrapResponse)', async () => {
    const method = uid('test/raw');
    registerHandler(method, (_params: unknown) => ({ directValue: 42 }));

    const raw = getLocalHandler(method);
    expect(raw, 'local handler should exist').toBeDefined();

    const result = await raw!({}) as { directValue: number };
    // Raw handler returns the plain object, NOT wrapped in content array
    expect(result.directValue).toBe(42);
  });

  // -----------------------------------------------------------------------
  // RED: proxy intercepts calls when installed
  // -----------------------------------------------------------------------
  it('proxy intercepts registered handler calls', async () => {
    const method = uid('test/proxied');
    registerHandler(method, (_p: unknown) => ({ original: true }));

    const proxyCalls: Array<{ tool: string; params: unknown }> = [];
    installHandlerProxy(async (tool, params) => {
      proxyCalls.push({ tool, params });
      return { proxied: true, tool };
    });

    expect(getHandlerProxy()).not.toBeNull();

    const handler = getHandler(method);
    const result = await handler!({ x: 1 }) as Record<string, unknown>;

    // Proxy was called, not the real handler
    expect(proxyCalls).toHaveLength(1);
    expect(proxyCalls[0].tool).toBe(method);
    expect(proxyCalls[0].params).toEqual({ x: 1 });

    // Result comes from proxy
    const raw = JSON.stringify(result);
    expect(raw).toContain('proxied');
  });

  // -----------------------------------------------------------------------
  // RED: getLocalHandler ALWAYS runs locally, bypasses proxy
  // -----------------------------------------------------------------------
  it('getLocalHandler bypasses installed proxy', async () => {
    const method = uid('test/local-bypass');
    registerHandler(method, (_p: unknown) => ({ localOnly: true }));

    installHandlerProxy(async (_tool, _params) => {
      return { proxied: true }; // should NOT be returned
    });

    const localFn = getLocalHandler(method);
    const result = await localFn!({}) as { localOnly: boolean };

    // Local handler ignores the proxy
    expect(result.localOnly).toBe(true);
  });

  // -----------------------------------------------------------------------
  // RED: remove proxy by passing null
  // -----------------------------------------------------------------------
  it('removing proxy restores direct dispatch', async () => {
    const method = uid('test/no-proxy');
    registerHandler(method, (_p: unknown) => ({ direct: 'yes' }));

    installHandlerProxy(async () => ({ proxied: true }));
    installHandlerProxy(null); // remove

    expect(getHandlerProxy()).toBeNull();

    const handler = getHandler(method);
    const result = await handler!({}) as Record<string, unknown>;
    const raw = JSON.stringify(result);
    // direct handler ran; result contains 'yes' not proxied
    expect(raw).toContain('yes');
    expect(raw).not.toContain('"proxied"');
  });

  // -----------------------------------------------------------------------
  // RED: listRegisteredMethods includes registered method names
  // -----------------------------------------------------------------------
  it('listRegisteredMethods includes all registered handlers', () => {
    const m1 = uid('list/a');
    const m2 = uid('list/b');
    registerHandler(m1, () => ({}));
    registerHandler(m2, () => ({}));

    const methods = listRegisteredMethods();
    expect(Array.isArray(methods)).toBe(true);
    expect(methods).toContain(m1);
    expect(methods).toContain(m2);
    // Should be sorted alphabetically
    const sorted = [...methods].sort();
    expect(methods).toEqual(sorted);
  });

  // -----------------------------------------------------------------------
  // RED: getMetricsRaw accumulates call counts after dispatch
  // -----------------------------------------------------------------------
  it('getMetricsRaw records call count and timing after handler invocation', async () => {
    const method = uid('metrics/track');
    registerHandler(method, (_p: unknown) => ({ ok: true }));

    const handler = getHandler(method);
    await handler!({});
    await handler!({});

    const metrics = getMetricsRaw();
    expect(metrics[method]).toBeDefined();
    expect(metrics[method].count).toBeGreaterThanOrEqual(2);
    expect(metrics[method].totalMs).toBeGreaterThanOrEqual(0);
    expect(metrics[method].maxMs).toBeGreaterThanOrEqual(0);
  });

  // -----------------------------------------------------------------------
  // RED: error thrown by handler propagates through wrapped handler
  // -----------------------------------------------------------------------
  it('handler that throws propagates the error', async () => {
    const method = uid('error/throws');
    registerHandler(method, (_p: unknown) => {
      throw new Error('deliberate failure');
    });

    const handler = getHandler(method);
    await expect(handler!({})).rejects.toThrow('deliberate failure');

    // Metrics should still record the call (in finally block)
    const metrics = getMetricsRaw();
    expect(metrics[method]).toBeDefined();
    expect(metrics[method].count).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // RED: proxy error propagates
  // -----------------------------------------------------------------------
  it('proxy error propagates to caller', async () => {
    const method = uid('proxy/error');
    registerHandler(method, () => ({ ok: true }));

    installHandlerProxy(async () => {
      throw new Error('proxy boom');
    });

    const handler = getHandler(method);
    await expect(handler!({})).rejects.toThrow('proxy boom');
  });

  // -----------------------------------------------------------------------
  // RED: timing mode embeds __timing in response
  // -----------------------------------------------------------------------
  it('timing mode (INDEX_SERVER_ADD_TIMING=1) embeds __timing in response', async () => {
    const method = uid('timing/enabled');
    registerHandler(method, (_p: unknown) => ({ value: 'timed' }));

    const prev = process.env.INDEX_SERVER_ADD_TIMING;
    process.env.INDEX_SERVER_ADD_TIMING = '1';
    try {
      const handler = getHandler(method);
      const result = await handler!({}) as Record<string, unknown>;
      // __timing should be embedded in the wrapped response
      const raw = JSON.stringify(result);
      expect(raw).toContain('__timing');
      expect(raw).toContain(method);
    } finally {
      if (prev === undefined) delete process.env.INDEX_SERVER_ADD_TIMING;
      else process.env.INDEX_SERVER_ADD_TIMING = prev;
    }
  });

  // -----------------------------------------------------------------------
  // RED: error with numeric .code uses code-based errorType classification
  // -----------------------------------------------------------------------
  it('error with numeric code uses code-based errorType (metrics still recorded)', async () => {
    const method = uid('error/numeric-code');
    registerHandler(method, (_p: unknown) => {
      const err = { code: -32000, message: 'custom code error' };
      throw err;
    });

    const handler = getHandler(method);
    await expect(handler!({})).rejects.toMatchObject({ code: -32000 });

    const metrics = getMetricsRaw();
    expect(metrics[method].count).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // RED: error with .data.reason uses reason-based errorType
  // -----------------------------------------------------------------------
  it('error with data.reason uses reason errorType path', async () => {
    const method = uid('error/data-reason');
    registerHandler(method, (_p: unknown) => {
      const err = { data: { reason: 'index_not_loaded' }, message: 'failed' };
      throw err;
    });

    const handler = getHandler(method);
    // It should propagate (not swallow)
    await expect(handler!({})).rejects.toBeDefined();

    const metrics = getMetricsRaw();
    expect(metrics[method].count).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // RED: error with top-level .reason string
  // -----------------------------------------------------------------------
  it('error with top-level reason string uses reason errorType path', async () => {
    const method = uid('error/top-reason');
    registerHandler(method, (_p: unknown) => {
      const err = { reason: 'not_found', message: 'resource missing' };
      throw err;
    });

    const handler = getHandler(method);
    await expect(handler!({})).rejects.toBeDefined();

    const metrics = getMetricsRaw();
    expect(metrics[method].count).toBeGreaterThanOrEqual(1);
  });
});
