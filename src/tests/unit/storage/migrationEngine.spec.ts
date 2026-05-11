/**
 * Migration engine tests — JSON ↔ SQLite bidirectional migration.
 *
 * TDD RED phase: tests written FIRST before implementation.
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

describe('Migration Engine', () => {
  let jsonDir: string;
  let sqliteDir: string;
  let dbPath: string;

  beforeEach(() => {
    jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-json-'));
    sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-sqlite-'));
    dbPath = path.join(sqliteDir, 'test.db');
    fs.writeFileSync(path.join(jsonDir, '.index-version'), '0', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(jsonDir, { recursive: true, force: true });
    fs.rmSync(sqliteDir, { recursive: true, force: true });
  });

  // ── JSON → SQLite ──────────────────────────────────────────────────

  describe('migrateJsonToSqlite()', () => {
    it('migrates all entries from JSON to SQLite', () => {
      const jsonStore = new JsonFileStore(jsonDir);
      jsonStore.write(makeEntry({ id: 'entry-1' }));
      jsonStore.write(makeEntry({ id: 'entry-2' }));
      jsonStore.write(makeEntry({ id: 'entry-3' }));
      jsonStore.close();

      const result = migrateJsonToSqlite(jsonDir, dbPath);
      expect(result.migrated).toBe(3);
      expect(result.errors).toEqual([]);

      const sqliteStore = new SqliteStore(dbPath);
      expect(sqliteStore.count()).toBe(3);
      expect(sqliteStore.get('entry-1')).not.toBeNull();
      expect(sqliteStore.get('entry-2')).not.toBeNull();
      expect(sqliteStore.get('entry-3')).not.toBeNull();
      sqliteStore.close();
    });

    it('preserves governance hash across migration', () => {
      const jsonStore = new JsonFileStore(jsonDir);
      jsonStore.write(makeEntry({ id: 'hash-1', version: '1.0.0', owner: 'team-a' }));
      jsonStore.write(makeEntry({ id: 'hash-2', version: '2.0.0', owner: 'team-b' }));
      const jsonHash = jsonStore.computeHash();
      jsonStore.close();

      migrateJsonToSqlite(jsonDir, dbPath);

      const sqliteStore = new SqliteStore(dbPath);
      expect(sqliteStore.computeHash()).toBe(jsonHash);
      sqliteStore.close();
    });

    it('preserves all core fields', () => {
      const jsonStore = new JsonFileStore(jsonDir);
      const entry = makeEntry({
        id: 'fields-1',
        title: 'Complex Entry',
        body: 'Full field test body',
        priority: 10,
        categories: ['security', 'governance'],
        contentType: 'knowledge',
        audience: 'all',
        requirement: 'mandatory',
        version: '3.1.0',
        owner: 'security-team',
        status: 'approved',
        priorityTier: 'P1',
      });
      jsonStore.write(entry);
      jsonStore.close();

      migrateJsonToSqlite(jsonDir, dbPath);

      const sqliteStore = new SqliteStore(dbPath);
      const loaded = sqliteStore.get('fields-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe('Complex Entry');
      expect(loaded!.body).toBe('Full field test body');
      expect(loaded!.priority).toBe(10);
      expect(loaded!.categories).toEqual(['security', 'governance']);
      expect(loaded!.contentType).toBe('knowledge');
      expect(loaded!.version).toBe('3.1.0');
      expect(loaded!.owner).toBe('security-team');
      sqliteStore.close();
    });

    it('is idempotent — running twice does not duplicate', () => {
      const jsonStore = new JsonFileStore(jsonDir);
      jsonStore.write(makeEntry({ id: 'idem-1' }));
      jsonStore.write(makeEntry({ id: 'idem-2' }));
      jsonStore.close();

      migrateJsonToSqlite(jsonDir, dbPath);
      migrateJsonToSqlite(jsonDir, dbPath);

      const sqliteStore = new SqliteStore(dbPath);
      expect(sqliteStore.count()).toBe(2);
      sqliteStore.close();
    });

    it('reports progress via callback', () => {
      const jsonStore = new JsonFileStore(jsonDir);
      jsonStore.write(makeEntry({ id: 'prog-1' }));
      jsonStore.write(makeEntry({ id: 'prog-2' }));
      jsonStore.close();

      const progress: { current: number; total: number }[] = [];
      migrateJsonToSqlite(jsonDir, dbPath, {
        onProgress: (current, total) => progress.push({ current, total }),
      });

      expect(progress.length).toBeGreaterThan(0);
      expect(progress[progress.length - 1].current).toBe(progress[progress.length - 1].total);
    });

    it('handles empty source directory', () => {
      const result = migrateJsonToSqlite(jsonDir, dbPath);
      expect(result.migrated).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('skips corrupt JSON files and reports errors', () => {
      const jsonStore = new JsonFileStore(jsonDir);
      jsonStore.write(makeEntry({ id: 'good-1' }));
      jsonStore.close();
      // Write a corrupt file
      fs.writeFileSync(path.join(jsonDir, 'bad-entry.json'), '{invalid json!!!', 'utf-8');

      const result = migrateJsonToSqlite(jsonDir, dbPath);
      expect(result.migrated).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].file).toContain('bad-entry');
    });
  });

  // ── SQLite → JSON ──────────────────────────────────────────────────

  describe('migrateSqliteToJson()', () => {
    it('exports all entries from SQLite to JSON files', () => {
      const sqliteStore = new SqliteStore(dbPath);
      sqliteStore.write(makeEntry({ id: 'exp-1' }));
      sqliteStore.write(makeEntry({ id: 'exp-2' }));
      sqliteStore.close();

      const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-export-'));
      try {
        const result = migrateSqliteToJson(dbPath, exportDir);
        expect(result.exported).toBe(2);
        expect(result.errors).toEqual([]);

        const jsonStore = new JsonFileStore(exportDir);
        expect(jsonStore.count()).toBe(2);
        expect(jsonStore.get('exp-1')).not.toBeNull();
        expect(jsonStore.get('exp-2')).not.toBeNull();
        jsonStore.close();
      } finally {
        fs.rmSync(exportDir, { recursive: true, force: true });
      }
    });

    it('preserves governance hash on export', () => {
      const sqliteStore = new SqliteStore(dbPath);
      sqliteStore.write(makeEntry({ id: 'exh-1', version: '1.0.0', owner: 'team-x' }));
      sqliteStore.write(makeEntry({ id: 'exh-2', version: '2.0.0', owner: 'team-y' }));
      const sqliteHash = sqliteStore.computeHash();
      sqliteStore.close();

      const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-hash-'));
      try {
        migrateSqliteToJson(dbPath, exportDir);
        const jsonStore = new JsonFileStore(exportDir);
        expect(jsonStore.computeHash()).toBe(sqliteHash);
        jsonStore.close();
      } finally {
        fs.rmSync(exportDir, { recursive: true, force: true });
      }
    });

    it('handles empty database', () => {
      const sqliteStore = new SqliteStore(dbPath);
      sqliteStore.close();

      const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-empty-'));
      try {
        const result = migrateSqliteToJson(dbPath, exportDir);
        expect(result.exported).toBe(0);
        expect(result.errors).toEqual([]);
      } finally {
        fs.rmSync(exportDir, { recursive: true, force: true });
      }
    });
  });

  // ── Round-trip ─────────────────────────────────────────────────────

  describe('round-trip: JSON → SQLite → JSON', () => {
    it('is lossless', () => {
      const jsonStore = new JsonFileStore(jsonDir);
      jsonStore.write(makeEntry({ id: 'rt-1', title: 'Round Trip', categories: ['a', 'b'], priority: 15 }));
      jsonStore.write(makeEntry({ id: 'rt-2', title: 'Second Entry', categories: ['c'], priority: 75 }));
      const originalHash = jsonStore.computeHash();
      jsonStore.close();

      // JSON → SQLite
      migrateJsonToSqlite(jsonDir, dbPath);

      // SQLite → JSON (new dir)
      const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-rt-'));
      try {
        migrateSqliteToJson(dbPath, exportDir);

        const roundTripStore = new JsonFileStore(exportDir);
        expect(roundTripStore.computeHash()).toBe(originalHash);
        expect(roundTripStore.count()).toBe(2);

        const entry = roundTripStore.get('rt-1');
        expect(entry!.title).toBe('Round Trip');
        expect(entry!.categories).toEqual(['a', 'b']);
        expect(entry!.priority).toBe(15);
        roundTripStore.close();
      } finally {
        fs.rmSync(exportDir, { recursive: true, force: true });
      }
    });
  });
});
