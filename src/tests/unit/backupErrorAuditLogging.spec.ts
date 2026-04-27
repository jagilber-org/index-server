/**
 * AdminPanel Backup Error Audit Logging Tests — Issue #121 (audit hook gap)
 *
 * Validates that AdminPanel backup operations not only surface errors to the
 * caller (UI) but also persist them to the audit trail via logAudit().
 *
 * Without these audit entries, backup failures leave no durable trace beyond
 * stderr — defeating the integrity guarantees the dashboard claims to provide.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-audit-test-'));
const auditFile = path.join(tmpDir, 'audit.log.jsonl');
process.env.INDEX_SERVER_AUDIT_LOG = auditFile;

describe('AdminPanel backup error audit logging (issue #121)', () => {
  let panel: import('../../dashboard/server/AdminPanel.js').AdminPanel;
  let auditMod: typeof import('../../services/auditLog.js');
  let backupRoot: string;
  const createdEntries: string[] = [];

  beforeAll(async () => {
    auditMod = await import('../../services/auditLog.js');
    auditMod.resetAuditLogCache();
    const adminMod = await import('../../dashboard/server/AdminPanel.js');
    panel = adminMod.getAdminPanel();
    backupRoot = path.join(process.cwd(), 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
  });

  beforeEach(() => {
    if (fs.existsSync(auditFile)) fs.writeFileSync(auditFile, '', 'utf8'); // lgtm[js/file-system-race] — test reset between cases; race acceptable in test infra
    auditMod.resetAuditLogCache();
  });

  afterAll(() => {
    for (const entry of createdEntries) {
      try { fs.rmSync(entry, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  function readAuditActions(): { action: string; meta?: Record<string, unknown>; ids?: string[] }[] {
    const result = auditMod.readAuditEntries();
    return result.entries.map(e => ({ action: e.action, meta: e.meta, ids: e.ids }));
  }

  it('listBackups: records audit entry for each unreadable backup entry', () => {
    // Create a directory backup with a corrupt manifest
    const id = 'backup_audit-corrupt-manifest';
    const dir = path.join(backupRoot, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ this is :: not json');
    createdEntries.push(dir);

    panel.listBackups();
    const entries = readAuditActions();
    const matching = entries.filter(e =>
      e.action.startsWith('admin/backup/') &&
      typeof e.meta?.error === 'string' &&
      Array.isArray(e.ids) && e.ids.includes(id),
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  it('restoreBackup: records audit entry when restore fails (missing backup)', () => {
    const result = panel.restoreBackup('backup_audit-does-not-exist-xyz');
    expect(result.success).toBe(false);
    const entries = readAuditActions();
    const found = entries.find(e =>
      e.action === 'admin/backup/restore_failed' &&
      typeof e.meta?.error === 'string',
    );
    expect(found).toBeDefined();
    expect(found?.ids).toContain('backup_audit-does-not-exist-xyz');
  });

  it('deleteBackup: records audit entry when target is missing', () => {
    const result = panel.deleteBackup('backup_audit-missing-delete-xyz');
    expect(result.success).toBe(false);
    const entries = readAuditActions();
    const found = entries.find(e =>
      e.action === 'admin/backup/delete_failed' &&
      typeof e.meta?.error === 'string',
    );
    expect(found).toBeDefined();
  });

  it('pruneBackups: rejects negative retain and records audit entry', () => {
    const result = panel.pruneBackups(-1);
    expect(result.success).toBe(false);
    const entries = readAuditActions();
    const found = entries.find(e => e.action === 'admin/backup/prune_failed');
    expect(found).toBeDefined();
    expect(found?.meta?.error).toBeDefined();
  });

  it('exportBackup: records audit entry when target is missing', () => {
    const result = panel.exportBackup('backup_audit-missing-export-xyz');
    expect(result.success).toBe(false);
    const entries = readAuditActions();
    const found = entries.find(e =>
      e.action === 'admin/backup/export_failed' &&
      typeof e.meta?.error === 'string',
    );
    expect(found).toBeDefined();
  });

  it('importBackup: records audit entry when bundle is invalid', () => {
    const result = panel.importBackup({} as { manifest?: Record<string, unknown>; files?: Record<string, unknown> });
    expect(result.success).toBe(false);
    const entries = readAuditActions();
    const found = entries.find(e =>
      e.action === 'admin/backup/import_failed' &&
      typeof e.meta?.error === 'string',
    );
    expect(found).toBeDefined();
  });

  it('importZipBackup: records audit entry when buffer is empty', () => {
    const result = panel.importZipBackup(Buffer.alloc(0));
    expect(result.success).toBe(false);
    const entries = readAuditActions();
    const found = entries.find(e =>
      e.action === 'admin/backup/import_failed' &&
      typeof e.meta?.error === 'string',
    );
    expect(found).toBeDefined();
  });
});
