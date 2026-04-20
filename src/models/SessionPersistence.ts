/**
 * Session Persistence Schema Design
 *
 * Persistent storage design for admin sessions, websocket connections, and session history
 * with deduplication, atomic writes, and backup integration.
 */

export interface PersistedAdminSession {
  id: string;
  userId: string;
  startTime: string; // ISO string for JSON serialization
  lastActivity: string; // ISO string
  ipAddress: string;
  userAgent: string;
  permissions: string[];
  // Added for persistence
  persistedAt: string; // When this session was last persisted
  version: number; // For schema versioning
}

export interface PersistedWebSocketConnection {
  id: string;
  clientId: string;
  connectedAt: string; // ISO string
  lastActivity: string; // ISO string
  ipAddress?: string;
  userAgent?: string;
  isActive: boolean;
  // Connection lifecycle
  disconnectedAt?: string; // ISO string
  disconnectReason?: string;
  // Added for persistence
  persistedAt: string;
  version: number;
}

export interface PersistedSessionHistoryEntry {
  id: string;
  userId: string;
  startTime: string; // ISO string
  endTime?: string; // ISO string
  ipAddress: string;
  userAgent: string;
  terminated?: boolean;
  terminationReason?: string;
  // Added for persistence
  persistedAt: string;
  version: number;
}

export interface SessionPersistenceMetadata {
  lastPersisted: string; // ISO string
  version: number;
  totalSessions: number;
  totalConnections: number;
  totalHistoryEntries: number;
  // Deduplication tracking
  checksums: {
    sessions: string; // Hash of all session IDs
    connections: string; // Hash of all connection IDs
    history: string; // Hash of all history entry IDs
  };
}

export interface SessionPersistenceManifest {
  metadata: SessionPersistenceMetadata;
  files: {
    adminSessions: string; // Relative path to admin sessions file
    webSocketConnections: string; // Relative path to websocket connections file
    sessionHistory: string; // Relative path to session history file
  };
  retention: {
    maxHistoryEntries: number;
    maxHistoryDays: number;
    maxConnectionHistoryDays: number;
  };
}

export interface SessionPersistenceData {
  adminSessions: PersistedAdminSession[];
  webSocketConnections: PersistedWebSocketConnection[];
  sessionHistory: PersistedSessionHistoryEntry[];
  metadata: SessionPersistenceMetadata;
}

// Configuration interface
export interface SessionPersistenceConfig {
  enabled: boolean;
  persistenceDir: string; // Base directory for persistence files
  backupIntegration: boolean;
  retention: {
    maxHistoryEntries: number; // Default: 1000
    maxHistoryDays: number; // Default: 30
    maxConnectionHistoryDays: number; // Default: 7
  };
  deduplication: {
    enabled: boolean;
    checksumAlgorithm: 'sha256' | 'sha512'; // Default: sha256
  };
  atomicWrites: {
    enabled: boolean;
    tempSuffix: string; // Default: '.tmp'
    backupSuffix: string; // Default: '.bak'
  };
  persistence: {
    intervalMs: number; // How often to persist (default: 30000ms = 30 seconds)
    onShutdown: boolean; // Persist on process shutdown
    onSessionChange: boolean; // Persist immediately on session changes
  };
}

// File naming constants
export const SESSION_PERSISTENCE_FILES = {
  MANIFEST: 'session-manifest.json',
  ADMIN_SESSIONS: 'admin-sessions.json',
  WEBSOCKET_CONNECTIONS: 'websocket-connections.json',
  SESSION_HISTORY: 'session-history.json',
  METADATA: 'session-metadata.json'
} as const;

// Directory structure:
// {persistenceDir}/
//   sessions/
//     session-manifest.json
//     admin-sessions.json
//     websocket-connections.json
//     session-history.json
//     session-metadata.json
//   backups/
//     {timestamp}/
//       session-manifest.json
//       admin-sessions.json
//       websocket-connections.json
//       session-history.json

export const DEFAULT_SESSION_PERSISTENCE_CONFIG: SessionPersistenceConfig = {
  enabled: true,
  persistenceDir: './data/sessions',
  backupIntegration: true,
  retention: {
    maxHistoryEntries: 1000,
    maxHistoryDays: 30,
    maxConnectionHistoryDays: 7
  },
  deduplication: {
    enabled: true,
    checksumAlgorithm: 'sha256'
  },
  atomicWrites: {
    enabled: true,
    tempSuffix: '.tmp',
    backupSuffix: '.bak'
  },
  persistence: {
    intervalMs: 30000, // 30 seconds
    onShutdown: true,
    onSessionChange: true
  }
};

// Environment variable mappings
export const SESSION_PERSISTENCE_ENV_VARS = {
  ENABLED: 'INDEX_SERVER_SESSION_PERSISTENCE_ENABLED',
  PERSISTENCE_DIR: 'INDEX_SERVER_SESSION_PERSISTENCE_DIR',
  BACKUP_INTEGRATION: 'INDEX_SERVER_SESSION_BACKUP_INTEGRATION',
  MAX_HISTORY_ENTRIES: 'INDEX_SERVER_SESSION_MAX_HISTORY_ENTRIES',
  MAX_HISTORY_DAYS: 'INDEX_SERVER_SESSION_MAX_HISTORY_DAYS',
  MAX_CONNECTION_HISTORY_DAYS: 'INDEX_SERVER_SESSION_MAX_CONNECTION_HISTORY_DAYS',
  PERSISTENCE_INTERVAL_MS: 'INDEX_SERVER_SESSION_PERSISTENCE_INTERVAL_MS',
  DEDUPLICATION_ENABLED: 'INDEX_SERVER_SESSION_DEDUPLICATION_ENABLED'
} as const;
