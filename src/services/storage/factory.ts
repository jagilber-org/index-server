/**
 * Storage backend factory.
 *
 * Creates the appropriate IInstructionStore implementation based on config.
 * Default: JsonFileStore (json). Experimental: SqliteStore (sqlite).
 */

import { getRuntimeConfig } from '../../config/runtimeConfig.js';
import { JsonFileStore } from './jsonFileStore.js';
import { SqliteStore } from './sqliteStore.js';
import type { IInstructionStore } from './types.js';

export type StorageBackend = 'json' | 'sqlite';

/**
 * Create a storage backend instance.
 *
 * @param backend - Override backend type (default: from config).
 * @param dir - Override instruction directory (default: from config).
 * @param sqlitePath - Override SQLite DB path (default: from config).
 * @returns An IInstructionStore implementation.
 */
export function createStore(backend?: StorageBackend, dir?: string, sqlitePath?: string): IInstructionStore {
  const config = getRuntimeConfig();
  const resolvedBackend = backend ?? (config.storage?.backend as StorageBackend) ?? 'json';
  const resolvedDir = dir ?? config.index?.baseDir;

  switch (resolvedBackend) {
    case 'sqlite': {
      console.warn('[storage] ⚠️  EXPERIMENTAL: SQLite backend is enabled. This feature has limited testing and may have data-loss or compatibility issues. Not recommended for production use.');
      const dbPath = sqlitePath ?? config.storage?.sqlitePath ?? 'data/index.db';
      return new SqliteStore(dbPath);
    }

    case 'json':
    default:
      return new JsonFileStore(resolvedDir);
  }
}
