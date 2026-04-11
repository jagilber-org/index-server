/**
 * Storage — Instruction storage abstraction layer.
 *
 * Exports the IInstructionStore interface and backend implementations.
 * Backend selection is controlled by INDEX_SERVER_STORAGE_BACKEND env var.
 */

export type {
  IInstructionStore,
  ListOptions,
  QueryOptions,
  ScopedListOptions,
  SearchOptions,
  SearchResult,
  UsagePersistRecord,
  UsageTrackOptions,
  LoadResult,
} from './types.js';

export { JsonFileStore } from './jsonFileStore.js';
export { SqliteStore } from './sqliteStore.js';
export { createStore } from './factory.js';
export { computeGovernanceHashFromEntries, projectGovernance } from './hashUtils.js';
export type { StorageBackend } from './factory.js';
