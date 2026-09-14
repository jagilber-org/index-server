/**
 * Storage backend factory.
 *
 * Creates the appropriate IInstructionStore implementation based on config.
 * Default: JsonFileStore (json). Experimental: SqliteStore (sqlite).
 */

import { getRuntimeConfig } from '../../config/runtimeConfig.js';
import { JsonFileStore } from './jsonFileStore.js';
import { JsonEmbeddingStore } from './jsonEmbeddingStore.js';
import { SqliteStore } from './sqliteStore.js';
import { logWarn } from '../logger.js';
import type { IInstructionStore, IEmbeddingStore } from './types.js';

export type StorageBackend = 'json' | 'sqlite';

/** Process-scoped flag so the EXPERIMENTAL SQLite warning is emitted once,
 *  not per-store-creation (which floods the events ring on every request). */
let sqliteExperimentalWarned = false;

/** Test-only: reset the warn-once latch. */
export function _resetSqliteExperimentalWarning(): void {
    sqliteExperimentalWarned = false;
}

/**
 * Check that the current Node.js version meets the minimum requirement.
 * Throws a clear error if the version is too old.
 */
export function checkNodeVersion(minVersion: string, feature: string): void {
  const current = process.versions.node;
  const cur = current.split('.').map(Number);
  const min = minVersion.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) > (min[i] ?? 0)) return;
    if ((cur[i] ?? 0) < (min[i] ?? 0)) {
      throw new Error(
        `Node.js ${minVersion}+ required for ${feature} (current: ${current}). ` +
          `Please upgrade Node.js or switch to the JSON storage backend.`,
      );
    }
  }
}

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
      checkNodeVersion('22.5.0', 'SQLite storage backend (node:sqlite)');
      if (!sqliteExperimentalWarned) {
        sqliteExperimentalWarned = true;
        logWarn(
          '[storage] ⚠️  EXPERIMENTAL: SQLite backend is enabled. This feature has limited testing and may have data-loss or compatibility issues. Not recommended for production use.',
        );
      }
      const dbPath = sqlitePath ?? config.storage?.sqlitePath ?? 'data/index.db';
      return new SqliteStore(dbPath);
    }

    case 'json':
    default:
      return new JsonFileStore(resolvedDir);
  }
}

/**
 * Create an embedding store instance.
 *
 * @param backend - Override backend type (default: from config).
 * @param embeddingPath - Override embedding file/db path (default: from config).
 * @returns An IEmbeddingStore implementation.
 */
export function createEmbeddingStore(backend?: StorageBackend, embeddingPath?: string): IEmbeddingStore {
  const config = getRuntimeConfig();
  const resolvedBackend = backend ?? (config.storage?.backend as StorageBackend) ?? 'json';

  switch (resolvedBackend) {
    case 'sqlite': {
      // Check if sqlite-vec is explicitly disabled via config
      if (config.storage?.sqliteVecEnabled === false) {
        const jsonPath = embeddingPath ?? config.semantic?.embeddingPath ?? 'data/embeddings.json';
        return new JsonEmbeddingStore(jsonPath);
      }
      checkNodeVersion('22.13.0', 'sqlite-vec extension (DatabaseSync.loadExtension)');
      // Lazy-load SqliteEmbeddingStore to avoid import errors when sqlite-vec is unavailable
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { SqliteEmbeddingStore } = require('./sqliteEmbeddingStore.js') as { SqliteEmbeddingStore: new (dbPath: string) => IEmbeddingStore };
        const dbPath = embeddingPath ?? (config.storage?.sqliteVecPath || 'data/embeddings.db');
        return new SqliteEmbeddingStore(dbPath);
      } catch (err) {
        logWarn(`[storage] sqlite-vec embedding store failed to initialize: ${err instanceof Error ? err.message : 'unknown'}. Falling back to JSON.`);
        const jsonPath = embeddingPath ?? config.semantic?.embeddingPath ?? 'data/embeddings.json';
        return new JsonEmbeddingStore(jsonPath);
      }
    }

    case 'json':
    default: {
      const jsonPath = embeddingPath ?? config.semantic?.embeddingPath ?? 'data/embeddings.json';
      return new JsonEmbeddingStore(jsonPath);
    }
  }
}

/**
 * Process-scoped embedding store, resolved once from config.
 *
 * WHY THIS EXISTS (issue #572): `getInstructionEmbeddings` takes the store as a
 * parameter, and previously each call site decided for itself which store to
 * use. Two of the three production call sites simply omitted it, so automatic
 * regeneration silently persisted to `data/embeddings.json` no matter what
 * `INDEX_SERVER_STORAGE_BACKEND` said, while the dashboard read
 * `data/embeddings.db` through an independently hardcoded `'sqlite'`. Writer
 * and reader ended up on different files: 284 entries in the JSON store, 78 in
 * the SQLite one, frozen for two weeks. Nothing errored, because both stores
 * worked perfectly — they were just different stores.
 *
 * One resolution point means the backend cannot disagree with itself.
 */
let cachedEmbeddingStore: IEmbeddingStore | null = null;

/**
 * Resolve the embedding store for this process, honouring `storage.backend`
 * (and the sqlite-vec fallbacks already implemented by `createEmbeddingStore`).
 *
 * Every production read and write of embeddings must go through this, so that
 * "which backend am I using" has exactly one answer.
 */
export function getEmbeddingStore(): IEmbeddingStore {
  if (!cachedEmbeddingStore) cachedEmbeddingStore = createEmbeddingStore();
  return cachedEmbeddingStore;
}

/** Test-only: drop the cached store so the next call re-resolves from config. */
export function resetEmbeddingStore(): void {
  cachedEmbeddingStore = null;
}
