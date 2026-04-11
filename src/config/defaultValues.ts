/**
 * Centralized default values for timeouts, limits, thresholds, and other
 * numeric constants used across configuration modules.
 * Import from here instead of hardcoding magic numbers.
 */

// ── Timeouts (milliseconds) ──────────────────────────────────────────
export const DEFAULT_TIMEOUTS_MS = {
  FATAL_EXIT_DELAY: 15,
  IDLE_KEEPALIVE: 30000,
  REQUEST_TIMEOUT: 30000,
  HEARTBEAT: 5000,
  STALE_THRESHOLD: 15000,
  POLL_INTERVAL: 10000,
  TOOLCALL_FLUSH: 5000,
  TOOLCALL_COMPACT: 300000,
  HEALTH_MIN_UPTIME: 1000,
  MESSAGING_SWEEP: 60000,
  AUTO_BACKUP_INTERVAL: 3600000,
  SESSION_PERSISTENCE_INTERVAL: 30000,
  AUTO_REFRESH: 300000,
} as const;

// ── Limits ───────────────────────────────────────────────────────────
export const DEFAULT_LIMITS = {
  MAX_CONNECTIONS: 100,
  MAX_PORT_TRIES: 10,
  MAX_BULK_DELETE: 5,
  MAX_FEEDBACK_ENTRIES: 1000,
  MAX_MESSAGES: 10000,
  MAX_SESSION_HISTORY: 200,
  BODY_MAX_LENGTH: 20000,
  BODY_MIN_LENGTH: 1000,
  BODY_ABS_MAX_LENGTH: 1000000,
  AUTO_BACKUP_MAX_COUNT: 10,
  TOOLCALL_CHUNK_SIZE: 250,
  LIST_CONCURRENCY: 8,
  LIST_MAX_DURATION_MS: 7000,
  ATOMIC_WRITE_RETRIES: 5,
  ATOMIC_WRITE_BACKOFF_MS: 10,
  READ_RETRIES: 3,
  READ_BACKOFF_MS: 8,
} as const;

// ── Resource / health thresholds ─────────────────────────────────────
export const DEFAULT_THRESHOLDS = {
  MEMORY_THRESHOLD: 0.95,
  ERROR_RATE_THRESHOLD: 10,
  RESOURCE_CAPACITY: 720,
  RESOURCE_SAMPLE_INTERVAL_MS: 5000,
} as const;

// ── Network ──────────────────────────────────────────────────────────
export const DEFAULT_PORTS = {
  DASHBOARD: 8787,
  LEADER: 9090,
  BOOTSTRAP_TOKEN_TTL_SEC: 900,
} as const;

// ── Governance ───────────────────────────────────────────────────────
export const DEFAULT_GOVERNANCE = {
  HASH_CANON_VARIANTS: 1,
  HASH_CANON_VARIANTS_MAX: 8,
  HASH_IMPORT_SET_SIZE: 2,
  HASH_IMPORT_SET_SIZE_MAX: 5,
  USAGE_FLUSH_MS: 75,
} as const;

// ── Semantic search ──────────────────────────────────────────────────
export const DEFAULT_SEMANTIC = {
  MODEL: 'Xenova/all-MiniLM-L6-v2',
  DEVICE: 'cpu' as const,
} as const;
