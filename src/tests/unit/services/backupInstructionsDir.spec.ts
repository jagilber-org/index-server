/**
 * Phase E1 (spec 006-archive-lifecycle) — shared backup helper test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpRoot: string;
let backupsDir: string;
let instructionsDir: string;

vi.mock('../../../config/runtimeConfig', () => {
  return {
    getRuntimeConfig: () => ({
      dashboard: { admin: { backupsDir } },
      mutation: { maxBulkDelete: 5, backupBeforeBulkDelete: true },
      instructions: {},
      storage: { backend: 'json' },
    }),
  };
});

vi.mock('../../../services/indexContext', () => ({
  getInstructionsDir: () => instructionsDir,
}));

describe('backupInstructionsDir', () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-helper-'));
    backupsDir = path.join(tmpRoot, 'backups');
    instructionsDir = path.join(tmpRoot, 'instructions');
    fs.mkdirSync(instructionsDir, { recursive: true });
    fs.writeFileSync(path.join(instructionsDir, 'alpha.json'), '{"id":"alpha","body":"a"}');
    fs.writeFileSync(path.join(instructionsDir, 'beta.json'), '{"id":"beta","body":"b"}');
  });

  afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* swallow */ }
    vi.resetModules();
  });

  it('creates a zip under the configured backupsDir with the expected name shape', async () => {
    const { backupInstructionsDir } = await import('../../../services/instructionsBackup.js');
    const zipPath = backupInstructionsDir();
    expect(fs.existsSync(zipPath)).toBe(true);
    expect(path.dirname(zipPath)).toBe(backupsDir);
    expect(path.basename(zipPath)).toMatch(/^instructions-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.zip$/);
    const stat = fs.statSync(zipPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('appends a numeric suffix on filename collision', async () => {
    const { backupInstructionsDir } = await import('../../../services/instructionsBackup.js');
    const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(backupsDir, `instructions-${stamp}.zip`), Buffer.alloc(0));
    const zipPath = backupInstructionsDir();
    expect(path.basename(zipPath)).toMatch(/^instructions-\d{4}-\d{2}-\d{2}-\d{4}-\d+\.zip$/);
    expect(fs.existsSync(zipPath)).toBe(true);
  });

  it('handles a missing instructions directory without throwing', async () => {
    fs.rmSync(instructionsDir, { recursive: true, force: true });
    const { backupInstructionsDir } = await import('../../../services/instructionsBackup.js');
    const zipPath = backupInstructionsDir();
    expect(fs.existsSync(zipPath)).toBe(true);
  });
});
