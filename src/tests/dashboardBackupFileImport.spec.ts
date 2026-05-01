import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'dashboard-backup-file-import');
const INSTRUCTIONS_DIR = path.join(TMP_ROOT, 'instructions');
const BACKUPS_DIR = path.join(TMP_ROOT, 'backups');
const UPLOAD_SOURCE_DIR = path.join(TMP_ROOT, 'upload-source');
const ENV_KEYS = [
  'INDEX_SERVER_DIR',
  'INDEX_SERVER_BACKUPS_DIR',
  'INDEX_SERVER_MUTATION',
  'INDEX_SERVER_AUTO_BACKUP',
  'INDEX_SERVER_AUTO_BACKUP_MAX_COUNT',
  'INDEX_SERVER_DASHBOARD_ADMIN_API_KEY',
] as const;

describe('Dashboard backup file import', () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
    }

    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(INSTRUCTIONS_DIR, { recursive: true });
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_SOURCE_DIR, { recursive: true });

    process.env.INDEX_SERVER_DIR = INSTRUCTIONS_DIR;
    process.env.INDEX_SERVER_BACKUPS_DIR = BACKUPS_DIR;
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_AUTO_BACKUP = '0';
    process.env.INDEX_SERVER_AUTO_BACKUP_MAX_COUNT = '5';
    delete process.env.INDEX_SERVER_DASHBOARD_ADMIN_API_KEY;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it('imports a zip backup file even when the uploaded file uses a .json extension, then restores it', async () => {
    vi.resetModules();

    const instruction = {
      id: 'restore-from-file',
      title: 'Restore From File',
      body: 'Recovered from uploaded zip backup',
      categories: ['backup', 'restore'],
    };
    fs.writeFileSync(
      path.join(UPLOAD_SOURCE_DIR, 'restore-from-file.json'),
      JSON.stringify(instruction, null, 2),
      'utf8',
    );

    const uploadedBackupPath = path.join(TMP_ROOT, 'backup_20260416T181546_912.json');

    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    reloadRuntimeConfig();

    const { createZipBackupWithManifest } = await import('../services/backupZip.js');
    createZipBackupWithManifest(UPLOAD_SOURCE_DIR, uploadedBackupPath, {
      type: 'admin-backup',
      createdAt: '2026-04-16T18:15:46.912Z',
      instructionCount: 1,
    });

    const { createDashboardServer } = await import('../dashboard/server/DashboardServer.js');
    const server = createDashboardServer({
      port: 0,
      host: '127.0.0.1',
      enableWebSockets: false,
      maxPortTries: 2,
    });

    const started = await server.start();
    const baseUrl = started.url.replace(/\/$/, '');
    const readyDeadline = Date.now() + 5000;
    while (Date.now() < readyDeadline) {
      try {
        const statusResponse = await fetch(`${baseUrl}/api/status`);
        if (statusResponse.ok) break;
      } catch {
        // wait for the dashboard HTTP stack to accept requests
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    try {
      const importResponse = await fetch(`${baseUrl}/api/admin/maintenance/backup/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          'X-Backup-Filename': path.basename(uploadedBackupPath),
        },
        body: fs.readFileSync(uploadedBackupPath), // lgtm[js/file-access-to-http] — test fixture upload from controlled temp path
      });

      expect(importResponse.ok).toBe(true);
      const importPayload = await importResponse.json() as { success: boolean; backupId?: string; files?: number; };
      expect(importPayload.success).toBe(true);
      expect(importPayload.files).toBe(1);
      expect(importPayload.backupId).toMatch(/^backup_\d{8}T\d{6}_\d{3}$/);

      const backupId = importPayload.backupId!;

      const exportResponse = await fetch(`${baseUrl}/api/admin/maintenance/backup/${encodeURIComponent(backupId)}/export`);
      expect(exportResponse.ok).toBe(true);
      expect(exportResponse.headers.get('content-type')).toContain('application/zip');
      expect(exportResponse.headers.get('content-disposition')).toContain(`${backupId}.zip`);

      const restoreResponse = await fetch(`${baseUrl}/api/admin/maintenance/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId }),
      });

      expect(restoreResponse.ok).toBe(true);
      const restorePayload = await restoreResponse.json() as { success: boolean; restored?: number; };
      expect(restorePayload.success).toBe(true);
      expect(restorePayload.restored).toBe(1);

      const restoredPath = path.join(INSTRUCTIONS_DIR, 'restore-from-file.json');
      expect(fs.existsSync(restoredPath)).toBe(true);
      expect(fs.existsSync(path.join(INSTRUCTIONS_DIR, 'manifest.json'))).toBe(false);
      expect(JSON.parse(fs.readFileSync(restoredPath, 'utf8')).body).toBe('Recovered from uploaded zip backup');
    } finally {
      await server.stop();
    }
  }, 15000);

  it('one-shot Restore from File via ?restore=1 imports + restores in a single request', async () => {
    vi.resetModules();

    // Seed instructions/ with two pre-existing files (the "live" state before restore).
    const preExistingA = { id: 'pre-a', title: 'Pre A', body: 'pre-existing A' };
    const preExistingB = { id: 'pre-b', title: 'Pre B', body: 'pre-existing B' };
    fs.writeFileSync(path.join(INSTRUCTIONS_DIR, 'pre-a.json'), JSON.stringify(preExistingA), 'utf8');
    fs.writeFileSync(path.join(INSTRUCTIONS_DIR, 'pre-b.json'), JSON.stringify(preExistingB), 'utf8');

    // Build the upload payload: three new instructions in a zip backup.
    const uploaded = [
      { id: 'restored-1', title: 'Restored 1', body: 'one' },
      { id: 'restored-2', title: 'Restored 2', body: 'two' },
      { id: 'restored-3', title: 'Restored 3', body: 'three' },
    ];
    for (const inst of uploaded) {
      fs.writeFileSync(path.join(UPLOAD_SOURCE_DIR, `${inst.id}.json`), JSON.stringify(inst), 'utf8');
    }
    const uploadedBackupPath = path.join(TMP_ROOT, 'backup_20260430T120000_001.zip');

    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    reloadRuntimeConfig();

    const { createZipBackupWithManifest } = await import('../services/backupZip.js');
    createZipBackupWithManifest(UPLOAD_SOURCE_DIR, uploadedBackupPath, {
      type: 'admin-backup',
      createdAt: '2026-04-30T12:00:00.001Z',
      instructionCount: uploaded.length,
    });

    // BEFORE: 2 pre-existing instructions, 0 backup zips.
    const beforeFiles = new Set(fs.readdirSync(INSTRUCTIONS_DIR).filter(f => f.toLowerCase().endsWith('.json')));
    expect(beforeFiles.has('pre-a.json')).toBe(true);
    expect(beforeFiles.has('pre-b.json')).toBe(true);
    expect(fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.zip')).length).toBe(0);

    const { createDashboardServer } = await import('../dashboard/server/DashboardServer.js');
    const server = createDashboardServer({
      port: 0,
      host: '127.0.0.1',
      enableWebSockets: false,
      maxPortTries: 2,
    });
    const started = await server.start();
    const baseUrl = started.url.replace(/\/$/, '');
    const readyDeadline = Date.now() + 5000;
    while (Date.now() < readyDeadline) {
      try {
        const statusResponse = await fetch(`${baseUrl}/api/status`);
        if (statusResponse.ok) break;
      } catch { /* retry */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    try {
      const response = await fetch(`${baseUrl}/api/admin/maintenance/backup/import?restore=1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/zip',
          'X-Backup-Filename': path.basename(uploadedBackupPath),
        },
        body: fs.readFileSync(uploadedBackupPath),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json() as {
        success: boolean;
        backupId?: string;
        files?: number;
        restored?: number;
        restored_applied?: boolean;
      };
      expect(payload.success).toBe(true);
      expect(payload.restored_applied).toBe(true);
      expect(payload.files).toBe(uploaded.length);
      expect(payload.restored).toBe(uploaded.length);
      expect(payload.backupId).toMatch(/^backup_\d{8}T\d{6}_\d{3}$/);

      // AFTER: each restored instruction file is present with the uploaded body.
      for (const inst of uploaded) {
        const target = path.join(INSTRUCTIONS_DIR, `${inst.id}.json`);
        expect(fs.existsSync(target), `expected ${inst.id}.json to be restored`).toBe(true);
        expect(JSON.parse(fs.readFileSync(target, 'utf8')).body).toBe(inst.body);
      }

      // The pre-restore safety backup must exist (proves restore path ran, not just import).
      const backupZips = fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.zip'));
      const safetyZip = backupZips.find(f => f.startsWith('pre_restore_'));
      expect(safetyZip, `expected a pre_restore_*.zip in ${backupZips.join(', ')}`).toBeDefined();

      // The imported backup zip is also present and addressable by backupId.
      const importedZip = backupZips.find(f => f === `${payload.backupId}.zip`);
      expect(importedZip, `expected ${payload.backupId}.zip in ${backupZips.join(', ')}`).toBeDefined();
    } finally {
      await server.stop();
    }
  }, 15000);

  it('one-shot ?restore=1 with a JSON bundle imports + restores and returns combined counts', async () => {
    vi.resetModules();

    const { reloadRuntimeConfig } = await import('../config/runtimeConfig.js');
    reloadRuntimeConfig();

    const { createDashboardServer } = await import('../dashboard/server/DashboardServer.js');
    const server = createDashboardServer({ port: 0, host: '127.0.0.1', enableWebSockets: false, maxPortTries: 2 });
    const started = await server.start();
    const baseUrl = started.url.replace(/\/$/, '');
    const readyDeadline = Date.now() + 5000;
    while (Date.now() < readyDeadline) {
      try {
        const statusResponse = await fetch(`${baseUrl}/api/status`);
        if (statusResponse.ok) break;
      } catch { /* retry */ }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    try {
      const bundle = {
        manifest: { type: 'admin-backup', createdAt: '2026-04-30T13:00:00.000Z', instructionCount: 2 },
        files: {
          'json-bundle-a.json': { id: 'json-bundle-a', title: 'JSON A', body: 'A' },
          'json-bundle-b.json': { id: 'json-bundle-b', title: 'JSON B', body: 'B' },
        },
      };

      const beforeFiles = new Set(fs.readdirSync(INSTRUCTIONS_DIR).filter(f => f.toLowerCase().endsWith('.json')));
      // Pre-condition: the two files we are about to restore must NOT already be present
      // (otherwise the test would be trivially satisfied by ambient state).
      expect(beforeFiles.has('json-bundle-a.json')).toBe(false);
      expect(beforeFiles.has('json-bundle-b.json')).toBe(false);

      const response = await fetch(`${baseUrl}/api/admin/maintenance/backup/import?restore=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json() as { success: boolean; restored?: number; restored_applied?: boolean; files?: number; backupId?: string };
      expect(payload.success).toBe(true);
      expect(payload.restored_applied).toBe(true);
      expect(payload.files).toBe(2);
      expect(payload.restored).toBe(2);

      // AFTER: the two restored files exist with the uploaded contents, and the dir grew by exactly 2 .json files.
      expect(fs.existsSync(path.join(INSTRUCTIONS_DIR, 'json-bundle-a.json'))).toBe(true);
      expect(fs.existsSync(path.join(INSTRUCTIONS_DIR, 'json-bundle-b.json'))).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(INSTRUCTIONS_DIR, 'json-bundle-a.json'), 'utf8')).body).toBe('A');
      expect(JSON.parse(fs.readFileSync(path.join(INSTRUCTIONS_DIR, 'json-bundle-b.json'), 'utf8')).body).toBe('B');
      const afterFiles = new Set(fs.readdirSync(INSTRUCTIONS_DIR).filter(f => f.toLowerCase().endsWith('.json')));
      expect(afterFiles.size - beforeFiles.size).toBe(2);
    } finally {
      await server.stop();
    }
  }, 15000);
});
