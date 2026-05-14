/**
 * Migration engine — bidirectional JSON ↔ SQLite migration.
 *
 * Uses Node.js built-in node:sqlite. Zero third-party dependencies.
 */

import fs from 'fs';
import path from 'path';
import { JsonFileStore } from './jsonFileStore.js';
import { JsonEmbeddingStore } from './jsonEmbeddingStore.js';
import { SqliteStore } from './sqliteStore.js';
import type { IEmbeddingStore } from './types.js';

export interface MigrationOptions {
  onProgress?: (current: number, total: number) => void;
}

export interface MigrationResult {
  migrated: number;
  /** Number of archived entries also migrated (Phase B5 / spec 006). */
  archivedMigrated: number;
  errors: { file: string; error: string }[];
}

export interface ExportResult {
  exported: number;
  /** Number of archived entries also exported (Phase B5 / spec 006). */
  archivedExported: number;
  errors: { id: string; error: string }[];
}

/**
 * Migrate all instructions from JSON files to a SQLite database.
 *
 * Idempotent: uses INSERT OR REPLACE so re-running is safe.
 * Atomic: all writes happen via SqliteStore (individual INSERT OR REPLACE).
 *
 * Archive parity (spec 006-archive-lifecycle B5): archived entries in
 * `<jsonDir>/.archive/` are migrated into the `instructions_archive` table.
 * Archived entries are NEVER reactivated by the migration.
 */
export function migrateJsonToSqlite(
  jsonDir: string,
  dbPath: string,
  opts?: MigrationOptions,
): MigrationResult {
  const jsonStore = new JsonFileStore(jsonDir);
  const loadResult = jsonStore.load();

  const entries = loadResult.entries;
  const archived = jsonStore.listArchived();
  const total = entries.length + archived.length;
  const errors = [...loadResult.errors];

  // Ensure DB directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqliteStore = new SqliteStore(dbPath);
  let migrated = 0;
  let archivedMigrated = 0;

  try {
    let progress = 0;
    for (const entry of entries) {
      try {
        sqliteStore.write(entry);
        migrated++;
      } catch (err) {
        errors.push({
          file: entry.id,
          error: err instanceof Error ? err.message : 'Write failed',
        });
      }
      opts?.onProgress?.(++progress, total);
    }

    // Archive parity: archived entries are migrated into the archive store
    // via write(active) + archive(meta). archive() is atomic per backend, so
    // the entry never appears in both tables simultaneously. Original archive
    // metadata (reason, source, archivedBy, archivedAt, restoreEligible) is
    // preserved through the ArchiveMeta payload.
    for (const arc of archived) {
      try {
        const meta = {
          archivedAt: arc.archivedAt,
          archivedBy: arc.archivedBy,
          archiveReason: arc.archiveReason,
          archiveSource: arc.archiveSource,
          restoreEligible: arc.restoreEligible,
        };
        // Strip archive metadata so it's a valid "active" payload, write,
        // then immediately archive with the original metadata.
        const activeCopy = { ...arc };
        delete activeCopy.archivedAt;
        delete activeCopy.archivedBy;
        delete activeCopy.archiveReason;
        delete activeCopy.archiveSource;
        delete activeCopy.restoreEligible;
        sqliteStore.write(activeCopy);
        sqliteStore.archive(arc.id, meta);
        archivedMigrated++;
      } catch (err) {
        errors.push({
          file: arc.id,
          error: err instanceof Error ? err.message : 'Archive write failed',
        });
      }
      opts?.onProgress?.(++progress, total);
    }
  } finally {
    sqliteStore.close();
    jsonStore.close();
  }

  return { migrated, archivedMigrated, errors };
}

/**
 * Export all instructions from a SQLite database to JSON files.
 *
 * Each entry becomes a separate .json file named by ID.
 *
 * Archive parity (spec 006-archive-lifecycle B5): archived entries in the
 * `instructions_archive` table are exported into `<jsonDir>/.archive/<id>.json`.
 * Archived entries are NEVER reactivated by the migration.
 */
export function migrateSqliteToJson(
  dbPath: string,
  jsonDir: string,
  opts?: MigrationOptions,
): ExportResult {
  if (!fs.existsSync(jsonDir)) {
    fs.mkdirSync(jsonDir, { recursive: true });
  }

  const sqliteStore = new SqliteStore(dbPath);
  const loadResult = sqliteStore.load();
  const entries = loadResult.entries;
  const archived = sqliteStore.listArchived();
  const total = entries.length + archived.length;
  const errors: { id: string; error: string }[] = [];

  const jsonStore = new JsonFileStore(jsonDir);
  let exported = 0;
  let archivedExported = 0;

  try {
    let progress = 0;
    for (const entry of entries) {
      try {
        jsonStore.write(entry);
        exported++;
      } catch (err) {
        errors.push({
          id: entry.id,
          error: err instanceof Error ? err.message : 'Write failed',
        });
      }
      opts?.onProgress?.(++progress, total);
    }

    // Archive parity: write archived entries into <jsonDir>/.archive/ and
    // ensure they never appear in active storage. We re-use the JsonFileStore
    // archive() path so the file lands in `.archive/` with proper atomicity.
    for (const arc of archived) {
      try {
        const meta = {
          archivedAt: arc.archivedAt,
          archivedBy: arc.archivedBy,
          archiveReason: arc.archiveReason,
          archiveSource: arc.archiveSource,
          restoreEligible: arc.restoreEligible,
        };
        const activeCopy = { ...arc };
        delete activeCopy.archivedAt;
        delete activeCopy.archivedBy;
        delete activeCopy.archiveReason;
        delete activeCopy.archiveSource;
        delete activeCopy.restoreEligible;
        jsonStore.write(activeCopy);
        jsonStore.archive(arc.id, meta);
        archivedExported++;
      } catch (err) {
        errors.push({
          id: arc.id,
          error: err instanceof Error ? err.message : 'Archive export failed',
        });
      }
      opts?.onProgress?.(++progress, total);
    }
  } finally {
    sqliteStore.close();
    jsonStore.close();
  }

  return { exported, archivedExported, errors };
}

export interface EmbeddingMigrationResult {
  migrated: number;
  skipped: number;
  error?: string;
}

/**
 * Migrate embeddings from a JSON file to an IEmbeddingStore (e.g. SqliteEmbeddingStore).
 *
 * Reads the JSON embedding cache and saves it into the target store.
 * Idempotent: calling again with the same data overwrites safely.
 */
export function migrateJsonEmbeddingsToStore(
  jsonEmbeddingPath: string,
  targetStore: IEmbeddingStore,
): EmbeddingMigrationResult {
  try {
    const jsonStore = new JsonEmbeddingStore(jsonEmbeddingPath);
    const data = jsonStore.load();
    jsonStore.close();

    if (!data) {
      return { migrated: 0, skipped: 0, error: 'No embedding data in JSON file' };
    }

    const count = Object.keys(data.embeddings).length;
    if (count === 0) {
      return { migrated: 0, skipped: 0 };
    }

    targetStore.save(data);
    return { migrated: count, skipped: 0 };
  } catch (err) {
    return {
      migrated: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : 'Migration failed',
    };
  }
}
