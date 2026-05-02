/**
 * Regression: dev dashboard sluggishness RCA.
 *
 * Symptom (live, observed 2026-05-01 on port 8687):
 *   - Every dashboard request → ensureLoaded() → migrateJsonToSqlite()
 *   - jsonFiles.length (713) > sqlite row count (707) is permanently true when
 *     a few JSON files fail loader validation, so the auto-migration block
 *     re-fires on every load tick.
 *   - Each call INSERT-OR-REPLACEs all rows → unbounded WAL growth (1.21 GB
 *     over a few minutes) → 16–48 second route latency, ~50% steady CPU.
 *
 * Constitution alignment:
 *   - TS-9: every bug fix begins with a failing regression test.
 *   - TS-12: ≥5 scenarios for bug-prone paths (this file covers 5).
 *   - maxTestDurationMs: 5000 (these tests are pure unit, ~ms each).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const ENV_KEYS = [
  'INDEX_SERVER_DIR',
  'INDEX_SERVER_STORAGE_BACKEND',
  'INDEX_SERVER_SQLITE_PATH',
  'INDEX_SERVER_SQLITE_MIGRATE_ON_START',
] as const;

let savedEnv: Partial<Record<typeof ENV_KEYS[number], string | undefined>> = {};
let baseDir: string;
let dbPath: string;

function snapshotEnv() {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

beforeEach(() => {
  snapshotEnv();
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-loop-'));
  dbPath = path.join(baseDir, 'idx.db');
  // .index-version marker so ensureLoaded short-circuits cleanly between calls
  fs.writeFileSync(path.join(baseDir, '.index-version'), '0', 'utf8');
  // Create a malformed JSON to permanently keep jsonFiles.length > sqlite row count
  fs.writeFileSync(path.join(baseDir, 'orphan.json'), '{not valid json}', 'utf8');
  process.env.INDEX_SERVER_DIR = baseDir;
  process.env.INDEX_SERVER_STORAGE_BACKEND = 'sqlite';
  process.env.INDEX_SERVER_SQLITE_PATH = dbPath;
  process.env.INDEX_SERVER_SQLITE_MIGRATE_ON_START = '1';
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('../../services/storage/migrationEngine.js');
  vi.resetModules();
  // sqlite handles may keep the db file locked on Windows even after resetModules;
  // assertions already ran, so swallow EPERM/EBUSY rather than fail teardown.
  try { fs.rmSync(baseDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  restoreEnv();
});

describe('ensureLoaded auto-migration loop guard', () => {
  it('1) calls migrateJsonToSqlite at most once across many ensureLoaded() invocations (mismatched counts)', async () => {
    const migrateSpy = vi.fn(() => ({ migrated: 0, errors: [] as { file: string; error: string }[] }));
    vi.doMock('../../services/storage/migrationEngine.js', async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return { ...real, migrateJsonToSqlite: migrateSpy };
    });
    const ctx = await import('../../services/indexContext.js');
    const internal = ctx as unknown as { _resetIndexContextProcessLatches?: () => void };
    internal._resetIndexContextProcessLatches?.();

    for (let i = 0; i < 6; i++) {
      ctx.invalidate();
      try { ctx.ensureLoaded(); } catch { /* loader may complain about malformed json — irrelevant */ }
    }
    expect(migrateSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('2) does not retry migration after a successful migrate (migrated > 0)', async () => {
    const migrateSpy = vi.fn(() => ({ migrated: 5, errors: [] as { file: string; error: string }[] }));
    vi.doMock('../../services/storage/migrationEngine.js', async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return { ...real, migrateJsonToSqlite: migrateSpy };
    });
    const ctx = await import('../../services/indexContext.js');
    const internal = ctx as unknown as { _resetIndexContextProcessLatches?: () => void };
    internal._resetIndexContextProcessLatches?.();

    for (let i = 0; i < 4; i++) {
      ctx.invalidate();
      try { ctx.ensureLoaded(); } catch { /* ignore */ }
    }
    expect(migrateSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('3) does not retry migration after a thrown error inside migrateJsonToSqlite', async () => {
    const migrateSpy = vi.fn(() => { throw new Error('simulated migration failure'); });
    vi.doMock('../../services/storage/migrationEngine.js', async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return { ...real, migrateJsonToSqlite: migrateSpy };
    });
    const ctx = await import('../../services/indexContext.js');
    const internal = ctx as unknown as { _resetIndexContextProcessLatches?: () => void };
    internal._resetIndexContextProcessLatches?.();

    for (let i = 0; i < 5; i++) {
      ctx.invalidate();
      try { ctx.ensureLoaded(); } catch { /* ignore */ }
    }
    expect(migrateSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('4) honours sqliteMigrateOnStart=false: migrate is never called', async () => {
    process.env.INDEX_SERVER_SQLITE_MIGRATE_ON_START = '0';
    vi.resetModules();
    const migrateSpy = vi.fn(() => ({ migrated: 0, errors: [] as { file: string; error: string }[] }));
    vi.doMock('../../services/storage/migrationEngine.js', async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return { ...real, migrateJsonToSqlite: migrateSpy };
    });
    const ctx = await import('../../services/indexContext.js');
    const internal = ctx as unknown as { _resetIndexContextProcessLatches?: () => void };
    internal._resetIndexContextProcessLatches?.();

    for (let i = 0; i < 3; i++) {
      ctx.invalidate();
      try { ctx.ensureLoaded(); } catch { /* ignore */ }
    }
    expect(migrateSpy.mock.calls.length).toBe(0);
  });

  it('5) _resetIndexContextProcessLatches re-arms migration (test isolation hook)', async () => {
    const migrateSpy = vi.fn(() => ({ migrated: 0, errors: [] as { file: string; error: string }[] }));
    vi.doMock('../../services/storage/migrationEngine.js', async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return { ...real, migrateJsonToSqlite: migrateSpy };
    });
    const ctx = await import('../../services/indexContext.js');
    const internal = ctx as unknown as { _resetIndexContextProcessLatches?: () => void };

    internal._resetIndexContextProcessLatches?.();
    ctx.invalidate();
    try { ctx.ensureLoaded(); } catch { /* ignore */ }
    const before = migrateSpy.mock.calls.length;

    // Reset latch — next ensureLoaded should be allowed to migrate again.
    internal._resetIndexContextProcessLatches?.();
    ctx.invalidate();
    try { ctx.ensureLoaded(); } catch { /* ignore */ }
    const after = migrateSpy.mock.calls.length;

    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThanOrEqual(2);
  });
});
