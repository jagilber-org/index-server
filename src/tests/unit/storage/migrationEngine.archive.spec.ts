/**
 * migrationEngine round-trip archive parity tests
 * (spec 006-archive-lifecycle Phase B6).
 *
 * Loads a fixture with both active and archived entries, migrates
 *   JSON → SQLite → JSON
 * and asserts:
 *   (a) active-set governance hash identical end-to-end,
 *   (b) archive-set hash identical end-to-end,
 *   (c) no archived id appears in the active set after either migration,
 *   (d) archive metadata (reason, source, archivedBy, restoreEligible,
 *       archivedAt) byte-stable across the round-trip.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonFileStore } from '../../../services/storage/jsonFileStore.js';
import { SqliteStore } from '../../../services/storage/sqliteStore.js';
import {
  migrateJsonToSqlite,
  migrateSqliteToJson,
} from '../../../services/storage/migrationEngine.js';
import type { InstructionEntry } from '../../../models/instruction.js';

function makeEntry(overrides: Partial<InstructionEntry> & { id: string }): InstructionEntry {
  const now = new Date().toISOString();
  return {
    title: `Entry ${overrides.id}`,
    body: `body-${overrides.id}`,
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['test'],
    contentType: 'instruction',
    sourceHash: 'h',
    schemaVersion: '7',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as InstructionEntry;
}

describe('migrationEngine — archive round-trip parity', () => {
  let jsonDir1: string;
  let dbDir: string;
  let jsonDir2: string;
  let dbPath: string;

  beforeEach(() => {
    jsonDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-arc-j1-'));
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-arc-db-'));
    jsonDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-arc-j2-'));
    dbPath = path.join(dbDir, 'roundtrip.db');
  });

  afterEach(() => {
    for (const d of [jsonDir1, dbDir, jsonDir2]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* windows lock */ }
    }
  });

  function seedJson(store: JsonFileStore): { activeIds: string[]; archivedIds: string[] } {
    // 3 active entries
    store.write(makeEntry({ id: 'act-1' }));
    store.write(makeEntry({ id: 'act-2', title: 'Two' }));
    store.write(makeEntry({ id: 'act-3', priority: 10 }));
    // 2 archived entries with distinct archive metadata
    store.write(makeEntry({ id: 'arc-a' }));
    store.archive('arc-a', {
      archivedAt: '2024-01-01T00:00:00.000Z',
      archivedBy: 'tester',
      archiveReason: 'manual',
      archiveSource: 'archive',
      restoreEligible: true,
    });
    store.write(makeEntry({ id: 'arc-b' }));
    store.archive('arc-b', {
      archivedAt: '2024-02-02T00:00:00.000Z',
      archivedBy: 'groomer',
      archiveReason: 'duplicate-merge',
      archiveSource: 'groom',
      restoreEligible: false,
    });
    return { activeIds: ['act-1', 'act-2', 'act-3'], archivedIds: ['arc-a', 'arc-b'] };
  }

  it('round-trips active and archive sets without reactivation', () => {
    const j1 = new JsonFileStore(jsonDir1);
    const { activeIds, archivedIds } = seedJson(j1);
    const activeHashStart = j1.computeHash();
    const archiveHashStart = j1.computeArchiveHash();
    j1.close();

    // JSON → SQLite
    const fwd = migrateJsonToSqlite(jsonDir1, dbPath);
    expect(fwd.migrated).toBe(activeIds.length);
    expect(fwd.archivedMigrated).toBe(archivedIds.length);
    expect(fwd.errors).toEqual([]);

    const sq = new SqliteStore(dbPath);
    const sqlActiveHash = sq.computeHash();
    const sqlArchiveHash = sq.computeArchiveHash();
    // No archived id is also active
    for (const id of archivedIds) {
      expect(sq.get(id)).toBeNull();
      expect(sq.getArchived(id)).not.toBeNull();
    }
    sq.close();

    expect(sqlActiveHash).toBe(activeHashStart);
    expect(sqlArchiveHash).toBe(archiveHashStart);

    // SQLite → JSON
    const back = migrateSqliteToJson(dbPath, jsonDir2);
    expect(back.exported).toBe(activeIds.length);
    expect(back.archivedExported).toBe(archivedIds.length);
    expect(back.errors).toEqual([]);

    const j2 = new JsonFileStore(jsonDir2);
    const activeHashEnd = j2.computeHash();
    const archiveHashEnd = j2.computeArchiveHash();
    for (const id of archivedIds) {
      expect(j2.get(id)).toBeNull();
      expect(j2.getArchived(id)).not.toBeNull();
      // Archive payload survives
      expect(fs.existsSync(path.join(jsonDir2, '.archive', `${id}.json`))).toBe(true);
      expect(fs.existsSync(path.join(jsonDir2, `${id}.json`))).toBe(false);
    }
    j2.close();

    expect(activeHashEnd).toBe(activeHashStart);
    expect(archiveHashEnd).toBe(archiveHashStart);
  });

  it('preserves archive metadata fields across the round-trip', () => {
    const j1 = new JsonFileStore(jsonDir1);
    seedJson(j1);
    j1.close();

    migrateJsonToSqlite(jsonDir1, dbPath);
    migrateSqliteToJson(dbPath, jsonDir2);

    const j2 = new JsonFileStore(jsonDir2);
    const a = j2.getArchived('arc-a');
    const b = j2.getArchived('arc-b');
    j2.close();

    expect(a).not.toBeNull();
    expect(a?.archivedBy).toBe('tester');
    expect(a?.archiveReason).toBe('manual');
    expect(a?.archiveSource).toBe('archive');
    expect(a?.restoreEligible).toBe(true);
    expect(a?.archivedAt).toBe('2024-01-01T00:00:00.000Z');

    expect(b).not.toBeNull();
    expect(b?.archivedBy).toBe('groomer');
    expect(b?.archiveReason).toBe('duplicate-merge');
    expect(b?.archiveSource).toBe('groom');
    expect(b?.restoreEligible).toBe(false);
    expect(b?.archivedAt).toBe('2024-02-02T00:00:00.000Z');
  });

  it('does not surface archived ids in the active set on either side', () => {
    const j1 = new JsonFileStore(jsonDir1);
    seedJson(j1);
    j1.close();

    // JSON → SQLite
    migrateJsonToSqlite(jsonDir1, dbPath);
    const sq = new SqliteStore(dbPath);
    const activeIdsAfterFwd = sq.list().map(e => e.id).sort();
    sq.close();
    expect(activeIdsAfterFwd).not.toContain('arc-a');
    expect(activeIdsAfterFwd).not.toContain('arc-b');

    // SQLite → JSON
    migrateSqliteToJson(dbPath, jsonDir2);
    const j2 = new JsonFileStore(jsonDir2);
    const activeIdsAfterBack = j2.load().entries.map(e => e.id).sort();
    j2.close();
    expect(activeIdsAfterBack).not.toContain('arc-a');
    expect(activeIdsAfterBack).not.toContain('arc-b');
  });
});
