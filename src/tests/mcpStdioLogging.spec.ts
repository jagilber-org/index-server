/**
 * Tests for the generalized McpStdioLogger module.
 *
 * These test the reusable library independently of index-server's
 * mcpLogBridge adapter. Covers: construction, stderr interception,
 * buffering, activation/replay, level inference, transport failure,
 * buffer limit, and restore.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let McpStdioLogger: typeof import('../lib/mcpStdioLogging').McpStdioLogger;
let defaultInferLevel: typeof import('../lib/mcpStdioLogging').defaultInferLevel;

describe('McpStdioLogger (generalized)', () => {
  let logger: InstanceType<typeof McpStdioLogger>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../lib/mcpStdioLogging.js');
    McpStdioLogger = mod.McpStdioLogger;
    defaultInferLevel = mod.defaultInferLevel;
  });

  afterEach(() => {
    // Always restore stderr
    if (logger) logger.restore();
  });

  // --- Construction & initial state ---

  it('is inactive after construction', () => {
    logger = new McpStdioLogger({ serverName: 'test' });
    expect(logger.isActive).toBe(false);
  });

  it('does not intercept if interceptImmediately is false', () => {
    const origWrite = process.stderr.write;
    logger = new McpStdioLogger({ interceptImmediately: false });
    expect(process.stderr.write).toBe(origWrite);
  });

  it('intercepts stderr on construction by default', () => {
    const origWrite = process.stderr.write;
    logger = new McpStdioLogger({ serverName: 'test' });
    expect(process.stderr.write).not.toBe(origWrite);
  });

  // --- Activation ---

  it('activate without server is a no-op', () => {
    logger = new McpStdioLogger();
    logger.activate();
    expect(logger.isActive).toBe(false);
  });

  it('activate with server lacking sendLoggingMessage is a no-op', () => {
    logger = new McpStdioLogger();
    logger.registerServer({ otherMethod: vi.fn() } as any);
    logger.activate();
    expect(logger.isActive).toBe(false);
  });

  it('activate succeeds after registering a valid server', () => {
    logger = new McpStdioLogger();
    logger.registerServer({ sendLoggingMessage: vi.fn() });
    logger.activate();
    expect(logger.isActive).toBe(true);
  });

  // --- Buffering ---

  it('buffers stderr writes before activation', () => {
    logger = new McpStdioLogger({ serverName: 'test' });
    process.stderr.write('line 1\n');
    process.stderr.write('line 2\n');
    expect(logger.bufferSize).toBe(2);
  });

  it('replays buffer on activation', () => {
    logger = new McpStdioLogger({ serverName: 'test' });
    process.stderr.write('[startup] Initializing config\n');
    process.stderr.write('[startup] Loading handlers\n');

    const mockServer = { sendLoggingMessage: vi.fn() };
    logger.registerServer(mockServer);
    logger.activate();

    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(2);
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: '[startup] Initializing config', logger: 'test' }),
    );
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: '[startup] Loading handlers', logger: 'test' }),
    );
    expect(logger.bufferSize).toBe(0);
  });

  it('enforces buffer size limit', () => {
    logger = new McpStdioLogger({ serverName: 'test', maxBufferSize: 3 });
    process.stderr.write('a\n');
    process.stderr.write('b\n');
    process.stderr.write('c\n');
    process.stderr.write('d\n');
    expect(logger.bufferSize).toBe(3);

    // Verify oldest was dropped
    const mockServer = { sendLoggingMessage: vi.fn() };
    logger.registerServer(mockServer);
    logger.activate();
    const calls = mockServer.sendLoggingMessage.mock.calls;
    expect(calls[0][0].data).toBe('b');
    expect(calls[1][0].data).toBe('c');
    expect(calls[2][0].data).toBe('d');
  });

  // --- Active routing ---

  it('routes stderr directly through MCP after activation', () => {
    logger = new McpStdioLogger({ serverName: 'test' });
    const mockServer = { sendLoggingMessage: vi.fn() };
    logger.registerServer(mockServer);
    logger.activate();
    mockServer.sendLoggingMessage.mockClear();

    process.stderr.write('[storage] SQLite backend active\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledTimes(1);
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        logger: 'test',
        data: '[storage] SQLite backend active',
      }),
    );
  });

  it('log() sends through MCP protocol when active', () => {
    logger = new McpStdioLogger({ serverName: 'my-tool' });
    const mockServer = { sendLoggingMessage: vi.fn() };
    logger.registerServer(mockServer);
    logger.activate();
    mockServer.sendLoggingMessage.mockClear();

    logger.log('warning', 'disk space low');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'warning',
      logger: 'my-tool',
      data: 'disk space low',
    });
  });

  it('log() is a no-op when inactive', () => {
    logger = new McpStdioLogger();
    const mockServer = { sendLoggingMessage: vi.fn() };
    logger.registerServer(mockServer);
    // Not activated
    logger.log('info', 'ignored');
    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
  });

  // --- Transport failure ---

  it('deactivates on transport failure from log()', () => {
    logger = new McpStdioLogger();
    const mockServer = {
      sendLoggingMessage: vi.fn().mockImplementation(() => {
        throw new Error('transport closed');
      }),
    };
    logger.registerServer(mockServer);
    logger.activate();
    expect(logger.isActive).toBe(true);

    logger.log('error', 'boom');
    expect(logger.isActive).toBe(false);
  });

  it('deactivates and restores stderr on transport failure during interception', () => {
    logger = new McpStdioLogger({ serverName: 'test' });
    const mockServer = {
      sendLoggingMessage: vi.fn().mockImplementation(() => {
        throw new Error('transport closed');
      }),
    };
    logger.registerServer(mockServer);
    logger.activate();

    process.stderr.write('trigger failure\n');
    expect(logger.isActive).toBe(false);
  });

  // --- Level inference ---

  it('infers levels from NDJSON', () => {
    logger = new McpStdioLogger({ serverName: 'test' });
    const mockServer = { sendLoggingMessage: vi.fn() };
    logger.registerServer(mockServer);
    logger.activate();
    mockServer.sendLoggingMessage.mockClear();

    process.stderr.write('{"level":"WARN","msg":"deprecation"}\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );

    mockServer.sendLoggingMessage.mockClear();
    process.stderr.write('{"level":"ERROR","msg":"crash"}\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('infers levels from keyword patterns', () => {
    logger = new McpStdioLogger({ serverName: 'test' });
    const mockServer = { sendLoggingMessage: vi.fn() };
    logger.registerServer(mockServer);
    logger.activate();
    mockServer.sendLoggingMessage.mockClear();

    process.stderr.write('WARN: deprecated feature\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );

    mockServer.sendLoggingMessage.mockClear();
    process.stderr.write('[trace:load] loading\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'debug' }),
    );
  });

  it('supports custom level inference', () => {
    logger = new McpStdioLogger({
      serverName: 'test',
      inferLevel: (line) => line.includes('CUSTOM') ? 'critical' : 'info',
    });
    const mockServer = { sendLoggingMessage: vi.fn() };
    logger.registerServer(mockServer);
    logger.activate();
    mockServer.sendLoggingMessage.mockClear();

    process.stderr.write('CUSTOM alert message\n');
    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'critical' }),
    );
  });

  // --- Restore ---

  it('restore deactivates and clears buffer', () => {
    logger = new McpStdioLogger({ serverName: 'test' });
    process.stderr.write('buffered line\n');
    expect(logger.bufferSize).toBe(1);

    const mockServer = { sendLoggingMessage: vi.fn() };
    logger.registerServer(mockServer);
    logger.activate();

    logger.restore();
    expect(logger.isActive).toBe(false);
    expect(logger.bufferSize).toBe(0);
  });

  // --- defaultInferLevel standalone ---

  describe('defaultInferLevel', () => {
    it('maps NDJSON levels', () => {
      expect(defaultInferLevel('{"level":"INFO","msg":"ok"}')).toBe('info');
      expect(defaultInferLevel('{"level":"DEBUG","msg":"ok"}')).toBe('debug');
      expect(defaultInferLevel('{"level":"WARN","msg":"ok"}')).toBe('warning');
      expect(defaultInferLevel('{"level":"ERROR","msg":"ok"}')).toBe('error');
      expect(defaultInferLevel('{"level":"TRACE","msg":"ok"}')).toBe('debug');
      expect(defaultInferLevel('{"level":"FATAL","msg":"ok"}')).toBe('critical');
    });

    it('maps keyword patterns', () => {
      expect(defaultInferLevel('ERROR: something broke')).toBe('error');
      expect(defaultInferLevel('WARN: something off')).toBe('warning');
      expect(defaultInferLevel('DEBUG: verbose info')).toBe('debug');
      expect(defaultInferLevel('[trace:load] loading')).toBe('debug');
    });

    it('defaults to info', () => {
      expect(defaultInferLevel('normal log line')).toBe('info');
      expect(defaultInferLevel('[startup] Ready')).toBe('info');
    });
  });
});
