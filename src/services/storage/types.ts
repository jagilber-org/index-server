/**
 * IInstructionStore — Storage abstraction for instruction persistence.
 *
 * Implementations:
 * - JsonFileStore: JSON-file-per-instruction (default, current behavior)
 * - SqliteStore: SQLite database (experimental, behind feature flag)
 *
 * IndexContext delegates all storage I/O through this interface.
 * Queries, search, and usage tracking are backend-agnostic.
 */

import { InstructionEntry, ArchiveReason, ArchiveSource } from '../../models/instruction.js';

// ── Query & Filter Types ─────────────────────────────────────────────────────

/** Options for listing instructions with filters. */
export interface ListOptions {
  category?: string;
  contentType?: string;
}

/** Options for complex multi-filter queries. */
export interface QueryOptions {
  text?: string;
  categoriesAny?: string[];
  categoriesAll?: string[];
  excludeCategories?: string[];
  contentType?: string;
  priorityMin?: number;
  priorityMax?: number;
  priorityTiers?: string[];
  requirements?: string[];
  offset?: number;
  limit?: number;
}

/** Options for scoped listing (workspace/user/team). */
export interface ScopedListOptions {
  userId?: string;
  workspaceId?: string;
  teamIds?: string[];
}

/** Options for keyword search. */
export interface SearchOptions {
  keywords: string[];
  includeCategories?: boolean;
  caseSensitive?: boolean;
  limit?: number;
}

/** A single search result with relevance score. */
export interface SearchResult {
  id: string;
  score: number;
}

// ── Usage Types ──────────────────────────────────────────────────────────────

/** Persisted usage record for an instruction. */
export interface UsagePersistRecord {
  usageCount?: number;
  firstSeenTs?: string;
  lastUsedAt?: string;
  lastAction?: string;
  lastSignal?: string;
  lastComment?: string;
}

/** Options for tracking a usage event. */
export interface UsageTrackOptions {
  action?: string;
  signal?: string;
  comment?: string;
}

// ── Load Result ──────────────────────────────────────────────────────────────

/** Result of loading the full instruction set. */
export interface LoadResult {
  entries: InstructionEntry[];
  hash: string;
  errors: { file: string; error: string }[];
  debug?: {
    scanned: number;
    accepted: number;
    skipped: number;
    trace?: { file: string; accepted: boolean; reason?: string }[];
  };
  summary?: {
    scanned: number;
    accepted: number;
    skipped: number;
    reasons: Record<string, number>;
    cacheHits?: number;
    hashHits?: number;
  };
}

// ── Archive Types ────────────────────────────────────────────────────────────

/**
 * Metadata supplied to {@link IInstructionStore.archive} when archiving an
 * instruction. All fields are optional; the store fills sensible defaults
 * (`archivedAt = now`, `restoreEligible = true`) when fields are omitted.
 *
 * @remarks
 * - `archivedBy` identifies the agent/operator that triggered the archive.
 * - `archiveReason` is the closed taxonomy describing *why* the entry was
 *   archived (deprecated, superseded, duplicate-merge, manual, legacy-scope).
 * - `archiveSource` identifies the lifecycle pathway (groom, remove, archive,
 *   import-migration).
 * - `restoreEligible: false` permanently locks the entry out of `restore()`.
 */
export interface ArchiveMeta {
  /** Identifier of the agent / operator that archived this entry. */
  archivedBy?: string;
  /** Closed-enum reason for the archive event. */
  archiveReason?: ArchiveReason;
  /** Which lifecycle pathway produced the archive event. */
  archiveSource?: ArchiveSource;
  /** Whether the entry may be restored. Default `true`. */
  restoreEligible?: boolean;
  /** Override timestamp (ISO 8601). Defaults to current time when omitted. */
  archivedAt?: string;
}

/**
 * Options for listing archived entries.
 * Filters are AND-combined; omitted filters do not constrain the result.
 */
export interface ListArchivedOpts {
  /** Filter by archive reason. */
  reason?: ArchiveReason;
  /** Filter by archive source. */
  source?: ArchiveSource;
  /** Filter by archiver identity. */
  archivedBy?: string;
  /** Filter by restore eligibility flag. */
  restoreEligible?: boolean;
  /** Maximum results to return. */
  limit?: number;
  /** Pagination offset. */
  offset?: number;
}

/**
 * Restore conflict-resolution mode.
 * - `reject` (default): throw when an active entry with the same id exists.
 * - `overwrite`: replace the active entry with the archived payload.
 */
export type RestoreMode = 'reject' | 'overwrite';

// ── Storage Interface ────────────────────────────────────────────────────────

/**
 * Storage backend interface for the instruction index.
 *
 * All methods are synchronous unless otherwise noted (matching current
 * IndexContext behavior). Async methods are marked with Promise return types.
 *
 * @remarks
 * Implementations must ensure:
 * - `load()` is idempotent and safe to call multiple times
 * - `write()` is atomic (entry is fully written or not at all)
 * - `remove()` tolerates missing IDs (no-op, no throw)
 * - `computeHash()` returns identical hashes for identical entry sets
 * - `get()` returns null for missing IDs (no throw)
 */
export interface IInstructionStore {
  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Load all instructions from the backing store.
   * @returns Load result with entries, hash, and diagnostics.
   */
  load(): LoadResult;

  /**
   * Close the store and release resources (e.g., DB connections).
   * No-op for file-based stores.
   */
  close(): void;

  // ── CRUD ─────────────────────────────────────────────────────────────

  /**
   * Get a single instruction by ID.
   * @param id - Instruction ID.
   * @returns The entry, or null if not found.
   */
  get(id: string): InstructionEntry | null;

  /**
   * Write (create or update) an instruction.
   * @param entry - The instruction to persist.
   */
  write(entry: InstructionEntry, opts?: { createOnly?: boolean }): void;

  /**
   * Remove an instruction by ID. No-op if not found.
   * @param id - Instruction ID to remove.
   */
  remove(id: string): void;

  // ── Queries ──────────────────────────────────────────────────────────

  /**
   * List instructions with optional category/contentType filter.
   * @param opts - Filter options.
   * @returns Array of matching entries.
   */
  list(opts?: ListOptions): InstructionEntry[];

  /**
   * Complex multi-filter query with pagination.
   * @param opts - Query options.
   * @returns Array of matching entries (paginated).
   */
  query(opts: QueryOptions): InstructionEntry[];

  /**
   * List instructions scoped to a user, workspace, or team.
   * @param opts - Scoping options.
   * @returns Array of matching entries.
   */
  listScoped(opts: ScopedListOptions): InstructionEntry[];

  /**
   * Search instructions by keywords with relevance scoring.
   * @param opts - Search options with keywords.
   * @returns Array of { id, score } sorted by relevance descending.
   */
  search(opts: SearchOptions): SearchResult[];

  /**
   * Get all unique categories with occurrence counts.
   * @returns Map of category name → count.
   */
  categories(): Map<string, number>;

  // ── Integrity ────────────────────────────────────────────────────────

  /**
   * Compute deterministic governance hash over all entries.
   * Must return identical hash for identical entry sets regardless of backend.
   * @returns SHA256 hex string.
   */
  computeHash(): string;

  /**
   * Get the count of loaded instructions.
   */
  count(): number;

  // ── Archive Lifecycle ────────────────────────────────────────────────

  /**
   * Move an active entry to the archive store. Atomic: the entry must vanish
   * from active storage and appear in archive storage in the same operation,
   * or neither.
   *
   * @param id - Active instruction id to archive.
   * @param meta - Archive metadata (reason, source, archivedBy, etc.).
   * @returns The archived entry (with archive metadata populated).
   * @throws If no active entry exists with the given id.
   * @throws If the archive write fails (active entry is left intact).
   */
  archive(id: string, meta?: ArchiveMeta): InstructionEntry;

  /**
   * Move an archived entry back to active storage. Atomic.
   *
   * @param id - Archived instruction id to restore.
   * @param mode - Collision behaviour when an active entry with the same id
   *   already exists. Defaults to `'reject'`.
   * @returns The restored active entry (archive metadata cleared).
   * @throws If no archived entry exists with the given id.
   * @throws If `restoreEligible === false` on the archived entry.
   * @throws If an active entry with the same id already exists and
   *   `mode !== 'overwrite'`.
   */
  restore(id: string, mode?: RestoreMode): InstructionEntry;

  /**
   * Permanently delete an archived entry. Irreversible.
   * No-op if the id is not present in the archive store.
   *
   * @param id - Archived instruction id to purge.
   */
  purge(id: string): void;

  /**
   * Get a single archived entry by id.
   *
   * @param id - Archived instruction id.
   * @returns The entry, or `null` if not found in the archive store.
   */
  getArchived(id: string): InstructionEntry | null;

  /**
   * List archived entries with optional filters.
   *
   * @param opts - Filter / pagination options.
   * @returns Array of matching archived entries.
   */
  listArchived(opts?: ListArchivedOpts): InstructionEntry[];

  /**
   * Count entries in the archive store.
   *
   * @returns Number of archived entries.
   */
  countArchived(): number;

  /**
   * Compute deterministic hash over the archive set.
   * Must match across backends for the same archive content (same projection
   * ordering as {@link computeHash}).
   *
   * @returns SHA256 hex string.
   */
  computeArchiveHash(): string;
}

// ── Embedding Store Interface ────────────────────────────────────────────────

/**
 * Persisted embedding cache format (backwards-compatible: entryHashes is optional).
 */
export interface EmbeddingCacheData {
  indexHash: string;
  modelName?: string;
  /** Per-entry content hashes for incremental invalidation (required for v2+). */
  entryHashes?: Record<string, string>;
  embeddings: Record<string, number[]>;
}

/** A single embedding search result with distance score. */
export interface EmbeddingSearchResult {
  id: string;
  distance: number;
}

/**
 * Storage backend interface for embedding vectors.
 *
 * Implementations:
 * - JsonEmbeddingStore: Flat JSON file (default, current behavior)
 * - SqliteEmbeddingStore: sqlite-vec vec0 virtual table
 */
export interface IEmbeddingStore {
  /**
   * Load cached embedding data from the backing store.
   * @returns The cached data, or null if no data exists.
   */
  load(): EmbeddingCacheData | null;

  /**
   * Save embedding data to the backing store.
   * @param data - The embedding cache data to persist.
   */
  save(data: EmbeddingCacheData): void;

  /**
   * Search for the nearest vectors to a query vector (KNN).
   * @param queryVector - The query embedding vector.
   * @param limit - Maximum number of results to return.
   * @returns Array of { id, distance } sorted by distance ascending.
   */
  search(queryVector: Float32Array, limit: number): EmbeddingSearchResult[];

  /**
   * Evict the cached vector and source hash for a single instruction id.
   * Used when an entry is archived or permanently purged so its embedding
   * does not surface in semantic search results. No-op if the id is not
   * present in the cache.
   *
   * @param id - Instruction id to evict.
   */
  evict(id: string): void;

  /**
   * Mark a single id stale so the next embedding refresh recomputes it.
   * Clears only the per-entry `entryHashes[id]` mapping; the cached vector
   * remains intact. No-op if the id is not present.
   *
   * @param id - Instruction id to mark stale.
   */
  markStale(id: string): void;

  /**
   * Close the store and release resources.
   */
  close(): void;
}
