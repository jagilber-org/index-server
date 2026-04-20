/**
 * Migration engine — bidirectional JSON ↔ SQLite migration.
 *
 * Uses Node.js built-in node:sqlite. Zero third-party dependencies.
 */

import fs from 'fs';
import path from 'path';
import { JsonFileStore } from './jsonFileStore.js';
import { SqliteStore } from './sqliteStore.js';

export interface MigrationOptions {
  onProgress?: (current: number, total: number) => void;
}

export interface MigrationResult {
  migrated: number;
  errors: { file: string; error: string }[];
}

export interface ExportResult {
  exported: number;
  errors: { id: string; error: string }[];
}

/**
 * Migrate all instructions from JSON files to a SQLite database.
 *
 * Idempotent: uses INSERT OR REPLACE so re-running is safe.
 * Atomic: all writes happen via SqliteStore (individual INSERT OR REPLACE).
 */
export function migrateJsonToSqlite(
  jsonDir: string,
  dbPath: string,
  opts?: MigrationOptions,
): MigrationResult {
  const jsonStore = new JsonFileStore(jsonDir);
  const loadResult = jsonStore.load();

  const entries = loadResult.entries;
  const total = entries.length;
  const errors = [...loadResult.errors];

  // Ensure DB directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqliteStore = new SqliteStore(dbPath);
  let migrated = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      try {
        sqliteStore.write(entries[i]);
        migrated++;
      } catch (err) {
        errors.push({
          file: entries[i].id,
          error: err instanceof Error ? err.message : 'Write failed',
        });
      }
      opts?.onProgress?.(i + 1, total);
    }
  } finally {
    sqliteStore.close();
    jsonStore.close();
  }

  return { migrated, errors };
}

/**
 * Export all instructions from a SQLite database to JSON files.
 *
 * Each entry becomes a separate .json file named by ID.
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
  const total = entries.length;
  const errors: { id: string; error: string }[] = [];

  const jsonStore = new JsonFileStore(jsonDir);
  let exported = 0;

  try {
    for (let i = 0; i < entries.length; i++) {
      try {
        jsonStore.write(entries[i]);
        exported++;
      } catch (err) {
        errors.push({
          id: entries[i].id,
          error: err instanceof Error ? err.message : 'Write failed',
        });
      }
      opts?.onProgress?.(i + 1, total);
    }
  } finally {
    sqliteStore.close();
    jsonStore.close();
  }

  return { exported, errors };
}
