/**
 * SqliteStore archive table migration test (spec 006-archive-lifecycle B4.3).
 *
 * Simulates a pre-archive (v1) SQLite DB created without `instructions_archive`,
 * opens it through SqliteStore, and verifies:
 *   - the archive table is created idempotently on open,
 *   - existing active data is untouched,
 *   - schema_version is bumped to the current value,
 *   - re-opening the same DB is a no-op (idempotent migration).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStore } from '../../../services/storage/sqliteStore.js';
import { SCHEMA_VERSION } from '../../../services/storage/sqliteSchema.js';

describe('SqliteSchema — archive table migration', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-arc-mig-'));
    dbPath = path.join(tmpDir, 'pre-archive.db');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort: Windows occasionally holds SQLite -wal/-shm briefly.
    }
  });

  /**
   * Build a minimal "pre-archive" DB: active instructions table only, no
   * instructions_archive table, schema_version stamped as '1'.
   */
  function createPreArchiveDb(): void {
    const db = new DatabaseSync(dbPath);
    // Full pre-archive (v1) schema: matches the original INSTRUCTIONS_DDL but
    // without the `instructions_archive` table and its indexes.
    db.exec(`
      CREATE TABLE instructions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        rationale TEXT,
        priority INTEGER NOT NULL DEFAULT 50,
        audience TEXT NOT NULL DEFAULT 'all',
        requirement TEXT NOT NULL DEFAULT 'recommended',
        categories TEXT NOT NULL DEFAULT '[]',
        content_type TEXT NOT NULL DEFAULT 'instruction',
        primary_category TEXT,
        source_hash TEXT NOT NULL DEFAULT '',
        schema_version TEXT NOT NULL DEFAULT '4',
        deprecated_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version TEXT DEFAULT '1.0.0',
        status TEXT DEFAULT 'approved',
        owner TEXT,
        priority_tier TEXT,
        classification TEXT DEFAULT 'public',
        last_reviewed_at TEXT,
        next_review_due TEXT,
        review_interval_days INTEGER,
        change_log TEXT DEFAULT '[]',
        supersedes TEXT,
        archived_at TEXT,
        workspace_id TEXT,
        user_id TEXT,
        team_ids TEXT DEFAULT '[]',
        semantic_summary TEXT,
        created_by_agent TEXT,
        source_workspace TEXT,
        extensions TEXT,
        risk_score REAL,
        usage_count INTEGER DEFAULT 0,
        first_seen_ts TEXT,
        last_used_at TEXT
      );
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '1');
    `);
    db.prepare('INSERT INTO instructions (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      'pre-1', 'Pre Archive Entry', 'Body', new Date().toISOString(), new Date().toISOString(),
    );
    db.close();
  }

  it('creates instructions_archive when opening a pre-archive DB', () => {
    createPreArchiveDb();

    const store = new SqliteStore(dbPath);
    try {
      // Inspect raw schema: archive table exists.
      const raw = new DatabaseSync(dbPath);
      const tbl = raw.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='instructions_archive'",
      ).get();
      raw.close();
      expect(tbl).toBeTruthy();
    } finally {
      store.close();
    }
  });

  it('leaves existing active rows untouched', () => {
    createPreArchiveDb();
    const store = new SqliteStore(dbPath);
    try {
      const got = store.get('pre-1');
      expect(got).not.toBeNull();
      expect(got?.title).toBe('Pre Archive Entry');
    } finally {
      store.close();
    }
  });

  it('updates metadata.schema_version to the current value', () => {
    createPreArchiveDb();
    const store = new SqliteStore(dbPath);
    try {
      const raw = new DatabaseSync(dbPath);
      const meta = raw.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as
        | { value: string } | undefined;
      raw.close();
      expect(meta?.value).toBe(SCHEMA_VERSION);
    } finally {
      store.close();
    }
  });

  it('migration is idempotent (open twice = same state)', () => {
    createPreArchiveDb();
    const a = new SqliteStore(dbPath);
    a.close();
    const b = new SqliteStore(dbPath);
    try {
      expect(b.countArchived()).toBe(0);
      expect(b.get('pre-1')).not.toBeNull();
    } finally {
      b.close();
    }

    // Inspect schema: archive table still exactly one
    const raw = new DatabaseSync(dbPath);
    const all = raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='instructions_archive'",
    ).all();
    raw.close();
    expect(all.length).toBe(1);
  });

  it('does not attach FTS5 triggers to instructions_archive', () => {
    createPreArchiveDb();
    const store = new SqliteStore(dbPath);
    try {
      const raw = new DatabaseSync(dbPath);
      const triggers = raw.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = 'instructions_archive'",
      ).all();
      raw.close();
      expect(triggers).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('supports archive round-trip on a migrated DB', () => {
    createPreArchiveDb();
    const store = new SqliteStore(dbPath);
    try {
      // Insert via the store so FTS5 indices remain consistent — pre-archive
      // v1 DB rows that bypass FTS5 are an existing-bug area unrelated to
      // archive lifecycle. The migration itself is exercised by tests 1–5.
      store.write({
        id: 'arc-new',
        title: 'Post-migration',
        body: 'b',
        priority: 50,
        audience: 'all',
        requirement: 'recommended',
        categories: [],
        contentType: 'instruction',
        sourceHash: '',
        schemaVersion: '7',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      store.archive('arc-new', { archiveReason: 'manual', archiveSource: 'archive' });
      expect(store.countArchived()).toBe(1);
      const restored = store.restore('arc-new');
      expect(restored.id).toBe('arc-new');
      expect(store.countArchived()).toBe(0);
    } finally {
      store.close();
    }
  });
});
