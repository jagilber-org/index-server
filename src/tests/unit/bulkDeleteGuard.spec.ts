/**
 * Tests for bulk deletion safety guards:
 * - maxBulkDelete threshold (INDEX_SERVER_MAX_BULK_DELETE)
 * - Automatic pre-mutation backup when force=true exceeds threshold
 * - Dry-run mode
 * - Backup failure aborts deletion
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { getHandler } from '../../server/registry';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'bulk-delete-guard');
const BACKUPS_DIR = path.join(TMP_DIR, '..', 'bulk-delete-backups');

function seedInstruction(id: string) {
  const file = path.join(TMP_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify({
    id, title: `Test ${id}`, body: 'test body', version: '1.0.0',
    priority: 5, audience: 'all', requirement: 'optional',
    sourceHash: 'abc123', schemaVersion: '4.0.0',
  }));
}

describe('bulk delete safety guards', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    process.env.INDEX_SERVER_MAX_BULK_DELETE = '3';
    process.env.INDEX_SERVER_BACKUPS_DIR = BACKUPS_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.rmSync(BACKUPS_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    // @ts-expect-error dynamic side-effect import
    await import('../../services/handlers.instructions');
    forceBootstrapConfirmForTests('bulk-delete-guard-test');
  });

  beforeEach(() => {
    // Clean and re-seed for each test
    for (const f of fs.readdirSync(TMP_DIR)) {
      if (f.endsWith('.json')) fs.unlinkSync(path.join(TMP_DIR, f));
    }
    for (let i = 1; i <= 6; i++) seedInstruction(`test-${i}`);
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.rmSync(BACKUPS_DIR, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_MAX_BULK_DELETE;
    delete process.env.INDEX_SERVER_BACKUPS_DIR;
  });

  it('allows deletion at or below maxBulkDelete without force', async () => {
    const remove = getHandler('index_remove')!;
    const result = await remove({ ids: ['test-1', 'test-2', 'test-3'], _viaDispatcher: true }) as Record<string, unknown>;
    expect(result.removed).toBe(3);
    expect(result.bulkBlocked).toBeUndefined();
  });

  it('blocks deletion exceeding maxBulkDelete without force', async () => {
    const remove = getHandler('index_remove')!;
    const result = await remove({ ids: ['test-1', 'test-2', 'test-3', 'test-4'], _viaDispatcher: true }) as Record<string, unknown>;
    expect(result.removed).toBe(0);
    expect(result.bulkBlocked).toBe(true);
    expect(result.maxBulkDelete).toBe(3);
    expect(result.requestedCount).toBe(4);
    // Verify no files were actually deleted
    expect(fs.existsSync(path.join(TMP_DIR, 'test-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(TMP_DIR, 'test-4.json'))).toBe(true);
  });

  it('allows bulk deletion with force=true and creates backup', async () => {
    const remove = getHandler('index_remove')!;
    const result = await remove({ ids: ['test-1', 'test-2', 'test-3', 'test-4'], force: true, _viaDispatcher: true }) as Record<string, unknown>;
    expect(result.removed).toBe(4);
    expect(result.backupDir).toBeDefined();
    expect(typeof result.backupDir).toBe('string');
    // Verify backup zip file exists and contains the expected JSON entries
    const backupZip = result.backupDir as string;
    expect(backupZip.endsWith('.zip')).toBe(true);
    expect(fs.existsSync(backupZip)).toBe(true);
    const zip = new AdmZip(backupZip);
    const jsonEntries = zip.getEntries().filter(e => e.entryName.endsWith('.json'));
    expect(jsonEntries.length).toBeGreaterThanOrEqual(4);
  });

  it('dryRun reports what would be deleted without deleting', async () => {
    const remove = getHandler('index_remove')!;
    const result = await remove({ ids: ['test-1', 'test-2', 'test-nonexistent'], dryRun: true, _viaDispatcher: true }) as Record<string, unknown>;
    expect(result.dryRun).toBe(true);
    expect(result.wouldRemove).toBe(2);
    expect(result.wouldMiss).toEqual(['test-nonexistent']);
    expect(result.removed).toBe(0);
    // Verify nothing was actually deleted
    expect(fs.existsSync(path.join(TMP_DIR, 'test-1.json'))).toBe(true);
    expect(fs.existsSync(path.join(TMP_DIR, 'test-2.json'))).toBe(true);
  });

  it('dryRun works even for bulk requests without requiring force', async () => {
    const remove = getHandler('index_remove')!;
    const result = await remove({ ids: ['test-1', 'test-2', 'test-3', 'test-4', 'test-5'], dryRun: true, _viaDispatcher: true }) as Record<string, unknown>;
    expect(result.dryRun).toBe(true);
    expect(result.wouldRemove).toBe(5);
    expect(result.removed).toBe(0);
  });

  it('error message in bulk block mentions the threshold', async () => {
    const remove = getHandler('index_remove')!;
    const result = await remove({ ids: ['test-1', 'test-2', 'test-3', 'test-4', 'test-5', 'test-6'], _viaDispatcher: true }) as Record<string, unknown>;
    expect(result.bulkBlocked).toBe(true);
    const errors = result.errors as string[];
    expect(errors[0]).toContain('INDEX_SERVER_MAX_BULK_DELETE=3');
    expect(errors[0]).toContain('force=true');
  });
});
