/**
 * index_groom archive-mode tests (Phase D / D1).
 *
 * Verifies:
 *  - removeDeprecated archives deprecated entries (reason 'superseded' when
 *    deprecatedBy resolves to an active id).
 *  - mergeDuplicates + removeDeprecated archives duplicate-body entries with
 *    reason 'duplicate-merge' and restoreEligible=false.
 *  - dryRun reports wouldArchive / wouldArchiveIds.
 *  - mode.purgeArchive permanently deletes archived entries.
 *  - mode.purgeArchive rejects combination with retirement flags.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../../server/registry.js';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../../../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'groom-archive-test');

function writeEntry(id: string, extra: Record<string, unknown> = {}): void {
  const e = {
    id, title: `T:${id}`, body: `Body ${id}`, priority: 50,
    audience: 'all', requirement: 'optional', categories: ['general'],
    schemaVersion: '7', version: '1.0.0', contentType: 'instruction',
    sourceHash: 'a'.repeat(64),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(path.join(TMP_DIR, `${id}.json`), JSON.stringify(e, null, 2));
}

async function refresh(): Promise<void> {
  const { invalidate, ensureLoaded } = await import('../../../services/indexContext.js');
  invalidate(); ensureLoaded();
}

describe('index_groom archive paths (Phase D / D1)', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../../../services/handlers.instructions.js');
    forceBootstrapConfirmForTests('groom-archive-test');
  });

  afterAll(() => { fs.rmSync(TMP_DIR, { recursive: true, force: true }); });

  beforeEach(async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await refresh();
  });

  it('removeDeprecated archives a superseded entry (not hard-deleted)', async () => {
    writeEntry('parent');
    writeEntry('child', { deprecatedBy: 'parent', requirement: 'deprecated' });
    await refresh();

    const r = await getHandler('index_groom')!({ mode: { removeDeprecated: true } }) as Record<string, unknown>;
    expect(r.dryRun).toBe(false);
    expect(r.archived).toBe(1);
    expect(r.archivedIds).toEqual(['child']);
    expect(typeof r.archiveLocation).toBe('string');
    expect(fs.existsSync(path.join(TMP_DIR, 'child.json'))).toBe(false);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'child.json'))).toBe(true);
  });

  it('dryRun reports wouldArchive / wouldArchiveIds without moving files', async () => {
    writeEntry('parent2');
    writeEntry('child2', { deprecatedBy: 'parent2', requirement: 'deprecated' });
    await refresh();

    const r = await getHandler('index_groom')!({ mode: { dryRun: true, removeDeprecated: true } }) as Record<string, unknown>;
    expect(r.dryRun).toBe(true);
    expect(r.wouldArchive).toBe(1);
    expect(r.wouldArchiveIds).toEqual(['child2']);
    expect(fs.existsSync(path.join(TMP_DIR, 'child2.json'))).toBe(true);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'child2.json'))).toBe(false);
  });

  it('mergeDuplicates+removeDeprecated archives duplicate-body entry as duplicate-merge', async () => {
    const dup = { body: 'identical body', sourceHash: 'b'.repeat(64) };
    writeEntry('a-dup', dup);
    writeEntry('b-dup', { ...dup, createdAt: new Date(Date.now() + 1000).toISOString() });
    await refresh();

    const r = await getHandler('index_groom')!({ mode: { removeDeprecated: true, mergeDuplicates: true } }) as Record<string, unknown>;
    expect(r.archived).toBe(1);
    // Read the archived file to verify reason/restoreEligible metadata.
    const archivedIds = r.archivedIds as string[];
    const archivedId = archivedIds[0];
    const archivedFile = path.join(TMP_DIR, '.archive', `${archivedId}.json`);
    expect(fs.existsSync(archivedFile)).toBe(true);
    const archivedEntry = JSON.parse(fs.readFileSync(archivedFile, 'utf8')) as Record<string, unknown>;
    expect(archivedEntry.archiveReason).toBe('duplicate-merge');
    expect(archivedEntry.restoreEligible).toBe(false);
  });

  it('mode.purgeArchive permanently deletes the archive store', async () => {
    writeEntry('victim');
    await refresh();
    await getHandler('index_archive')!({ ids: ['victim'] });
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'victim.json'))).toBe(true);

    const r = await getHandler('index_groom')!({ mode: { purgeArchive: true } }) as Record<string, unknown>;
    expect(r.purgeArchive).toBe(true);
    expect(r.purged).toBe(1);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'victim.json'))).toBe(false);
  });

  it('mode.purgeArchive cannot be combined with retirement flags', async () => {
    const fn = getHandler('index_groom')!;
    await expect(
      Promise.resolve(fn({ mode: { purgeArchive: true, removeDeprecated: true } }))
    ).rejects.toThrow(/purgeArchive cannot be combined/);
  });
});
