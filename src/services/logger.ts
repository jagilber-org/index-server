import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { isMcpLogBridgeActive, sendMcpLog } from './mcpLogBridge';
import { recordEvent } from './eventBuffer';
import { LOG_LEVEL_PRIORITY, type LogLevelUpper } from '../lib/logLevels';

// ── NDJSON Log Schema ───────────────────────────────────────────
// Compliant with typescript-schema-viewer log analysis format.
// See the companion schema viewer repository for analysis tooling.
//
// Required fields: ts, level (UPPERCASE), msg
// Optional fields: detail (stack trace), evt, tool, ms, data, pid, port
//
// Module matching: prefix msg with [ModuleName] to match source files.
//   e.g. "[logger] File logging enabled" matches logger.ts
//
// Function tracing: use → / ← prefixes at TRACE level for call graphs.
//   e.g. "→ IndexContext.ensureLoaded" / "← IndexContext.ensureLoaded"
//
// Stack traces: V8 Error.captureStackTrace is used on WARN/ERROR to
// populate the detail field with call-site stacks for Error Trace Flow.
//
// Example NDJSON lines:
//   {"ts":"2026-04-03T18:52:12.000Z","level":"ERROR","msg":"[rpc] readSession failed","detail":"Error: ...\n    at readSession (server/rpc.ts:42:9)","pid":12345}
//   {"ts":"2026-04-03T18:52:12.001Z","level":"TRACE","msg":"→ IndexContext.ensureLoaded","detail":"{\"source\":\"handler\"}","pid":12345}

export type LogLevel = LogLevelUpper;

/** Numeric priority for log level filtering (lower = more verbose). */
const LEVEL_PRIORITY: Record<string, number> = LOG_LEVEL_PRIORITY;

export interface LogRecord {
  ts: string;            // ISO 8601 timestamp
  level: LogLevel;       // UPPERCASE: TRACE | DEBUG | INFO | WARN | ERROR
  msg: string;           // Human-readable message (prefix with [module] for heatmap matching)
  detail?: string;       // Stack trace or serialized data (enables Error Trace Flow)
  tool?: string;
  ms?: number;
  pid?: number;
  port?: string;
  correlationId?: string;
}

// Simple correlation id helper (call per incoming JSON-RPC if desired)
/**
 * Generate a new random correlation ID (16 hex characters).
 * @returns Hex string suitable for tagging a single request context
 */
export function newCorrelationId(){ return crypto.randomBytes(8).toString('hex'); }

let logFileHandle: fs.WriteStream | null = null;
let logFilePath: string | undefined;

function loggingCfg(){
  return getRuntimeConfig().logging;
}

/**
 * Capture V8 call-site stack trace, omitting the logger internals.
 * Used on WARN/ERROR to populate the `detail` field for Error Trace Flow.
 */
function captureCallStack(omitFrames: (...args: never[]) => void): string | undefined {
  const obj: { stack?: string } = {};
  Error.captureStackTrace(obj, omitFrames);
  return obj.stack;
}

/** Serialize a detail value to a string for the NDJSON detail field. */
function serializeDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (detail instanceof Error) return detail.stack ?? detail.message;
  if (typeof detail === 'string') return detail;
  return JSON.stringify(detail);
}

/**
 * Check whether the given log level passes the configured minimum level.
 * Returns true if the record should be emitted, false if suppressed.
 */
function shouldEmit(level: LogLevel): boolean {
  const cfg = loggingCfg();
  const cfgLevel = cfg.level?.toUpperCase() ?? 'INFO';
  const threshold = LEVEL_PRIORITY[cfgLevel] ?? LEVEL_PRIORITY.INFO;
  const recordPriority = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.INFO;
  return recordPriority >= threshold;
}

// Single exit handler — registered once to avoid listener accumulation on re-init
let exitHandlerRegistered = false;

// Initialize file logging if INDEX_SERVER_LOG_FILE is specified
function initializeFileLogging(): void {
  const cfg = loggingCfg();
  const logFile = cfg.file;
  if (!logFile) return;

  // If file handle exists but path changed (e.g., test reconfiguration), close old and reopen
  if (logFileHandle && logFilePath !== logFile) {
    try { logFileHandle.end(); } catch { /* ignore */ }
    logFileHandle = null;
    logFilePath = undefined;
  }

  if (logFileHandle) return; // Already initialized for this path

  try {
    // Ensure log directory exists
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Create write stream with append mode
    logFileHandle = fs.createWriteStream(logFile, {
      flags: 'a',
      encoding: 'utf8'
    });
    logFilePath = logFile;

    // Graceful fallback: if the stream hits EPERM/EACCES, disable file logging
    logFileHandle.on('error', (err: NodeJS.ErrnoException) => {
      process.stderr.write(`[logger] File logging error (${err.code ?? err.message}), falling back to stderr-only\n`);
      try { logFileHandle?.end(); } catch { /* ignore */ }
      logFileHandle = null;
      logFilePath = undefined;
    });

    // NDJSON session start record
    const sessionStart: LogRecord = {
      ts: new Date().toISOString(),
      level: 'INFO',
      msg: '[logger] Session started',
      pid: process.pid,
    };
    const startLine = JSON.stringify(sessionStart);
    logFileHandle.write(startLine + '\n');

    // Cleanup on process exit — register only once
    if (!exitHandlerRegistered) {
      exitHandlerRegistered = true;
      process.on('exit', () => {
        if (logFileHandle && !logFileHandle.destroyed) {
          const sessionEnd: LogRecord = {
            ts: new Date().toISOString(),
            level: 'INFO',
            msg: '[logger] Session ended',
            pid: process.pid,
          };
          logFileHandle.write(JSON.stringify(sessionEnd) + '\n');
          logFileHandle.end();
        }
      });
    }

    // Emit NDJSON init diagnostic
    try {
      const stats = fs.existsSync(logFile) ? fs.statSync(logFile) : null;
      const diag: LogRecord = {
        ts: new Date().toISOString(),
        level: 'INFO',
        msg: '[logger] File logging enabled',
        pid: process.pid,
        detail: JSON.stringify({
          file: logFile,
          size: stats?.size ?? 0,
          sentinel: cfg.sentinelRequested,
          cwd: process.cwd(),
        }),
      };
      const line = JSON.stringify(diag);
      console.error(line);
      if (logFileHandle && !logFileHandle.destroyed) {
        try { logFileHandle.write(line + '\n'); } catch { /* ignore */ }
      }
    } catch { /* ignore diagnostics error */ }

  } catch (error) {
    // Fallback to NDJSON on stderr if file logging fails
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'ERROR',
      msg: '[logger] Failed to initialize file logging',
      detail: String(error),
      pid: process.pid,
    }));
  }
}

// Eager initialization: if user supplied a sentinel value ('1', 'true', etc.)
// we create the log file immediately so external components (dashboard log
// viewer polling /api/logs) see the file even before the first structured
// log line is emitted. Without this, very early polling could race the first
// emit() call and incorrectly report "no log file". Normal explicit paths
// remain lazy to avoid unnecessary fd usage when logger never used.
try {
  const cfg = loggingCfg();
  if(cfg.file && cfg.sentinelRequested){
    initializeFileLogging();
  }
} catch { /* ignore eager init errors */ }

function emit(rec: LogRecord){
  // Level filtering — suppress records below configured threshold
  if (!shouldEmit(rec.level)) return;

  // Initialize file logging on first emit (lazy initialization)
  // or reinitialize if the configured path has changed (e.g., test reconfiguration)
  const cfg = loggingCfg();
  if (cfg.file && (!logFileHandle || logFilePath !== cfg.file)) {
    initializeFileLogging();
  }

  // Always include pid for multi-process identification
  if (rec.pid === undefined) rec.pid = process.pid;

  // Always NDJSON — no plain-text path
  const out: Record<string, unknown> = {
    ts: rec.ts,
    level: rec.level,
    msg: rec.msg,
  };
  if (rec.detail) out.detail = rec.detail;
  if (rec.tool) out.tool = rec.tool;
  if (rec.ms !== undefined) out.ms = rec.ms;
  out.pid = rec.pid;
  if (rec.port) out.port = rec.port;
  if (rec.correlationId) out.correlationId = rec.correlationId;
  const logLine = JSON.stringify(out);

  // Route through MCP protocol notifications/message when available.
  // This gives VS Code correct severity (info/debug/warning/error) instead
  // of tagging every line as [warning] [server stderr].
  if (isMcpLogBridgeActive()) {
    sendMcpLog(rec.level, logLine);
  } else {
    // Pre-handshake: fall back to stderr (intercepted and buffered by McpStdioLogger)
    console.error(logLine);
  }

  // Also log to file if configured and available
  if (logFileHandle && !logFileHandle.destroyed) {
    try {
      logFileHandle.write(logLine + '\n'); // lgtm[js/http-to-file-access] — log file path from config
      // Optional deterministic flushing for tests / critical observability. Enabled with INDEX_SERVER_LOG_SYNC=1
      if(cfg.sync) {
        try { fs.fsyncSync((logFileHandle as unknown as { fd: number }).fd); } catch { /* ignore fsync errors */ }
      }
    } catch { /* ignore file write failures */ }
  }

  // Surface WARN/ERROR into the in-process events ring buffer so the dashboard
  // Monitoring panel can display them without log-file tailing (OB-3, OB-5).
  if (rec.level === 'WARN' || rec.level === 'ERROR') {
    try { recordEvent(rec.level, rec.msg, rec.detail, rec.pid); } catch { /* never let buffer failure break logging */ }
  }
}

/**
 * Emit a structured NDJSON log record at the specified level.
 * @param level - TRACE | DEBUG | INFO | WARN | ERROR
 * @param msg - Message with [module] prefix for heatmap matching
 * @param fields - Additional fields (detail, tool, ms, correlationId, etc.)
 */
export function log(level: LogLevel, msg: string, fields: Partial<Omit<LogRecord, 'level' | 'ts' | 'msg'>> = {}){
  emit({ ts: new Date().toISOString(), level, msg, ...fields });
}

/** TRACE — function entry/exit tracing and low-level diagnostics.
 * Use `→ Class.method` / `← Class.method` prefixes for call graph support.
 * @param msg - Message (use → / ← prefixes for function tracing)
 * @param detail - Optional data serialized into the detail field
 */
export const logTrace = (msg: string, detail?: unknown) => {
  log('TRACE', msg, { detail: serializeDetail(detail) });
};
/** DEBUG — diagnostic information for development.
 * @param msg - Message with [module] prefix
 * @param detail - Optional data serialized into the detail field
 */
export const logDebug = (msg: string, detail?: unknown) => {
  log('DEBUG', msg, { detail: serializeDetail(detail) });
};
/** INFO — normal operational events.
 * @param msg - Message with [module] prefix
 * @param detail - Optional data serialized into the detail field
 */
export const logInfo = (msg: string, detail?: unknown) => {
  log('INFO', msg, { detail: serializeDetail(detail) });
};
/** WARN — potential issues. Captures V8 call-site stack into detail for Error Trace Flow.
 * Error instances use their own stack; non-Error detail is serialized with call-site stack appended.
 * @param msg - Message with [module] prefix
 * @param detail - Optional Error, string, or data; Error.stack or V8 call-site stack used
 */
export const logWarn = (msg: string, detail?: unknown) => {
  let d: string | undefined;
  if (detail instanceof Error) {
    d = detail.stack;
  } else {
    const stack = captureCallStack(logWarn);
    d = detail !== undefined
      ? serializeDetail(detail) + (stack ? '\n' + stack : '')
      : stack;
  }
  log('WARN', msg, { detail: d });
};
/** ERROR — failures. Captures V8 call-site stack into detail for Error Trace Flow.
 * Error instances use their own stack; non-Error detail is serialized with call-site stack appended.
 * @param msg - Message with [module] prefix
 * @param detail - Optional Error, string, or data; Error.stack or V8 call-site stack used
 */
export const logError = (msg: string, detail?: unknown) => {
  let d: string | undefined;
  if (detail instanceof Error) {
    d = detail.stack;
  } else {
    const stack = captureCallStack(logError);
    d = detail !== undefined
      ? serializeDetail(detail) + (stack ? '\n' + stack : '')
      : stack;
  }
  log('ERROR', msg, { detail: d });
};
