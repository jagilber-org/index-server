/**
 * MCP Log Bridge — thin adapter over the generalized McpStdioLogger.
 *
 * Preserves the existing module-level API (`registerMcpServer`, `activateMcpLogBridge`,
 * `isMcpLogBridgeActive`, `sendMcpLog`, `_restoreStderr`) so that all existing
 * call sites in index-server.ts, sdkServer.ts, handshakeManager.ts, and logger.ts
 * continue to work without changes.
 *
 * The actual stderr interception, buffering, replay, and MCP protocol routing is
 * delegated to `McpStdioLogger` from `../lib/mcpStdioLogging`, which is a
 * self-contained, reusable module for any MCP stdio server.
 *
 * See `src/lib/mcpStdioLogging.ts` for the generalized implementation and
 * `docs/mcp_stdio_logging.md` for integration guidance.
 */

import { McpStdioLogger, type McpLoggingLevel } from '../lib/mcpStdioLogging';
import type { LogLevel } from './logger';

const LEVEL_MAP: Record<LogLevel, McpLoggingLevel> = {
  TRACE: 'debug',
  DEBUG: 'debug',
  INFO:  'info',
  WARN:  'warning',
  ERROR: 'error',
};

// Singleton instance — intercepts stderr immediately on module load.
const _logger = new McpStdioLogger({
  serverName: 'index-server',
  interceptImmediately: process.env.INDEX_SERVER_DISABLE_STDERR_BRIDGE !== '1',
  maxBufferSize: 500,
});

/**
 * Register the SDK server instance. Called once after server creation.
 * Does NOT activate the bridge — call `activateMcpLogBridge()` after ready.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerMcpServer(server: any): void {
  _logger.registerServer(server);
}

/**
 * Activate the bridge so subsequent log calls are routed via MCP protocol.
 * Replays any buffered pre-handshake stderr lines through the protocol.
 * Called from `emitReadyGlobal()` after the handshake completes.
 */
export function activateMcpLogBridge(): void {
  _logger.activate();
}

/**
 * Returns true if the bridge is active and logs will be sent via MCP protocol.
 */
export function isMcpLogBridgeActive(): boolean {
  return _logger.isActive;
}

/**
 * Send a log message through the MCP `notifications/message` protocol.
 * No-op if the bridge is not yet active.
 *
 * @param level - The index-server log level (TRACE, DEBUG, INFO, WARN, ERROR)
 * @param data  - The log payload (typically the NDJSON string)
 */
export function sendMcpLog(level: LogLevel, data: string): void {
  _logger.log(LEVEL_MAP[level] ?? 'info', data);
}

/**
 * Write directly to the original process.stderr, bypassing the interceptor.
 * Use from logger.ts to ensure VS Code Output panel always has content.
 */
export function writeRealStderr(data: string): void {
  _logger.writeOriginalStderr(data);
}

/**
 * Restore original stderr and deactivate the bridge.
 * Intended for testing cleanup only.
 */
export function _restoreStderr(): void {
  _logger.restore();
}
