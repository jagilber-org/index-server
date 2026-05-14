/**
 * Dispatcher archive filter tests (Phase D / D4).
 *
 * Verifies:
 *  - includeArchived + onlyArchived together yields invalid_params error.
 *  - includeArchived merges archived items into list results.
 *  - onlyArchived returns archive-only.
 *  - get(id) with includeArchived falls back to archive.
 *  - diff/governanceHash with includeArchived also returns archiveHash.
 *  - dispatcher routes archive/restore/listArchived/getArchived/purgeArchive
 *    actions to the corresponding tools.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../../server/registry.js';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../../../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'dispatch-archive-test');

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

describe('dispatcher archive filters (Phase D / D4)', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../../../services/handlers.instructions.js');
    await import('../../../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('dispatch-archive-test');
  });

  afterAll(() => { fs.rmSync(TMP_DIR, { recursive: true, force: true }); });

  beforeEach(async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await refresh();
  });

  it('rejects includeArchived + onlyArchived combined', async () => {
    const r = await getHandler('index_dispatch')!({ action: 'list', includeArchived: true, onlyArchived: true }) as Record<string, unknown>;
    expect(r.error).toBe('invalid_params');
    expect(String(r.reason)).toMatch(/mutually exclusive/);
  });

  it('list onlyArchived returns archive-only items', async () => {
    writeEntry('keep');
    writeEntry('gone');
    await refresh();
    await getHandler('index_dispatch')!({ action: 'archive', ids: ['gone'] });

    const r = await getHandler('index_dispatch')!({ action: 'list', onlyArchived: true }) as Record<string, unknown>;
    const items = (r.items as Array<{ id: string; archived?: boolean }>) || [];
    expect(items.length).toBe(1);
    expect(items[0].id).toBe('gone');
    expect(items[0].archived).toBe(true);
  });

  it('list includeArchived merges active + archive', async () => {
    writeEntry('a');
    writeEntry('b');
    await refresh();
    await getHandler('index_dispatch')!({ action: 'archive', ids: ['b'] });

    const r = await getHandler('index_dispatch')!({ action: 'list', includeArchived: true }) as Record<string, unknown>;
    const ids = ((r.items as Array<{ id: string }>) || []).map(i => i.id).sort();
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(r.includeArchived).toBe(true);
  });

  it('get(id) with includeArchived falls back to archive when not active', async () => {
    writeEntry('lost');
    await refresh();
    await getHandler('index_dispatch')!({ action: 'archive', ids: ['lost'] });

    const r = await getHandler('index_dispatch')!({ action: 'get', id: 'lost', includeArchived: true }) as Record<string, unknown>;
    const item = r.item as { id: string; archived?: boolean } | undefined;
    expect(item?.id).toBe('lost');
    expect(item?.archived).toBe(true);
  });

  it('governanceHash includeArchived returns archiveHash too', async () => {
    writeEntry('a');
    await refresh();
    await getHandler('index_dispatch')!({ action: 'archive', ids: ['a'] });

    const r = await getHandler('index_dispatch')!({ action: 'governanceHash', includeArchived: true }) as Record<string, unknown>;
    expect(typeof r.archiveHash).toBe('string');
    expect((r.archiveHash as string).length).toBeGreaterThan(0);
  });

  it('dispatches the 5 archive lifecycle actions to their handlers', async () => {
    writeEntry('x');
    await refresh();
    const arch = await getHandler('index_dispatch')!({ action: 'archive', ids: ['x'] }) as Record<string, unknown>;
    expect(arch.archived).toBe(1);

    const listR = await getHandler('index_dispatch')!({ action: 'listArchived' }) as { items: Array<{ id: string }> };
    expect(listR.items.find(i => i.id === 'x')).toBeDefined();

    const getR = await getHandler('index_dispatch')!({ action: 'getArchived', id: 'x' }) as { item?: { id: string } };
    expect(getR.item?.id).toBe('x');

    const restR = await getHandler('index_dispatch')!({ action: 'restore', ids: ['x'] }) as Record<string, unknown>;
    expect(restR.restored).toBe(1);

    // archive again then purge
    await getHandler('index_dispatch')!({ action: 'archive', ids: ['x'] });
    const purgeR = await getHandler('index_dispatch')!({ action: 'purgeArchive', ids: ['x'] }) as Record<string, unknown>;
    expect(purgeR.purged).toBe(1);
  });
});
