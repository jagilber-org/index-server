/**
 * Log level taxonomies — single source of truth (SOT).
 *
 * Two structurally identical but textually distinct taxonomies coexist:
 *
 *   - `LOG_LEVELS_LOWER` — lowercase, configuration / env-var surface
 *     (consumed by runtimeConfig, serverConfig, INDEX_SERVER_LOG_LEVEL).
 *
 *   - `LOG_LEVELS_UPPER` — UPPERCASE, NDJSON / wire-format surface
 *     (emitted by services/logger.ts in `level` field, expected by the
 *     companion typescript-schema-viewer).
 *
 * Both are ordered most-verbose → least-verbose so an index lookup yields
 * a numeric priority directly (lower index = more verbose). Helper
 * `LOG_LEVEL_PRIORITY` materializes this for the uppercase surface (used
 * by the logger's level filter).
 *
 * Distinct from `MCP_LOG_LEVELS` in src/lib/mcpStdioLogging.ts which uses
 * the 8-value RFC-5424 taxonomy (debug/info/notice/warning/error/critical/
 * alert/emergency) for the MCP `notifications/message` protocol surface.
 *
 * @module logLevels
 */

export const LOG_LEVELS_LOWER = ['trace', 'debug', 'info', 'warn', 'error'] as const;
export type LogLevelLower = (typeof LOG_LEVELS_LOWER)[number];

export const LOG_LEVELS_UPPER = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const;
export type LogLevelUpper = (typeof LOG_LEVELS_UPPER)[number];

/** Numeric priority for upper-case levels (lower = more verbose). */
export const LOG_LEVEL_PRIORITY: Record<LogLevelUpper, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
};
