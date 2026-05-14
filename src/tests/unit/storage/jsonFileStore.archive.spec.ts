/**
 * JsonFileStore archive-specific tests (spec 006-archive-lifecycle Phase B3.2):
 * - Active load() skips dot-prefixed subdirectories (.archive/, .backups/, .tmp/).
 * - archive() is crash-safe: failed unlink rolls back the archive write.
 * - restore() is crash-safe: failed archive unlink rolls back the active write.
 * - No id ever appears in both active and .archive/ at rest, even after a failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JsonFileStore } from '../../../services/storage/jsonFileStore.js';
import type { InstructionEntry } from '../../../models/instruction.js';

function makeEntry(overrides: Partial<InstructionEntry> & { id: string }): InstructionEntry {
  const now = new Date().toISOString();
  return {
    title: `Test ${overrides.id}`,
    body: `Body for ${overrides.id}`,
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['t'],
    contentType: 'instruction',
    sourceHash: 'h',
    schemaVersion: '7',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as InstructionEntry;
}

describe('JsonFileStore — archive layout', () => {
  let dir: string;
  let store: JsonFileStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-archive-test-'));
    store = new JsonFileStore(dir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('load() dot-dir skip', () => {
    it('does not surface entries under .archive/ as active', () => {
      store.write(makeEntry({ id: 'active-1' }));
      store.archive('active-1', { archiveReason: 'manual', archiveSource: 'archive' });

      // Sanity: file landed in .archive/
      const archivePath = path.join(dir, '.archive', 'active-1.json');
      expect(fs.existsSync(archivePath)).toBe(true);

      // Fresh store instance to force a real load() from disk
      const fresh = new JsonFileStore(dir);
      const result = fresh.load();
      expect(result.entries.find(e => e.id === 'active-1')).toBeUndefined();
      fresh.close();
    });

    it('ignores any dot-prefixed subdirectory (e.g. .backups, .tmp)', () => {
      fs.mkdirSync(path.join(dir, '.backups'));
      fs.writeFileSync(path.join(dir, '.backups', 'should-not-load.json'), JSON.stringify(makeEntry({ id: 'phantom' })));
      fs.mkdirSync(path.join(dir, '.tmp'));
      fs.writeFileSync(path.join(dir, '.tmp', 'leftover.json'), JSON.stringify(makeEntry({ id: 'tmp-phantom' })));

      const fresh = new JsonFileStore(dir);
      const result = fresh.load();
      expect(result.entries.find(e => e.id === 'phantom')).toBeUndefined();
      expect(result.entries.find(e => e.id === 'tmp-phantom')).toBeUndefined();
      fresh.close();
    });

    it('listArchived() only walks .archive/ (not the active root)', () => {
      store.write(makeEntry({ id: 'live-only' }));
      const archived = store.listArchived();
      expect(archived).toEqual([]);
    });
  });

  describe('archive() atomicity & rollback', () => {
    it('rolls back the archive write if the active unlink fails', () => {
      store.write(makeEntry({ id: 'rollback-1' }));

      // Force unlinkSync to throw on the active file path.
      const activePath = path.join(dir, 'rollback-1.json');
      const spy = vi.spyOn(fs, 'unlinkSync').mockImplementation((p: fs.PathLike) => {
        if (p === activePath) {
          throw Object.assign(new Error('simulated unlink failure'), { code: 'EPERM' });
        }
        return (spy.getMockImplementation() as never);
      });
      // Restore the real impl for everything except the targeted path. We do
      // this by capturing the original first:
      spy.mockRestore();
      const original = fs.unlinkSync;
      const failing = vi.spyOn(fs, 'unlinkSync').mockImplementation((p: fs.PathLike) => {
        if (typeof p === 'string' && p === activePath) {
          throw Object.assign(new Error('simulated unlink failure'), { code: 'EPERM' });
        }
        return original(p);
      });

      expect(() => store.archive('rollback-1', { archiveReason: 'manual', archiveSource: 'archive' }))
        .toThrow(/unlink failure/);

      failing.mockRestore();

      // Invariant: active file still exists, no archive duplicate.
      expect(fs.existsSync(activePath)).toBe(true);
      expect(fs.existsSync(path.join(dir, '.archive', 'rollback-1.json'))).toBe(false);
    });

    it('produces a real archive file via atomic rename (temp file does not linger)', () => {
      store.write(makeEntry({ id: 'atomic-1' }));
      store.archive('atomic-1', { archiveReason: 'manual', archiveSource: 'archive' });

      const archiveDir = path.join(dir, '.archive');
      const files = fs.readdirSync(archiveDir);
      // Only the real file, no `.atomic-1.json.<hex>.tmp` artifacts.
      expect(files).toContain('atomic-1.json');
      expect(files.filter(f => f.endsWith('.tmp'))).toEqual([]);
    });

    it('never leaves the same id present in both active and .archive/', () => {
      store.write(makeEntry({ id: 'inv' }));
      store.archive('inv', { archiveReason: 'manual', archiveSource: 'archive' });
      expect(fs.existsSync(path.join(dir, 'inv.json'))).toBe(false);
      expect(fs.existsSync(path.join(dir, '.archive', 'inv.json'))).toBe(true);
    });
  });

  describe('restore() atomicity', () => {
    it('rolls back the active write if the archive unlink fails (reject mode)', () => {
      store.write(makeEntry({ id: 'rb-2' }));
      store.archive('rb-2', { archiveReason: 'manual', archiveSource: 'archive' });

      const archivePath = path.join(dir, '.archive', 'rb-2.json');
      const activePath = path.join(dir, 'rb-2.json');
      const original = fs.unlinkSync;
      const failing = vi.spyOn(fs, 'unlinkSync').mockImplementation((p: fs.PathLike) => {
        if (typeof p === 'string' && p === archivePath) {
          throw Object.assign(new Error('simulated archive-unlink failure'), { code: 'EPERM' });
        }
        return original(p);
      });

      expect(() => store.restore('rb-2')).toThrow(/archive-unlink failure/);
      failing.mockRestore();

      // Invariant: active file rolled back; archive file still present.
      expect(fs.existsSync(activePath)).toBe(false);
      expect(fs.existsSync(archivePath)).toBe(true);
    });
  });
});
