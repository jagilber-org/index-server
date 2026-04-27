import { afterEach, describe, expect, it, vi } from 'vitest';

type HandlerRegistration = {
  schema: { safeParse: (input: unknown) => { success: boolean } };
  handler: (req: unknown) => Promise<unknown>;
};

class FakeServer {
  public readonly handlers: HandlerRegistration[] = [];
  public version?: string;

  constructor(info: { name: string; version: string }) {
    this.version = info.version;
  }

  setRequestHandler(schema: HandlerRegistration['schema'], handler: HandlerRegistration['handler']) {
    this.handlers.push({ schema, handler });
  }
}

function getRegisteredHandler(server: FakeServer, method: string) {
  const match = server.handlers.find(({ schema }) =>
    schema.safeParse({ jsonrpc: '2.0', id: 1, method }).success,
  );
  expect(match, `missing handler for ${method}`).toBeDefined();
  return match!.handler;
}

describe('sdkServer initialize errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('../../server/handshakeManager.js');
  });

  it('throws an MCP initialize error instead of returning a fake success response', async () => {
    vi.doMock('../../server/handshakeManager.js', async () => {
      const actual = await vi.importActual<typeof import('../../server/handshakeManager.js')>('../../server/handshakeManager.js');
      return {
        ...actual,
        negotiateProtocolVersion: vi.fn(() => {
          throw new Error('boom');
        }),
      };
    });

    const { createSdkServer } = await import('../../server/sdkServer.js');

    const server = createSdkServer(FakeServer as unknown as new (...args: unknown[]) => unknown) as FakeServer;
    const initialize = getRegisteredHandler(server, 'initialize');

    await expect(
      initialize({ params: { protocolVersion: '2025-06-18' } }),
    ).rejects.toMatchObject({
      code: -32603,
      message: 'Initialize handler failure',
      data: { message: 'boom' },
    });
  });
});
