/**
 * Handler tests for the archive lifecycle tools (Phase D / D3).
 * Covers index_archive / index_restore / index_purgeArchive / index_listArchived /
 * index_getArchived through their registered handlers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../../server/registry.js';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../../../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'archive-handlers-test');

function writeEntry(id: string, extra: Record<string, unknown> = {}): void {
  const e = {
    id,
    title: `T:${id}`,
    body: `Body ${id}`,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['general'],
    schemaVersion: '7',
    version: '1.0.0',
    contentType: 'instruction',
    sourceHash: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(path.join(TMP_DIR, `${id}.json`), JSON.stringify(e, null, 2));
}

async function refreshIndex(): Promise<void> {
  const { invalidate, ensureLoaded } = await import('../../../services/indexContext.js');
  invalidate();
  ensureLoaded();
}

describe('archive lifecycle handlers (Phase D / D3)', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../../../services/handlers.instructions.js');
    forceBootstrapConfirmForTests('archive-handlers-test');
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await refreshIndex();
  });

  it('index_archive moves an active entry to .archive', async () => {
    writeEntry('alpha');
    await refreshIndex();

    const r = await getHandler('index_archive')!({ ids: ['alpha'], reason: 'manual' }) as Record<string, unknown>;
    expect(r.archived).toBe(1);
    expect(r.archivedIds).toEqual(['alpha']);
    expect(fs.existsSync(path.join(TMP_DIR, 'alpha.json'))).toBe(false);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'alpha.json'))).toBe(true);
  });

  it('index_archive dryRun reports wouldArchive without moving files', async () => {
    writeEntry('beta');
    await refreshIndex();

    const r = await getHandler('index_archive')!({ ids: ['beta'], dryRun: true }) as Record<string, unknown>;
    expect(r.dryRun).toBe(true);
    expect(r.wouldArchive).toBe(1);
    expect(fs.existsSync(path.join(TMP_DIR, 'beta.json'))).toBe(true);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'beta.json'))).toBe(false);
  });

  it('index_listArchived + index_getArchived return archived entries', async () => {
    writeEntry('gamma');
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['gamma'], reason: 'manual' });

    const lr = await getHandler('index_listArchived')!({}) as { items: unknown[]; count: number };
    expect(lr.count).toBeGreaterThanOrEqual(1);
    const ids = (lr.items as Array<{ id: string }>).map(i => i.id);
    expect(ids).toContain('gamma');

    const gr = await getHandler('index_getArchived')!({ id: 'gamma' }) as { item?: { id: string; archived?: true } };
    expect(gr.item?.id).toBe('gamma');
    expect(gr.item?.archived).toBe(true);

    const miss = await getHandler('index_getArchived')!({ id: 'does-not-exist' }) as { notFound?: boolean };
    expect(miss.notFound).toBe(true);
  });

  it('index_restore brings an archived entry back to active (default reject mode)', async () => {
    writeEntry('delta');
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['delta'] });
    expect(fs.existsSync(path.join(TMP_DIR, 'delta.json'))).toBe(false);

    const r = await getHandler('index_restore')!({ ids: ['delta'] }) as Record<string, unknown>;
    expect(r.restored).toBe(1);
    expect(r.restoredIds).toEqual(['delta']);
    expect(r.restoreMode).toBe('reject');
    expect(fs.existsSync(path.join(TMP_DIR, 'delta.json'))).toBe(true);
  });

  it('index_purgeArchive permanently deletes archived entries', async () => {
    writeEntry('epsilon');
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['epsilon'] });
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'epsilon.json'))).toBe(true);

    const r = await getHandler('index_purgeArchive')!({ ids: ['epsilon'] }) as Record<string, unknown>;
    expect(r.purged).toBe(1);
    expect(r.purgedIds).toEqual(['epsilon']);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'epsilon.json'))).toBe(false);
  });

  it('index_purgeArchive dryRun reports wouldPurge + missing ids', async () => {
    writeEntry('zeta');
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['zeta'] });

    const r = await getHandler('index_purgeArchive')!({ ids: ['zeta', 'ghost'], dryRun: true }) as Record<string, unknown>;
    expect(r.dryRun).toBe(true);
    expect(r.wouldPurge).toBe(1);
    expect(r.wouldPurgeIds).toEqual(['zeta']);
    expect(r.missing).toEqual(['ghost']);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'zeta.json'))).toBe(true);
  });
});
