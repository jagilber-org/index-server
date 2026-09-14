/**
 * Dashboard domain config: HTTP server, TLS, WebSocket, and session persistence settings.
 */
import path from 'path';
import { getBooleanEnv, parseBooleanEnv } from '../utils/envUtils';
import { DEFAULT_SESSION_PERSISTENCE_CONFIG, SESSION_PERSISTENCE_ENV_VARS } from '../models/SessionPersistence.js';
import { toAbsolute, toStateAbsolute, numberFromEnv, stringFromEnv } from './configUtils';
import { DIR } from './dirConstants';
import { resolveStateDir } from './serviceEnv';
import { DEFAULT_TIMEOUTS_MS, DEFAULT_LIMITS, DEFAULT_PORTS } from './defaultValues';

function isDevMode(): boolean {
  return process.env.NODE_ENV === 'development' || process.argv.some(a => a === '--watch' || a.includes('--watch'));
}

interface DashboardTlsConfig {
  enabled: boolean;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
}

interface DashboardHttpConfig {
  enable: boolean;
  port: number;
  host: string;
  maxPortTries: number;
  enableHttpMetrics: boolean;
  requestTimeoutMs: number;
  maxConnections: number;
  verboseLogging: boolean;
  mutationEnabled: boolean;
  adminApiKey?: string;
  /**
   * Dashboard HTTP API rate limit, in requests per minute.
   *
   * - `0` (default) disables rate limiting entirely (HTTP API + usage tracking).
   * - Any positive integer N enforces N requests/min globally with a fixed
   *   60-second window. Bulk import/export/backup/restore routes are
   *   unconditionally exempt regardless of this value.
   *
   * Configured via the `INDEX_SERVER_RATE_LIMIT` environment variable.
   */
  rateLimitPerMinute: number;
  tls: DashboardTlsConfig;
}

interface DashboardAdminConfig {
  maxSessionHistory: number;
  backupsDir: string;
  instructionsDir: string;
  stateDir: string;
}

interface DashboardSessionPersistenceConfig {
  enabled: boolean;
  persistenceDir: string;
  backupIntegration: boolean;
  retention: {
    maxHistoryEntries: number;
    maxHistoryDays: number;
    maxConnectionHistoryDays: number;
  };
  persistenceIntervalMs: number;
  deduplicationEnabled: boolean;
}

export interface DashboardConfig {
  http: DashboardHttpConfig;
  admin: DashboardAdminConfig;
  sessionPersistence: DashboardSessionPersistenceConfig;
  graphEnabled: boolean;
}

export function parseDashboardConfig(mutationEnabled: boolean, instructionsBaseDir: string): DashboardConfig {
  const persistenceDefaults = DEFAULT_SESSION_PERSISTENCE_CONFIG;
  const persistenceEnv = SESSION_PERSISTENCE_ENV_VARS;
  const persistenceEnabled = parseBooleanEnv(process.env[persistenceEnv.ENABLED], persistenceDefaults.enabled);
  const persistenceDir = toStateAbsolute(process.env[persistenceEnv.PERSISTENCE_DIR], persistenceDefaults.persistenceDir);
  const persistenceInterval = numberFromEnv(persistenceEnv.PERSISTENCE_INTERVAL_MS, persistenceDefaults.persistence.intervalMs);
  // Backup target, in precedence order:
  //
  //   1. INDEX_SERVER_BACKUPS_DIR           — explicit operator choice
  //   2. <INDEX_SERVER_DIR>/../backups      — sibling of the CONFIGURED catalog
  //   3. <STATE_ROOT>/backups               — no catalog configured
  //
  // Rule 2 is deliberate and stays: a backup should sit next to the thing it
  // backs up, which is what `getAutoBackupSourceMismatch()` exists to police.
  // When the operator has named a catalog, that relationship is meaningful.
  //
  // Rule 3 is the #577 fix. Previously rule 2 applied unconditionally, and with
  // INDEX_SERVER_DIR unset the "source" is itself only a cwd fallback
  // (`<cwd>/instructions`) — so the sibling resolved to `<cwd>/backups`, and
  // auto-backup wrote a rotating, hourly, ten-deep copy of the whole catalog
  // into whatever directory the MCP client happened to be launched from. One
  // private copy per client project folder, none of them the one the dashboard
  // reads. There is no meaningful source to follow in that case, so it anchors
  // to STATE_ROOT like every other artifact in #577's table. This artifact is
  // absent from that issue's own list, which is how it survived the change.
  //
  // A RELATIVE INDEX_SERVER_BACKUPS_DIR resolves against STATE_ROOT rather than
  // cwd, matching the other state paths — a relative value anchored to cwd is
  // the same defect wearing an override.
  const catalogConfigured = !!process.env.INDEX_SERVER_DIR?.trim();
  const backupsDir = toStateAbsolute(
    process.env.INDEX_SERVER_BACKUPS_DIR,
    catalogConfigured ? path.resolve(instructionsBaseDir, '..', DIR.BACKUPS) : DIR.BACKUPS,
  );
  // Shared with the thin client, which reads the lock file this directory holds
  // (#611). One definition so the writer and the reader cannot drift apart.
  const stateDir = resolveStateDir();
  return {
    http: {
      enable: getBooleanEnv('INDEX_SERVER_DASHBOARD'),
      port: numberFromEnv('INDEX_SERVER_DASHBOARD_PORT', isDevMode() ? DEFAULT_PORTS.DASHBOARD_DEV : DEFAULT_PORTS.DASHBOARD),
      host: stringFromEnv('INDEX_SERVER_DASHBOARD_HOST', '127.0.0.1'),
      maxPortTries: Math.max(1, numberFromEnv('INDEX_SERVER_DASHBOARD_TRIES', DEFAULT_LIMITS.MAX_PORT_TRIES)),
      enableHttpMetrics: getBooleanEnv('INDEX_SERVER_HTTP_METRICS', true),
      requestTimeoutMs: numberFromEnv('INDEX_SERVER_REQUEST_TIMEOUT', DEFAULT_TIMEOUTS_MS.REQUEST_TIMEOUT),
      maxConnections: numberFromEnv('INDEX_SERVER_MAX_CONNECTIONS', DEFAULT_LIMITS.MAX_CONNECTIONS),
      verboseLogging: getBooleanEnv('INDEX_SERVER_VERBOSE_LOGGING'),
      mutationEnabled,
      adminApiKey: process.env.INDEX_SERVER_ADMIN_API_KEY || undefined,
      rateLimitPerMinute: Math.max(0, numberFromEnv('INDEX_SERVER_RATE_LIMIT', 0)),
      tls: {
        enabled: getBooleanEnv('INDEX_SERVER_DASHBOARD_TLS'),
        certPath: process.env.INDEX_SERVER_DASHBOARD_TLS_CERT || undefined,
        keyPath: process.env.INDEX_SERVER_DASHBOARD_TLS_KEY || undefined,
        caPath: process.env.INDEX_SERVER_DASHBOARD_TLS_CA || undefined,
      },
    },
    admin: {
      maxSessionHistory: numberFromEnv('INDEX_SERVER_ADMIN_MAX_SESSION_HISTORY', DEFAULT_LIMITS.MAX_SESSION_HISTORY),
      backupsDir,
      instructionsDir: instructionsBaseDir,
      stateDir,
    },
    sessionPersistence: {
      enabled: persistenceEnabled,
      persistenceDir,
      backupIntegration: parseBooleanEnv(process.env[persistenceEnv.BACKUP_INTEGRATION], persistenceDefaults.backupIntegration),
      retention: {
        maxHistoryEntries: numberFromEnv(persistenceEnv.MAX_HISTORY_ENTRIES, persistenceDefaults.retention.maxHistoryEntries),
        maxHistoryDays: numberFromEnv(persistenceEnv.MAX_HISTORY_DAYS, persistenceDefaults.retention.maxHistoryDays),
        maxConnectionHistoryDays: numberFromEnv(persistenceEnv.MAX_CONNECTION_HISTORY_DAYS, persistenceDefaults.retention.maxConnectionHistoryDays),
      },
      persistenceIntervalMs: persistenceInterval,
      deduplicationEnabled: parseBooleanEnv(process.env[persistenceEnv.DEDUPLICATION_ENABLED], persistenceDefaults.deduplication.enabled),
    },
    graphEnabled: getBooleanEnv('INDEX_SERVER_DASHBOARD_GRAPH'),
  };
}
