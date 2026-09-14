/**
 * Tests for automatic periodic backup of instructions Index.
 * RED-GREEN: Tests written first, implementation follows.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'auto-backup-test-instructions');
const BACKUPS_DIR = path.join(process.cwd(), 'tmp', 'auto-backup-test-backups');

function seedInstruction(id: string) {
  const file = path.join(TMP_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({
    id, title: `Test ${id}`, body: 'test body', version: '1.0.0',
    priority: 5, audience: 'all', requirement: 'optional',
    sourceHash: 'abc123', schemaVersion: '4.0.0',
  }));
}

describe('auto-backup service', () => {
  beforeAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.rmSync(BACKUPS_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    process.env.INDEX_SERVER_BACKUPS_DIR = BACKUPS_DIR;
    process.env.INDEX_SERVER_AUTO_BACKUP = '1';
    process.env.INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS = '500';
    process.env.INDEX_SERVER_AUTO_BACKUP_MAX_COUNT = '3';
    reloadRuntimeConfig();
  });

  beforeEach(() => {
    // Re-seed instructions for each test
    for (const f of fs.readdirSync(TMP_DIR)) {
      if (f.endsWith('.json')) fs.unlinkSync(path.join(TMP_DIR, f));
    }
    // Clean backup dir
    for (const d of fs.readdirSync(BACKUPS_DIR)) {
      const full = path.join(BACKUPS_DIR, d);
      if (fs.statSync(full).isDirectory()) {
        fs.rmSync(full, { recursive: true, force: true });
      } else {
        fs.unlinkSync(full);
      }
    }
    for (let i = 1; i <= 3; i++) seedInstruction(`instr-${i}`);
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.rmSync(BACKUPS_DIR, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_BACKUPS_DIR;
    delete process.env.INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS;
    delete process.env.INDEX_SERVER_AUTO_BACKUP_MAX_COUNT;
    reloadRuntimeConfig();
  });

  it('exports startAutoBackup and stopAutoBackup functions', async () => {
    const mod = await import('../../services/autoBackup.js');
    expect(typeof mod.startAutoBackup).toBe('function');
    expect(typeof mod.stopAutoBackup).toBe('function');
  });

  it('creates a backup zip with instruction files on trigger', async () => {
    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    const backupPath = runAutoBackupOnce();
    expect(backupPath).toBeTruthy();
    expect(backupPath!.endsWith('.zip')).toBe(true);
    expect(fs.existsSync(backupPath!)).toBe(true);
    const zip = new AdmZip(backupPath!);
    const files = zip.getEntries().map(e => e.entryName).filter(n => n.endsWith('.json'));
    expect(files.length).toBe(3);
  });

  it('backup zip name contains auto-backup prefix', async () => {
    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    const backupPath = runAutoBackupOnce();
    expect(path.basename(backupPath!)).toMatch(/^auto-backup-.*\.zip$/);
  });

  it('skips backup when instructions directory is empty', async () => {
    // Remove all instructions
    for (const f of fs.readdirSync(TMP_DIR)) {
      if (f.endsWith('.json')) fs.unlinkSync(path.join(TMP_DIR, f));
    }
    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    const backupPath = runAutoBackupOnce();
    expect(backupPath).toBeNull();
  });

  it('rotates old backups when exceeding maxCount', async () => {
    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    // Create 4 backups (maxCount=3), oldest should be pruned
    for (let i = 0; i < 4; i++) {
      runAutoBackupOnce();
      // Small delay to ensure unique timestamps
      await new Promise(r => setTimeout(r, 50));
    }
    const remaining = fs.readdirSync(BACKUPS_DIR).filter(f =>
      f.startsWith('auto-backup-') && f.endsWith('.zip')
    );
    expect(remaining.length).toBeLessThanOrEqual(3);
  });

  it('startAutoBackup returns a timer handle, stopAutoBackup clears it', async () => {
    const { startAutoBackup, stopAutoBackup } = await import('../../services/autoBackup.js');
    const handle = startAutoBackup();
    expect(handle).toBeTruthy();
    stopAutoBackup();
    // Should not throw when called again
    stopAutoBackup();
  });
});

describe('auto-backup source/target configuration guard', () => {
  const GUARD_BACKUPS_DIR = path.join(process.cwd(), 'tmp', 'auto-backup-guard-backups');
  let savedDir: string | undefined;
  let savedBackups: string | undefined;
  let savedAllow: string | undefined;

  beforeEach(async () => {
    const { stopAutoBackup } = await import('../../services/autoBackup.js');
    stopAutoBackup();
    savedDir = process.env.INDEX_SERVER_DIR;
    savedBackups = process.env.INDEX_SERVER_BACKUPS_DIR;
    savedAllow = process.env.INDEX_SERVER_AUTO_BACKUP_ALLOW_IMPLICIT_DIR;
    fs.rmSync(GUARD_BACKUPS_DIR, { recursive: true, force: true });
    fs.mkdirSync(GUARD_BACKUPS_DIR, { recursive: true });
    process.env.INDEX_SERVER_AUTO_BACKUP = '1';
    delete process.env.INDEX_SERVER_AUTO_BACKUP_ALLOW_IMPLICIT_DIR;
  });

  afterEach(async () => {
    const { stopAutoBackup } = await import('../../services/autoBackup.js');
    stopAutoBackup();
    if (savedDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = savedDir;
    if (savedBackups === undefined) delete process.env.INDEX_SERVER_BACKUPS_DIR;
    else process.env.INDEX_SERVER_BACKUPS_DIR = savedBackups;
    if (savedAllow === undefined) delete process.env.INDEX_SERVER_AUTO_BACKUP_ALLOW_IMPLICIT_DIR;
    else process.env.INDEX_SERVER_AUTO_BACKUP_ALLOW_IMPLICIT_DIR = savedAllow;
    fs.rmSync(GUARD_BACKUPS_DIR, { recursive: true, force: true });
    reloadRuntimeConfig();
  });

  it('reports a mismatch when the backup target is explicit but the source is not', async () => {
    delete process.env.INDEX_SERVER_DIR;
    process.env.INDEX_SERVER_BACKUPS_DIR = GUARD_BACKUPS_DIR;
    reloadRuntimeConfig();
    const { getAutoBackupSourceMismatch } = await import('../../services/autoBackup.js');
    const mismatch = getAutoBackupSourceMismatch();
    expect(mismatch).toBeTruthy();
    expect(mismatch).toContain('INDEX_SERVER_DIR');
  });

  it('refuses to start and writes nothing when source and target are mismatched', async () => {
    delete process.env.INDEX_SERVER_DIR;
    process.env.INDEX_SERVER_BACKUPS_DIR = GUARD_BACKUPS_DIR;
    reloadRuntimeConfig();
    const { startAutoBackup, runAutoBackupOnce } = await import('../../services/autoBackup.js');
    expect(startAutoBackup()).toBeNull();
    expect(runAutoBackupOnce()).toBeNull();
    expect(fs.readdirSync(GUARD_BACKUPS_DIR)).toHaveLength(0);
  });

  it('reports no mismatch when both source and target are explicit', async () => {
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    process.env.INDEX_SERVER_BACKUPS_DIR = GUARD_BACKUPS_DIR;
    reloadRuntimeConfig();
    const { getAutoBackupSourceMismatch } = await import('../../services/autoBackup.js');
    expect(getAutoBackupSourceMismatch()).toBeNull();
  });

  it('reports no mismatch when neither source nor target is explicit', async () => {
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_BACKUPS_DIR;
    reloadRuntimeConfig();
    const { getAutoBackupSourceMismatch } = await import('../../services/autoBackup.js');
    expect(getAutoBackupSourceMismatch()).toBeNull();
  });

  it('treats an empty INDEX_SERVER_DIR as not set', async () => {
    process.env.INDEX_SERVER_DIR = '   ';
    process.env.INDEX_SERVER_BACKUPS_DIR = GUARD_BACKUPS_DIR;
    reloadRuntimeConfig();
    const { getAutoBackupSourceMismatch } = await import('../../services/autoBackup.js');
    expect(getAutoBackupSourceMismatch()).toBeTruthy();
  });

  it('allows the mismatch when the explicit opt-in escape hatch is set', async () => {
    delete process.env.INDEX_SERVER_DIR;
    process.env.INDEX_SERVER_BACKUPS_DIR = GUARD_BACKUPS_DIR;
    process.env.INDEX_SERVER_AUTO_BACKUP_ALLOW_IMPLICIT_DIR = '1';
    reloadRuntimeConfig();
    const { getAutoBackupSourceMismatch } = await import('../../services/autoBackup.js');
    expect(getAutoBackupSourceMismatch()).toBeNull();
  });
});

describe('auto-backup derives its target from the index source', () => {
  const ROOT = path.join(process.cwd(), 'tmp', 'auto-backup-derived');
  const SOURCE_DIR = path.join(ROOT, 'my-index');
  const DERIVED_BACKUPS_DIR = path.join(ROOT, 'backups');
  let savedDir: string | undefined;
  let savedBackups: string | undefined;

  beforeEach(async () => {
    const { stopAutoBackup } = await import('../../services/autoBackup.js');
    stopAutoBackup();
    savedDir = process.env.INDEX_SERVER_DIR;
    savedBackups = process.env.INDEX_SERVER_BACKUPS_DIR;
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(SOURCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(SOURCE_DIR, 'derived-1.json'), JSON.stringify({
      id: 'derived-1', title: 'Derived', body: 'body', version: '1.0.0',
      priority: 5, audience: 'all', requirement: 'optional',
      sourceHash: 'abc123', schemaVersion: '4.0.0',
    }));
    process.env.INDEX_SERVER_DIR = SOURCE_DIR;
    delete process.env.INDEX_SERVER_BACKUPS_DIR;
    process.env.INDEX_SERVER_AUTO_BACKUP = '1';
    reloadRuntimeConfig();
  });

  afterEach(async () => {
    const { stopAutoBackup } = await import('../../services/autoBackup.js');
    stopAutoBackup();
    if (savedDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = savedDir;
    if (savedBackups === undefined) delete process.env.INDEX_SERVER_BACKUPS_DIR;
    else process.env.INDEX_SERVER_BACKUPS_DIR = savedBackups;
    fs.rmSync(ROOT, { recursive: true, force: true });
    reloadRuntimeConfig();
  });

  it('resolves backupsDir as a sibling of INDEX_SERVER_DIR when no backups dir is configured', async () => {
    const { getRuntimeConfig } = await import('../../config/runtimeConfig.js');
    expect(getRuntimeConfig().dashboard.admin.backupsDir).toBe(DERIVED_BACKUPS_DIR);
  });

  it('reports no mismatch and writes the backup next to the index without any backup env vars', async () => {
    const { getAutoBackupSourceMismatch, runAutoBackupOnce } = await import('../../services/autoBackup.js');
    expect(getAutoBackupSourceMismatch()).toBeNull();
    const backupPath = runAutoBackupOnce();
    expect(backupPath).toBeTruthy();
    expect(path.dirname(backupPath!)).toBe(DERIVED_BACKUPS_DIR);
    const files = new AdmZip(backupPath!).getEntries().map(e => e.entryName);
    expect(files).toContain('derived-1.json');
  });

  it('falls back to STATE_ROOT/backups when INDEX_SERVER_DIR is unset', async () => {
    // This case previously asserted the historical `<cwd>/backups` default.
    // That default is the #577 defect: with no catalog configured, the "source"
    // this suite derives from is itself only a cwd fallback
    // (`<cwd>/instructions`), so the sibling rule resolved into whatever
    // directory the MCP client was launched from — writing a rotating, hourly,
    // ten-deep copy of the whole catalog into an unrelated project folder, one
    // private copy per client.
    //
    // The sibling-of-source rule that the two cases above pin is deliberate and
    // is UNCHANGED: when the operator names a catalog, the backup still follows
    // it, and `getAutoBackupSourceMismatch()` still polices that relationship.
    // Only the no-catalog case moved, because there is no source to follow.
    delete process.env.INDEX_SERVER_DIR;
    reloadRuntimeConfig();
    const { getRuntimeConfig } = await import('../../config/runtimeConfig.js');
    const { STATE_ROOT } = await import('../../config/configUtils.js');

    const resolved = getRuntimeConfig().dashboard.admin.backupsDir;
    expect(resolved).toBe(path.join(STATE_ROOT, 'backups'));
    expect(resolved.startsWith(process.cwd())).toBe(false);
  });
});
