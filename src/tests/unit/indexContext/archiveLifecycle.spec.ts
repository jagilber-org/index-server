/**
 * IndexContext archive lifecycle tests — spec 006-archive-lifecycle Phase C.
 *
 * Coverage:
 *   - archiveEntry invalidates cache + bumps versionToken
 *   - archiveEntry emits embedding evict(id)
 *   - listArchivedEntries / getArchivedEntry do not invalidate
 *   - restoreEntry happy path, default 'reject' collision, 'overwrite' override
 *   - restoreEntry marks embedding stale (NOT evicted)
 *   - purgeEntry hard-removes + emits evict(id)
 *   - property-flavoured random sequence preserves invariants
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { InstructionEntry } from '../../../models/instruction';

function makeEntry(id: string): InstructionEntry {
  const now = new Date().toISOString();
  return {
    id,
    title: `Title ${id}`,
    body: `Body for ${id}`,
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['t'],
    contentType: 'instruction',
    sourceHash: 'h',
    schemaVersion: '7',
    createdAt: now,
    updatedAt: now,
  } as InstructionEntry;
}

// Each describe block sets up its own temp dir BEFORE importing indexContext
// so the module pins INDEX_SERVER_DIR to the temp directory.
let TEST_DIR: string;
let ic: typeof import('../../../services/indexContext');

async function freshIndexContext(): Promise<typeof import('../../../services/indexContext')> {
  TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'idxctx-archive-'));
  process.env.INDEX_SERVER_DIR = TEST_DIR;
  process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH = path.join(TEST_DIR, 'usage-snapshot.json');
  const mod = await import('../../../services/indexContext.js');
  // Trigger directory repin: getInstructionsDir() resets state when
  // INDEX_SERVER_DIR changes, so this call rebinds module-level state to
  // the fresh temp dir.
  mod.getInstructionsDir();
  mod._resetIndexContextStateForTests();
  mod._resetIndexContextProcessLatches();
  mod.setEmbeddingEvictionHook(null);
  return mod;
}

describe('IndexContext archive lifecycle (Phase C)', () => {
  beforeEach(async () => {
    ic = await freshIndexContext();
  });

  afterEach(() => {
    try { ic.setEmbeddingEvictionHook(null); } catch { /* ignore */ }
    try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('archiveEntry', () => {
    it('removes the id from the active list (next ensureLoaded() misses it)', () => {
      ic.writeEntry(makeEntry('alpha'));
      const before = ic.getIndexState();
      expect(before.byId.has('alpha')).toBe(true);

      ic.archiveEntry('alpha', { archiveReason: 'manual', archiveSource: 'archive' });

      const after = ic.getIndexState();
      expect(after.byId.has('alpha')).toBe(false);
      expect(after.list.find(e => e.id === 'alpha')).toBeUndefined();
    });

    it('bumps the index version token (touchIndexVersion)', () => {
      ic.writeEntry(makeEntry('beta'));
      const before = ic.getIndexState();
      const v0 = before.versionToken;

      ic.archiveEntry('beta');

      const after = ic.getIndexState();
      expect(after.versionToken).not.toBe(v0);
      expect(after.versionToken.length).toBeGreaterThan(0);
    });

    it('invokes embedding evict(id) exactly once', () => {
      ic.writeEntry(makeEntry('gamma'));
      const calls: { method: 'evict' | 'markStale'; id: string }[] = [];
      ic.setEmbeddingEvictionHook({
        evict: (id: string) => calls.push({ method: 'evict', id }),
        markStale: (id: string) => calls.push({ method: 'markStale', id }),
      });

      ic.archiveEntry('gamma');

      expect(calls).toEqual([{ method: 'evict', id: 'gamma' }]);
    });

    it('swallows embedding hook errors (best-effort)', () => {
      ic.writeEntry(makeEntry('delta'));
      ic.setEmbeddingEvictionHook({
        evict: () => { throw new Error('boom'); },
      });
      expect(() => ic.archiveEntry('delta')).not.toThrow();
    });

    it('is a no-op signal when no hook is registered', () => {
      ic.writeEntry(makeEntry('epsilon'));
      // No hook set.
      expect(() => ic.archiveEntry('epsilon')).not.toThrow();
    });
  });

  describe('read accessors (no invalidation)', () => {
    it('listArchivedEntries returns the archived id', () => {
      ic.writeEntry(makeEntry('arc-1'));
      ic.archiveEntry('arc-1', { archiveReason: 'deprecated', archiveSource: 'archive' });

      const archived = ic.listArchivedEntries();
      expect(archived.map(e => e.id)).toContain('arc-1');
      expect(archived.find(e => e.id === 'arc-1')?.archiveReason).toBe('deprecated');
    });

    it('getArchivedEntry returns the entry and does not invalidate state', () => {
      ic.writeEntry(makeEntry('arc-2'));
      ic.archiveEntry('arc-2');

      const tokenBefore = ic.getIndexState().versionToken;
      const got = ic.getArchivedEntry('arc-2');
      expect(got?.id).toBe('arc-2');
      const tokenAfter = ic.getIndexState().versionToken;
      expect(tokenAfter).toBe(tokenBefore);
    });

    it('listArchivedEntries does not invalidate state', () => {
      ic.writeEntry(makeEntry('arc-3'));
      ic.archiveEntry('arc-3');

      const tokenBefore = ic.getIndexState().versionToken;
      ic.listArchivedEntries();
      const tokenAfter = ic.getIndexState().versionToken;
      expect(tokenAfter).toBe(tokenBefore);
    });

    it('computeActiveAndArchiveHashes returns both hashes deterministically', () => {
      ic.writeEntry(makeEntry('active-1'));
      ic.writeEntry(makeEntry('active-2'));
      ic.archiveEntry('active-2');

      const h1 = ic.computeActiveAndArchiveHashes();
      const h2 = ic.computeActiveAndArchiveHashes();
      expect(h1).toEqual(h2);
      expect(h1.active).toMatch(/^[a-f0-9]{64}$/);
      expect(h1.archive).toMatch(/^[a-f0-9]{64}$/);
      expect(h1.active).not.toBe(h1.archive);
    });
  });

  describe('restoreEntry', () => {
    it('moves the entry back to active storage (happy path)', () => {
      ic.writeEntry(makeEntry('r-1'));
      ic.archiveEntry('r-1');
      expect(ic.getArchivedEntry('r-1')).not.toBeNull();

      ic.restoreEntry('r-1');

      expect(ic.getArchivedEntry('r-1')).toBeNull();
      const state = ic.getIndexState();
      expect(state.byId.has('r-1')).toBe(true);
      // Archive metadata must be stripped from the restored entry.
      const restored = state.byId.get('r-1');
      expect(restored?.archivedAt).toBeUndefined();
      expect(restored?.archiveReason).toBeUndefined();
    });

    it('rejects when an active entry with the same id already exists (default mode)', () => {
      ic.writeEntry(makeEntry('r-2'));
      ic.archiveEntry('r-2');
      // Re-introduce an active entry with the same id.
      ic.writeEntry(makeEntry('r-2'));

      expect(() => ic.restoreEntry('r-2')).toThrow(/collision|already exists/i);
    });

    it("mode 'overwrite' succeeds even with an active collision", () => {
      ic.writeEntry({ ...makeEntry('r-3'), title: 'Active version' } as InstructionEntry);
      ic.archiveEntry('r-3');
      ic.writeEntry({ ...makeEntry('r-3'), title: 'Replacement that will be overwritten' } as InstructionEntry);

      ic.restoreEntry('r-3', { mode: 'overwrite' });

      const state = ic.getIndexState();
      const restored = state.byId.get('r-3');
      expect(restored?.title).toBe('Active version');
      expect(ic.getArchivedEntry('r-3')).toBeNull();
    });

    it('emits markStale(id) — NOT evict(id) — on restore', () => {
      ic.writeEntry(makeEntry('r-4'));
      ic.archiveEntry('r-4');

      const calls: { method: 'evict' | 'markStale'; id: string }[] = [];
      ic.setEmbeddingEvictionHook({
        evict: (id: string) => calls.push({ method: 'evict', id }),
        markStale: (id: string) => calls.push({ method: 'markStale', id }),
      });

      ic.restoreEntry('r-4');

      expect(calls).toEqual([{ method: 'markStale', id: 'r-4' }]);
    });
  });

  describe('purgeEntry', () => {
    it('hard-removes from archive store', () => {
      ic.writeEntry(makeEntry('p-1'));
      ic.archiveEntry('p-1');
      expect(ic.getArchivedEntry('p-1')).not.toBeNull();

      ic.purgeEntry('p-1');

      expect(ic.getArchivedEntry('p-1')).toBeNull();
      expect(ic.listArchivedEntries().find(e => e.id === 'p-1')).toBeUndefined();
    });

    it('is a no-op for an unknown id', () => {
      expect(() => ic.purgeEntry('does-not-exist')).not.toThrow();
    });

    it('emits embedding evict(id) on purge', () => {
      ic.writeEntry(makeEntry('p-2'));
      ic.archiveEntry('p-2');

      const calls: { method: 'evict' | 'markStale'; id: string }[] = [];
      ic.setEmbeddingEvictionHook({
        evict: (id: string) => calls.push({ method: 'evict', id }),
        markStale: (id: string) => calls.push({ method: 'markStale', id }),
      });

      ic.purgeEntry('p-2');

      // archive happened before hook was registered, so only the purge should
      // surface in calls — and it must be an evict, never a markStale.
      expect(calls).toEqual([{ method: 'evict', id: 'p-2' }]);
    });
  });

  describe('property-flavoured random sequence', () => {
    // Mulberry32 — deterministic seeded PRNG so failures are reproducible.
    function makeRng(seed: number): () => number {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // pii-allowlist: 2^32 PRNG normalization constant
      };
    }

    it('50 random {add, archive, restore, purge} ops preserve invariants', () => {
      const rng = makeRng(0xC0FFEE);
      const alphabet = ['p-0', 'p-1', 'p-2', 'p-3', 'p-4'];
      const ops = ['add', 'archive', 'restore', 'purge'] as const;

      const archiveHashesForSameSet: Record<string, string> = {};

      for (let i = 0; i < 50; i++) {
        const op = ops[Math.floor(rng() * ops.length)];
        const id = alphabet[Math.floor(rng() * alphabet.length)];
        // Skip ops that would create deliberate active+archive duplication
        // (those are *write-path* concerns, not lifecycle-invariant concerns —
        // the dispatcher gates them in Phase D). For Phase C we only check
        // that lifecycle ops themselves preserve disjointness.
        const isArchived = ic.getArchivedEntry(id) !== null;
        if (op === 'add' && isArchived) continue;
        try {
          if (op === 'add') {
            ic.writeEntry(makeEntry(id));
          } else if (op === 'archive') {
            ic.archiveEntry(id);
          } else if (op === 'restore') {
            ic.restoreEntry(id, { mode: 'overwrite' });
          } else {
            ic.purgeEntry(id);
          }
        } catch {
          // Expected: many random ops will reference absent ids. The
          // invariants below still apply after each (failed or successful) op.
        }

        // Invariant 1: no id appears in both active and archive sets.
        const state = ic.getIndexState();
        const activeIds = new Set(state.list.map(e => e.id));
        const archivedIds = new Set(ic.listArchivedEntries().map(e => e.id));
        for (const aid of archivedIds) {
          expect(activeIds.has(aid)).toBe(false);
        }

        // Invariant 2: archive hash is deterministic for the same archive set.
        const archiveKey = [...archivedIds].sort().join('|');
        const { archive } = ic.computeActiveAndArchiveHashes();
        if (archiveHashesForSameSet[archiveKey] !== undefined) {
          // Note: the per-entry archivedAt timestamp is part of the archive
          // projection (see computeArchiveHashFromEntries), so re-archiving
          // the same id at a different time yields a different hash. We
          // therefore only assert determinism within a single observation
          // of the set — i.e. consecutive calls without intervening writes.
          const second = ic.computeActiveAndArchiveHashes();
          expect(second.archive).toBe(archive);
        }
        archiveHashesForSameSet[archiveKey] = archive;
      }
    });

    it('active hash stable for unchanged active set across archive churn', () => {
      ic.writeEntry(makeEntry('stable-1'));
      ic.writeEntry(makeEntry('stable-2'));
      ic.writeEntry(makeEntry('churn'));

      const hashBefore = ic.computeActiveAndArchiveHashes().active;

      ic.archiveEntry('churn');
      const hashMidArchived = ic.computeActiveAndArchiveHashes().active;
      expect(hashMidArchived).not.toBe(hashBefore);

      ic.purgeEntry('churn');
      const hashAfterPurge = ic.computeActiveAndArchiveHashes().active;
      // Active set after purge is { stable-1, stable-2 } — same as after
      // archive (both removed 'churn' from active). Hash must match.
      expect(hashAfterPurge).toBe(hashMidArchived);
    });
  });
});
