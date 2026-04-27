import { registerHandler } from '../server/registry';
import { getBooleanEnv } from '../utils/envUtils';

/**
 * dashboard_config
 * Returns a deterministic snapshot of all recognized environment / feature flags regardless of current value.
 * This consolidates scattered documentation, enabling the dashboard (and tests) to surface:
 *  - Current value (raw)
 *  - Parsed boolean (when applicable)
 *  - Default semantics
 *  - Category (core | dashboard | instructions | manifest | tracing | diagnostics | stress | usage | validation | auth | metrics | experimental)
 *  - Description
 *  - Stability (stable | diagnostic | experimental | reserved)
 *  - Since (version first introduced when known – best effort)
 *
 * The list is curated (not discovered dynamically) to ensure ordering stability and to include flags
 * that might not appear in code paths when disabled. Additions should append (not reorder) to maintain
 * predictable client diffing.
 */

export interface FlagMeta { name:string; category:string; description:string; stability:'stable'|'diagnostic'|'experimental'|'reserved'; since?:string; default?:string; type?:'boolean'|'string'|'number'; }
export interface FlagRuntime extends FlagMeta { value?:string; enabled?:boolean; parsed?:unknown; docAnchor?:string; }

// Curated registry. Order is intentional for grouping high-value operational flags first.
export const FLAG_REGISTRY: FlagMeta[] = [
  // Core operation & dashboard
  { name:'INDEX_SERVER_DIR', category:'core', description:'Instructions catalog directory. Defaults to ./instructions relative to CWD.', stability:'stable', default:'./instructions', type:'string', since:'1.0.0' },
  { name:'INDEX_SERVER_MUTATION', category:'core', description:'Override mutation tools (unset or 1 = enabled, 0 = read-only).', stability:'stable', default:'on', type:'boolean', since:'1.0.0' },
  { name:'INDEX_SERVER_VERBOSE_LOGGING', category:'core', description:'Verbose logging (handshake, dispatch timings).', stability:'stable', default:'off', type:'boolean', since:'1.0.0' },
  { name:'INDEX_SERVER_LOG_DIAG', category:'diagnostics', description:'Diagnostic logging (lower-level/internal).', stability:'diagnostic', default:'off', type:'boolean', since:'1.0.0' },
  { name:'INDEX_SERVER_DASHBOARD', category:'dashboard', description:'Enable admin dashboard HTTP server.', stability:'stable', default:'off', type:'boolean', since:'1.0.0' },
  { name:'INDEX_SERVER_DASHBOARD_PORT', category:'dashboard', description:'Dashboard port.', stability:'stable', default:'8787', type:'number', since:'1.0.0' },
  { name:'INDEX_SERVER_DASHBOARD_HOST', category:'dashboard', description:'Dashboard bind host.', stability:'stable', default:'127.0.0.1', type:'string', since:'1.0.0' },
  { name:'INDEX_SERVER_DASHBOARD_TRIES', category:'dashboard', description:'Dashboard port retry attempts.', stability:'stable', default:'10', type:'number', since:'1.0.0' },

  // Manifest & index
  { name:'INDEX_SERVER_MANIFEST_WRITE', category:'manifest', description:'Allow writing index manifest (set 0 to disable).', stability:'stable', default:'on', type:'boolean', since:'1.1.0' },
  { name:'INDEX_SERVER_MANIFEST_FASTLOAD', category:'manifest', description:'Preview fastload path (currently reserved).', stability:'reserved', default:'off', type:'boolean', since:'1.1.0' },
  { name:'INDEX_SERVER_ENABLE_INDEX_SERVER_POLLER', category:'manifest', description:'Enable background version marker poller (cross-process propagation).', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_POLL_MS', category:'manifest', description:'Index poll interval ms when poller enabled.', stability:'diagnostic', default:'10000', type:'number', since:'1.1.1' },
  { name:'INDEX_SERVER_POLL_PROACTIVE', category:'manifest', description:'Proactive reload on poll interval even if version unchanged.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },

  // Instructions strictness / visibility / creation controls
  { name:'INDEX_SERVER_STRICT_CREATE', category:'index', description:'After add, perform strict visibility verification chain.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_STRICT_REMOVE', category:'index', description:'After remove, enforce strict verification of absence.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_TEST_STRICT_VISIBILITY', category:'instructions', description:'Test-only strict fallback path for immediate get/query discoverability.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_REQUIRE_CATEGORY', category:'instructions', description:'Reject instructions missing category unless lax override set.', stability:'stable', default:'off', type:'boolean', since:'1.0.0' },
  { name:'INDEX_SERVER_CANONICAL_DISABLE', category:'instructions', description:'Disable canonical sourceHash persistence (forces runtime recompute).', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_READ_RETRIES', category:'instructions', description:'Retries for post-add disk visibility checks.', stability:'diagnostic', default:'5', type:'number', since:'1.1.1' },
  { name:'INDEX_SERVER_READ_BACKOFF_MS', category:'instructions', description:'Backoff ms between read retries.', stability:'diagnostic', default:'10', type:'number', since:'1.1.1' },

  // Tracing & logging advanced
  { name:'INDEX_SERVER_TRACE_LEVEL', category:'tracing', description:'Explicit trace level (off|core|perf|files|verbose).', stability:'stable', default:'off', type:'string', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_ALL', category:'tracing', description:'Force maximum trace verbosity.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_PERSIST', category:'tracing', description:'Enable persistent JSONL trace output (auto file).', stability:'stable', default:'off', type:'boolean', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_FILE', category:'tracing', description:'Explicit trace output file path.', stability:'stable', default:'(unset)', type:'string', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_DIR', category:'tracing', description:'Directory for auto trace files.', stability:'stable', default:'./logs/trace', type:'string', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_MAX_FILE_SIZE', category:'tracing', description:'Rotate trace file after exceeding N bytes (0=off).', stability:'stable', default:'0', type:'number', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_CATEGORIES', category:'tracing', description:'Comma/space list of allowed trace categories (filter).', stability:'stable', default:'(all)', type:'string', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_SESSION', category:'tracing', description:'Explicit trace session id.', stability:'stable', default:'(random)', type:'string', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_CALLSITE', category:'tracing', description:'Include emitting function callsite (verbose or explicit).', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_FSYNC', category:'tracing', description:'fsync after each trace write (heavy, diagnostics only).', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_BUFFER_SIZE', category:'tracing', description:'Enable in-memory ring buffer of last N trace frames.', stability:'experimental', default:'0', type:'number', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_BUFFER_FILE', category:'tracing', description:'Explicit file path for buffer dump.', stability:'experimental', default:'./logs/trace/trace-buffer.json', type:'string', since:'1.1.2' },
  { name:'INDEX_SERVER_TRACE_BUFFER_DUMP_ON_EXIT', category:'tracing', description:'Dump ring buffer automatically on process exit.', stability:'experimental', default:'off', type:'boolean', since:'1.1.2' },
  { name:'INDEX_SERVER_VISIBILITY_DIAG', category:'tracing', description:'Force core trace level for visibility diagnostics.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_FILE_TRACE', category:'tracing', description:'Promote index file events to trace level (files).', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },

  // Usage & metrics
  { name:'INDEX_SERVER_DISABLE_RATE_LIMIT', category:'usage', description:'Disable all rate limiting (dashboard HTTP API and usage tracking). Rate limiting is enabled by default.', stability:'stable', default:'off', type:'boolean', since:'1.1.3' },
  { name:'INDEX_SERVER_DISABLE_USAGE_RATE_LIMIT', category:'usage', description:'(Deprecated) Legacy per-subsystem override to disable usage rate limit.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_DISABLE_USAGE_CLAMP', category:'usage', description:'Disable initial usage count clamp logic.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_USAGE_FLUSH_MS', category:'usage', description:'Override usage flush debounce interval.', stability:'diagnostic', default:'75', type:'number', since:'1.1.1' },

  // Validation / schema
  { name:'INDEX_SERVER_VALIDATION_MODE', category:'validation', description:'Schema validation engine selection (ajv|zod|auto).', stability:'stable', default:'zod', type:'string', since:'1.1.2' },

  // Handshake / transport / performance diagnostics
  { name:'INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER', category:'diagnostics', description:'Disable early stdin buffering (compare fragmentation behavior).', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_FATAL_EXIT_DELAY_MS', category:'diagnostics', description:'Delay before forced fatal exit (ms).', stability:'diagnostic', default:'15', type:'number', since:'1.1.1' },
  { name:'INDEX_SERVER_IDLE_KEEPALIVE_MS', category:'diagnostics', description:'Keepalive interval for idle transports.', stability:'stable', default:'30000', type:'number', since:'1.0.0' },
  { name:'INDEX_SERVER_ADD_TIMING', category:'diagnostics', description:'Embed per-tool timing phase marks in response envelope.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },
  { name:'INDEX_SERVER_TRACE_DISPATCH_DIAG', category:'diagnostics', description:'Extra dispatcher timing/phase logs (use INDEX_SERVER_TRACE=dispatchDiag).', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.1' },

  // Stress / adversarial
  { name:'INDEX_SERVER_STRESS_DIAG', category:'stress', description:'Enable stress suite & escalated diagnostic loops.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.0' },

  // Auth / security (placeholders for future expansion)
  { name:'INDEX_SERVER_REQUIRE_AUTH_ALL', category:'auth', description:'Require auth for all tool calls (future integration).', stability:'experimental', default:'off', type:'boolean', since:'1.1.2' },
  { name:'INDEX_SERVER_AUTH_KEY', category:'auth', description:'Static auth key / token (development only).', stability:'experimental', default:'(unset)', type:'string', since:'1.1.2' },

  // Metrics collection (file-based)
  { name:'INDEX_SERVER_METRICS_FILE_STORAGE', category:'metrics', description:'Persist metrics snapshots to files for dashboard aggregation.', stability:'experimental', default:'off', type:'boolean', since:'1.1.2' },
  { name:'INDEX_SERVER_METRICS_DIR', category:'metrics', description:'Directory for metrics file storage.', stability:'experimental', default:'./metrics', type:'string', since:'1.1.2' },
  { name:'INDEX_SERVER_METRICS_MAX_FILES', category:'metrics', description:'Max metrics files to retain (rotation).', stability:'experimental', default:'720', type:'number', since:'1.1.2' },

  // Debug / developer ergonomics
  { name:'INDEX_SERVER_DEBUG', category:'diagnostics', description:'Enable developer diagnostics bundle (memory, internals).', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.0' },
  { name:'INDEX_SERVER_MEMORY_MONITOR', category:'diagnostics', description:'Enable periodic memory usage sampling/logging.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.0' },
  { name:'INDEX_SERVER_LOG_MUTATION', category:'diagnostics', description:'Emit mutation-specific verbose logs.', stability:'diagnostic', default:'off', type:'boolean', since:'1.1.0' },

  // Legacy / removed (for awareness; not parsed at runtime)

  // Multi-instance / leader-follower
  { name:'INDEX_SERVER_MODE', category:'multi-instance', description:'Instance mode: standalone (default), leader, follower, auto.', stability:'experimental', default:'standalone', type:'string', since:'1.8.5' },
  { name:'INDEX_SERVER_LEADER_PORT', category:'multi-instance', description:'HTTP port for leader MCP transport (thin clients connect here).', stability:'experimental', default:'9090', type:'number', since:'1.8.5' },
  { name:'INDEX_SERVER_HEARTBEAT_MS', category:'multi-instance', description:'Leader heartbeat interval (ms).', stability:'experimental', default:'5000', type:'number', since:'1.8.5' },
  { name:'INDEX_SERVER_STALE_THRESHOLD_MS', category:'multi-instance', description:'Stale leader threshold (ms) before follower promotes.', stability:'experimental', default:'15000', type:'number', since:'1.8.5' },
];

function parseValue(meta: FlagMeta): { value?:string; enabled?:boolean; parsed?:unknown } {
  const raw = process.env[meta.name];
  if(raw === undefined) return {};
  if(meta.type === 'boolean'){
    const enabled = getBooleanEnv(meta.name);
    return { value: raw, enabled, parsed: enabled };
  }
  if(meta.type === 'number'){
    const n = parseInt(raw,10); return { value: raw, parsed: Number.isFinite(n)? n : undefined };
  }
  return { value: raw, parsed: raw };
}

export function getFlagRegistrySnapshot(): FlagRuntime[] {
  return FLAG_REGISTRY
    .slice()
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    .map(m => ({ ...m, ...parseValue(m), docAnchor: m.name.toLowerCase().replace(/_/g, '-') }));
}

registerHandler('dashboard_config', () => {
  const flags: FlagRuntime[] = getFlagRegistrySnapshot();
  return {
    generatedAt: new Date().toISOString(),
    lastRefreshed: Date.now(),
    total: flags.length,
    flags,
  };
});

export {}; // ensure module scope
