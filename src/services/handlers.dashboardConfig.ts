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
  { name:'INDEX_SERVER_SEARCH_OMIT_ZERO_QUERY', category:'instructions', description:'Omit echoed query metadata from zero-result search responses.', stability:'diagnostic', default:'off', type:'boolean', since:'1.28.2' },
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
  { name:'INDEX_SERVER_RATE_LIMIT', category:'usage', description:'Dashboard HTTP API and usage-tracking rate limit, in requests per minute. 0 (default) disables rate limiting. Bulk import/export/backup/restore routes are unconditionally exempt.', stability:'stable', default:'0', type:'number', since:'1.27.0' },
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

  // Semantic / embeddings
  { name:'INDEX_SERVER_SEMANTIC_ENABLED', category:'semantic', description:'Enable semantic search & embedding compute.', stability:'experimental', default:'off', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_SEMANTIC_MODEL', category:'semantic', description:'HuggingFace embedding model id (e.g. Xenova/all-MiniLM-L6-v2).', stability:'experimental', default:'(default)', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_SEMANTIC_DEVICE', category:'semantic', description:'Inference device: cpu | cuda | dml.', stability:'experimental', default:'cpu', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_SEMANTIC_CACHE_DIR', category:'semantic', description:'Directory for downloaded model artifacts.', stability:'experimental', default:'./data/models', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_SEMANTIC_LOCAL_ONLY', category:'semantic', description:'Disallow remote model downloads (offline mode).', stability:'experimental', default:'on', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_EMBEDDING_PATH', category:'semantic', description:'Path to embeddings JSON cache file.', stability:'experimental', default:'./data/embeddings.json', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_AUTO_EMBED_ON_IMPORT', category:'semantic', description:'Auto-compute embeddings after zip import / restore (when semantic enabled).', stability:'experimental', default:'on', type:'boolean', since:'1.27.3' },

  // Storage backend
  { name:'INDEX_SERVER_STORAGE_BACKEND', category:'storage', description:'Instruction store backend: json (default) | sqlite (experimental).', stability:'experimental', default:'json', type:'string', since:'1.25.0' },
  { name:'INDEX_SERVER_SQLITE_PATH', category:'storage', description:'SQLite database file path.', stability:'experimental', default:'./data/index.db', type:'string', since:'1.25.0' },
  { name:'INDEX_SERVER_SQLITE_WAL', category:'storage', description:'Enable SQLite WAL journaling.', stability:'experimental', default:'on', type:'boolean', since:'1.25.0' },
  { name:'INDEX_SERVER_SQLITE_MIGRATE_ON_START', category:'storage', description:'Run schema migrations at startup.', stability:'experimental', default:'on', type:'boolean', since:'1.25.0' },
  { name:'INDEX_SERVER_SQLITE_VEC_ENABLED', category:'storage', description:'Enable sqlite-vec extension for embeddings.', stability:'experimental', default:'off', type:'boolean', since:'1.25.0' },
  { name:'INDEX_SERVER_SQLITE_VEC_PATH', category:'storage', description:'Path to sqlite-vec loadable extension.', stability:'experimental', default:'(unset)', type:'string', since:'1.25.0' },

  // Feedback & messaging
  { name:'INDEX_SERVER_FEEDBACK_DIR', category:'feedback', description:'Feedback storage directory.', stability:'stable', default:'./feedback', type:'string', since:'1.10.0' },
  { name:'INDEX_SERVER_FEEDBACK_MAX_ENTRIES', category:'feedback', description:'Maximum retained feedback entries.', stability:'stable', default:'10000', type:'number', since:'1.10.0' },
  { name:'INDEX_SERVER_MESSAGING_DIR', category:'messaging', description:'Inter-agent messaging storage dir.', stability:'experimental', default:'./data/messaging', type:'string', since:'1.18.0' },
  { name:'INDEX_SERVER_MESSAGING_MAX', category:'messaging', description:'Max retained messages.', stability:'experimental', default:'5000', type:'number', since:'1.18.0' },
  { name:'INDEX_SERVER_MESSAGING_SWEEP_MS', category:'messaging', description:'Messaging sweep interval (ms).', stability:'experimental', default:'60000', type:'number', since:'1.18.0' },

  // Dashboard / TLS
  { name:'INDEX_SERVER_DASHBOARD_TLS', category:'dashboard', description:'Enable HTTPS for the admin dashboard.', stability:'stable', default:'off', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_DASHBOARD_TLS_CERT', category:'dashboard', description:'TLS certificate path.', stability:'stable', default:'(unset)', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_DASHBOARD_TLS_KEY', category:'dashboard', description:'TLS private key path.', stability:'stable', default:'(unset)', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_DASHBOARD_TLS_CA', category:'dashboard', description:'Optional TLS CA bundle path.', stability:'stable', default:'(unset)', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_DASHBOARD_GRAPH', category:'dashboard', description:'Enable dashboard graph rendering.', stability:'stable', default:'off', type:'boolean', since:'1.18.0' },
  { name:'INDEX_SERVER_HTTP_METRICS', category:'dashboard', description:'Expose Prometheus-style HTTP metrics.', stability:'stable', default:'on', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_REQUEST_TIMEOUT', category:'dashboard', description:'HTTP request timeout (ms).', stability:'stable', default:'30000', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_MAX_CONNECTIONS', category:'dashboard', description:'Max concurrent HTTP connections.', stability:'stable', default:'100', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_ADMIN_API_KEY', category:'auth', description:'Bearer token for admin endpoints.', stability:'stable', default:'(unset)', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_ADMIN_MAX_SESSION_HISTORY', category:'dashboard', description:'Max retained admin session history.', stability:'stable', default:'500', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_BACKUPS_DIR', category:'dashboard', description:'Directory for backup zips.', stability:'stable', default:'./backups', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_STATE_DIR', category:'dashboard', description:'Persistent dashboard state directory.', stability:'stable', default:'./data/state', type:'string', since:'1.20.0' },

  // Backup / mutation safety
  { name:'INDEX_SERVER_AUTO_BACKUP', category:'index', description:'Auto-create backup before risky mutations.', stability:'stable', default:'on', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS', category:'index', description:'Auto-backup interval ms.', stability:'stable', default:'3600000', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_AUTO_BACKUP_MAX_COUNT', category:'index', description:'Max retained auto-backups.', stability:'stable', default:'10', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE', category:'index', description:'Snapshot before bulk delete.', stability:'stable', default:'on', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_MAX_BULK_DELETE', category:'index', description:'Max ids per bulk delete call.', stability:'stable', default:'1000', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_BODY_WARN_LENGTH', category:'index', description:'Warn-then-reject threshold for instruction body length.', stability:'stable', default:'50000', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_AUTO_SPLIT_OVERSIZED', category:'index', description:'Auto-split oversized instruction bodies on add.', stability:'experimental', default:'off', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_AUTO_USAGE_TRACK', category:'usage', description:'Auto-track usage for tool invocations.', stability:'stable', default:'on', type:'boolean', since:'1.20.0' },

  // Bootstrap & seed
  { name:'INDEX_SERVER_AUTO_SEED', category:'bootstrap', description:'Auto-seed canonical bootstrap instructions on first start.', stability:'stable', default:'on', type:'boolean', since:'1.10.0' },
  { name:'INDEX_SERVER_SEED_VERBOSE', category:'bootstrap', description:'Verbose seed-bootstrap logging.', stability:'diagnostic', default:'off', type:'boolean', since:'1.10.0' },
  { name:'INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM', category:'bootstrap', description:'Auto-confirm bootstrap (skip token prompt).', stability:'stable', default:'off', type:'boolean', since:'1.10.0' },
  { name:'INDEX_SERVER_BOOTSTRAP_TOKEN_TTL_SEC', category:'bootstrap', description:'Bootstrap token TTL (seconds).', stability:'stable', default:'600', type:'number', since:'1.10.0' },

  // Logging surface
  { name:'INDEX_SERVER_LOG_FILE', category:'core', description:'NDJSON log file path (or 1 to use default).', stability:'stable', default:'(unset)', type:'string', since:'1.0.0' },
  { name:'INDEX_SERVER_LOG_LEVEL', category:'core', description:'Minimum log level: trace|debug|info|warn|error.', stability:'stable', default:'info', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_LOG_JSON', category:'core', description:'(Reserved) Force JSON log mode.', stability:'reserved', default:'off', type:'boolean', since:'1.0.0' },
  { name:'INDEX_SERVER_LOG_SYNC', category:'diagnostics', description:'Fsync after each log write (test determinism).', stability:'diagnostic', default:'off', type:'boolean', since:'1.0.0' },
  { name:'INDEX_SERVER_LOG_PROTOCOL', category:'diagnostics', description:'Log MCP protocol frames.', stability:'diagnostic', default:'off', type:'boolean', since:'1.0.0' },
  { name:'INDEX_SERVER_EVENT_BUFFER_SIZE', category:'diagnostics', description:'Capacity of in-memory WARN/ERROR ring buffer surfaced in dashboard Events panel.', stability:'stable', default:'500', type:'number', since:'1.27.3' },
  { name:'INDEX_SERVER_EVENT_SILENT', category:'diagnostics', description:'Suppress redundant index-event logs.', stability:'diagnostic', default:'off', type:'boolean', since:'1.20.0' },

  // Profile / dev mode
  { name:'INDEX_SERVER_PROFILE', category:'core', description:'Runtime profile selector (default | dev | prod).', stability:'stable', default:'default', type:'string', since:'1.20.0' },

  // Operationally-meaningful additions surfaced by the catalog drift test.
  { name:'INDEX_SERVER_BODY_MAX_LENGTH', category:'index', description:'Hard reject threshold for instruction body length (bytes).', stability:'stable', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_MAX_FILES', category:'index', description:'Soft cap on number of indexed instruction files.', stability:'stable', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_LOAD_WARN_MS', category:'diagnostics', description:'Emit WARN if initial index load exceeds this many ms.', stability:'diagnostic', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_AGENT_ID', category:'core', description:'Logical agent identity for audit/attestation trailers.', stability:'stable', default:'(unset)', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_FLAGS_FILE', category:'core', description:'Path to feature-flag persistence file.', stability:'stable', default:'./flags.json', type:'string', since:'1.10.0' },
  { name:'INDEX_SERVER_HEALTH_MEMORY_THRESHOLD', category:'diagnostics', description:'Memory threshold (bytes) for /health degraded status.', stability:'diagnostic', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_HEALTH_ERROR_THRESHOLD', category:'diagnostics', description:'Error-rate threshold for /health degraded status.', stability:'diagnostic', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_HEALTH_MIN_UPTIME', category:'diagnostics', description:'Minimum uptime (s) before /health reports healthy.', stability:'diagnostic', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_RESOURCE_CAPACITY', category:'diagnostics', description:'In-memory resource sample buffer capacity.', stability:'diagnostic', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_RESOURCE_SAMPLE_INTERVAL_MS', category:'diagnostics', description:'Resource sampler interval (ms).', stability:'diagnostic', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_TOOLCALL_CHUNK_SIZE', category:'diagnostics', description:'Tool-call ring buffer chunk size.', stability:'diagnostic', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_TOOLCALL_FLUSH_MS', category:'diagnostics', description:'Tool-call ring buffer flush interval (ms).', stability:'diagnostic', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_TOOLCALL_COMPACT_MS', category:'diagnostics', description:'Tool-call ring buffer compaction interval (ms).', stability:'diagnostic', default:'(unset)', type:'number', since:'1.20.0' },
  { name:'INDEX_SERVER_TOOLCALL_APPEND_LOG', category:'diagnostics', description:'Append-only tool-call log path.', stability:'diagnostic', default:'(unset)', type:'string', since:'1.20.0' },
  { name:'INDEX_SERVER_AUDIT_LOG', category:'diagnostics', description:'Audit log file path (mutation operations).', stability:'diagnostic', default:'(unset)', type:'string', since:'1.10.0' },
  { name:'INDEX_SERVER_NORMALIZATION_LOG', category:'diagnostics', description:'Normalization log file path.', stability:'diagnostic', default:'(unset)', type:'string', since:'1.10.0' },
  { name:'INDEX_SERVER_TRACE', category:'diagnostics', description:'Enable verbose trace logging.', stability:'diagnostic', default:'off', type:'boolean', since:'1.0.0' },
  { name:'INDEX_SERVER_TIMING_JSON', category:'diagnostics', description:'Emit timing data as JSON-NDJSON.', stability:'diagnostic', default:'off', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_MINIMAL_DEBUG', category:'diagnostics', description:'Minimal debug surface (reduces verbosity).', stability:'diagnostic', default:'off', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_STRESS_MODE', category:'diagnostics', description:'Enable stress-test instrumentation.', stability:'diagnostic', default:'off', type:'boolean', since:'1.20.0' },
  { name:'INDEX_SERVER_GRAPH_INCLUDE_PRIMARY_EDGES', category:'index', description:'Include primary edges in graph export.', stability:'experimental', default:'on', type:'boolean', since:'1.18.0' },
  { name:'INDEX_SERVER_GRAPH_LARGE_CATEGORY_CAP', category:'index', description:'Cap large-category fanout in graph export.', stability:'experimental', default:'(unset)', type:'number', since:'1.18.0' },
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
