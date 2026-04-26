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

import { InstructionEntry } from '../../models/instruction.js';

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
   * Close the store and release resources.
   */
  close(): void;
}
