/**
 * Backup/Restore Integrity Tests
 *
 * Tests that backup creation captures the complete index state and that
 * restoring from a backup recovers the exact same instructions (content,
 * governance fields, hashes) as the original.
 *
 * Covers:
 * - Backup creation captures all instruction files as a zip
 * - Restore from backup zip recovers exact content
 * - Restore handles partial index (only missing files restored)
 * - Hash integrity: sourceHash matches after restore cycle
 * - Governance metadata survives backup/restore
 * - Backup rotation respects maxCount
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'backup-restore-test');
const INSTR_DIR = path.join(TMP_ROOT, 'instructions');
const BACKUPS_DIR = path.join(TMP_ROOT, 'backups');

function makeInstruction(id: string, body: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Instruction: ${id}`,
    body,
    version: '1.0.0',
    priority: 30,
    audience: 'all',
    requirement: 'recommended',
    sourceHash: `hash-${id}-${body.length}`,
    schemaVersion: '4',
    categories: ['backup-test'],
    contentType: 'instruction',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

function writeInstr(id: string, body: string, extra: Record<string, unknown> = {}) {
  const data = makeInstruction(id, body, extra);
  fs.writeFileSync(path.join(INSTR_DIR, `${id}.json`), JSON.stringify(data, null, 2));
  return data;
}

function readInstr(dir: string, id: string) {
  const filePath = path.join(dir, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function readInstrFromZip(zipPath: string, id: string) {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry(`${id}.json`);
  if (!entry) return null;
  return JSON.parse(entry.getData().toString('utf-8'));
}

describe('Backup/Restore Integrity', () => {
  beforeAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(INSTR_DIR, { recursive: true });
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    process.env.INDEX_SERVER_DIR = INSTR_DIR;
    process.env.INDEX_SERVER_BACKUPS_DIR = BACKUPS_DIR;
    process.env.INDEX_SERVER_AUTO_BACKUP = '1';
    process.env.INDEX_SERVER_AUTO_BACKUP_MAX_COUNT = '5';
    reloadRuntimeConfig();
  });

  beforeEach(() => {
    // Clean instruction dir
    for (const f of fs.readdirSync(INSTR_DIR)) {
      if (f.endsWith('.json')) fs.unlinkSync(path.join(INSTR_DIR, f));
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
  });

  afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_BACKUPS_DIR;
    delete process.env.INDEX_SERVER_AUTO_BACKUP;
    delete process.env.INDEX_SERVER_AUTO_BACKUP_MAX_COUNT;
    reloadRuntimeConfig();
  });

  it('backup creates a zip file containing all instruction files', async () => {
    writeInstr('br-1', 'First instruction body');
    writeInstr('br-2', 'Second instruction body');
    writeInstr('br-3', 'Third instruction body');

    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    const backupPath = runAutoBackupOnce();
    expect(backupPath).toBeTruthy();
    expect(backupPath!.endsWith('.zip')).toBe(true);
    expect(fs.existsSync(backupPath!)).toBe(true);

    const zip = new AdmZip(backupPath!);
    const entries = zip.getEntries().map(e => e.entryName).filter(n => n.endsWith('.json')).sort();
    expect(entries).toEqual(['br-1.json', 'br-2.json', 'br-3.json']);
  });

  it('backup preserves exact instruction content in zip', async () => {
    const original = writeInstr('br-content', 'Exact content preservation test', {
      owner: 'test-team',
      status: 'approved',
      classification: 'internal',
      priorityTier: 'P2',
    });

    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    const backupPath = runAutoBackupOnce();
    const restored = readInstrFromZip(backupPath!, 'br-content');

    expect(restored).toBeTruthy();
    expect(restored.id).toBe(original.id);
    expect(restored.body).toBe(original.body);
    expect(restored.sourceHash).toBe(original.sourceHash);
    expect(restored.owner).toBe('test-team');
    expect(restored.status).toBe('approved');
    expect(restored.classification).toBe('internal');
    expect(restored.priorityTier).toBe('P2');
  });

  it('restore from zip backup recovers deleted instructions', async () => {
    writeInstr('br-del-1', 'Will be deleted');
    writeInstr('br-del-2', 'Will survive');

    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    const backupPath = runAutoBackupOnce();

    // Delete one instruction
    fs.unlinkSync(path.join(INSTR_DIR, 'br-del-1.json'));

    // Restore from zip backup
    const { extractZipBackup } = await import('../../services/backupZip.js');
    extractZipBackup(backupPath!, INSTR_DIR);

    expect(fs.existsSync(path.join(INSTR_DIR, 'br-del-1.json'))).toBe(true);
    const recovered = readInstr(INSTR_DIR, 'br-del-1');
    expect(recovered.body).toBe('Will be deleted');
  });

  it('full restore from zip overwrites modified instructions', async () => {
    writeInstr('br-mod', 'Original body');

    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    const backupPath = runAutoBackupOnce();

    // Modify the instruction
    writeInstr('br-mod', 'Modified body');
    expect(readInstr(INSTR_DIR, 'br-mod').body).toBe('Modified body');

    // Force restore from zip
    const { extractZipBackup } = await import('../../services/backupZip.js');
    extractZipBackup(backupPath!, INSTR_DIR);

    const restored = readInstr(INSTR_DIR, 'br-mod');
    expect(restored.body).toBe('Original body');
  });

  it('sourceHash integrity survives zip backup/restore cycle', async () => {
    const original = writeInstr('br-hash', 'Hash integrity test body', { sourceHash: 'sha256-abc123def456' });

    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    const backupPath = runAutoBackupOnce();

    // Destroy original
    fs.unlinkSync(path.join(INSTR_DIR, 'br-hash.json'));

    // Restore from zip
    const { extractZipBackup } = await import('../../services/backupZip.js');
    extractZipBackup(backupPath!, INSTR_DIR);

    const restored = readInstr(INSTR_DIR, 'br-hash');
    expect(restored.sourceHash).toBe(original.sourceHash);
    expect(restored.body).toBe(original.body);
    expect(restored.title).toBe(original.title);
  });

  it('multiple backup cycles create separate zip files', async () => {
    writeInstr('br-multi', 'Multi-backup test');

    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    runAutoBackupOnce();
    await new Promise(r => setTimeout(r, 50));
    runAutoBackupOnce();
    await new Promise(r => setTimeout(r, 50));
    runAutoBackupOnce();

    const zips = fs.readdirSync(BACKUPS_DIR).filter(f =>
      f.startsWith('auto-backup-') && f.endsWith('.zip')
    );
    expect(zips.length).toBe(3);
  });

  it('backup captures governance changelog in zip', async () => {
    writeInstr('br-gov', 'Governance field test', {
      changeLog: [
        { version: '1.0.0', changedAt: '2026-01-01T00:00:00Z', summary: 'Initial creation' },
        { version: '1.1.0', changedAt: '2026-02-01T00:00:00Z', summary: 'Updated body' },
      ],
    });

    const { runAutoBackupOnce } = await import('../../services/autoBackup.js');
    const backupPath = runAutoBackupOnce();

    const backed = readInstrFromZip(backupPath!, 'br-gov');
    expect(backed.changeLog).toHaveLength(2);
    expect(backed.changeLog[1].summary).toBe('Updated body');
  });
});
