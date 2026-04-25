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
        body: fs.readFileSync(uploadedBackupPath),
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
});
