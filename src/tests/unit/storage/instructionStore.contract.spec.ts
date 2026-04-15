/**
 * Contract tests for IInstructionStore implementations.
 *
 * These tests define the behavioral contract that ANY storage backend must satisfy.
 * Parameterized: run against JsonFileStore (and later SqliteStore).
 *
 * TDD RED phase: these tests are written FIRST and must FAIL before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonFileStore } from '../../../services/storage/jsonFileStore.js';
import { SqliteStore } from '../../../services/storage/sqliteStore.js';
import type { IInstructionStore } from '../../../services/storage/types.js';
import type { InstructionEntry } from '../../../models/instruction.js';

// ── Test Fixtures ────────────────────────────────────────────────────────────

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

// ── Parameterized Contract Suite ─────────────────────────────────────────────

interface StoreFactory {
  name: string;
  create: () => { store: IInstructionStore; cleanup: () => void };
}

const backends: StoreFactory[] = [
  {
    name: 'JsonFileStore',
    create: () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-store-test-'));
      // Seed the directory with the required marker files
      fs.writeFileSync(path.join(tmpDir, '.index-version'), '0', 'utf-8');
      const store = new JsonFileStore(tmpDir);
      return {
        store,
        cleanup: () => {
          store.close();
          fs.rmSync(tmpDir, { recursive: true, force: true });
        },
      };
    },
  },
  {
    name: 'SqliteStore',
    create: () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-sqlite-test-'));
      const dbPath = path.join(tmpDir, 'test.db');
      const store = new SqliteStore(dbPath);
      return {
        store,
        cleanup: () => {
          store.close();
          fs.rmSync(tmpDir, { recursive: true, force: true });
        },
      };
    },
  },
];

for (const backend of backends) {
  describe(`IInstructionStore contract: ${backend.name}`, () => {
    let store: IInstructionStore;
    let cleanup: () => void;

    beforeEach(() => {
      const ctx = backend.create();
      store = ctx.store;
      cleanup = ctx.cleanup;
    });

    afterEach(() => {
      cleanup();
    });

    // ── Load ───────────────────────────────────────────────────────────

    describe('load()', () => {
      it('returns empty result for empty store', () => {
        const result = store.load();
        expect(result.entries).toEqual([]);
        expect(result.hash).toBeTruthy();
        expect(result.errors).toEqual([]);
      });

      it('returns entries after write', () => {
        store.write(makeEntry({ id: 'test-entry-1' }));
        const result = store.load();
        expect(result.entries.length).toBe(1);
        expect(result.entries[0].id).toBe('test-entry-1');
      });

      it('is idempotent — multiple loads return same data', () => {
        store.write(makeEntry({ id: 'idem-1' }));
        const r1 = store.load();
        const r2 = store.load();
        expect(r1.entries.length).toBe(r2.entries.length);
        expect(r1.hash).toBe(r2.hash);
      });
    });

    // ── Get ────────────────────────────────────────────────────────────

    describe('get()', () => {
      it('returns null for missing ID', () => {
        expect(store.get('nonexistent')).toBeNull();
      });

      it('returns entry after write', () => {
        const entry = makeEntry({ id: 'get-test-1', title: 'Get Test' });
        store.write(entry);
        const result = store.get('get-test-1');
        expect(result).not.toBeNull();
        expect(result!.id).toBe('get-test-1');
        expect(result!.title).toBe('Get Test');
      });

      it('returns null after remove', () => {
        store.write(makeEntry({ id: 'get-rm-1' }));
        store.remove('get-rm-1');
        expect(store.get('get-rm-1')).toBeNull();
      });
    });

    // ── Write ──────────────────────────────────────────────────────────

    describe('write()', () => {
      it('persists a new entry', () => {
        store.write(makeEntry({ id: 'write-1', body: 'Hello' }));
        const entry = store.get('write-1');
        expect(entry).not.toBeNull();
        expect(entry!.body).toBe('Hello');
      });

      it('overwrites an existing entry', () => {
        store.write(makeEntry({ id: 'write-2', body: 'v1' }));
        store.write(makeEntry({ id: 'write-2', body: 'v2' }));
        const entry = store.get('write-2');
        expect(entry!.body).toBe('v2');
      });

      it('does not affect other entries on overwrite', () => {
        store.write(makeEntry({ id: 'write-3a' }));
        store.write(makeEntry({ id: 'write-3b' }));
        store.write(makeEntry({ id: 'write-3a', body: 'updated' }));
        expect(store.get('write-3b')).not.toBeNull();
        expect(store.count()).toBe(2);
      });
    });

    // ── Remove ─────────────────────────────────────────────────────────

    describe('remove()', () => {
      it('removes an existing entry', () => {
        store.write(makeEntry({ id: 'rm-1' }));
        store.remove('rm-1');
        expect(store.get('rm-1')).toBeNull();
      });

      it('is a no-op for missing ID (no throw)', () => {
        expect(() => store.remove('nonexistent-id')).not.toThrow();
      });

      it('decrements count', () => {
        store.write(makeEntry({ id: 'rm-2a' }));
        store.write(makeEntry({ id: 'rm-2b' }));
        expect(store.count()).toBe(2);
        store.remove('rm-2a');
        expect(store.count()).toBe(1);
      });
    });

    // ── List ───────────────────────────────────────────────────────────

    describe('list()', () => {
      beforeEach(() => {
        store.write(makeEntry({ id: 'list-1', categories: ['alpha', 'beta'], contentType: 'instruction' }));
        store.write(makeEntry({ id: 'list-2', categories: ['beta', 'gamma'], contentType: 'template' }));
        store.write(makeEntry({ id: 'list-3', categories: ['alpha'], contentType: 'instruction' }));
      });

      it('returns all entries with no filter', () => {
        expect(store.list().length).toBe(3);
      });

      it('filters by category', () => {
        const result = store.list({ category: 'alpha' });
        expect(result.length).toBe(2);
        expect(result.every(e => e.categories.includes('alpha'))).toBe(true);
      });

      it('filters by contentType', () => {
        const result = store.list({ contentType: 'template' });
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('list-2');
      });

      it('returns empty for non-matching filter', () => {
        expect(store.list({ category: 'nonexistent' }).length).toBe(0);
      });
    });

    // ── Query ──────────────────────────────────────────────────────────

    describe('query()', () => {
      beforeEach(() => {
        store.write(makeEntry({ id: 'q-1', title: 'Security Guide', categories: ['security', 'guide'], priority: 10 }));
        store.write(makeEntry({ id: 'q-2', title: 'Testing Tips', categories: ['testing'], priority: 50 }));
        store.write(makeEntry({ id: 'q-3', title: 'Security Testing', categories: ['security', 'testing'], priority: 30 }));
      });

      it('filters by text (title substring)', () => {
        const result = store.query({ text: 'Security' });
        expect(result.length).toBe(2);
      });

      it('filters by categoriesAny', () => {
        const result = store.query({ categoriesAny: ['testing'] });
        expect(result.length).toBe(2);
      });

      it('filters by categoriesAll', () => {
        const result = store.query({ categoriesAll: ['security', 'testing'] });
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('q-3');
      });

      it('filters by priorityMin/Max', () => {
        const result = store.query({ priorityMin: 20, priorityMax: 50 });
        expect(result.length).toBe(2);
      });

      it('supports offset and limit pagination', () => {
        const all = store.query({});
        const page = store.query({ offset: 1, limit: 1 });
        expect(page.length).toBe(1);
        expect(all.length).toBe(3);
      });

      it('returns empty for non-matching query', () => {
        expect(store.query({ text: 'zzz-nonexistent' }).length).toBe(0);
      });
    });

    // ── Search ─────────────────────────────────────────────────────────

    describe('search()', () => {
      beforeEach(() => {
        store.write(makeEntry({ id: 'srch-1', title: 'Authentication Flow', body: 'JWT tokens for login' }));
        store.write(makeEntry({ id: 'srch-2', title: 'Database Schema', body: 'SQLite tables and indexes' }));
        store.write(makeEntry({ id: 'srch-3', title: 'Auth Middleware', body: 'Express authentication guard' }));
      });

      it('finds entries by keyword in title', () => {
        const result = store.search({ keywords: ['Auth'] });
        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result.some(r => r.id === 'srch-1')).toBe(true);
        expect(result.some(r => r.id === 'srch-3')).toBe(true);
      });

      it('finds entries by keyword in body', () => {
        const result = store.search({ keywords: ['SQLite'] });
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0].id).toBe('srch-2');
      });

      it('returns empty for non-matching keyword', () => {
        expect(store.search({ keywords: ['zzz-nope'] }).length).toBe(0);
      });

      it('respects limit', () => {
        const result = store.search({ keywords: ['Auth'], limit: 1 });
        expect(result.length).toBe(1);
      });

      it('returns results with score > 0', () => {
        const result = store.search({ keywords: ['Auth'] });
        result.forEach(r => expect(r.score).toBeGreaterThan(0));
      });
    });

    // ── Categories ─────────────────────────────────────────────────────

    describe('categories()', () => {
      it('returns empty map for empty store', () => {
        expect(store.categories().size).toBe(0);
      });

      it('returns correct counts', () => {
        store.write(makeEntry({ id: 'cat-1', categories: ['a', 'b'] }));
        store.write(makeEntry({ id: 'cat-2', categories: ['b', 'c'] }));
        const cats = store.categories();
        expect(cats.get('a')).toBe(1);
        expect(cats.get('b')).toBe(2);
        expect(cats.get('c')).toBe(1);
      });
    });

    // ── Hash ───────────────────────────────────────────────────────────

    describe('computeHash()', () => {
      it('returns consistent hash for same entries', () => {
        store.write(makeEntry({ id: 'hash-1' }));
        store.write(makeEntry({ id: 'hash-2' }));
        const h1 = store.computeHash();
        const h2 = store.computeHash();
        expect(h1).toBe(h2);
      });

      it('changes hash when entries change', () => {
        store.write(makeEntry({ id: 'hash-3' }));
        const h1 = store.computeHash();
        store.write(makeEntry({ id: 'hash-4' }));
        const h2 = store.computeHash();
        expect(h1).not.toBe(h2);
      });

      it('returns a hex string', () => {
        store.write(makeEntry({ id: 'hash-5' }));
        const hash = store.computeHash();
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      });
    });

    // ── Count ──────────────────────────────────────────────────────────

    describe('count()', () => {
      it('returns 0 for empty store', () => {
        expect(store.count()).toBe(0);
      });

      it('reflects writes and removes', () => {
        store.write(makeEntry({ id: 'cnt-1' }));
        store.write(makeEntry({ id: 'cnt-2' }));
        expect(store.count()).toBe(2);
        store.remove('cnt-1');
        expect(store.count()).toBe(1);
      });
    });

    // ── Edge Cases ─────────────────────────────────────────────────────

    describe('edge cases', () => {
      it('handles empty store gracefully', () => {
        expect(store.list()).toEqual([]);
        expect(store.query({})).toEqual([]);
        expect(store.search({ keywords: ['x'] })).toEqual([]);
        expect(store.categories().size).toBe(0);
        expect(store.count()).toBe(0);
      });

      it('write then load round-trips all core fields', () => {
        const entry = makeEntry({
          id: 'round-trip-1',
          title: 'Round Trip Test',
          body: 'Full field preservation',
          priority: 25,
          categories: ['cat-a', 'cat-b'],
          contentType: 'reference',
        });
        store.write(entry);
        const loaded = store.get('round-trip-1');
        expect(loaded).not.toBeNull();
        expect(loaded!.title).toBe('Round Trip Test');
        expect(loaded!.body).toBe('Full field preservation');
        expect(loaded!.priority).toBe(25);
        expect(loaded!.categories).toEqual(['cat-a', 'cat-b']);
        expect(loaded!.contentType).toBe('reference');
      });
    });
  });
}
