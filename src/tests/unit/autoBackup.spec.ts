/**
 * Tests for automatic periodic backup of instructions Index.
 * RED-GREEN: Tests written first, implementation follows.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
