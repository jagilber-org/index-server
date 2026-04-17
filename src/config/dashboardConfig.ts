/**
 * Dashboard domain config: HTTP server, TLS, WebSocket, and session persistence settings.
 */
import path from 'path';
import { getBooleanEnv, parseBooleanEnv } from '../utils/envUtils';
import { DEFAULT_SESSION_PERSISTENCE_CONFIG, SESSION_PERSISTENCE_ENV_VARS } from '../models/SessionPersistence.js';
import { CWD, toAbsolute, numberFromEnv, stringFromEnv } from './configUtils';
import { DIR } from './dirConstants';
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
  rateLimitEnabled: boolean;
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
  const persistenceDir = toAbsolute(process.env[persistenceEnv.PERSISTENCE_DIR], persistenceDefaults.persistenceDir);
  const persistenceInterval = numberFromEnv(persistenceEnv.PERSISTENCE_INTERVAL_MS, persistenceDefaults.persistence.intervalMs);
  const backupsDir = toAbsolute(process.env.INDEX_SERVER_BACKUPS_DIR, path.join(CWD, DIR.BACKUPS));
  const stateDir = toAbsolute(process.env.INDEX_SERVER_STATE_DIR, path.join(CWD, DIR.DATA_STATE));
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
      rateLimitEnabled: getBooleanEnv('INDEX_SERVER_RATE_LIMIT_ENABLED'),
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
