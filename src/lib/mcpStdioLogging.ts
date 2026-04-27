/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * mcpStdioLogging — Generic MCP stdio transport logging solution.
 *
 * Drop-in module for ANY MCP server using stdio transport that wants proper
 * log-level display in VS Code (or any MCP client that reads stderr).
 *
 * ## Problem
 *
 * VS Code's MCP host (`extHostMcpNode.ts`) hardcodes ALL stderr output as
 * `LogLevel.Warning` with prefix `[server stderr]`. There is no configuration,
 * no level detection, no opt-out. Every byte on stderr becomes a warning.
 *
 * The MCP protocol provides `notifications/message` with a `level` field.
 * VS Code's `translateMcpLogMessage()` correctly maps those levels to proper
 * log output (debug, info, warning, error). Other clients (Claude Desktop,
 * Cursor, etc.) also respect `notifications/message` levels.
 *
 * ## Solution
 *
 * 1. Intercept `process.stderr.write` at module import time (before any other
 *    module can write to stderr).
 * 2. Buffer all pre-handshake stderr lines in memory.
 * 3. After the MCP handshake completes, replay the buffer through
 *    `server.sendLoggingMessage()` and route all future stderr the same way.
 * 4. Infer severity from content (NDJSON level field, keyword patterns).
 * 5. On transport failure, deactivate and restore original stderr.
 *
 * ## Usage (3 steps)
 *
 * ```typescript
 * // 1. Import FIRST — before any module that writes to stderr
 * import { McpStdioLogger } from './lib/mcpStdioLogging';
 * const logger = new McpStdioLogger({ serverName: 'my-server' });
 *
 * // 2. After creating the MCP SDK server, register it
 * const server = new Server({ name: 'my-server', version }, { capabilities: { logging: {} } });
 * logger.registerServer(server);
 *
 * // 3. After the handshake completes (initialize response sent), activate
 * logger.activate();
 * ```
 *
 * ## Requirements
 *
 * - Server must declare `logging: {}` in capabilities so clients know to
 *   accept `notifications/message`.
 * - Server object must have `sendLoggingMessage({ level, logger?, data })`.
 * - Module must be imported before `logPrefix` or any other stderr-producing module.
 *
 * @module mcpStdioLogging
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** MCP LoggingLevel values (RFC 5424 syslog mapping used by the MCP spec). */
export type McpLoggingLevel =
  | 'debug' | 'info' | 'notice' | 'warning'
  | 'error' | 'critical' | 'alert' | 'emergency';

/** Minimal interface for the MCP SDK server's logging method. */
export interface McpLoggable {
  sendLoggingMessage(params: {
    level: McpLoggingLevel;
    logger?: string;
    data: unknown;
  }): void;
}

/** Configuration options for McpStdioLogger. */
export interface McpStdioLoggerOptions {
  /**
   * Name shown in the `logger` field of MCP notifications/message.
   * Typically matches the server name (e.g., 'index-server', 'my-tool').
   * @default 'mcp-server'
   */
  serverName?: string;

  /**
   * Maximum number of lines to buffer before the handshake completes.
   * Prevents unbounded memory growth if activation never happens.
   * Oldest lines are discarded when the limit is reached.
   * @default 500
   */
  maxBufferSize?: number;

  /**
   * Custom level inference function. Given a raw stderr line, return the
   * MCP logging level. If not provided, the built-in heuristic is used
   * (checks NDJSON `"level"` field, then keyword patterns).
   */
  inferLevel?: (line: string) => McpLoggingLevel;

  /**
   * If true, start intercepting stderr immediately on construction.
   * If false, you must call `interceptStderr()` manually.
   * @default true
   */
  interceptImmediately?: boolean;
}

// ---------------------------------------------------------------------------
// Built-in level inference heuristic
// ---------------------------------------------------------------------------

/**
 * Infer MCP logging level from a raw stderr line.
 *
 * Priority:
 * 1. NDJSON with `"level"` field → map to MCP level
 * 2. Keyword patterns (ERROR, WARN, DEBUG, trace) → corresponding level
 * 3. Default → 'info'
 */
export function defaultInferLevel(line: string): McpLoggingLevel {
  // Check for NDJSON with "level" field
  if (line.startsWith('{')) {
    const m = /"level"\s*:\s*"(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|info|warning|error|debug|notice|critical|alert|emergency)"/i.exec(line);
    if (m) {
      const l = m[1].toUpperCase();
      if (l === 'TRACE' || l === 'DEBUG') return 'debug';
      if (l === 'INFO' || l === 'NOTICE') return 'info';
      if (l === 'WARN' || l === 'WARNING') return 'warning';
      if (l === 'ERROR') return 'error';
      if (l === 'FATAL' || l === 'CRITICAL') return 'critical';
      if (l === 'ALERT') return 'alert';
      if (l === 'EMERGENCY') return 'emergency';
    }
  }
  // Keyword patterns in plain text
  if (/\bERROR\b|\bFATAL\b/i.test(line)) return 'error';
  if (/\bWARN\b/i.test(line)) return 'warning';
  if (/\bDEBUG\b|\btrace\b/i.test(line)) return 'debug';
  return 'info';
}

// ---------------------------------------------------------------------------
// McpStdioLogger class
// ---------------------------------------------------------------------------

/**
 * Manages stderr interception, buffering, and MCP protocol log routing
 * for any MCP server using stdio transport.
 *
 * Designed to be instantiated once, as early as possible in the server's
 * entry point, before any module writes to stderr.
 */
export class McpStdioLogger {
  private _server: McpLoggable | null = null;
  private _active = false;
  private _intercepting = false;
  private readonly _buffer: Array<{ level: McpLoggingLevel; data: string }> = [];
  private readonly _originalStderrWrite: typeof process.stderr.write;
  private readonly _serverName: string;
  private readonly _maxBufferSize: number;
  private readonly _inferLevel: (line: string) => McpLoggingLevel;

  constructor(options: McpStdioLoggerOptions = {}) {
    this._serverName = options.serverName ?? 'mcp-server';
    this._maxBufferSize = options.maxBufferSize ?? 500;
    this._inferLevel = options.inferLevel ?? defaultInferLevel;
    this._originalStderrWrite = process.stderr.write.bind(process.stderr) as typeof process.stderr.write;

    if (options.interceptImmediately !== false) {
      this.interceptStderr();
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Start intercepting process.stderr.write.
   * Called automatically on construction unless `interceptImmediately: false`.
   * Safe to call multiple times (idempotent).
   */
  interceptStderr(): void {
    if (this._intercepting) return;
    this._intercepting = true;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    process.stderr.write = ((chunk: any, encodingOrCb?: any, cb?: any): boolean => {
      const text = typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const lines = text.split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (self._active && self._server) {
          // Bridge is live — send directly via MCP protocol
          try {
            self._server.sendLoggingMessage({
              level: self._inferLevel(trimmed),
              logger: self._serverName,
              data: trimmed,
            });
          } catch {
            // Transport failed — deactivate and fall back to real stderr
            self._active = false;
            self._intercepting = false;
            process.stderr.write = self._originalStderrWrite;
            return self._originalStderrWrite(chunk, encodingOrCb, cb);
          }
        } else {
          // Pre-handshake — buffer the line (don't write to stderr)
          self._buffer.push({ level: self._inferLevel(trimmed), data: trimmed });
          // Enforce buffer size limit
          if (self._buffer.length > self._maxBufferSize) {
            self._buffer.shift();
          }
        }
      }

      // Invoke callback if provided
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
      if (typeof callback === 'function') callback();
      return true;
    }) as typeof process.stderr.write;
  }

  /**
   * Register the MCP SDK server instance.
   * Must be called after server creation but before activation.
   * The server must have a `sendLoggingMessage()` method.
   */
  registerServer(server: McpLoggable): void {
    this._server = server;
  }

  /**
   * Activate the bridge: replay buffered stderr and route all future
   * output through `server.sendLoggingMessage()`.
   *
   * Call this after the MCP handshake completes (initialize response sent).
   * No-op if server is not registered or lacks sendLoggingMessage.
   */
  activate(): void {
    if (!this._server || typeof this._server.sendLoggingMessage !== 'function') return;
    this._active = true;
    this._replayBuffer();
  }

  /**
   * Returns true when the bridge is active and logs route through MCP protocol.
   */
  get isActive(): boolean {
    return this._active;
  }

  /**
   * Send a structured log message through the MCP protocol.
   * Use this from your application logger instead of console.error/stderr.
   * No-op if the bridge is not active.
   *
   * @param level - MCP logging level
   * @param data  - Log payload (string or object)
   */
  log(level: McpLoggingLevel, data: unknown): void {
    if (!this._active || !this._server) return;
    try {
      this._server.sendLoggingMessage({
        level,
        logger: this._serverName,
        data,
      });
    } catch {
      // Transport failed — deactivate to avoid repeated failures
      this._active = false;
    }
  }

  /**
   * Write directly to the ORIGINAL process.stderr, bypassing the interceptor.
   * Use this when you need stderr output visible to VS Code's Output panel
   * without triggering the MCP routing/buffering pipeline.
   */
  writeOriginalStderr(data: string): void {
    try { this._originalStderrWrite(data.endsWith('\n') ? data : data + '\n'); } catch { /* ignore */ }
  }

  /**
   * Restore original stderr and deactivate the bridge.
   * Useful for testing cleanup or graceful shutdown.
   */
  restore(): void {
    process.stderr.write = this._originalStderrWrite;
    this._active = false;
    this._intercepting = false;
    this._buffer.length = 0;
  }

  /**
   * Get the number of currently buffered lines (pre-handshake).
   */
  get bufferSize(): number {
    return this._buffer.length;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private _replayBuffer(): void {
    while (this._buffer.length > 0) {
      const entry = this._buffer.shift()!;
      try {
        this._server!.sendLoggingMessage({
          level: entry.level,
          logger: this._serverName,
          data: entry.data,
        });
      } catch {
        // Transport failed during replay — stop and dump remaining to real stderr
        this._active = false;
        this._intercepting = false;
        process.stderr.write = this._originalStderrWrite;
        for (const remaining of this._buffer) {
          this._originalStderrWrite(remaining.data + '\n');
        }
        this._buffer.length = 0;
        return;
      }
    }
  }
}
