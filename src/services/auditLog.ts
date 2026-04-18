import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { MUTATION } from './toolRegistry';

// Append-only JSONL audit log for all server operations.
// Each line: { ts, kind, action, ids?, meta? }
// kind: 'mutation' | 'read' | 'http' — classifies the entry type.
// Path and enablement are driven by runtime configuration (instructions.auditLog).

// AsyncLocalStorage carries the correlation ID from registry wrapper into handler scope.
// This lets logAudit() calls inside handlers automatically include correlationId
// without changing handler signatures or passing context explicitly.
const auditContext = new AsyncLocalStorage<{ correlationId: string }>();

/** Run a function with a correlation ID accessible to all logAudit() calls within. */
export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
  return auditContext.run({ correlationId }, fn);
}

/** Get the current correlation ID from the async context (if any). */
export function getCurrentCorrelationId(): string | undefined {
  return auditContext.getStore()?.correlationId;
}

let cachedKey: string | undefined;
let cachedPath: string | null | undefined;
function resolveLogPath(){
  const { auditLog } = getRuntimeConfig().instructions;
  const key = auditLog.enabled && auditLog.file ? `on:${auditLog.file}` : 'off';
  if(cachedKey === key && cachedPath !== undefined){
    return cachedPath;
  }

  cachedKey = key;
  if(!auditLog.enabled || !auditLog.file){
    cachedPath = null;
    return cachedPath;
  }
  const file = auditLog.file;
  try {
    const dir = path.dirname(file);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, '');
    cachedPath = file;
  } catch {
    cachedPath = null;
  }
  return cachedPath;
}

/** Reset the cached audit log path, forcing re-resolution on next write. */
export function resetAuditLogCache(): void {
  cachedKey = undefined;
  cachedPath = undefined;
}

export type AuditKind = 'mutation' | 'read' | 'http';

export interface AuditEntry {
  ts: string; // ISO timestamp
  kind: AuditKind; // entry classification
  action: string; // tool/operation name
  ids?: string[]; // impacted instruction ids (if any)
  meta?: Record<string, unknown>; // lightweight result summary (counts, flags, clientIp, etc.)
}

/**
 * Append an entry to the audit log file. Silent no-op when logging is disabled.
 * @param action - Tool or operation name being recorded
 * @param ids - Instruction IDs affected by this operation (if any)
 * @param meta - Lightweight result summary (counts, flags, etc.)
 * @param kind - Entry classification; defaults to `'mutation'`
 */
export function logAudit(action: string, ids?: string[]|string, meta?: Record<string, unknown>, kind?: AuditKind){
  const file = resolveLogPath();
  if(!file) return; // silent no-op when logging disabled
  const entry: AuditEntry = { ts: new Date().toISOString(), kind: kind ?? 'mutation', action };
  if(ids){ entry.ids = Array.isArray(ids)? ids: [ids]; }
  // Auto-inject correlationId from async context if not already present in meta
  const ctxCorr = getCurrentCorrelationId();
  if(ctxCorr || meta){
    const m = meta ? { ...meta } : {};
    if(ctxCorr && !m.correlationId) m.correlationId = ctxCorr;
    entry.meta = m;
  }
  try {
    fs.appendFileSync(file, JSON.stringify(entry)+'\n','utf8'); // lgtm[js/http-to-file-access] — audit log path from config
  } catch { /* swallow logging errors to avoid impacting primary operation path */ }
}

/**
 * Log a tool invocation to the audit trail. Called from the registry wrapper
 * so ALL tool calls (reads + mutations) are captured automatically.
 */
export function logToolAudit(toolName: string, success: boolean, durationMs: number, correlationId?: string, errorType?: string): void {
  const kind: AuditKind = MUTATION.has(toolName) ? 'mutation' : 'read';
  const meta: Record<string, unknown> = { success, durationMs: Math.round(durationMs * 100) / 100 };
  if(correlationId) meta.correlationId = correlationId;
  if(!success && errorType) meta.errorType = errorType;
  logAudit(toolName, undefined, meta, kind);
}

/**
 * Log an HTTP request to the audit trail. Called from dashboard middleware
 * so all API requests are captured with client IP and user-agent.
 */
export function logHttpAudit(method: string, route: string, statusCode: number, durationMs: number, clientIp?: string, userAgent?: string): void {
  const meta: Record<string, unknown> = { statusCode, durationMs: Math.round(durationMs * 100) / 100 };
  if(clientIp) meta.clientIp = clientIp;
  if(userAgent) meta.userAgent = userAgent;
  logAudit(`${method} ${route}`, undefined, meta, 'http');
}

/**
 * Read the most recent audit log entries from disk.
 * @param limit - Maximum number of lines to return from the tail of the file (default 1000)
 * @returns Parsed audit entries, or an empty array if logging is disabled or the file is missing
 */
export function readAuditEntries(limit=1000): AuditEntry[] {
  const file = resolveLogPath();
  if(!file || !fs.existsSync(file)) return [];
  try {
    const lines = fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=> l.trim());
    const recent = lines.slice(-limit);
    const parsed: AuditEntry[] = [];
    for(const l of recent){ try { parsed.push(JSON.parse(l)); } catch { /* ignore */ } }
    return parsed;
  } catch { return []; }
}
