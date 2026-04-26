/**
 * SqliteEmbeddingStore — IEmbeddingStore backed by sqlite-vec (vec0 virtual table).
 *
 * Uses node:sqlite (DatabaseSync) with sqlite-vec extension for KNN vector search.
 * Vectors stored as BLOB (Float32Array buffer), metadata in a companion table.
 *
 * Requires: Node.js ≥22.13.0, sqlite-vec npm package.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { getLoadablePath } from 'sqlite-vec';
import type { IEmbeddingStore, EmbeddingCacheData, EmbeddingSearchResult } from './types.js';
import { logWarn, logInfo } from '../logger.js';

const DEFAULT_VECTOR_DIMS = 384;
const MAX_VECTOR_DIMS = 65536;

const EMBEDDING_META_DDL = `CREATE TABLE IF NOT EXISTS embedding_meta (
  instruction_id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  index_hash TEXT NOT NULL,
  computed_at TEXT NOT NULL
)`;

/** Cache metadata stored in the SQLite metadata table. */
const META_INDEX_HASH_KEY = 'embedding_index_hash';
const META_MODEL_NAME_KEY = 'embedding_model_name';

export class SqliteEmbeddingStore implements IEmbeddingStore {
  private db: DatabaseSync;
  private readonly dims: number;
  private readonly dbPath: string;

  constructor(dbPath: string, dims: number = DEFAULT_VECTOR_DIMS) {
    if (!Number.isInteger(dims) || dims < 1 || dims > MAX_VECTOR_DIMS) {
      throw new Error(
        `Invalid vector dimensions: ${dims}. Must be an integer between 1 and ${MAX_VECTOR_DIMS}.`,
      );
    }
    this.dims = dims;
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath, { allowExtension: true } as Record<string, unknown>);
    this.initExtension();
    if (!this.verifyIntegrity()) {
      this.rebuildDatabase();
    }
    this.initSchema();
  }

  private initExtension(): void {
    const extPath = getLoadablePath();
    // Security: validate the extension path resolves within node_modules
    const resolved = path.resolve(extPath);
    const nmDir = path.resolve(__dirname, '..', '..', '..', 'node_modules');
    if (!resolved.startsWith(nmDir + path.sep) && !resolved.startsWith(nmDir + '/')) {
      throw new Error(`sqlite-vec extension path escapes node_modules: ${resolved}`);
    }
    (this.db as unknown as { loadExtension(path: string): void }).loadExtension(extPath);
  }

  /**
   * Run PRAGMA integrity_check to detect database corruption.
   * @returns true if the database is intact, false if corrupt.
   */
  private verifyIntegrity(): boolean {
    try {
      const result = this.db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      if (result.length === 1 && result[0].integrity_check === 'ok') return true;
      const issues = result.map(r => r.integrity_check).join('; ');
      logWarn(`[embedding-store] Integrity check failed: ${issues}`);
      return false;
    } catch (err) {
      logWarn(`[embedding-store] Integrity check error: ${err instanceof Error ? err.message : 'unknown'}`);
      return false;
    }
  }

  /**
   * Rebuild a corrupt database by closing, deleting, and recreating it.
   */
  private rebuildDatabase(): void {
    logWarn(`[embedding-store] Rebuilding corrupt database: ${this.dbPath}`);
    try { this.db.close(); } catch { /* may already be unusable */ }
    // Remove the corrupt DB and WAL/SHM files
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(this.dbPath + suffix); } catch { /* file may not exist */ }
    }
    this.db = new DatabaseSync(this.dbPath, { allowExtension: true } as Record<string, unknown>);
    this.initExtension();
    logInfo(`[embedding-store] Database rebuilt successfully`);
  }

  private initSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');

    // Ensure metadata table exists (may already exist from SqliteStore)
    this.db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)');

    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
      instruction_id TEXT PRIMARY KEY,
      embedding float[${this.dims}]
    )`);
    this.db.exec(EMBEDDING_META_DDL);
  }

  load(): EmbeddingCacheData | null {
    // Read cache metadata
    const hashRow = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(META_INDEX_HASH_KEY) as { value: string } | undefined;
    const modelRow = this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(META_MODEL_NAME_KEY) as { value: string } | undefined;

    if (!hashRow) return null;

    // Read all embeddings
    const rows = this.db.prepare('SELECT instruction_id, embedding FROM embeddings').all() as Array<{
      instruction_id: string;
      embedding: Buffer;
    }>;

    if (rows.length === 0) {
      // CodeQL flagged the original `&& !hashRow` as dead code (already
      // null-guarded at L115). We cannot upgrade to `if (rows.length === 0) return null`
      // because the public contract (see embeddingStore.contract.spec.ts
      // "save() with empty embeddings map succeeds") requires a non-null cache
      // when hashRow exists but no embeddings have been persisted. Fall through
      // to return { indexHash, entryHashes, embeddings: {} } so subsequent saves
      // can layer onto the same metadata.
    }

    const embeddings: Record<string, number[]> = {};
    for (const row of rows) {
      // Validate buffer bounds before creating Float32Array view
      const expectedBytes = this.dims * 4;
      if (row.embedding.byteLength !== expectedBytes) {
        logWarn(
          `[embedding-store] Skipping entry '${row.instruction_id}': buffer size ${row.embedding.byteLength} bytes, expected ${expectedBytes} (${this.dims} dims × 4 bytes)`,
        );
        continue;
      }
      embeddings[row.instruction_id] = Array.from(new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        this.dims,
      ));
    }

    // Read entry hashes from embedding_meta
    const metaRows = this.db.prepare('SELECT instruction_id, source_hash FROM embedding_meta').all() as Array<{
      instruction_id: string;
      source_hash: string;
    }>;
    const entryHashes: Record<string, string> = {};
    for (const m of metaRows) {
      entryHashes[m.instruction_id] = m.source_hash;
    }

    return {
      indexHash: hashRow.value,
      modelName: modelRow?.value,
      entryHashes,
      embeddings,
    };
  }

  save(data: EmbeddingCacheData): void {
    // TODO: Replace full-table clear+reinsert with incremental upsert for large datasets.
    // Use a diff of entryHashes to INSERT OR REPLACE only changed entries and DELETE removed ones.

    // Use a transaction for atomicity
    const tx = this.db.prepare('BEGIN');
    const commit = this.db.prepare('COMMIT');
    const rollback = this.db.prepare('ROLLBACK');

    try {
      tx.run();

      // Clear existing data
      this.db.exec('DELETE FROM embeddings');
      this.db.exec('DELETE FROM embedding_meta');

      // Upsert cache metadata
      const upsertMeta = this.db.prepare(
        'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
      );
      upsertMeta.run(META_INDEX_HASH_KEY, data.indexHash);
      if (data.modelName) {
        upsertMeta.run(META_MODEL_NAME_KEY, data.modelName);
      }

      // Insert embeddings
      const insertVec = this.db.prepare(
        'INSERT INTO embeddings (instruction_id, embedding) VALUES (?, ?)',
      );
      const insertMeta = this.db.prepare(
        'INSERT INTO embedding_meta (instruction_id, model_name, source_hash, index_hash, computed_at) VALUES (?, ?, ?, ?, ?)',
      );

      const now = new Date().toISOString();
      for (const [id, vec] of Object.entries(data.embeddings)) {
        if (vec.length !== this.dims) {
          throw new Error(
            `Vector dimension mismatch for '${id}': expected ${this.dims}, got ${vec.length}`,
          );
        }
        for (let i = 0; i < vec.length; i++) {
          if (!Number.isFinite(vec[i])) {
            throw new Error(
              `Invalid vector value for '${id}' at index ${i}: ${vec[i]}. Vectors must contain only finite numbers.`,
            );
          }
        }
        const buf = Buffer.from(new Float32Array(vec).buffer);
        insertVec.run(id, buf);
        insertMeta.run(
          id,
          data.modelName ?? 'unknown',
          data.entryHashes?.[id] ?? '',
          data.indexHash,
          now,
        );
      }

      commit.run();
    } catch (err) {
      try { rollback.run(); } catch { /* rollback may fail if tx already aborted */ }
      throw err;
    }
  }

  search(queryVector: Float32Array, limit: number): EmbeddingSearchResult[] {
    if (limit <= 0) return [];
    if (queryVector.length !== this.dims) {
      logWarn(
        `[embedding-store] Search query dimension mismatch: expected ${this.dims}, got ${queryVector.length}`,
      );
      return [];
    }

    try {
      const buf = Buffer.from(queryVector.buffer, queryVector.byteOffset, queryVector.byteLength);
      const rows = this.db.prepare(
        'SELECT instruction_id, distance FROM embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?',
      ).all(buf, limit) as Array<{ instruction_id: string; distance: number }>;

      return rows.map(r => ({
        id: r.instruction_id,
        distance: r.distance,
      }));
    } catch (err) {
      logWarn(`[embedding-store] search failed: ${err instanceof Error ? err.message : 'unknown'}`);
      return [];
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed
    }
  }
}
