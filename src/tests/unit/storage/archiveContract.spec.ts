/**
 * Backend-agnostic contract tests for the archive lifecycle methods on
 * IInstructionStore (spec 006-archive-lifecycle Phase B).
 *
 * Parameterized over JsonFileStore and SqliteStore so both backends share an
 * identical observable contract. Tests are written before the implementation
 * is wired up (TDD RED) and must FAIL against the B1 stub implementations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonFileStore } from '../../../services/storage/jsonFileStore.js';
import { SqliteStore } from '../../../services/storage/sqliteStore.js';
import type { IInstructionStore } from '../../../services/storage/types.js';
import type { InstructionEntry } from '../../../models/instruction.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

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
    schemaVersion: '7',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as InstructionEntry;
}

interface StoreFactory {
  name: string;
  create: () => { store: IInstructionStore; cleanup: () => void };
}

const backends: StoreFactory[] = [
  {
    name: 'JsonFileStore',
    create: () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-archive-json-'));
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
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-archive-sqlite-'));
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
  describe(`IInstructionStore archive contract: ${backend.name}`, () => {
    let store: IInstructionStore;
    let cleanup: () => void;

    beforeEach(() => {
      const ctx = backend.create();
      store = ctx.store;
      cleanup = ctx.cleanup;
    });

    afterEach(() => cleanup());

    // ── archive() ─────────────────────────────────────────────────────

    describe('archive()', () => {
      it('moves an active entry into the archive store atomically', () => {
        store.write(makeEntry({ id: 'arc-1' }));
        const archived = store.archive('arc-1', {
          archivedBy: 'tester',
          archiveReason: 'manual',
          archiveSource: 'archive',
        });

        expect(archived.id).toBe('arc-1');
        expect(archived.archivedAt).toBeTruthy();
        expect(archived.archiveReason).toBe('manual');
        expect(archived.archiveSource).toBe('archive');
        expect(archived.archivedBy).toBe('tester');

        // gone from active
        expect(store.get('arc-1')).toBeNull();
        expect(store.list()).toHaveLength(0);

        // present in archive
        expect(store.getArchived('arc-1')).not.toBeNull();
        expect(store.countArchived()).toBe(1);
      });

      it('defaults restoreEligible to true and stamps archivedAt', () => {
        store.write(makeEntry({ id: 'arc-def' }));
        const archived = store.archive('arc-def', { archiveReason: 'manual', archiveSource: 'archive' });
        expect(archived.restoreEligible).toBe(true);
        expect(archived.archivedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
      });

      it('respects explicit restoreEligible:false', () => {
        store.write(makeEntry({ id: 'arc-locked' }));
        store.archive('arc-locked', {
          archiveReason: 'duplicate-merge',
          archiveSource: 'groom',
          restoreEligible: false,
        });
        const got = store.getArchived('arc-locked');
        expect(got?.restoreEligible).toBe(false);
      });

      it('throws when archiving an unknown id', () => {
        expect(() => store.archive('does-not-exist')).toThrow();
      });

      it('leaves the active entry intact if archive fails (no-active-id case)', () => {
        // No active entry — archive must throw, no half-state created.
        expect(() => store.archive('ghost', { archiveReason: 'manual', archiveSource: 'archive' })).toThrow();
        expect(store.getArchived('ghost')).toBeNull();
        expect(store.countArchived()).toBe(0);
      });

      it('archives multiple distinct ids independently', () => {
        store.write(makeEntry({ id: 'a' }));
        store.write(makeEntry({ id: 'b' }));
        store.write(makeEntry({ id: 'c' }));
        store.archive('a', { archiveReason: 'manual', archiveSource: 'archive' });
        store.archive('b', { archiveReason: 'deprecated', archiveSource: 'groom' });
        expect(store.countArchived()).toBe(2);
        expect(store.count()).toBe(1);
        expect(store.get('c')).not.toBeNull();
      });
    });

    // ── restore() ─────────────────────────────────────────────────────

    describe('restore()', () => {
      it('moves an archived entry back into active storage atomically', () => {
        store.write(makeEntry({ id: 'r-1', title: 'Original' }));
        store.archive('r-1', { archiveReason: 'manual', archiveSource: 'archive' });
        expect(store.get('r-1')).toBeNull();

        const restored = store.restore('r-1');
        expect(restored.id).toBe('r-1');
        expect(store.get('r-1')).not.toBeNull();
        expect(store.getArchived('r-1')).toBeNull();
        expect(store.countArchived()).toBe(0);
      });

      it('rejects when an active entry with the same id exists (default mode)', () => {
        store.write(makeEntry({ id: 'coll-1' }));
        store.archive('coll-1', { archiveReason: 'manual', archiveSource: 'archive' });
        // Recreate an active entry with the same id
        store.write(makeEntry({ id: 'coll-1', title: 'New Active' }));

        expect(() => store.restore('coll-1')).toThrow(/collid|exist|conflict/i);
        // Archive copy must still be present (atomic rollback)
        expect(store.getArchived('coll-1')).not.toBeNull();
        expect(store.get('coll-1')?.title).toBe('New Active');
      });

      it('overwrites active entry when mode = "overwrite"', () => {
        store.write(makeEntry({ id: 'coll-2', title: 'Archived Title' }));
        store.archive('coll-2', { archiveReason: 'manual', archiveSource: 'archive' });
        store.write(makeEntry({ id: 'coll-2', title: 'Live Title' }));

        const restored = store.restore('coll-2', 'overwrite');
        expect(restored.title).toBe('Archived Title');
        expect(store.get('coll-2')?.title).toBe('Archived Title');
        expect(store.getArchived('coll-2')).toBeNull();
      });

      it('throws when restoreEligible is false', () => {
        store.write(makeEntry({ id: 'locked' }));
        store.archive('locked', {
          archiveReason: 'duplicate-merge',
          archiveSource: 'groom',
          restoreEligible: false,
        });
        expect(() => store.restore('locked')).toThrow(/restore.*eligibl|ineligible/i);
        // Still in archive
        expect(store.getArchived('locked')).not.toBeNull();
      });

      it('throws when restoring an unknown id', () => {
        expect(() => store.restore('does-not-exist')).toThrow();
      });
    });

    // ── purge() ───────────────────────────────────────────────────────

    describe('purge()', () => {
      it('permanently removes an archived entry', () => {
        store.write(makeEntry({ id: 'p-1' }));
        store.archive('p-1', { archiveReason: 'manual', archiveSource: 'archive' });
        store.purge('p-1');
        expect(store.getArchived('p-1')).toBeNull();
        expect(store.countArchived()).toBe(0);
      });

      it('is a no-op when the id does not exist in the archive', () => {
        expect(() => store.purge('never-archived')).not.toThrow();
      });

      it('does not affect the active store', () => {
        store.write(makeEntry({ id: 'live' }));
        store.write(makeEntry({ id: 'dead' }));
        store.archive('dead', { archiveReason: 'manual', archiveSource: 'archive' });
        store.purge('dead');
        expect(store.get('live')).not.toBeNull();
        expect(store.count()).toBe(1);
      });
    });

    // ── getArchived / listArchived / countArchived ────────────────────

    describe('reads', () => {
      it('listArchived() returns empty when no entries are archived', () => {
        expect(store.listArchived()).toEqual([]);
        expect(store.countArchived()).toBe(0);
      });

      it('listArchived() filters by reason', () => {
        store.write(makeEntry({ id: 'l1' }));
        store.write(makeEntry({ id: 'l2' }));
        store.write(makeEntry({ id: 'l3' }));
        store.archive('l1', { archiveReason: 'manual', archiveSource: 'archive' });
        store.archive('l2', { archiveReason: 'deprecated', archiveSource: 'groom' });
        store.archive('l3', { archiveReason: 'manual', archiveSource: 'archive' });

        const manual = store.listArchived({ reason: 'manual' });
        expect(manual.map(e => e.id).sort()).toEqual(['l1', 'l3']);
      });

      it('listArchived() respects limit / offset', () => {
        for (const id of ['x1', 'x2', 'x3', 'x4', 'x5']) {
          store.write(makeEntry({ id }));
          store.archive(id, { archiveReason: 'manual', archiveSource: 'archive' });
        }
        const page = store.listArchived({ limit: 2, offset: 0 });
        expect(page.length).toBe(2);
      });

      it('getArchived() returns null when not found', () => {
        expect(store.getArchived('missing')).toBeNull();
      });
    });

    // ── computeArchiveHash ────────────────────────────────────────────

    describe('computeArchiveHash()', () => {
      it('returns identical hashes for identical archive contents (determinism)', () => {
        store.write(makeEntry({ id: 'h1' }));
        store.write(makeEntry({ id: 'h2' }));
        store.archive('h1', { archiveReason: 'manual', archiveSource: 'archive', archivedAt: '2024-01-01T00:00:00.000Z' });
        store.archive('h2', { archiveReason: 'deprecated', archiveSource: 'groom', archivedAt: '2024-01-02T00:00:00.000Z' });

        const h1 = store.computeArchiveHash();
        const h2 = store.computeArchiveHash();
        expect(h1).toBe(h2);
        expect(h1).toMatch(/^[a-f0-9]{64}$/);
      });

      it('changes when archive set changes', () => {
        store.write(makeEntry({ id: 'h1' }));
        store.archive('h1', { archiveReason: 'manual', archiveSource: 'archive' });
        const before = store.computeArchiveHash();

        store.write(makeEntry({ id: 'h2' }));
        store.archive('h2', { archiveReason: 'manual', archiveSource: 'archive' });
        const after = store.computeArchiveHash();
        expect(before).not.toBe(after);
      });

      it('is unaffected by active-set changes', () => {
        store.write(makeEntry({ id: 'a1' }));
        store.archive('a1', { archiveReason: 'manual', archiveSource: 'archive', archivedAt: '2024-01-01T00:00:00.000Z' });
        const before = store.computeArchiveHash();

        // Mutate active set only
        store.write(makeEntry({ id: 'active-only' }));
        const after = store.computeArchiveHash();
        expect(before).toBe(after);
      });

      it('returns a stable empty-set hash when nothing is archived', () => {
        const empty1 = store.computeArchiveHash();
        const empty2 = store.computeArchiveHash();
        expect(empty1).toBe(empty2);
      });
    });

    // ── Cross-cutting invariants ─────────────────────────────────────

    describe('invariants', () => {
      it('an id is never present in both active and archive at rest', () => {
        store.write(makeEntry({ id: 'inv-1' }));
        store.archive('inv-1', { archiveReason: 'manual', archiveSource: 'archive' });
        expect(store.get('inv-1')).toBeNull();
        expect(store.getArchived('inv-1')).not.toBeNull();

        store.restore('inv-1');
        expect(store.get('inv-1')).not.toBeNull();
        expect(store.getArchived('inv-1')).toBeNull();
      });

      it('archive/restore round-trip preserves entry payload', () => {
        const original = makeEntry({
          id: 'rt-1',
          title: 'RoundTrip',
          body: 'Body content',
          categories: ['alpha', 'beta'],
          priority: 17,
        });
        store.write(original);
        store.archive('rt-1', { archiveReason: 'manual', archiveSource: 'archive' });
        const restored = store.restore('rt-1');

        expect(restored.id).toBe('rt-1');
        expect(restored.title).toBe('RoundTrip');
        expect(restored.body).toBe('Body content');
        expect(restored.categories).toEqual(['alpha', 'beta']);
        expect(restored.priority).toBe(17);
      });

      it('sequential archive operations remain consistent (concurrent-like)', () => {
        const ids = ['s1', 's2', 's3', 's4'];
        for (const id of ids) store.write(makeEntry({ id }));
        for (const id of ids) store.archive(id, { archiveReason: 'manual', archiveSource: 'archive' });

        expect(store.count()).toBe(0);
        expect(store.countArchived()).toBe(4);

        store.restore('s2');
        store.purge('s3');

        expect(store.count()).toBe(1);
        expect(store.countArchived()).toBe(2);
        expect(store.get('s2')).not.toBeNull();
        expect(store.getArchived('s3')).toBeNull();
      });
    });
  });
}
