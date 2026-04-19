/**
 * Unit tests for WebSocketManager verifyClient callback.
 *
 * Extracts the inline verifyClient callback by mocking the ws module's
 * WebSocketServer constructor and capturing the options passed to it.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { IncomingMessage } from 'http';
import { Socket } from 'net';

// Capture the verifyClient callback from the WebSocketServer constructor
let capturedVerifyClient: ((
  info: { origin: string; secure: boolean; req: IncomingMessage },
  callback: (result: boolean, code?: number, message?: string) => void,
) => void) | undefined;

vi.mock('ws', () => ({
  WebSocket: { OPEN: 1, CLOSED: 3 },
  WebSocketServer: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    capturedVerifyClient = opts.verifyClient as typeof capturedVerifyClient;
    return { on: vi.fn(), close: vi.fn(), clients: new Set() };
  }),
}));

vi.mock('../../config/runtimeConfig.js', () => ({
  getRuntimeConfig: vi.fn(),
}));

vi.mock('../../dashboard/server/MetricsCollector.js', () => ({
  getMetricsCollector: vi.fn().mockReturnValue({
    recordConnection: vi.fn(),
    recordDisconnection: vi.fn(),
    getSnapshot: vi.fn().mockReturnValue({}),
  }),
  MetricsSnapshot: {},
}));

vi.mock('../../dashboard/server/SessionPersistenceManager', () => ({
  SessionPersistenceManager: vi.fn().mockImplementation(() => ({
    saveConnectionState: vi.fn(),
    loadConnectionState: vi.fn(),
  })),
}));

vi.mock('../../models/SessionPersistence', () => ({}));

vi.mock('../../services/logger.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

import { WebSocketManager } from '../../dashboard/server/WebSocketManager.js';
import { getRuntimeConfig } from '../../config/runtimeConfig.js';
import { Server as HttpServer } from 'http';

const mockedGetRuntimeConfig = vi.mocked(getRuntimeConfig);

/** Build a mock info object for verifyClient. */
function mockInfo(overrides: {
  remoteAddress?: string;
  url?: string;
  headers?: Record<string, string>;
} = {}) {
  const socket = new Socket();
  Object.defineProperty(socket, 'remoteAddress', {
    value: overrides.remoteAddress ?? '127.0.0.1',
    configurable: true,
  });
  const req = new IncomingMessage(socket);
  req.url = overrides.url || '/ws';
  if (overrides.headers) {
    for (const [k, v] of Object.entries(overrides.headers)) {
      req.headers[k.toLowerCase()] = v;
    }
  }
  return { origin: '', secure: false, req };
}

/** Invoke verifyClient and return what the callback received. */
function callVerifyClient(
  info: ReturnType<typeof mockInfo>,
): { result: boolean; code?: number; message?: string } {
  const cb = vi.fn();
  capturedVerifyClient!(info, cb);
  expect(cb).toHaveBeenCalledOnce();
  const [result, code, message] = cb.mock.calls[0] as [boolean, number | undefined, string | undefined];
  return { result, code, message };
}

describe('WebSocketManager verifyClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedVerifyClient = undefined;

    mockedGetRuntimeConfig.mockReturnValue({
      dashboard: { http: { adminApiKey: '' } },
    } as ReturnType<typeof getRuntimeConfig>);

    const manager = new WebSocketManager();
    manager.initialize({} as HttpServer);
    expect(capturedVerifyClient).toBeDefined();
  });

  // ── No admin key configured ──────────────────────────────────────────

  describe('when no admin key is configured', () => {
    it('allows loopback address 127.0.0.1', () => {
      const out = callVerifyClient(mockInfo({ remoteAddress: '127.0.0.1' }));
      expect(out.result).toBe(true);
    });

    it('allows loopback address ::1', () => {
      const out = callVerifyClient(mockInfo({ remoteAddress: '::1' }));
      expect(out.result).toBe(true);
    });

    it('allows loopback address ::ffff:127.0.0.1', () => {
      const out = callVerifyClient(mockInfo({ remoteAddress: '::ffff:127.0.0.1' }));
      expect(out.result).toBe(true);
    });

    it('rejects non-loopback address with 403', () => {
      const out = callVerifyClient(mockInfo({ remoteAddress: '192.168.1.100' }));
      expect(out.result).toBe(false);
      expect(out.code).toBe(403);
      expect(out.message).toMatch(/localhost/i);
    });

    it('rejects empty remote address with 403', () => {
      const out = callVerifyClient(mockInfo({ remoteAddress: '' }));
      expect(out.result).toBe(false);
      expect(out.code).toBe(403);
    });
  });

  // ── With admin key configured ────────────────────────────────────────

  describe('when admin key is configured', () => {
    const ADMIN_KEY = 'test-secret-key-12345';

    beforeEach(() => {
      mockedGetRuntimeConfig.mockReturnValue({
        dashboard: { http: { adminApiKey: ADMIN_KEY } },
      } as ReturnType<typeof getRuntimeConfig>);
    });

    it('accepts valid token as query parameter', () => {
      const out = callVerifyClient(
        mockInfo({ url: `/ws?token=${ADMIN_KEY}` }),
      );
      expect(out.result).toBe(true);
    });

    it('accepts valid token as Bearer authorization header', () => {
      const out = callVerifyClient(
        mockInfo({ headers: { Authorization: `Bearer ${ADMIN_KEY}` } }),
      );
      expect(out.result).toBe(true);
    });

    it('accepts Bearer prefix case-insensitively (lowercase)', () => {
      const out = callVerifyClient(
        mockInfo({ headers: { Authorization: `bearer ${ADMIN_KEY}` } }),
      );
      expect(out.result).toBe(true);
    });

    it('accepts Bearer prefix case-insensitively (uppercase)', () => {
      const out = callVerifyClient(
        mockInfo({ headers: { Authorization: `BEARER ${ADMIN_KEY}` } }),
      );
      expect(out.result).toBe(true);
    });

    it('rejects invalid token with 401', () => {
      const out = callVerifyClient(
        mockInfo({ url: '/ws?token=wrong-key' }),
      );
      expect(out.result).toBe(false);
      expect(out.code).toBe(401);
      expect(out.message).toMatch(/authentication/i);
    });

    it('rejects when no token or header is provided', () => {
      const out = callVerifyClient(mockInfo());
      expect(out.result).toBe(false);
      expect(out.code).toBe(401);
      expect(out.message).toMatch(/authentication/i);
    });

    it('rejects invalid Bearer header with 401', () => {
      const out = callVerifyClient(
        mockInfo({ headers: { Authorization: 'Bearer wrong-key' } }),
      );
      expect(out.result).toBe(false);
      expect(out.code).toBe(401);
    });

    it('prefers query token when both query and header are valid', () => {
      const out = callVerifyClient(
        mockInfo({
          url: `/ws?token=${ADMIN_KEY}`,
          headers: { Authorization: `Bearer ${ADMIN_KEY}` },
        }),
      );
      expect(out.result).toBe(true);
    });
  });
});
