/**
 * Usage persistence adapter — routes usage counter I/O to the active backend.
 *
 * Historically the usage subsystem always persisted to `data/usage-snapshot.json`
 * regardless of `storage.backend`. That made the snapshot file the authoritative
 * counter store even when instructions lived in SQLite, which is why migrating
 * JSON → SQLite silently lost every counter: the migration copied instructions
 * but nothing ever moved the snapshot.
 *
 * This module keeps the record *shape* identical (UsageSnapshotRecord) and swaps
 * only the sink/source:
 *   - backend 'json'   → data/usage-snapshot.json  (unchanged behaviour)
 *   - backend 'sqlite' → the `usage` table in the instruction DB
 *
 * All the invariant-repair, monotonic-authority and rate-limiting logic in
 * indexUsage.ts is untouched and continues to operate on the same in-memory
 * records.
 */

import { getRuntimeConfig } from '../config/runtimeConfig.js';
import { logWarn } from './logger.js';
import {
  resolveUsageSnapshotPath,
  readUsageSnapshotFile,
  writeUsageSnapshotFile,
  type UsageSnapshotRecord,
} from './storage/usageSnapshotFile.js';
import { SqliteUsageStore } from './storage/sqliteUsageStore.js';

export type { UsageSnapshotRecord };

/** Resolve the active storage backend, defaulting to 'json'. */
function activeBackend(): 'json' | 'sqlite' {
  try {
    return (getRuntimeConfig().storage?.backend as 'json' | 'sqlite') ?? 'json';
  } catch {
    return 'json';
  }
}

/** Resolve the instruction DB path used for the `usage` table. */
function sqliteDbPath(): string {
  try {
    return getRuntimeConfig().storage?.sqlitePath ?? 'data/index.db';
  } catch {
    return 'data/index.db';
  }
}

// A single long-lived connection per DB path — flushes are frequent, and
// reopening DatabaseSync on every flush would thrash WAL and file handles.
let cachedStore: SqliteUsageStore | null = null;
let cachedPath: string | null = null;

function getSqliteUsageStore(): SqliteUsageStore | null {
  const dbPath = sqliteDbPath();
  if (cachedStore && cachedPath === dbPath) return cachedStore;
  try {
    closeUsagePersistence();
    cachedStore = new SqliteUsageStore(dbPath);
    cachedPath = dbPath;
    return cachedStore;
  } catch (err) {
    logWarn(`[usage] SQLite usage store unavailable (${err instanceof Error ? err.message : 'unknown'}); falling back to the JSON snapshot.`);
    cachedStore = null;
    cachedPath = null;
    return null;
  }
}

/** Close any cached usage DB handle. Safe to call repeatedly. */
export function closeUsagePersistence(): void {
  if (cachedStore) {
    try { cachedStore.close(); } catch { /* already closed */ }
  }
  cachedStore = null;
  cachedPath = null;
}

/**
 * Read all persisted usage records from the active backend.
 *
 * Falls back to the JSON snapshot when the SQLite store cannot be opened, so a
 * misconfigured DB path degrades to the previous behaviour rather than silently
 * reporting zero usage.
 */
export function readPersistedUsage(): Record<string, UsageSnapshotRecord> {
  if (activeBackend() === 'sqlite') {
    const store = getSqliteUsageStore();
    if (store) {
      try {
        return store.readAll();
      } catch (err) {
        logWarn(`[usage] SQLite usage read failed (${err instanceof Error ? err.message : 'unknown'}); falling back to the JSON snapshot.`);
      }
    }
  }
  return readUsageSnapshotFile(resolveUsageSnapshotPath());
}

/** Write all usage records to the active backend. */
export function writePersistedUsage(data: Record<string, UsageSnapshotRecord>): void {
  if (activeBackend() === 'sqlite') {
    const store = getSqliteUsageStore();
    if (store) {
      try {
        store.writeAll(data);
        return;
      } catch (err) {
        logWarn(`[usage] SQLite usage write failed (${err instanceof Error ? err.message : 'unknown'}); falling back to the JSON snapshot.`);
      }
    }
  }
  writeUsageSnapshotFile(resolveUsageSnapshotPath(), data);
}
