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

// Bridge default: DISABLED.
//
// History: enabling-by-default routed all logs through MCP `notifications/message`
// and suppressed raw stderr. VS Code Insiders does not surface those notifications
// in any visible output channel, so the net effect for that client was complete
// log silence (regression first observed after commit 5de6662 / v1.26.4).
//
// Default is now off: stderr flows raw, which every MCP-aware client (including
// VS Code Insiders' `[server stderr]` rendering) handles. Set
// INDEX_SERVER_ENABLE_STDERR_BRIDGE=1 to opt in to the protocol-level routing
// (preferred for clients that render `notifications/message` with proper severity).
//
// The legacy INDEX_SERVER_DISABLE_STDERR_BRIDGE variable is now a no-op (the
// new default already matches what setting it did).
const STDERR_BRIDGE_ENABLED =
  process.env.INDEX_SERVER_ENABLE_STDERR_BRIDGE === '1';

// Singleton instance — intercepts stderr only when the bridge is opted in.
const _logger = new McpStdioLogger({
  serverName: 'index-server',
  interceptImmediately: STDERR_BRIDGE_ENABLED,
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
 *
 * No-op when STDERR_BRIDGE_ENABLED is false (default).
 */
export function activateMcpLogBridge(): void {
  if (!STDERR_BRIDGE_ENABLED) return;
  _logger.activate();
}

/**
 * Returns true if the bridge is active and logs will be sent via MCP protocol.
 * Always false when STDERR_BRIDGE_ENABLED is false (default).
 */
export function isMcpLogBridgeActive(): boolean {
  return STDERR_BRIDGE_ENABLED && _logger.isActive;
}

/**
 * Send a log message through the MCP `notifications/message` protocol.
 * No-op if the bridge is not yet active or not enabled.
 *
 * @param level - The index-server log level (TRACE, DEBUG, INFO, WARN, ERROR)
 * @param data  - The log payload (typically the NDJSON string)
 */
export function sendMcpLog(level: LogLevel, data: string): void {
  if (!STDERR_BRIDGE_ENABLED) return;
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
