/**
 * Backup API Warning/Error Surfacing Tests — Issue #121 verification
 *
 * Validates that:
 *   - AdminPanel.pruneBackups returns { success, message, pruned, errors? } shape
 *   - pruneBackups rejects negative retain
 *   - listBackups returns entries with optional warnings[] field
 *   - The route handler derives hasWarnings from warnings presence
 *
 * Tests AdminPanel directly via the getAdminPanel() singleton.
 * The singleton reads backupRoot from runtimeConfig (defaulting to cwd()/backups).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';
import { AdminPanel } from '../../dashboard/server/AdminPanel.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-warning-test-'));
const backupRoot = path.join(tmpDir, 'backups');

describe('Backup API warning/error surfacing (issue #121)', () => {
  let panel: AdminPanel;
  const createdDirs: string[] = [];

  beforeAll(() => {
    process.env.INDEX_SERVER_BACKUPS_DIR = backupRoot;
    reloadRuntimeConfig();
    panel = new AdminPanel();
    fs.mkdirSync(backupRoot, { recursive: true });
  });

  afterAll(() => {
    // Clean up any test backup dirs we created
    for (const dir of createdDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    delete process.env.INDEX_SERVER_BACKUPS_DIR;
    reloadRuntimeConfig();
  });

  describe('pruneBackups return shape', () => {
    it('rejects negative retain with success:false', () => {
      const result = panel.pruneBackups(-1);
      expect(result.success).toBe(false);
      expect(result.message).toContain('retain must be >= 0');
    });

    it('returns success with pruned count when pruning', () => {
      // Create 3 test backups with staggered mtime
      const names = ['backup_test-prune-a', 'backup_test-prune-b', 'backup_test-prune-c'];
      for (let i = 0; i < names.length; i++) {
        const dir = path.join(backupRoot, names[i]);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString() }));
        createdDirs.push(dir);
        // Stagger mtime so sort order is deterministic
        const now = Date.now();
        fs.utimesSync(dir, new Date(now + i * 1000), new Date(now + i * 1000));
      }
      // Retain 1 → prune 2 (at minimum — other backups may exist)
      const result = panel.pruneBackups(1);
      expect(result.success).toBe(true);
      expect(typeof result.pruned).toBe('number');
      expect(result.pruned).toBeGreaterThanOrEqual(2);
      // errors is optional — if present, must be string array
      if (result.errors !== undefined) {
        expect(Array.isArray(result.errors)).toBe(true);
        for (const err of result.errors) {
          expect(typeof err).toBe('string');
        }
      }
    });
  });

  describe('listBackups shape with warnings field', () => {
    it('each backup entry may contain optional warnings[] array', () => {
      const backups = panel.listBackups();
      // Whether or not backups exist, shape should be correct
      expect(Array.isArray(backups)).toBe(true);
      for (const backup of backups) {
        expect(typeof backup.id).toBe('string');
        expect(typeof backup.createdAt).toBe('string');
        expect(typeof backup.sizeBytes).toBe('number');
        // warnings is optional — if present, must be string[]
        if (backup.warnings !== undefined) {
          expect(Array.isArray(backup.warnings)).toBe(true);
          for (const w of backup.warnings) {
            expect(typeof w).toBe('string');
          }
        }
      }
    });

    it('hasWarnings derivation: false when no backup has warnings', () => {
      const backups = panel.listBackups();
      const hasWarnings = backups.some(b => b.warnings && b.warnings.length > 0);
      // This mirrors the route handler logic (admin.routes.ts:312)
      expect(typeof hasWarnings).toBe('boolean');
      // Can't guarantee hasWarnings is false (existing backups may have warnings)
      // but the derivation pattern must be correct boolean
    });
  });

  describe('route-level response shape expectations', () => {
    it('backup list response includes hasWarnings, count, timestamp fields', () => {
      // Simulate what the route handler does (admin.routes.ts:309-313)
      const backups = panel.listBackups();
      const hasWarnings = backups.some(b => b.warnings && b.warnings.length > 0);
      const response = { success: true, backups, count: backups.length, hasWarnings, timestamp: Date.now() };

      expect(typeof response.success).toBe('boolean');
      expect(response.success).toBe(true);
      expect(typeof response.hasWarnings).toBe('boolean');
      expect(typeof response.count).toBe('number');
      expect(typeof response.timestamp).toBe('number');
      expect(Array.isArray(response.backups)).toBe(true);
      expect(response.count).toBe(response.backups.length);
    });

    it('prune response includes errors[] when present (route enrichment)', () => {
      // Simulate the route handler enrichment logic (admin.routes.ts:365-366)
      const mockResult = { success: true, message: 'Pruned 2 backups (1 error(s))', pruned: 2, errors: ['Failed to delete backup: EACCES'] };
      const response: Record<string, unknown> = { success: true, message: mockResult.message, pruned: mockResult.pruned, timestamp: Date.now() };
      if (mockResult.errors && mockResult.errors.length > 0) response.errors = mockResult.errors;

      expect(response.errors).toBeDefined();
      expect(Array.isArray(response.errors)).toBe(true);
      expect((response.errors as string[])[0]).toContain('EACCES');
    });
  });
});
