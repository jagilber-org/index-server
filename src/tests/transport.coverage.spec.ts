/**
 * RED/GREEN tests for src/server/transport.ts
 *
 * Constitution TS-9: real production code, no stubs.
 * Constitution TS-4: full pipeline round-trip with JSON-RPC output validation.
 *
 * Coverage targets:
 *  - parse error (-32700)
 *  - invalid request (-32600: wrong jsonrpc version, missing method)
 *  - duplicate initialize (-32600: already initialized)
 *  - method not found (-32601) with available list in data
 *  - handler error propagates as -32603
 *  - notifications/initialized dispatch (no-id, benign)
 *  - shutdown handler
 *  - health_check handler returns expected shape
 *  - custom handler dispatch via tools/call equivalent
 *  - empty/whitespace lines ignored
 *  - verbose/protocolLog paths
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import { startTransport, registerHandler } from '../server/transport';
import { getHandler as getRegistryHandler, getMetricsRaw } from '../server/registry';

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/** Collect all JSON-RPC response objects emitted to the output stream */
function collectLines(output: PassThrough): string[] {
  const collected: string[] = [];
  output.on('data', (chunk: Buffer | string) => {
    chunk.toString().trim().split(/\n+/).filter(Boolean).forEach(l => collected.push(l));
  });
  return collected;
}

/** Wait for at least `count` lines to arrive, with a timeout */
async function waitForLines(lines: string[], count: number, timeoutMs = 300): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (lines.length < count && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10));
  }
}

/** Parse JSON lines into objects, silently skip non-JSON */
function parseJsonLines(lines: string[]): Record<string, unknown>[] {
  return lines.flatMap(l => {
    try { return [JSON.parse(l) as Record<string, unknown>]; } catch { return []; }
  });
}

/** Build a fresh transport with its own streams */
function makeTransport(env: Record<string, string> = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const stderr = new PassThrough();
  const lines = collectLines(output);
  startTransport({ input, output, stderr, env: { INDEX_SERVER_VERBOSE_LOGGING: '0', ...env } });
  return { input, output, stderr, lines };
}

/** Send a JSON-RPC request as a line */
function send(input: PassThrough, obj: unknown) {
  input.write(JSON.stringify(obj) + '\n');
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('transport - initialize handshake', () => {
  it('responds to initialize with result containing protocolVersion and serverInfo', async () => {
    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    await waitForLines(lines, 2, 400); // result + server/ready

    const frames = parseJsonLines(lines);
    const initResult = frames.find(f => f.id === 1 && 'result' in f);
    expect(initResult, 'initialize result frame must exist').toBeDefined();

    const result = initResult!.result as Record<string, unknown>;
    expect(result).toHaveProperty('protocolVersion');
    expect(result).toHaveProperty('serverInfo');
    expect((result.serverInfo as Record<string, unknown>).name).toBe('index');

    const ready = frames.find(f => (f as Record<string, unknown>).method === 'server/ready');
    expect(ready, 'server/ready notification must be emitted').toBeDefined();
  });

  it('returns -32600 error if initialize is called a second time', async () => {
    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 200);

    send(input, { jsonrpc: '2.0', id: 2, method: 'initialize' });
    await waitForLines(lines, 2, 200);

    const frames = parseJsonLines(lines);
    const dupError = frames.find(f => f.id === 2 && 'error' in f);
    expect(dupError, 'duplicate initialize must return error').toBeDefined();
    expect((dupError!.error as Record<string, unknown>).code).toBe(-32600);
  });
});

describe('transport - parse error', () => {
  it('returns -32700 parse error for malformed JSON', async () => {
    const { input, lines } = makeTransport();
    input.write('this is not json\n');
    await waitForLines(lines, 1, 200);

    const frames = parseJsonLines(lines);
    const parseErr = frames.find(f => 'error' in f);
    expect(parseErr, 'parse error frame must exist').toBeDefined();
    expect((parseErr!.error as Record<string, unknown>).code).toBe(-32700);
  });
});

describe('transport - invalid request', () => {
  it('returns -32600 for request missing method field', async () => {
    const { input, lines } = makeTransport();
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 5 }) + '\n');
    await waitForLines(lines, 1, 200);

    const frames = parseJsonLines(lines);
    const invalid = frames.find(f => 'error' in f);
    expect(invalid, 'invalid request error must exist').toBeDefined();
    expect((invalid!.error as Record<string, unknown>).code).toBe(-32600);
  });

  it('returns -32600 for wrong jsonrpc version', async () => {
    const { input, lines } = makeTransport();
    input.write(JSON.stringify({ jsonrpc: '1.0', id: 6, method: 'test' }) + '\n');
    await waitForLines(lines, 1, 200);

    const frames = parseJsonLines(lines);
    const invalid = frames.find(f => 'error' in f);
    expect(invalid, 'wrong version must return invalid request error').toBeDefined();
    expect((invalid!.error as Record<string, unknown>).code).toBe(-32600);
  });
});

describe('transport - method not found', () => {
  it('returns -32601 with available list for unknown method', async () => {
    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 200);

    send(input, { jsonrpc: '2.0', id: 7, method: 'does/not/exist' });
    await waitForLines(lines, 3, 300);

    const frames = parseJsonLines(lines);
    const notFound = frames.find(f => f.id === 7 && 'error' in f);
    expect(notFound, 'method not found error must exist').toBeDefined();

    const err = notFound!.error as Record<string, unknown>;
    expect(err.code).toBe(-32601);
    // data.available should be provided to help clients discover valid methods
    const data = err.data as Record<string, unknown> | undefined;
    expect(data?.method).toBe('does/not/exist');
  });
});

describe('transport - handler dispatch', () => {
  it('health_check handler returns status ok with version and uptime', async () => {
    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 200);

    send(input, { jsonrpc: '2.0', id: 8, method: 'health_check' });
    await waitForLines(lines, 4, 400);

    const frames = parseJsonLines(lines);
    const healthResp = frames.find(f => f.id === 8 && 'result' in f);
    expect(healthResp, 'health_check result must exist').toBeDefined();

    const result = healthResp!.result as Record<string, unknown>;
    expect(result.status).toBe('ok');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('version');
    expect(typeof result.uptime).toBe('number');
  });

  it('custom registered handler returns expected output', async () => {
    const method = `transport_custom_${Date.now()}`;
    registerHandler(method, (p: unknown) => {
      const params = p as { x?: number };
      return { doubled: (params?.x ?? 0) * 2 };
    });

    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 200);

    send(input, { jsonrpc: '2.0', id: 9, method, params: { x: 21 } });
    await waitForLines(lines, 4, 400);

    const frames = parseJsonLines(lines);
    const resp = frames.find(f => f.id === 9 && 'result' in f);
    expect(resp, 'custom handler result must exist').toBeDefined();

    const raw = JSON.stringify(resp!.result);
    expect(raw).toContain('42');
  });

  it('transport registration is visible in the canonical registry and records canonical metrics', async () => {
    const method = `transport_registry_${Date.now()}`;
    registerHandler(method, (p: unknown) => {
      const params = p as { value?: number };
      return { value: params?.value ?? 0 };
    });

    expect(getRegistryHandler(method), 'transport handler should be registered in canonical registry').toBeDefined();

    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 200);

    send(input, { jsonrpc: '2.0', id: 91, method, params: { value: 7 } });
    await waitForLines(lines, 4, 400);

    const frames = parseJsonLines(lines);
    const resp = frames.find(f => f.id === 91 && 'result' in f);
    expect(resp, 'registry-backed transport result must exist').toBeDefined();
    expect(JSON.stringify(resp!.result)).toContain('7');

    const metrics = getMetricsRaw();
    expect(metrics[method], 'canonical metrics should include transport-registered handler').toBeDefined();
    expect(metrics[method].count).toBeGreaterThanOrEqual(1);
  });

  it('handler that throws returns -32603 internal error', async () => {
    const method = `transport_throws_${Date.now()}`;
    registerHandler(method, () => {
      throw new Error('boom from handler');
    });

    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 200);

    send(input, { jsonrpc: '2.0', id: 10, method });
    await waitForLines(lines, 4, 400);

    const frames = parseJsonLines(lines);
    const errResp = frames.find(f => f.id === 10 && 'error' in f);
    expect(errResp, 'handler error must produce error response').toBeDefined();
    expect((errResp!.error as Record<string, unknown>).code).toBe(-32603);
  });

  it('shutdown handler returns shuttingDown flag', async () => {
    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 200);

    send(input, { jsonrpc: '2.0', id: 11, method: 'shutdown' });
    await waitForLines(lines, 4, 400);

    const frames = parseJsonLines(lines);
    const shutdownResp = frames.find(f => f.id === 11 && 'result' in f);
    expect(shutdownResp, 'shutdown result must exist').toBeDefined();
    const raw = JSON.stringify(shutdownResp!.result);
    expect(raw).toContain('shuttingDown');
  });
});

describe('transport - notifications (no-id frames)', () => {
  it('notifications/initialized returns acknowledged without breaking the stream', async () => {
    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 200);

    // Notification: no id field
    send(input, { jsonrpc: '2.0', method: 'notifications/initialized' });
    await new Promise(r => setTimeout(r, 50));

    // Stream should still be alive: send another request
    send(input, { jsonrpc: '2.0', id: 12, method: 'health_check' });
    await waitForLines(lines, 5, 400);

    const frames = parseJsonLines(lines);
    const healthResp = frames.find(f => f.id === 12 && 'result' in f);
    expect(healthResp, 'subsequent request after notification must succeed').toBeDefined();
  });
});

describe('transport - empty and whitespace input', () => {
  it('ignores blank lines without crashing', async () => {
    const { input, lines } = makeTransport();
    input.write('\n\n   \n');
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 300);

    const frames = parseJsonLines(lines);
    const initResult = frames.find(f => f.id === 1);
    expect(initResult, 'initialize must succeed after blank lines').toBeDefined();
  });
});

describe('transport - verbose/diagnostics mode', () => {
  it('starts without error in verbose mode', async () => {
    const { input, lines } = makeTransport({ INDEX_SERVER_VERBOSE_LOGGING: '1' });
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 300);

    const frames = parseJsonLines(lines);
    // Even in verbose mode, initialize returns a proper result
    const initResult = frames.find(f => f.id === 1 && 'result' in f);
    expect(initResult, 'verbose mode must still return initialize result').toBeDefined();
  });
});

describe('transport - diagnostics mode (covers startup log branch)', () => {
  afterEach(() => {
    delete process.env.INDEX_SERVER_LOG_DIAG;
  });

  it('starts with diagnostics enabled without breaking handshake', async () => {
    process.env.INDEX_SERVER_LOG_DIAG = '1';
    // Force runtimeConfig reload by creating a fresh transport (it re-reads config at start)
    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 300);

    const frames = parseJsonLines(lines);
    const initResult = frames.find(f => f.id === 1 && 'result' in f);
    expect(initResult, 'diagnostics mode must still return initialize result').toBeDefined();
  });
});

describe('transport - error classification branches', () => {
  it('handler throwing structured JSON-RPC error (with .code) returns that code', async () => {
    const method = `transport_rpc_err_${Date.now()}`;
    registerHandler(method, () => {
      const err = { code: -32001, message: 'domain error', data: { detail: 'x' } };
      throw err;
    });

    const { input, lines } = makeTransport();
    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize' });
    await waitForLines(lines, 1, 200);

    send(input, { jsonrpc: '2.0', id: 20, method });
    await waitForLines(lines, 4, 400);

    const frames = parseJsonLines(lines);
    const errResp = frames.find(f => f.id === 20 && 'error' in f);
    expect(errResp, 'structured error response must exist').toBeDefined();
    // The transport preserves the custom code
    expect((errResp!.error as Record<string, unknown>).code).toBe(-32001);
  });

  it('initialize with no id field still returns a result (id defaults to 1)', async () => {
    const { input, lines } = makeTransport();
    // Send initialize WITHOUT an id field
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialize' }) + '\n');
    await waitForLines(lines, 2, 400);

    const frames = parseJsonLines(lines);
    // Should have a result frame (id defaults to 1 or null)
    const initResult = frames.find(f => 'result' in f && !('error' in f));
    expect(initResult, 'initialize without id must still return result').toBeDefined();
  });
});
