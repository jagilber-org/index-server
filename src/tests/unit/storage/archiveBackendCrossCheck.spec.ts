/**
 * Cross-backend parity expansion for the archive lifecycle (Phase G1).
 *
 * Spec 006-archive-lifecycle, REQ-4 / REQ-5 / REQ-6 / REQ-13 / REQ-23.
 *
 * The existing `archiveContract.spec.ts` exercises each backend independently
 * against the same test bodies. This file expands parity by driving an
 * IDENTICAL operation sequence against *both* backends in the same test and
 * asserting that observable outputs (counts, ids, hashes, listArchived
 * ordering, getArchived payload shape) are byte-identical or
 * semantically-identical across `JsonFileStore` and `SqliteStore`.
 *
 * Coverage targets:
 *   - archive(id, meta) idempotency (re-archive of already-archived id throws
 *     on both backends).
 *   - restore(id) collision behaviour: 'reject' vs 'overwrite' return shape.
 *   - listArchived() filter parity: reason / source / archivedBy /
 *     restoreEligible / pagination / ordering.
 *   - getArchived() hit + miss byte-identical between backends.
 *   - purgeArchive removes only from archive side; active store untouched.
 *   - computeArchiveHash() stable across no-op reads.
 *   - migration of a v6 entry through JSON + SQLite ends up at schemaVersion '7'.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonFileStore } from '../../../services/storage/jsonFileStore.js';
import { SqliteStore } from '../../../services/storage/sqliteStore.js';
import type { IInstructionStore, ArchiveMeta } from '../../../services/storage/types.js';
import type { InstructionEntry, ArchiveReason, ArchiveSource } from '../../../models/instruction.js';
import { migrateInstructionRecord } from '../../../versioning/schemaVersion.js';

function makeEntry(id: string, over: Partial<InstructionEntry> = {}): InstructionEntry {
  const now = '2025-01-01T00:00:00.000Z';
  return {
    id,
    title: `T:${id}`,
    body: `Body for ${id}`,
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['general'],
    contentType: 'instruction',
    sourceHash: 'h',
    schemaVersion: '7',
    createdAt: now,
    updatedAt: now,
    ...over,
  } as InstructionEntry;
}

/**
 * Normalize an entry for byte-comparison between backends. The SQLite path
 * round-trips through column projection so a few fields can become null vs
 * undefined; we drop falsy/empty optional fields before deep-equal.
 */
function normalize(e: InstructionEntry | null): Record<string, unknown> | null {
  if (e === null) return null;
  // Usage counters live in a sidecar on JSON but as columns on SQLite; they
  // can differ between backends after archive (SQLite preserves the row's
  // counter columns at 0, JSON has no sidecar entry yet). Strip them.
  const USAGE_KEYS = new Set(['usageCount', 'firstSeenTs', 'lastUsedAt', 'lastAction', 'lastSignal', 'lastComment']);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) {
    if (USAGE_KEYS.has(k)) continue;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

interface DualStore {
  jsonDir: string;
  dbDir: string;
  json: IInstructionStore;
  sqlite: IInstructionStore;
  cleanup: () => void;
}

function makeDualStore(): DualStore {
  const jsonDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-xcheck-json-'));
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-xcheck-sql-'));
  fs.writeFileSync(path.join(jsonDir, '.index-version'), '0', 'utf-8');
  const json = new JsonFileStore(jsonDir);
  const sqlite = new SqliteStore(path.join(dbDir, 'x.db'));
  return {
    jsonDir,
    dbDir,
    json,
    sqlite,
    cleanup: () => {
      try { json.close(); } catch { /* ignore */ }
      try { sqlite.close(); } catch { /* ignore */ }
      try { fs.rmSync(jsonDir, { recursive: true, force: true }); } catch { /* ignore */ }
      try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/** Apply `op` to both stores and assert the same return/error behaviour. */
function applyOnBoth<T>(d: DualStore, op: (s: IInstructionStore) => T): { json: T | { threw: string }, sqlite: T | { threw: string } } {
  function safe(s: IInstructionStore): T | { threw: string } {
    try { return op(s); }
    catch (e) { return { threw: e instanceof Error ? e.constructor.name : 'Error' }; }
  }
  return { json: safe(d.json), sqlite: safe(d.sqlite) };
}

describe('cross-backend parity expansion (Phase G1)', () => {
  let d: DualStore;

  beforeEach(() => { d = makeDualStore(); });
  afterEach(() => { d.cleanup(); });

  describe('archive idempotency', () => {
    it('re-archiving an already-archived id throws on both backends', () => {
      d.json.write(makeEntry('a'));
      d.sqlite.write(makeEntry('a'));
      d.json.archive('a', { archiveReason: 'manual', archiveSource: 'archive' });
      d.sqlite.archive('a', { archiveReason: 'manual', archiveSource: 'archive' });

      const r = applyOnBoth(d, s => s.archive('a', { archiveReason: 'manual', archiveSource: 'archive' }));
      expect('threw' in (r.json as object)).toBe(true);
      expect('threw' in (r.sqlite as object)).toBe(true);

      // Archive set still has exactly one entry on each backend.
      expect(d.json.countArchived()).toBe(1);
      expect(d.sqlite.countArchived()).toBe(1);
    });
  });

  describe('restore collision parity', () => {
    it('default mode rejects on both, "overwrite" succeeds on both', () => {
      // Seed both with an active entry, archive it, then re-create active.
      for (const s of [d.json, d.sqlite]) {
        s.write(makeEntry('c1', { title: 'Archived' }));
        s.archive('c1', { archiveReason: 'manual', archiveSource: 'archive' });
        s.write(makeEntry('c1', { title: 'Live' }));
      }

      const rejected = applyOnBoth(d, s => s.restore('c1'));
      expect('threw' in (rejected.json as object)).toBe(true);
      expect('threw' in (rejected.sqlite as object)).toBe(true);

      const okJson = d.json.restore('c1', 'overwrite');
      const okSql = d.sqlite.restore('c1', 'overwrite');
      expect(okJson.title).toBe('Archived');
      expect(okSql.title).toBe('Archived');
      // Archive set empty on both
      expect(d.json.countArchived()).toBe(0);
      expect(d.sqlite.countArchived()).toBe(0);
    });

    it('restoreEligible=false is enforced identically on both backends', () => {
      for (const s of [d.json, d.sqlite]) {
        s.write(makeEntry('lock'));
        s.archive('lock', { archiveReason: 'duplicate-merge', archiveSource: 'groom', restoreEligible: false });
      }
      const r = applyOnBoth(d, s => s.restore('lock'));
      expect('threw' in (r.json as object)).toBe(true);
      expect('threw' in (r.sqlite as object)).toBe(true);
      // overwrite must NOT bypass eligibility (security invariant per REQ-7)
      const ro = applyOnBoth(d, s => s.restore('lock', 'overwrite'));
      expect('threw' in (ro.json as object)).toBe(true);
      expect('threw' in (ro.sqlite as object)).toBe(true);
    });
  });

  describe('listArchived filter & ordering parity', () => {
    function seed(s: IInstructionStore): void {
      // 6 archived entries with varied metadata
      const recipe: Array<{ id: string; reason: ArchiveReason; source: ArchiveSource; by: string; eligible: boolean; ts: string }> = [
        { id: 'd1', reason: 'manual',         source: 'archive', by: 'alice', eligible: true,  ts: '2024-01-01T00:00:00.000Z' },
        { id: 'd2', reason: 'deprecated',     source: 'groom',   by: 'bob',   eligible: true,  ts: '2024-01-02T00:00:00.000Z' },
        { id: 'd3', reason: 'manual',         source: 'archive', by: 'alice', eligible: false, ts: '2024-01-03T00:00:00.000Z' },
        { id: 'd4', reason: 'superseded',     source: 'groom',   by: 'bob',   eligible: true,  ts: '2024-01-04T00:00:00.000Z' },
        { id: 'd5', reason: 'duplicate-merge',source: 'groom',   by: 'bob',   eligible: false, ts: '2024-01-05T00:00:00.000Z' },
        { id: 'd6', reason: 'legacy-scope',   source: 'groom',   by: 'carol', eligible: true,  ts: '2024-01-06T00:00:00.000Z' },
      ];
      for (const r of recipe) {
        s.write(makeEntry(r.id));
        const meta: ArchiveMeta = {
          archiveReason: r.reason,
          archiveSource: r.source,
          archivedBy: r.by,
          restoreEligible: r.eligible,
          archivedAt: r.ts,
        };
        s.archive(r.id, meta);
      }
    }

    it.each([
      { name: 'no-filter',          opts: undefined },
      { name: 'reason=manual',      opts: { reason: 'manual' as ArchiveReason } },
      { name: 'source=groom',       opts: { source: 'groom' as ArchiveSource } },
      { name: 'archivedBy=bob',     opts: { archivedBy: 'bob' } },
      { name: 'restoreEligible=false', opts: { restoreEligible: false } },
      { name: 'limit=2',            opts: { limit: 2 } },
      { name: 'limit=3 offset=2',   opts: { limit: 3, offset: 2 } },
      { name: 'offset=4 only',      opts: { offset: 4 } },
    ])('listArchived parity for $name', ({ opts }) => {
      seed(d.json);
      seed(d.sqlite);
      const j = d.json.listArchived(opts).map(e => e.id);
      const s = d.sqlite.listArchived(opts).map(e => e.id);
      expect(s).toEqual(j);
    });

    it('archive hash matches between backends for the same archive set', () => {
      seed(d.json);
      seed(d.sqlite);
      const hj = d.json.computeArchiveHash();
      const hs = d.sqlite.computeArchiveHash();
      expect(hs).toBe(hj);
    });

    it('archive hash is stable across multiple no-op read invocations', () => {
      seed(d.json);
      seed(d.sqlite);
      const j1 = d.json.computeArchiveHash();
      const s1 = d.sqlite.computeArchiveHash();
      // Read operations should not perturb the hash.
      d.json.listArchived();
      d.json.getArchived('d1');
      d.sqlite.listArchived();
      d.sqlite.getArchived('d1');
      expect(d.json.computeArchiveHash()).toBe(j1);
      expect(d.sqlite.computeArchiveHash()).toBe(s1);
    });
  });

  describe('getArchived hit/miss parity', () => {
    it('hit returns semantically-identical payloads across backends', () => {
      const meta: ArchiveMeta = {
        archiveReason: 'manual',
        archiveSource: 'archive',
        archivedBy: 'tester',
        restoreEligible: true,
        archivedAt: '2024-06-01T00:00:00.000Z',
      };
      d.json.write(makeEntry('g1', { title: 'Same', body: 'identical' }));
      d.json.archive('g1', meta);
      d.sqlite.write(makeEntry('g1', { title: 'Same', body: 'identical' }));
      d.sqlite.archive('g1', meta);

      const nj = normalize(d.json.getArchived('g1'));
      const ns = normalize(d.sqlite.getArchived('g1'));
      expect(ns).toEqual(nj);
    });

    it('miss returns null on both backends (not undefined, not throw)', () => {
      expect(d.json.getArchived('nope')).toBeNull();
      expect(d.sqlite.getArchived('nope')).toBeNull();
    });
  });

  describe('purge isolation parity', () => {
    it('purge removes only from archive; active set unchanged on both backends', () => {
      for (const s of [d.json, d.sqlite]) {
        s.write(makeEntry('live'));
        s.write(makeEntry('dead'));
        s.archive('dead', { archiveReason: 'manual', archiveSource: 'archive' });
      }

      const liveHashJsonBefore = d.json.computeHash();
      const liveHashSqlBefore = d.sqlite.computeHash();

      d.json.purge('dead');
      d.sqlite.purge('dead');

      // active untouched
      expect(d.json.computeHash()).toBe(liveHashJsonBefore);
      expect(d.sqlite.computeHash()).toBe(liveHashSqlBefore);
      // archive emptied
      expect(d.json.countArchived()).toBe(0);
      expect(d.sqlite.countArchived()).toBe(0);
      // active count == 1 on both
      expect(d.json.count()).toBe(1);
      expect(d.sqlite.count()).toBe(1);
    });
  });

  describe('v6 → v7 migration parity', () => {
    it('a v6 raw record migrates to v7 and writes successfully into both backends', () => {
      const v6 = {
        id: 'old',
        title: 'Old entry',
        body: 'body',
        priority: 50,
        audience: 'all',
        requirement: 'recommended',
        categories: ['general'],
        contentType: 'instruction',
        sourceHash: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        schemaVersion: '6',
      } as Record<string, unknown>;

      const result = migrateInstructionRecord(v6);
      expect(result.changed).toBe(true);
      expect(v6.schemaVersion).toBe('7');

      d.json.write(v6 as unknown as InstructionEntry);
      d.sqlite.write(v6 as unknown as InstructionEntry);

      const aj = d.json.get('old');
      const as = d.sqlite.get('old');
      expect(aj?.schemaVersion).toBe('7');
      expect(as?.schemaVersion).toBe('7');
      // Active hashes must match across backends for the migrated record
      expect(d.sqlite.computeHash()).toBe(d.json.computeHash());
    });
  });
});
