/**
 * Regression: dashboard restore must refresh the live in-memory index.
 *
 * RCA 2026-05-01 (dev port 8687): user uploaded a 702-file zip backup via the
 * dashboard "Restore from File" action. Files were extracted to disk, but the
 * Overview tab kept showing 2 instructions (the seed bootstrap pair). Two
 * gaps were diagnosed:
 *
 *  1. JSON backend: AdminPanel.restoreBackup writes JSON files under
 *     instructionsRoot but never calls invalidate()/ensureLoaded(), so the
 *     cached IndexContext state continues to reflect the pre-restore set.
 *
 *  2. SQLite backend: the JSON files on disk are NOT the source of truth. The
 *     SQLite store at storage.sqlitePath is. Extracting the zip to disk has
 *     zero effect on what IndexContext.load() returns. The restore code path
 *     must re-ingest the just-written JSON files into SQLite and invalidate
 *     the cache.
 *
 * These tests pin both behaviours.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import { _resetIndexContextStateForTests, getIndexState } from '../../services/indexContext';
import { createZipBackupWithManifest } from '../../services/backupZip';
import { migrateJsonToSqlite } from '../../services/storage/migrationEngine';
import { AdminPanel } from '../../dashboard/server/AdminPanel';

interface TestEnv {
  instructionsDir: string;
  backupsDir: string;
  sqlitePath: string;
  zipPath: string;
  zipBackupId: string;
}

function makeInstruction(id: string): Record<string, unknown> {
  return {
    id,
    title: `Test instruction ${id}`,
    body: `Body for ${id}`,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['test'],
    contentType: 'instruction',
    createdAt: new Date().toISOString(),
    firstSeenTs: new Date().toISOString(),
    schemaVersion: '4',
  };
}

function writeInstructions(dir: string, ids: string[]): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ids) {
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify(makeInstruction(id), null, 2),
      'utf8',
    );
  }
}

function makeTempEnv(prefix: string): TestEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `restore-${prefix}-`));
  const instructionsDir = path.join(root, 'instructions');
  const backupsDir = path.join(root, 'backups');
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(instructionsDir, { recursive: true });
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    instructionsDir,
    backupsDir,
    sqlitePath: path.join(dataDir, 'index.db'),
    zipPath: '',
    zipBackupId: '',
  };
}

function buildBackupZip(
  env: TestEnv,
  ids: string[],
): { backupId: string; zipPath: string } {
  // Build a separate staging dir with the desired entries, zip it, drop the zip in backupsDir.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-staging-'));
  writeInstructions(staging, ids);
  const backupId = `backup_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const zipPath = path.join(env.backupsDir, `${backupId}.zip`);
  createZipBackupWithManifest(staging, zipPath, {
    type: 'test',
    createdAt: new Date().toISOString(),
    source: 'unit-test',
    originalCount: ids.length,
  });
  fs.rmSync(staging, { recursive: true, force: true });
  return { backupId, zipPath };
}

function applyEnv(env: TestEnv, backend: 'json' | 'sqlite'): void {
  process.env.INDEX_SERVER_DIR = env.instructionsDir;
  process.env.INDEX_SERVER_BACKUPS_DIR = env.backupsDir;
  process.env.INDEX_SERVER_STORAGE_BACKEND = backend;
  process.env.INDEX_SERVER_SQLITE_PATH = env.sqlitePath;
  // Disable noisy/slow ancillary features.
  process.env.INDEX_SERVER_AUTO_SEED = '0';
  process.env.INDEX_SERVER_SQLITE_MIGRATE_ON_START = '0';
  reloadRuntimeConfig();
  _resetIndexContextStateForTests();
}

describe('AdminPanel.restoreBackup refreshes the live index', () => {
  let env: TestEnv;

  beforeEach(() => {
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_BACKUPS_DIR;
    delete process.env.INDEX_SERVER_STORAGE_BACKEND;
    delete process.env.INDEX_SERVER_SQLITE_PATH;
    delete process.env.INDEX_SERVER_AUTO_SEED;
    delete process.env.INDEX_SERVER_SQLITE_MIGRATE_ON_START;
  });

  afterEach(() => {
    _resetIndexContextStateForTests();
    if (env && fs.existsSync(env.instructionsDir)) {
      try { fs.rmSync(path.dirname(env.instructionsDir), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('JSON backend: getIndexState reflects restored entries (5), not pre-restore (2)', () => {
    env = makeTempEnv('json');
    applyEnv(env, 'json');

    // Pre-condition: 2 entries on disk, loaded into memory.
    writeInstructions(env.instructionsDir, ['pre-a', 'pre-b']);
    const before = getIndexState();
    expect(before.list.length).toBe(2);

    // Build a 5-entry backup zip.
    const { backupId } = buildBackupZip(env, ['x1', 'x2', 'x3', 'x4', 'x5']);

    // Act.
    const panel = new AdminPanel();
    const result = panel.restoreBackup(backupId);

    // Disk side-effect succeeded.
    expect(result.success).toBe(true);
    expect(result.restored).toBe(5);
    const onDisk = fs.readdirSync(env.instructionsDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    expect(onDisk.length).toBeGreaterThanOrEqual(5);

    // BUG CHECK: live index MUST surface the just-restored entries.
    // Today this fails because restoreBackup never invalidates the cache.
    const after = getIndexState();
    const ids = Array.from(after.byId.keys());
    for (const id of ['x1', 'x2', 'x3', 'x4', 'x5']) {
      expect(ids, `restored id ${id} missing from live index`).toContain(id);
    }
  });

  it('SQLite backend: getIndexState reflects restored entries (5) after restore', () => {
    env = makeTempEnv('sqlite');
    applyEnv(env, 'sqlite');

    // Seed SQLite with 2 rows by writing JSON then migrating.
    writeInstructions(env.instructionsDir, ['seed-a', 'seed-b']);
    const seedRes = migrateJsonToSqlite(env.instructionsDir, env.sqlitePath);
    expect(seedRes.migrated).toBe(2);
    // Remove on-disk JSON so it can't accidentally satisfy the assertion via
    // a JSON backend code path; the SQLite DB is now the only source of truth.
    for (const f of fs.readdirSync(env.instructionsDir)) {
      fs.unlinkSync(path.join(env.instructionsDir, f));
    }
    _resetIndexContextStateForTests();

    const before = getIndexState();
    expect(before.list.length).toBe(2);
    expect(Array.from(before.byId.keys()).sort()).toEqual(['seed-a', 'seed-b']);

    // Build a 5-entry backup zip.
    const { backupId } = buildBackupZip(env, ['r1', 'r2', 'r3', 'r4', 'r5']);

    // Act.
    const panel = new AdminPanel();
    const result = panel.restoreBackup(backupId);
    expect(result.success).toBe(true);
    expect(result.restored).toBe(5);

    // Live index (under sqlite backend, sourced from the DB) MUST surface
    // the just-restored entries. Today this fails because the JSON files
    // were extracted to disk but never re-ingested into the SQLite store.
    const after = getIndexState();
    const ids = Array.from(after.byId.keys());
    for (const id of ['r1', 'r2', 'r3', 'r4', 'r5']) {
      expect(ids, `restored id ${id} missing from live index`).toContain(id);
    }
  });
});
