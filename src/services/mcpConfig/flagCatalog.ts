import path from 'path';

export type McpProfile = 'default' | 'enhanced' | 'experimental';

export interface McpDataPaths {
  instructions: string;
  feedback: string;
  backups: string;
  state: string;
  auditLog: string;
  logFile: string;
  metrics: string;
  messaging: string;
  embeddings: string;
  modelCache: string;
  sqliteDb: string;
  certs: string;
  flags: string;
}

export interface McpEnvCatalogSection {
  section: string;
}

export interface McpEnvCatalogVariable {
  key: string;
  desc: string;
  active: boolean;
  value: string;
  defaultByProfile: Record<McpProfile, string>;
  mcpEnvVisibility: 'always' | 'when-set' | 'never';
  validate: string;
  [key: string]: unknown;
}

export type McpEnvCatalogEntry = McpEnvCatalogSection | McpEnvCatalogVariable;
interface RawMcpEnvCatalogVariable {
  key: string;
  desc: string;
  active: boolean;
  value: string;
}
type RawMcpEnvCatalogEntry = McpEnvCatalogSection | RawMcpEnvCatalogVariable;

export interface McpProfileConfig {
  profile: McpProfile;
  root: string;
  port: number;
  host: string;
  tls: boolean;
  mutation: boolean;
  logLevel: string;
}

export const DOCUMENTED_INDEX_SERVER_FLAGS = [
  'INDEX_SERVER_ADD_TIMING',
  'INDEX_SERVER_ADMIN_API_KEY',
  'INDEX_SERVER_ADMIN_MAX_SESSION_HISTORY',
  'INDEX_SERVER_AGENT_ID',
  'INDEX_SERVER_ALWAYS_RELOAD',
  'INDEX_SERVER_ATOMIC_WRITE_BACKOFF_MS',
  'INDEX_SERVER_ATOMIC_WRITE_RETRIES',
  'INDEX_SERVER_AUDIT_LOG',
  'INDEX_SERVER_AUTH_KEY',
  'INDEX_SERVER_AUTO_BACKUP',
  'INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS',
  'INDEX_SERVER_AUTO_BACKUP_MAX_COUNT',
  'INDEX_SERVER_AUTO_EMBED_ON_IMPORT',
  'INDEX_SERVER_AUTO_SEED',
  'INDEX_SERVER_AUTO_SPLIT_OVERSIZED',
  'INDEX_SERVER_AUTO_USAGE_TRACK',
  'INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE',
  'INDEX_SERVER_BACKUPS_DIR',
  'INDEX_SERVER_BODY_MAX_LENGTH',
  'INDEX_SERVER_BODY_WARN_LENGTH',
  'INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM',
  'INDEX_SERVER_BOOTSTRAP_TOKEN_TTL_SEC',
  'INDEX_SERVER_BUFFER_RING_APPEND',
  'INDEX_SERVER_BUFFER_RING_PRELOAD',
  'INDEX_SERVER_CACHE_MODE',
  'INDEX_SERVER_CANONICAL_DISABLE',
  'INDEX_SERVER_DASHBOARD',
  'INDEX_SERVER_DASHBOARD_GRAPH',
  'INDEX_SERVER_DASHBOARD_HOST',
  'INDEX_SERVER_DASHBOARD_PORT',
  'INDEX_SERVER_DASHBOARD_TLS',
  'INDEX_SERVER_DASHBOARD_TLS_CA',
  'INDEX_SERVER_DASHBOARD_TLS_CERT',
  'INDEX_SERVER_DASHBOARD_TLS_KEY',
  'INDEX_SERVER_DASHBOARD_TRIES',
  'INDEX_SERVER_DEBUG',
  'INDEX_SERVER_DIR',
  'INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER',
  'INDEX_SERVER_DISABLE_PPID_WATCHDOG',
  'INDEX_SERVER_DISABLE_STDERR_BRIDGE',
  'INDEX_SERVER_DISABLE_USAGE_CLAMP',
  'INDEX_SERVER_EMBEDDING_PATH',
  'INDEX_SERVER_ENABLE_INDEX_SERVER_POLLER',
  'INDEX_SERVER_ENABLE_STDERR_BRIDGE',
  'INDEX_SERVER_EVENT_BUFFER_SIZE',
  'INDEX_SERVER_EVENT_SILENT',
  'INDEX_SERVER_FATAL_EXIT_DELAY_MS',
  'INDEX_SERVER_FEATURES',
  'INDEX_SERVER_FEEDBACK_DIR',
  'INDEX_SERVER_FEEDBACK_MAX_ENTRIES',
  'INDEX_SERVER_FILE_TRACE',
  'INDEX_SERVER_FLAG_TOOLS_ADMIN',
  'INDEX_SERVER_FLAG_TOOLS_EXTENDED',
  'INDEX_SERVER_FLAGS',
  'INDEX_SERVER_FLAGS_FILE',
  'INDEX_SERVER_FORCE_REBUILD',
  'INDEX_SERVER_GOV_HASH_CANON_VARIANTS',
  'INDEX_SERVER_GOV_HASH_HARDENING',
  'INDEX_SERVER_GOV_HASH_IMPORT_SET_SIZE',
  'INDEX_SERVER_GRAPH_INCLUDE_PRIMARY_EDGES',
  'INDEX_SERVER_GRAPH_LARGE_CATEGORY_CAP',
  'INDEX_SERVER_HEALTH_ERROR_THRESHOLD',
  'INDEX_SERVER_HEALTH_MEMORY_THRESHOLD',
  'INDEX_SERVER_HEALTH_MIN_UPTIME',
  'INDEX_SERVER_HEARTBEAT_MS',
  'INDEX_SERVER_HTTP_METRICS',
  'INDEX_SERVER_IDLE_KEEPALIVE_MS',
  'INDEX_SERVER_IDLE_READY_SENTINEL',
  'INDEX_SERVER_INIT_FEATURES',
  'INDEX_SERVER_ISSUE_317_COUNTER',
  'INDEX_SERVER_LEADER_PORT',
  'INDEX_SERVER_LEADER_URL',
  'INDEX_SERVER_LOAD_WARN_MS',
  'INDEX_SERVER_LOG_DIAG',
  'INDEX_SERVER_LOG_FILE',
  'INDEX_SERVER_LOG_JSON',
  'INDEX_SERVER_LOG_LEVEL',
  'INDEX_SERVER_LOG_MUTATION',
  'INDEX_SERVER_LOG_PROTOCOL',
  'INDEX_SERVER_LOG_SEARCH',
  'INDEX_SERVER_LOG_SYNC',
  'INDEX_SERVER_LOG_TOOLS',
  'INDEX_SERVER_MANIFEST_FASTLOAD',
  'INDEX_SERVER_MANIFEST_PATH',
  'INDEX_SERVER_MANIFEST_WRITE',
  'INDEX_SERVER_MAX_BULK_DELETE',
  'INDEX_SERVER_MAX_CONNECTIONS',
  'INDEX_SERVER_MAX_FILES',
  'INDEX_SERVER_MCP_BACKUP_RETAIN',
  'INDEX_SERVER_MCP_CONFIG_ROOT',
  'INDEX_SERVER_MEMOIZE',
  'INDEX_SERVER_MEMOIZE_HASH',
  'INDEX_SERVER_MEMORY_MONITOR',
  'INDEX_SERVER_MESSAGING_DIR',
  'INDEX_SERVER_MESSAGING_MAX',
  'INDEX_SERVER_MESSAGING_SWEEP_MS',
  'INDEX_SERVER_METRICS_DIR',
  'INDEX_SERVER_METRICS_FILE_STORAGE',
  'INDEX_SERVER_METRICS_MAX_FILES',
  'INDEX_SERVER_MINIMAL_DEBUG',
  'INDEX_SERVER_MODE',
  'INDEX_SERVER_MUTATION',
  'INDEX_SERVER_NORMALIZATION_LOG',
  'INDEX_SERVER_POLL_MS',
  'INDEX_SERVER_POLL_PROACTIVE',
  'INDEX_SERVER_PREFLIGHT_MODULES',
  'INDEX_SERVER_PREFLIGHT_STRICT',
  'INDEX_SERVER_PROFILE',
  'INDEX_SERVER_PWS_EXIT_MS',
  'INDEX_SERVER_RATE_LIMIT',
  'INDEX_SERVER_READ_BACKOFF_MS',
  'INDEX_SERVER_READ_RETRIES',
  'INDEX_SERVER_REFERENCE_MODE',
  'INDEX_SERVER_REQUEST_TIMEOUT',
  'INDEX_SERVER_REQUIRE_AUTH_ALL',
  'INDEX_SERVER_REQUIRE_CATEGORY',
  'INDEX_SERVER_RESOURCE_CAPACITY',
  'INDEX_SERVER_RESOURCE_SAMPLE_INTERVAL_MS',
  'INDEX_SERVER_SEED_VERBOSE',
  'INDEX_SERVER_SEMANTIC_CACHE_DIR',
  'INDEX_SERVER_SEMANTIC_DEVICE',
  'INDEX_SERVER_SEMANTIC_ENABLED',
  'INDEX_SERVER_SEMANTIC_LOCAL_ONLY',
  'INDEX_SERVER_SEMANTIC_MODEL',
  'INDEX_SERVER_SEARCH_OMIT_ZERO_QUERY',
  'INDEX_SERVER_SESSION_BACKUP_INTEGRATION',
  'INDEX_SERVER_SESSION_DEDUPLICATION_ENABLED',
  'INDEX_SERVER_SESSION_MAX_CONNECTION_HISTORY_DAYS',
  'INDEX_SERVER_SESSION_MAX_HISTORY_DAYS',
  'INDEX_SERVER_SESSION_MAX_HISTORY_ENTRIES',
  'INDEX_SERVER_SESSION_PERSISTENCE_DIR',
  'INDEX_SERVER_SESSION_PERSISTENCE_ENABLED',
  'INDEX_SERVER_SESSION_PERSISTENCE_INTERVAL_MS',
  'INDEX_SERVER_SHARED_SERVER_SENTINEL',
  'INDEX_SERVER_SQLITE_MIGRATE_ON_START',
  'INDEX_SERVER_SQLITE_PATH',
  'INDEX_SERVER_SQLITE_VEC_ENABLED',
  'INDEX_SERVER_SQLITE_VEC_PATH',
  'INDEX_SERVER_SQLITE_WAL',
  'INDEX_SERVER_STALE_THRESHOLD_MS',
  'INDEX_SERVER_STATE_DIR',
  'INDEX_SERVER_STORAGE_BACKEND',
  'INDEX_SERVER_STRESS_DIAG',
  'INDEX_SERVER_STRESS_MODE',
  'INDEX_SERVER_STRICT_',
  'INDEX_SERVER_STRICT_CREATE',
  'INDEX_SERVER_STRICT_REMOVE',
  'INDEX_SERVER_TEST_MODE',
  'INDEX_SERVER_TEST_STRICT_VISIBILITY',
  'INDEX_SERVER_TIMING_JSON',
  'INDEX_SERVER_TOOLCALL_APPEND_LOG',
  'INDEX_SERVER_TOOLCALL_CHUNK_SIZE',
  'INDEX_SERVER_TOOLCALL_COMPACT_MS',
  'INDEX_SERVER_TOOLCALL_FLUSH_MS',
  'INDEX_SERVER_TRACE',
  'INDEX_SERVER_TRACE_',
  'INDEX_SERVER_TRACE_ALL',
  'INDEX_SERVER_TRACE_BUFFER_',
  'INDEX_SERVER_TRACE_BUFFER_DUMP_ON_EXIT',
  'INDEX_SERVER_TRACE_BUFFER_FILE',
  'INDEX_SERVER_TRACE_BUFFER_SIZE',
  'INDEX_SERVER_TRACE_CALLSITE',
  'INDEX_SERVER_TRACE_CATEGORIES',
  'INDEX_SERVER_TRACE_DIR',
  'INDEX_SERVER_TRACE_DISPATCH_DIAG',
  'INDEX_SERVER_TRACE_FILE',
  'INDEX_SERVER_TRACE_FSYNC',
  'INDEX_SERVER_TRACE_LEVEL',
  'INDEX_SERVER_TRACE_MAX_FILE_SIZE',
  'INDEX_SERVER_TRACE_PERSIST',
  'INDEX_SERVER_TRACE_QUERY_DIAG',
  'INDEX_SERVER_TRACE_SESSION',
  'INDEX_SERVER_USAGE_FLUSH_MS',
  'INDEX_SERVER_USAGE_SNAPSHOT_PATH',
  'INDEX_SERVER_VALIDATION_MODE',
  'INDEX_SERVER_VERBOSE_LOGGING',
  'INDEX_SERVER_VISIBILITY_DIAG',
  'INDEX_SERVER_WARN_BUDGET',
  'INDEX_SERVER_WORKSPACE',
] as const;

export function toForwardSlashes(value: string): string {
  return value.split(path.sep).join('/');
}

export function resolveDataPaths(root: string): McpDataPaths {
  const resolveUnder = (...segments: string[]) => toForwardSlashes(path.resolve(root, ...segments));
  return {
    instructions: resolveUnder('instructions'),
    feedback: resolveUnder('feedback'),
    backups: resolveUnder('backups'),
    state: resolveUnder('data', 'state'),
    auditLog: resolveUnder('logs', 'instruction-transactions.log.jsonl'),
    logFile: resolveUnder('logs', 'mcp-server.log'),
    metrics: resolveUnder('metrics'),
    messaging: resolveUnder('data', 'messaging'),
    embeddings: resolveUnder('data', 'embeddings.json'),
    modelCache: resolveUnder('data', 'models'),
    sqliteDb: resolveUnder('data', 'index.db'),
    certs: resolveUnder('certs'),
    flags: resolveUnder('flags.json'),
  };
}

export function buildEnvCatalog(config: McpProfileConfig, paths: McpDataPaths): McpEnvCatalogEntry[] {
  const isEnhanced = config.profile === 'enhanced' || config.profile === 'experimental';
  const isSqlite = config.profile === 'experimental';
  const entries: RawMcpEnvCatalogEntry[] = [
    { section: 'Core Paths - where your data lives' },
    { key: 'INDEX_SERVER_PROFILE', desc: 'Configuration profile: default | enhanced | experimental', active: true, value: config.profile },
    { key: 'INDEX_SERVER_ALWAYS_RELOAD', desc: 'Reload index on each read for generated config verification', active: true, value: '1' },
    { key: 'INDEX_SERVER_DIR', desc: 'Instruction catalog directory', active: false, value: paths.instructions },
    { key: 'INDEX_SERVER_FEEDBACK_DIR', desc: 'Feedback entries storage directory', active: false, value: paths.feedback },
    { key: 'INDEX_SERVER_BACKUPS_DIR', desc: 'Backup snapshots directory', active: false, value: paths.backups },
    { key: 'INDEX_SERVER_STATE_DIR', desc: 'Runtime state files directory', active: false, value: paths.state },
    { key: 'INDEX_SERVER_MESSAGING_DIR', desc: 'Message queue storage directory', active: false, value: paths.messaging },
    { section: 'Dashboard - HTTP/HTTPS admin interface' },
    { key: 'INDEX_SERVER_DASHBOARD', desc: 'Enable the web dashboard', active: true, value: '1' },
    { key: 'INDEX_SERVER_DASHBOARD_PORT', desc: 'Dashboard listen port', active: true, value: String(config.port) },
    { key: 'INDEX_SERVER_DASHBOARD_HOST', desc: 'Dashboard bind address', active: true, value: config.host },
    { key: 'INDEX_SERVER_DASHBOARD_GRAPH', desc: 'Enable graph visualization', active: false, value: '0' },
    { section: 'Security - mutation control and TLS' },
    { key: 'INDEX_SERVER_MUTATION', desc: 'Enable write operations', active: true, value: config.mutation ? '1' : '0' },
    { key: 'INDEX_SERVER_ADMIN_API_KEY', desc: 'Dashboard admin API key', active: false, value: '' },
    { key: 'INDEX_SERVER_DASHBOARD_TLS', desc: 'Enable HTTPS dashboard', active: config.tls, value: config.tls ? '1' : '0' },
    { key: 'INDEX_SERVER_DASHBOARD_TLS_CERT', desc: 'Path to TLS certificate file', active: config.tls, value: `${paths.certs}/server.crt` },
    { key: 'INDEX_SERVER_DASHBOARD_TLS_KEY', desc: 'Path to TLS private key file', active: config.tls, value: `${paths.certs}/server.key` },
    { key: 'INDEX_SERVER_DASHBOARD_TLS_CA', desc: 'Path to CA certificate', active: false, value: '' },
    { section: 'Semantic Search - embeddings' },
    { key: 'INDEX_SERVER_SEMANTIC_ENABLED', desc: 'Enable semantic search', active: isEnhanced, value: isEnhanced ? '1' : '0' },
    { key: 'INDEX_SERVER_SEMANTIC_MODEL', desc: 'HuggingFace model name', active: false, value: 'Xenova/all-MiniLM-L6-v2' },
    { key: 'INDEX_SERVER_SEMANTIC_DEVICE', desc: 'Compute device', active: false, value: 'cpu' },
    { key: 'INDEX_SERVER_SEMANTIC_CACHE_DIR', desc: 'Downloaded model cache directory', active: false, value: paths.modelCache },
    { key: 'INDEX_SERVER_EMBEDDING_PATH', desc: 'Cached embeddings file', active: false, value: paths.embeddings },
    { key: 'INDEX_SERVER_SEMANTIC_LOCAL_ONLY', desc: 'Block remote model downloads', active: false, value: isEnhanced ? '0' : '1' },
    { section: 'Storage Backend - JSON or SQLite' },
    { key: 'INDEX_SERVER_STORAGE_BACKEND', desc: 'Storage engine', active: isSqlite, value: isSqlite ? 'sqlite' : 'json' },
    { key: 'INDEX_SERVER_SQLITE_PATH', desc: 'SQLite database file path', active: false, value: paths.sqliteDb },
    { key: 'INDEX_SERVER_SQLITE_WAL', desc: 'Enable SQLite WAL mode', active: false, value: '1' },
    { key: 'INDEX_SERVER_SQLITE_MIGRATE_ON_START', desc: 'Auto-migrate JSON to SQLite', active: false, value: '1' },
    { section: 'Logging and diagnostics' },
    { key: 'INDEX_SERVER_LOG_LEVEL', desc: 'Log level', active: true, value: config.logLevel },
    { key: 'INDEX_SERVER_LOG_FILE', desc: 'Enable file logging', active: isEnhanced, value: isEnhanced ? '1' : '0' },
    { key: 'INDEX_SERVER_VERBOSE_LOGGING', desc: 'Verbose stderr output', active: false, value: '0' },
    { key: 'INDEX_SERVER_LOG_JSON', desc: 'JSON-formatted logs', active: false, value: '0' },
    { key: 'INDEX_SERVER_LOG_DIAG', desc: 'Diagnostic startup logging', active: false, value: '0' },
    { key: 'INDEX_SERVER_AUDIT_LOG', desc: 'Audit log path', active: false, value: paths.auditLog },
    { section: 'Backup and recovery' },
    { key: 'INDEX_SERVER_AUTO_BACKUP', desc: 'Enable instruction backups', active: false, value: config.mutation ? '1' : '0' },
    { key: 'INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS', desc: 'Backup interval in ms', active: false, value: '3600000' },
    { key: 'INDEX_SERVER_AUTO_BACKUP_MAX_COUNT', desc: 'Max instruction backups retained', active: false, value: '10' },
    { key: 'INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE', desc: 'Backup before bulk delete', active: false, value: '1' },
    { section: 'Features and flags' },
    { key: 'INDEX_SERVER_FEATURES', desc: 'Comma-separated feature flags', active: isEnhanced, value: isEnhanced ? 'usage' : '' },
    { key: 'INDEX_SERVER_FLAG_TOOLS_EXTENDED', desc: 'Expose extended index mutation tools', active: true, value: '1' },
    { key: 'INDEX_SERVER_SEARCH_OMIT_ZERO_QUERY', desc: 'Omit echoed query metadata on zero-result search responses', active: true, value: '1' },
    { key: 'INDEX_SERVER_METRICS_FILE_STORAGE', desc: 'Persist metrics to disk', active: isEnhanced, value: isEnhanced ? '1' : '0' },
    { key: 'INDEX_SERVER_METRICS_DIR', desc: 'Metrics storage directory', active: false, value: paths.metrics },
    { key: 'INDEX_SERVER_FLAGS_FILE', desc: 'Feature flags JSON file path', active: false, value: paths.flags },
    { section: 'Server and transport' },
    { key: 'INDEX_SERVER_MODE', desc: 'Instance mode', active: false, value: 'standalone' },
    { key: 'INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER', desc: 'Disable stdin handshake hardening', active: false, value: '0' },
    { key: 'INDEX_SERVER_DISABLE_PPID_WATCHDOG', desc: 'Disable parent-process watchdog (dev sandbox launchers)', active: false, value: '0' },
    { key: 'INDEX_SERVER_IDLE_KEEPALIVE_MS', desc: 'Keepalive interval in ms', active: false, value: '30000' },
    { key: 'INDEX_SERVER_POLL_MS', desc: 'Index filesystem poll interval', active: false, value: '10000' },
    { section: 'Advanced tuning' },
    { key: 'INDEX_SERVER_BODY_WARN_LENGTH', desc: 'Instruction body warning length', active: false, value: '50000' },
    { key: 'INDEX_SERVER_AUTO_SPLIT_OVERSIZED', desc: 'Auto-split oversized entries', active: false, value: '0' },
    { key: 'INDEX_SERVER_READ_RETRIES', desc: 'File read retry attempts', active: false, value: '3' },
    { key: 'INDEX_SERVER_MAX_BULK_DELETE', desc: 'Max bulk delete entries', active: false, value: '5' },
    { key: 'INDEX_SERVER_FEEDBACK_MAX_ENTRIES', desc: 'Max feedback entries', active: false, value: '1000' },
    { key: 'INDEX_SERVER_MESSAGING_MAX', desc: 'Max messages in queue', active: false, value: '10000' },
    { key: 'INDEX_SERVER_MAX_CONNECTIONS', desc: 'Max dashboard connections', active: false, value: '100' },
    { key: 'INDEX_SERVER_CACHE_MODE', desc: 'Index cache mode', active: false, value: 'normal' },
    { key: 'INDEX_SERVER_WORKSPACE', desc: 'Workspace identifier', active: false, value: '' },
    { key: 'INDEX_SERVER_AGENT_ID', desc: 'Agent identifier', active: false, value: '' },
  ];
  const seen = new Set(entries.flatMap(entry => 'key' in entry ? [entry.key] : []));
  for (const flag of DOCUMENTED_INDEX_SERVER_FLAGS) {
    if (!seen.has(flag)) entries.push({ key: flag, desc: 'Documented runtime configuration flag', active: false, value: '' });
  }
  return entries.map((entry): McpEnvCatalogEntry => {
    if ('section' in entry) return entry;
    const value = String(entry.value);
    const variable: McpEnvCatalogVariable = {
      ...entry,
      value,
      defaultByProfile: {
        default: value,
        enhanced: value,
        experimental: value,
      },
      mcpEnvVisibility: entry.active ? 'always' : 'when-set',
      validate: 'string',
    };
    return variable;
  });
}

export function activeEnvFromCatalog(catalog: McpEnvCatalogEntry[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of catalog) {
    if ('key' in entry && entry.active) env[entry.key] = entry.value;
  }
  return env;
}
