import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { reloadRuntimeConfig } from '../config/runtimeConfig';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating';
import { invalidate, ensureLoaded } from '../services/indexContext';
import { migrateLegacyInstructionEntry } from '../services/schemaMigrationService';
import { getHandler } from '../server/registry';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'schema-migration-service');

describe('schema migration service (#346)', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    await import('../services/handlers.instructions.js');
    forceBootstrapConfirmForTests('schema-migration-service');
  });

  beforeEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    invalidate();
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MUTATION;
    invalidate();
  });

  it('maps legacy enum/id/priority drift without changing strict input validation globally', () => {
    const migrated = migrateLegacyInstructionEntry({
      id: 'Legacy Reference Entry!',
      title: 'Legacy reference',
      body: 'Legacy body',
      audience: 'agents',
      requirement: 'must be retained',
      contentType: 'reference',
      schemaVersion: '2',
      categories: ['legacy'],
    }, { source: 'index_import', log: false });

    expect(migrated.changed).toBe(true);
    expect(migrated.entry).toMatchObject({
      id: 'legacy-reference-entry',
      priority: 50,
      audience: 'all',
      requirement: 'mandatory',
      contentType: 'knowledge',
      primaryCategory: 'legacy',
    });
    expect(migrated.changes.map(change => change.field)).toEqual(expect.arrayContaining([
      'id',
      'priority',
      'audience',
      'requirement',
      'contentType',
    ]));
  });

  it('index_import migrates legacy backup entries before validation and reports migration details', async () => {
    const importHandler = getHandler('index_import') as (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    const response = await importHandler({
      entries: [{
        id: 'Legacy Import Reference!',
        title: 'Legacy import reference',
        body: 'Legacy import body',
        audience: 'support-engineer',
        requirement: 'must be retained',
        contentType: 'reference',
        owner: 'migration-owner',
        schemaVersion: '2',
      }],
      mode: 'overwrite',
    });

    expect(response.errors).toEqual([]);
    expect(response.imported).toBe(1);
    expect(response.migrationCount).toBe(1);
    expect(response.migrationDetails).toEqual([
      expect.objectContaining({
        originalId: 'Legacy Import Reference!',
        id: 'legacy-import-reference',
      }),
    ]);
    const stored = JSON.parse(fs.readFileSync(path.join(TMP_DIR, 'legacy-import-reference.json'), 'utf8'));
    expect(stored).toMatchObject({
      id: 'legacy-import-reference',
      priority: 50,
      audience: 'group',
      requirement: 'mandatory',
      contentType: 'knowledge',
    });
  });

  it('index_repair migrates skipped legacy files so they load on the next index refresh', async () => {
    const rawPath = path.join(TMP_DIR, 'Repair Legacy Reference!.json');
    fs.writeFileSync(rawPath, JSON.stringify({
      id: 'Repair Legacy Reference!',
      title: 'Repair legacy reference',
      body: 'Repair legacy body',
      audience: 'agent',
      requirement: 'should be retained',
      contentType: 'reference',
      schemaVersion: '2',
      categories: ['repair'],
    }, null, 2), 'utf8');

    const repairHandler = getHandler('index_repair') as (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    const response = await repairHandler({});

    expect(response.repaired).toBeGreaterThanOrEqual(1);
    expect(response.migrationCount).toBeGreaterThanOrEqual(1);
    expect(response.skippedRepaired).toContain('repair-legacy-reference');
    expect(fs.existsSync(rawPath)).toBe(false);
    invalidate();
    const loaded = ensureLoaded().byId.get('repair-legacy-reference');
    expect(loaded).toMatchObject({
      id: 'repair-legacy-reference',
      priority: 50,
      audience: 'all',
      requirement: 'recommended',
      contentType: 'knowledge',
    });
  });
});
