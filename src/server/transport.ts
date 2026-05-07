/**
 * MCP Transport Layer - stdio JSON-RPC 2.0 Only
 *
 * This module implements the primary MCP server transport over stdin/stdout.
 * All MCP clients (VS Code, Claude, etc.) communicate exclusively through this stdio transport.
 *
 * Security: Process-isolated communication with no network exposure.
 * Protocol: JSON-RPC 2.0 line-delimited over stdin/stdout streams.
 *
 * Note: The optional HTTP dashboard is implemented separately and is for admin use only.
 */
import { createInterface } from 'readline';
import { validateParams } from '../services/validationService';
import { getRuntimeConfig } from '../config/runtimeConfig';
import {
  getHandler as getRegistryHandler,
  getMetricsRaw,
  listRegisteredMethods as listRegistryMethods,
  registerHandler as registerRegistryHandler,
} from './registry';
import fs from 'fs';
import path from 'path';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}
interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}
interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

export type Handler<TParams = unknown> = (params: TParams) => Promise<unknown> | unknown;
interface MetricRecord { count: number; totalMs: number; maxMs: number; }

// Robust version resolution: attempt cwd + relative to compiled dist location
const versionCandidates = [
  path.join(process.cwd(), 'package.json'),
  path.join(__dirname, '..', '..', 'package.json')
];
let VERSION = '0.0.0';
for(const p of versionCandidates){
  try { if(fs.existsSync(p)){ const raw = JSON.parse(fs.readFileSync(p,'utf8')); if(raw?.version){ VERSION = raw.version; break; } } } catch { /* ignore */ }
}

/** Return the in-memory per-method metrics map (count, totalMs, maxMs).
 * @returns Reference to the live metrics map keyed by method name
 */
export function getMetrics(): Record<string, MetricRecord> {
  return getMetricsRaw() as Record<string, MetricRecord>;
}

/**
 * Register a transport-exposed method handler via the canonical registry.
 * @param method - JSON-RPC method name
 * @param handler - Handler function invoked with the parsed params
 */
export function registerHandler<TParams=unknown>(method: string, handler: Handler<TParams>){
  registerRegistryHandler(method, handler);
}

/**
 * Return a sorted list of transport-exposed method names.
 * @returns Array of method name strings in alphabetical order
 */
export function listRegisteredMethods(): string[]{
  return listRegistryMethods();
}

/**
 * Look up a canonical registered handler by method name.
 * @param method - JSON-RPC method name to look up
  * @returns The handler function, or `undefined` if not registered
  */
export function getHandler(method: string): Handler | undefined {
  return getRegistryHandler(method);
}

function getFallbackHealth(): {
  status: 'ok';
  timestamp: string;
  version: string;
  pid: number;
  uptime: number;
  instances: Array<{ pid: number; port: number; host: string; startedAt: string; current: boolean }>;
} {
  let instances: Array<{ pid: number; port: number; host: string; startedAt: string; current: boolean }> = [];
  try {
    // Dynamic require avoids circular dependency at module load time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getActiveInstances } = require('../dashboard/server/InstanceManager') as typeof import('../dashboard/server/InstanceManager');
    instances = getActiveInstances().map(i => ({ pid: i.pid, port: i.port, host: i.host, startedAt: i.startedAt, current: i.current }));
  } catch { /* fail-open */ }
  return { status: 'ok', timestamp: new Date().toISOString(), version: VERSION, pid: process.pid, uptime: Math.round(process.uptime()), instances };
}

if(!getRegistryHandler('health_check')){
  registerRegistryHandler('health_check', () => getFallbackHealth());
}

function makeError(id: string | number | null | undefined, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

// (legacy placeholder removed; responses are written via respondFn inside startTransport)

export interface TransportOptions {
  input?: NodeJS.ReadableStream;        // defaults to process.stdin
  output?: NodeJS.WritableStream;       // defaults to process.stdout
  stderr?: NodeJS.WritableStream;       // defaults to process.stderr
  env?: NodeJS.ProcessEnv;              // defaults to process.env
}

/**
 * Start the stdio JSON-RPC 2.0 transport, reading requests from stdin and writing responses to stdout.
 * Registers built-in handlers for `initialize`, `notifications/initialized`, `shutdown`, and `exit`.
 * @param opts - Optional stream overrides (input, output, stderr) and environment; defaults to process streams
 */
export function startTransport(opts: TransportOptions = {}){
  const runtimeConfig = getRuntimeConfig();
  const verbose = runtimeConfig.logging.verbose;
  const protocolLog = runtimeConfig.logging.protocol; // raw frames (parsed) logging
  const diag = runtimeConfig.logging.diagnostics || verbose; // banner + environment snapshot

  const log = (level: 'info'|'error'|'debug', msg: string, extra?: unknown) => {
    if(level === 'debug' && !verbose) return;
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${msg}`;
    try {
      (opts.stderr || process.stderr).write(line + (extra ? ` ${JSON.stringify(extra)}` : '') + '\n');
    } catch { /* ignore */ }
  };

  if(diag){
    log('info','startup', {
      version: VERSION,
      pid: process.pid,
      node: process.version,
      cwd: process.cwd(),
  mutationEnabled: runtimeConfig.mutationEnabled,
      verbose,
      protocolLog,
      diagnosticsEnabled: runtimeConfig.logging.diagnostics
    });
  }

  // Global crash / rejection safety net to aid diagnostics in host clients that only see silent exits.
  // Note: process.exit() is handled by the unified shutdownGuard in index.ts (Issue #36 fix).
  // This handler only logs — the guard prevents duplicate exit() races.
  process.on('uncaughtException', (err) => {
    log('error', 'uncaughtException', { message: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason: unknown) => {
    const msg = typeof reason === 'object' && reason && 'message' in (reason as Record<string,unknown>) ? (reason as { message?: string }).message : String(reason);
    log('error', 'unhandledRejection', { reason: msg });
  });

  const transportHandlers: Record<string, Handler> = {
    'initialize': (params: unknown) => {
      const p = params as { protocolVersion?: string } | undefined;
      return {
        protocolVersion: p?.protocolVersion || '2025-06-18',
        serverInfo: { name: 'index-server', version: VERSION },
        capabilities: { roots: { listChanged: true }, tools: { listChanged: true } }
      };
    },
    'notifications/initialized': () => ({ acknowledged: true }),
    'shutdown': () => ({ shuttingDown: true }),
    'exit': () => { setTimeout(() => process.exit(0), 0); return { exiting: true }; }
  };
  const getAvailableMethods = () => Array.from(new Set([
    ...Object.keys(transportHandlers),
    ...listRegistryMethods(),
  ])).sort();

  // Handshake state & helpers (deterministic: initialize result flushes, then server/ready)
  let initialized = false;
  let readyEmitted = false;
  function emitReady(reason: string){
    if(readyEmitted) return;
    readyEmitted = true;
    try {
      (opts.output || process.stdout).write(JSON.stringify({ jsonrpc:'2.0', method:'server/ready', params:{ version: VERSION, reason } })+'\n');
      (opts.output || process.stdout).write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/tools/list_changed', params:{} })+'\n');
    } catch { /* ignore */ }
  }
  // Use readline only for input parsing; do NOT set output to avoid echoing client-sent
  // JSON-RPC request lines back to stdout (which confused tests expecting only server
  // responses and caused false negatives when matching initialize/result frames).
  const rl = createInterface({ input: opts.input || process.stdin });
  const respondFn = (obj: JsonRpcResponse) => {
    if(protocolLog){
      const base: { id: string | number | null; error?: number; ok?: true } = { id: (obj as JsonRpcSuccess | JsonRpcError).id ?? null };
      if('error' in obj) base.error = obj.error.code; else base.ok = true;
      log('debug','send', base);
    }
    (opts.output || process.stdout).write(JSON.stringify(obj) + '\n');
  };
  // NOTE: Unlike earlier versions we DO NOT emit server/ready until after initialize response.
  // This matches stricter clients (and reference PowerShell server) that expect handshake ordering.
  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if(!trimmed) return;
    if(trimmed === 'quit'){ process.exit(0); }
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
      if(protocolLog){
        log('debug','recv', { id: req.id ?? null, method: req.method });
      }
    } catch{
      log('error', 'parse_error', { raw: trimmed.slice(0,200) });
      respondFn(makeError(null, -32700, 'Parse error'));
      return;
    }
    if(req.jsonrpc !== '2.0' || !req.method){
      respondFn(makeError(req.id ?? null, -32600, 'Invalid Request'));
      return;
    }
    // Fast-path initialize for deterministic ordering: respond immediately with write callback then schedule ready.
    if(req.method === 'initialize'){
      const p = (req.params as { protocolVersion?: string } | undefined);
      if(initialized){
        respondFn(makeError(req.id ?? null, -32600, 'Already initialized'));
        return;
      }
      initialized = true;
      // Reuse registered initialize handler so future shared logic (capability changes, root listing, etc.) stays centralized.
      const initHandler = transportHandlers['initialize'];
      let resultPayload: unknown;
      try {
        resultPayload = initHandler ? initHandler(req.params) : {
          protocolVersion: p?.protocolVersion || '2025-06-18',
          serverInfo: { name: 'index-server', version: VERSION },
          capabilities: { roots: { listChanged: true }, tools: { listChanged: true } }
        };
      } catch(e){
        respondFn(makeError(req.id ?? null, -32603, 'Initialize handler failure', { message: (e as Error)?.message }));
        return;
      }
      // Support promise return from handler
      Promise.resolve(resultPayload).then(resolved => {
        const initResult = { jsonrpc:'2.0', id: req.id ?? 1, result: resolved };
        try {
          if(protocolLog){
            log('debug','respond_success', { id: req.id ?? 1, method: 'initialize' });
          }
          (opts.output || process.stdout).write(JSON.stringify(initResult)+'\n', () => {
            // Primary ready emission via macrotask after write flush
            setTimeout(() => emitReady('post-initialize'), 0);
            // Microtask fallback (parity with minimal server) for extreme scheduler edge cases
            queueMicrotask(() => { if(!readyEmitted) emitReady('post-initialize-microtask'); });
          });
        } catch {
          respondFn(makeError(req.id ?? null, -32603, 'Failed to write initialize result'));
        }
      });
      return;
    }
    const handler = transportHandlers[req.method] ?? getRegistryHandler(req.method);
    if(!handler){
      // Provide richer context for missing method to help client authors.
      const available = getAvailableMethods();
      log('debug', 'method_not_found', { requested: req.method, availableCount: available.length });
      respondFn(makeError(req.id ?? null, -32601, 'Method not found', { method: req.method, available }));
      return;
    }
    // Pre-dispatch parameter validation using registry input schemas (when available)
    try {
      const validation = validateParams(req.method, req.params);
      if(!validation.ok){
  respondFn(makeError(req.id ?? null, -32602, 'Invalid params', { method: req.method, errors: validation.errors }));
        return;
      }
    } catch{ /* fail-open on validator issues */ }
    Promise.resolve()
      .then(() => handler(req.params))
      .then(result => {
        if(!initialized){
          log('debug', 'call_before_initialize', { method: req.method });
        }
        if(req.id !== undefined && req.id !== null){
          try { if(protocolLog || verbose) log('debug','respond_success', { id: req.id, method: req.method }); } catch { /* ignore */ }
          respondFn({ jsonrpc: '2.0', id: req.id, result });
        }
      })
      .catch(e => {
        // Support structured JSON-RPC style errors (objects with numeric code) without coercing to -32603.
        interface JsonRpcLikeError { code: number; message?: string; data?: Record<string,unknown>; }
        const maybeErr = e as Partial<JsonRpcLikeError> | null;
        if(maybeErr && typeof maybeErr === 'object' && Number.isSafeInteger(maybeErr.code)){
          log('error', 'handler_error', { method: req.method, message: maybeErr.message, code: maybeErr.code });
          respondFn(makeError(req.id ?? null, maybeErr.code!, maybeErr.message || 'Error', { method: req.method, ...(maybeErr.data || {}) }));
          return;
        }
        const errObj = e instanceof Error ? { message: e.message, stack: e.stack } : { message: 'Unknown error', value: e };
        log('error', 'handler_error', { method: req.method, ...errObj });
        respondFn(makeError(req.id ?? null, -32603, 'Internal error', { method: req.method, ...errObj }));
      });
  });
}

if(require.main === module){
  startTransport();
}
