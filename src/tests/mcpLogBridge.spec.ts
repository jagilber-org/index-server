/**
 * Tests for the MCP Log Bridge module.
 * Validates: immediate stderr interception, pre-handshake buffering,
 * buffer replay on activation, level mapping, and error resilience.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let registerMcpServer: typeof import('../services/mcpLogBridge').registerMcpServer;
let activateMcpLogBridge: typeof import('../services/mcpLogBridge').activateMcpLogBridge;
let isMcpLogBridgeActive: typeof import('../services/mcpLogBridge').isMcpLogBridgeActive;
let sendMcpLog: typeof import('../services/mcpLogBridge').sendMcpLog;
let _restoreStderr: typeof import('../services/mcpLogBridge')._restoreStderr;

describe('mcpLogBridge', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../services/mcpLogBridge.js');
    registerMcpServer = mod.registerMcpServer;
    activateMcpLogBridge = mod.activateMcpLogBridge;
    isMcpLogBridgeActive = mod.isMcpLogBridgeActive;
    sendMcpLog = mod.sendMcpLog;
    _restoreStderr = mod._restoreStderr;
  });

  afterEach(() => {
    // Always restore original stderr after each test
    _restoreStderr();
  });

  it('bridge is inactive before activation', () => {
    expect(isMcpLogBridgeActive()).toBe(false);
  });

  it('activation without server registration is a no-op', () => {
    activateMcpLogBridge();
    expect(isMcpLogBridgeActive()).toBe(false);
  });

  it('activation succeeds after server registration', () => {
    const mockServer = { sendLoggingMessage: vi.fn() };
    registerMcpServer(mockServer);
    activateMcpLogBridge();
    expect(isMcpLogBridgeActive()).toBe(true);
  });

  it('sendMcpLog is a no-op when bridge is inactive', () => {
    const mockServer = { sendLoggingMessage: vi.fn() };
    registerMcpServer(mockServer);
    sendMcpLog('INFO', '{"msg":"test"}');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('sendMcpLog routes through server.sendLoggingMessage', () => {
    const mockServer = { sendLoggingMessage: vi.fn() };
    registerMcpServer(mockServer);
    activateMcpLogBridge();

    sendMcpLog('INFO', '{"msg":"hello"}');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'info',
      logger: 'index-server',
      data: '{"msg":"hello"}',
    });
  });

  it('maps all log levels correctly', () => {
    const mockServer = { sendLoggingMessage: vi.fn() };
    registerMcpServer(mockServer);
    activateMcpLogBridge();

    const cases: Array<[import('../services/logger').LogLevel, string]> = [
      ['TRACE', 'debug'],
      ['DEBUG', 'debug'],
      ['INFO', 'info'],
      ['WARN', 'warning'],
      ['ERROR', 'error'],
    ];

    for (const [input, expected] of cases) {
      mockServer.sendLoggingMessage.mockClear();
      sendMcpLog(input, `{"level":"${input}"}`);
      expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
        expect.objectContaining({ level: expected }),
      );
    }
  });

  it('deactivates bridge on sendLoggingMessage failure', () => {
    const mockServer = {
      sendLoggingMessage: vi.fn().mockImplementation(() => {
        throw new Error('transport closed');
      }),
    };
    registerMcpServer(mockServer);
    activateMcpLogBridge();
    expect(isMcpLogBridgeActive()).toBe(true);

    sendMcpLog('ERROR', '{"msg":"boom"}');
    expect(isMcpLogBridgeActive()).toBe(false);

    mockServer.sendLoggingMessage.mockClear();
    sendMcpLog('INFO', '{"msg":"ignored"}');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  it('activation with server lacking sendLoggingMessage is a no-op', () => {
    const badServer = { otherMethod: vi.fn() };
    registerMcpServer(badServer);
    activateMcpLogBridge();
    expect(isMcpLogBridgeActive()).toBe(false);
  });

  // --- Stderr interception & buffering ---

  it('buffers stderr writes before bridge activation', () => {
    process.stderr.write('[config] EXPERIMENTAL: SQLite storage\n');
    process.stderr.write('[startup] Dashboard started\n');

    const mockServer = { sendLoggingMessage: vi.fn() };
    registerMcpServer(mockServer);
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();

    // Activation replays the buffer
    activateMcpLogBridge();
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(2);
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: '[config] EXPERIMENTAL: SQLite storage' }),
    );
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: '[startup] Dashboard started' }),
    );
  });

  it('routes stderr directly after activation (no buffering)', () => {
    const mockServer = { sendLoggingMessage: vi.fn() };
    registerMcpServer(mockServer);
    activateMcpLogBridge();
    mockServer.sendLoggingMessage.mockClear();

    process.stderr.write('[storage] EXPERIMENTAL: SQLite backend\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        data: '[storage] EXPERIMENTAL: SQLite backend',
      }),
    );
  });

  it('infers correct level from raw stderr NDJSON', () => {
    const mockServer = { sendLoggingMessage: vi.fn() };
    registerMcpServer(mockServer);
    activateMcpLogBridge();
    mockServer.sendLoggingMessage.mockClear();

    process.stderr.write('{"level":"WARN","msg":"something bad"}\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );

    mockServer.sendLoggingMessage.mockClear();
    process.stderr.write('{"level":"ERROR","msg":"crash"}\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('infers level from keyword patterns in raw stderr', () => {
    const mockServer = { sendLoggingMessage: vi.fn() };
    registerMcpServer(mockServer);
    activateMcpLogBridge();
    mockServer.sendLoggingMessage.mockClear();

    process.stderr.write('[trace:ensureLoaded] some debug info\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'debug' }),
    );

    mockServer.sendLoggingMessage.mockClear();
    process.stderr.write('WARN: something went wrong\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('restores stderr on transport failure during active interception', () => {
    const mockServer = {
      sendLoggingMessage: vi.fn().mockImplementation(() => {
        throw new Error('transport closed');
      }),
    };
    registerMcpServer(mockServer);
    activateMcpLogBridge();

    process.stderr.write('test\n');
    expect(isMcpLogBridgeActive()).toBe(false);
  });

  it('replays buffered lines with correct inferred levels', () => {
    process.stderr.write('{"level":"INFO","msg":"startup"}\n');
    process.stderr.write('WARN: deprecated feature\n');
    process.stderr.write('[trace:load] loading index\n');
    process.stderr.write('ERROR: something broke\n');

    const mockServer = { sendLoggingMessage: vi.fn() };
    registerMcpServer(mockServer);
    activateMcpLogBridge();

    const calls = mockServer.sendLoggingMessage.mock.calls;
    expect(calls[0][0]).toMatchObject({ level: 'info' });
    expect(calls[1][0]).toMatchObject({ level: 'warning' });
    expect(calls[2][0]).toMatchObject({ level: 'debug' });
    expect(calls[3][0]).toMatchObject({ level: 'error' });
  });
});
