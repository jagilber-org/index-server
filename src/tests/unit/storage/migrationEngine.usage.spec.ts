/**
 * Migration engine — usage counter preservation (JSON ↔ SQLite).
 *
 * Regression coverage for the defect where migrating from the JSON backend to
 * the SQLite backend silently dropped ALL accumulated usage:
 *
 *  1. `migrateJsonToSqlite` read raw `<jsonDir>/*.json` via JsonFileStore, which
 *     knows nothing about the usage subsystem. Because `incrementUsage` flushes
 *     to `data/usage-snapshot.json` and NEVER rewrites the entry file, the
 *     snapshot is the authoritative counter store at runtime — so every counter
 *     was lost.
 *  2. The SQLite DDL had no `retrieved_count` / `applied_count` /
 *     `last_retrieved_at` / `last_applied_at` columns, so even counters present
 *     on an entry could not round-trip; the retrieved/applied split collapsed.
 *  3. `migrateSqliteToJson` had the same hole in reverse.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonFileStore } from '../../../services/storage/jsonFileStore.js';
import { SqliteStore } from '../../../services/storage/sqliteStore.js';
import { migrateJsonToSqlite, migrateSqliteToJson } from '../../../services/storage/migrationEngine.js';
import type { InstructionEntry } from '../../../models/instruction.js';

function makeEntry(overrides: Partial<InstructionEntry> & { id: string }): InstructionEntry {
  const now = new Date().toISOString();
  return {
    title: `Test Instruction ${overrides.id}`,
    body: `Body for ${overrides.id}`,
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['test'],
    contentType: 'instruction',
    sourceHash: 'abc123',
    schemaVersion: '4',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as InstructionEntry;
}

describe('Migration Engine — usage preservation', () => {
  let jsonDir: string;
  let sqliteDir: string;
  let dbPath: string;
  let snapPath: string;

  beforeEach(() => {
    jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-json-'));
    sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-sqlite-'));
    dbPath = path.join(sqliteDir, 'test.db');
    snapPath = path.join(sqliteDir, 'usage-snapshot.json');
    fs.writeFileSync(path.join(jsonDir, '.index-version'), '0', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(jsonDir, { recursive: true, force: true });
    fs.rmSync(sqliteDir, { recursive: true, force: true });
  });

  it('carries usage-snapshot counters into SQLite (JSON → SQLite)', () => {
    const jsonStore = new JsonFileStore(jsonDir);
    // Entry file carries NO counters — exactly as incrementUsage leaves it.
    jsonStore.write(makeEntry({ id: 'hot-entry' }));
    jsonStore.close();

    fs.writeFileSync(
      snapPath,
      JSON.stringify({
        'hot-entry': {
          usageCount: 7,
          retrievedCount: 5,
          appliedCount: 2,
          firstSeenTs: '2026-01-01T00:00:00.000Z',
          lastUsedAt: '2026-02-02T00:00:00.000Z',
          lastRetrievedAt: '2026-02-01T00:00:00.000Z',
          lastAppliedAt: '2026-02-02T00:00:00.000Z',
        },
      }),
    );

    const result = migrateJsonToSqlite(jsonDir, dbPath, { usageSnapshotPath: snapPath });
    expect(result.errors).toEqual([]);
    expect(result.usageMerged).toBe(1);

    const store = new SqliteStore(dbPath);
    const got = store.get('hot-entry')!;
    store.close();

    expect(got.usageCount).toBe(7);
    expect(got.retrievedCount).toBe(5);
    expect(got.appliedCount).toBe(2);
    expect(got.firstSeenTs).toBe('2026-01-01T00:00:00.000Z');
    expect(got.lastUsedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(got.lastRetrievedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(got.lastAppliedAt).toBe('2026-02-02T00:00:00.000Z');
  });

  it('does not let a stale snapshot lower counters already on the entry', () => {
    const jsonStore = new JsonFileStore(jsonDir);
    jsonStore.write(makeEntry({ id: 'monotonic', retrievedCount: 9, appliedCount: 4, usageCount: 13 }));
    jsonStore.close();

    fs.writeFileSync(
      snapPath,
      JSON.stringify({ monotonic: { usageCount: 2, retrievedCount: 1, appliedCount: 1 } }),
    );

    migrateJsonToSqlite(jsonDir, dbPath, { usageSnapshotPath: snapPath });

    const store = new SqliteStore(dbPath);
    const got = store.get('monotonic')!;
    store.close();

    expect(got.retrievedCount).toBe(9);
    expect(got.appliedCount).toBe(4);
    expect(got.usageCount).toBe(13);
  });

  it('preserves the retrieved/applied split through a full JSON → SQLite → JSON round trip', () => {
    const jsonStore = new JsonFileStore(jsonDir);
    jsonStore.write(makeEntry({ id: 'round-trip' }));
    jsonStore.close();

    fs.writeFileSync(
      snapPath,
      JSON.stringify({
        'round-trip': {
          usageCount: 10,
          retrievedCount: 6,
          appliedCount: 4,
          firstSeenTs: '2026-01-01T00:00:00.000Z',
          lastUsedAt: '2026-03-03T00:00:00.000Z',
          lastRetrievedAt: '2026-03-01T00:00:00.000Z',
          lastAppliedAt: '2026-03-03T00:00:00.000Z',
        },
      }),
    );

    migrateJsonToSqlite(jsonDir, dbPath, { usageSnapshotPath: snapPath });

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-out-'));
    const outSnap = path.join(outDir, 'usage-snapshot.json');
    try {
      const exported = migrateSqliteToJson(dbPath, outDir, { usageSnapshotPath: outSnap });
      expect(exported.errors).toEqual([]);

      const back = new JsonFileStore(outDir);
      const got = back.load().entries.find(e => e.id === 'round-trip')!;
      back.close();

      expect(got.retrievedCount).toBe(6);
      expect(got.appliedCount).toBe(4);
      expect(got.usageCount).toBe(10);

      // The exported snapshot must also carry the split, since it is the
      // authoritative counter store for the JSON backend at runtime.
      const snap = JSON.parse(fs.readFileSync(outSnap, 'utf8')) as Record<string, Record<string, unknown>>;
      expect(snap['round-trip'].retrievedCount).toBe(6);
      expect(snap['round-trip'].appliedCount).toBe(4);
      expect(snap['round-trip'].lastAppliedAt).toBe('2026-03-03T00:00:00.000Z');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('preserves counters on archived entries', () => {
    const jsonStore = new JsonFileStore(jsonDir);
    jsonStore.write(makeEntry({ id: 'arc-entry' }));
    jsonStore.archive('arc-entry', {
      archivedAt: '2026-01-05T00:00:00.000Z',
      archivedBy: 'tester',
      archiveReason: 'deprecated',
      archiveSource: 'archive',
      restoreEligible: true,
    });
    jsonStore.close();

    fs.writeFileSync(
      snapPath,
      JSON.stringify({ 'arc-entry': { usageCount: 3, retrievedCount: 2, appliedCount: 1 } }),
    );

    migrateJsonToSqlite(jsonDir, dbPath, { usageSnapshotPath: snapPath });

    const store = new SqliteStore(dbPath);
    const arc = store.listArchived().find(e => e.id === 'arc-entry')!;
    store.close();

    expect(arc.retrievedCount).toBe(2);
    expect(arc.appliedCount).toBe(1);
    expect(arc.usageCount).toBe(3);
  });
});
