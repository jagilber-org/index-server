// Lightweight in-process tool registry used exclusively by the SDK server path.
// Replaces the prior custom JSON-RPC transport layer.
import { log, newCorrelationId } from '../services/logger';
import { wrapResponse } from '../services/responseEnvelope';
import { logToolAudit, runWithCorrelation } from '../services/auditLog';
import { getRuntimeConfig } from '../config/runtimeConfig';
// Dashboard metrics integration: bridge per-tool execution to global MetricsCollector
// so the admin panel performance & tool counters reflect live activity. Previously the
// dashboard showed zeros because recordToolCall was never invoked along the runtime path.
import { getMetricsCollector } from '../dashboard/server/MetricsCollector.js';
export type Handler<TParams=unknown> = (params: TParams) => Promise<unknown> | unknown;

interface MetricRecord { count: number; totalMs: number; maxMs: number }
const handlers: Record<string, Handler> = {};
// Raw (unwrapped) handlers that always execute locally - never go through proxy.
// Used by HttpTransport so the leader always runs handlers locally even when
// a proxy is installed in this process (e.g., same-process test scenarios).
const localHandlers: Record<string, Handler> = {};
const metrics: Record<string, MetricRecord> = {};

function recordMetric(name: string, ms: number){
  let rec = metrics[name];
  if(!rec){ rec = { count:0, totalMs:0, maxMs:0 }; metrics[name] = rec; }
  rec.count++; rec.totalMs += ms; if(ms > rec.maxMs) rec.maxMs = ms;
}

/**
 * Register a tool handler in the in-process registry, wrapping it with metrics,
 * audit logging, correlation IDs, and optional proxy forwarding.
 * @param name - Tool name used to route incoming requests
 * @param fn - Handler function; may return a plain value or a Promise
 */
export function registerHandler<TParams=unknown>(name: string, fn: Handler<TParams>){
  // Always log tool lifecycle events (previously gated by INDEX_SERVER_LOG_TOOLS)
  // Lazily resolve singleton (avoid throwing if dashboard disabled – metrics collector module
  // still exports a singleton even when dashboard not started).
  const collector = (()=>{ try { return getMetricsCollector(); } catch { return null; } })();
  const wrapped: Handler<TParams> = async (params: TParams) => {
  const corr = newCorrelationId();
    // If a proxy is installed (follower mode), forward to leader instead of running locally
    if (proxyFn) {
      try { log('INFO',`[registry] → ${name} (proxy)`,{ tool: name, correlationId: corr }); } catch { /* ignore */ }
      const startNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
      try {
        const result = await proxyFn(name, params);
        const endNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
        const ms = Number(endNs - startNs)/1_000_000;
        recordMetric(name, ms);
        try { collector?.recordToolCall(name, true, ms); } catch { /* ignore */ }
        try { log('INFO',`[registry] ← ${name} (proxy)`,{ tool: name, correlationId: corr, ms }); } catch { /* ignore */ }
        return result;
      } catch(e) {
        const endNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
        const ms = Number(endNs - startNs)/1_000_000;
        recordMetric(name, ms);
        try { collector?.recordToolCall(name, false, ms, 'proxy_error'); } catch { /* ignore */ }
        try { log('ERROR',`[registry] Tool proxy error: ${name}`,{ tool: name, correlationId: corr, detail: e instanceof Error ? e.stack : String(e) }); } catch { /* ignore */ }
        throw e;
      }
    }
    const startNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
    const timingEnabled = getRuntimeConfig().mutation.dispatcherTiming;
    let phaseMarks: { p:string; t:number }[] | undefined;
    if(timingEnabled){ phaseMarks = [{ p:'start', t: Date.now() }]; }
    try { log('INFO',`[registry] → ${name}`,{ tool: name, correlationId: corr }); } catch { /* logging should not break */ }
    let success = false;
    let errorType: string | undefined;
    try {
      const result = await runWithCorrelation(corr, () => Promise.resolve(fn(params)));
      if(timingEnabled && phaseMarks){ phaseMarks.push({ p:'afterFn', t: Date.now() }); }
      success = true;
      const wrappedResp = wrapResponse(result) as { result?: unknown };
      if(timingEnabled){
        try {
          const endTs = Date.now();
          phaseMarks!.push({ p:'endPreWrap', t:endTs });
          const phases = phaseMarks!;
          (wrappedResp as Record<string, unknown>).__timing = { tool:name, phases };
        } catch { /* ignore timing embed errors */ }
      }
      return wrappedResp;
    } catch(e){
      try { log('ERROR',`[registry] Tool error: ${name}`,{ tool: name, correlationId: corr, detail: e instanceof Error ? e.stack : String(e) }); } catch { /* ignore */ }
      // Best-effort classification for dashboard error breakdown
      try {
        const errObj: unknown = e;
        // Narrow progressively without casting to any to satisfy eslint no-explicit-any rule.
        if(typeof errObj === 'object' && errObj !== null){
          const maybeCode = (errObj as { code?: unknown }).code;
          if(Number.isSafeInteger(maybeCode)) {
            errorType = `code_${maybeCode as number}`;
          } else {
            const maybeData = (errObj as { data?: unknown }).data;
            if(typeof maybeData === 'object' && maybeData !== null && typeof (maybeData as { reason?: unknown }).reason === 'string') {
              errorType = String((maybeData as { reason?: unknown }).reason);
            } else if(typeof (errObj as { reason?: unknown }).reason === 'string') {
              errorType = String((errObj as { reason?: unknown }).reason);
            } else {
              errorType = 'error';
            }
          }
        } else {
          errorType = 'error';
        }
      } catch { /* ignore classification errors */ }
      throw e;
    } finally {
      const endNs = typeof process.hrtime === 'function' ? process.hrtime.bigint() : BigInt(Date.now()) * 1_000_000n;
      const ms = Number(endNs - startNs)/1_000_000;
      recordMetric(name, ms);
      if(timingEnabled && phaseMarks){
        try { phaseMarks.push({ p:'finally', t: Date.now() }); } catch { /* ignore */ }
      }
      // Feed global dashboard metrics (safe no-op if collector absent). This enables:
      //  - requestsPerMinute (rolling window)
      //  - successRate / errorRate
      //  - per-tool call counts & avg response time
      try { collector?.recordToolCall(name, success, ms, success ? undefined : errorType); } catch { /* never block tool path */ }
      try { logToolAudit(name, success, ms, corr, success ? undefined : errorType); } catch { /* never block tool path */ }
      try { log('INFO',`[registry] ← ${name}`,{ tool: name, correlationId: corr, ms }); } catch { /* ignore */ }
    }
  };
  handlers[name] = wrapped as Handler;
  localHandlers[name] = fn as Handler;
}

/**
 * Look up a registered (wrapped) handler by name.
 * @param name - Tool name to look up
 * @returns The wrapped handler, or `undefined` if not registered
 */
export function getHandler(name: string){
  return handlers[name];
}

/**
 * Return the raw (unwrapped) handler that always executes locally,
 * bypassing any installed proxy. Used by HttpTransport so the leader
 * never accidentally routes its own handler calls through a proxy.
 * @param name - Tool name to look up
 * @returns The raw unwrapped handler, or `undefined` if not registered
 */
export function getLocalHandler(name: string){
  return localHandlers[name];
}

/**
 * Install a proxy function that intercepts all handler calls.
 * Used by follower instances to forward tool calls to the leader.
 * The proxy receives (toolName, params) and returns the result.
 * Pass null to remove the proxy (e.g., on promotion to leader).
 * @param fn - Proxy function to install, or `null` to remove the current proxy
 */
let proxyFn: ((tool: string, params: unknown) => Promise<unknown>) | null = null;

export function installHandlerProxy(fn: ((tool: string, params: unknown) => Promise<unknown>) | null): void {
  proxyFn = fn;
}

/**
 * Return the currently installed proxy function, or `null` if no proxy is active.
 * @returns The proxy function, or `null`
 */
export function getHandlerProxy(): ((tool: string, params: unknown) => Promise<unknown>) | null {
  return proxyFn;
}

/**
 * Return a sorted list of all registered tool method names.
 * @returns Array of method name strings in alphabetical order
 */
export function listRegisteredMethods(){
  return Object.keys(handlers).sort();
}

/**
 * Return the raw per-tool metrics record map (count, totalMs, maxMs).
 * @returns Reference to the live metrics map keyed by tool name
 */
export function getMetricsRaw(){
  return metrics;
}
