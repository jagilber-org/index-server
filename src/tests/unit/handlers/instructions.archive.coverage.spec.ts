/**
 * Coverage-fill tests for src/services/handlers/instructions.archive.ts
 * (Phase G1 coverage validation).
 *
 * The Phase D happy-path handler tests in `instructions.archive.spec.ts`
 * already cover the canonical paths. This file targets the remaining
 * branches surfaced by `npx vitest run --coverage`:
 *
 *   - empty / invalid ids → "no ids supplied" error row (all 3 mutations).
 *   - archive() error path → archiveErrors row populated.
 *   - restore() error path → restoreErrors row populated.
 *   - listArchived: category + contentType client-side filters.
 *   - listArchived: includeContent:false (default) strips body to ''.
 *   - listArchived: includeContent:true retains body.
 *   - purgeArchive: bulkBlocked path (>maxBulk without force).
 *   - purgeArchive: missing-id path (id not present in archive).
 *   - getArchived: empty-string id and whitespace-only id → notFound.
 *
 * Spec 006-archive-lifecycle, REQ-8 / REQ-17 / REQ-20 / REQ-21.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../../server/registry.js';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../../../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'archive-handlers-coverage');

function writeEntry(id: string, extra: Record<string, unknown> = {}): void {
  const e = {
    id,
    title: `T:${id}`,
    body: `Body of ${id}`,
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

describe('archive handlers coverage fill (Phase G1)', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    // Force a small bulk-delete limit so a 2-id purge can trip the
    // bulkBlocked branch without seeding hundreds of entries.
    process.env.INDEX_SERVER_MAX_BULK_DELETE = '1';
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../../../services/handlers.instructions.js');
    forceBootstrapConfirmForTests('archive-handlers-coverage');
  });

  afterAll(() => {
    delete process.env.INDEX_SERVER_MAX_BULK_DELETE;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await refreshIndex();
  });

  // ── empty ids errors ──────────────────────────────────────────────────────

  it.each([
    ['index_archive', 'archived', 'archiveErrors'],
    ['index_restore', 'restored', 'restoreErrors'],
    ['index_purgeArchive', 'purged', 'purgeErrors'],
  ])('%s rejects empty ids with "no ids supplied"', async (tool, countKey, errorsKey) => {
    const r = await getHandler(tool)!({ ids: [] }) as Record<string, unknown>;
    expect(r[countKey]).toBe(0);
    const errs = r[errorsKey] as Array<{ id: string; error: string }>;
    expect(errs.length).toBe(1);
    expect(errs[0].error).toMatch(/no ids supplied/i);
  });

  it.each([
    ['index_archive'],
    ['index_restore'],
    ['index_purgeArchive'],
  ])('%s rejects missing ids field with "no ids supplied"', async (tool) => {
    const r = await getHandler(tool)!({}) as Record<string, unknown>;
    const errs = (r.archiveErrors ?? r.restoreErrors ?? r.purgeErrors) as Array<{ error: string }>;
    expect(errs?.[0]?.error).toMatch(/no ids supplied/i);
  });

  // ── archive error path ────────────────────────────────────────────────────

  it('index_archive collects per-id errors for unknown ids', async () => {
    writeEntry('present');
    await refreshIndex();
    const r = await getHandler('index_archive')!({ ids: ['present', 'ghost'] }) as Record<string, unknown>;
    expect(r.archived).toBe(1);
    expect(r.archivedIds).toEqual(['present']);
    const errors = r.archiveErrors as Array<{ id: string; error: string }>;
    expect(errors.length).toBe(1);
    expect(errors[0].id).toBe('ghost');
  });

  // ── restore error path ────────────────────────────────────────────────────

  it('index_restore collects per-id errors when archive missing', async () => {
    const r = await getHandler('index_restore')!({ ids: ['nope'] }) as Record<string, unknown>;
    expect(r.restored).toBe(0);
    const errors = r.restoreErrors as Array<{ id: string; error: string }>;
    expect(errors.length).toBe(1);
    expect(errors[0].id).toBe('nope');
  });

  // ── listArchived filters ──────────────────────────────────────────────────

  it('listArchived filters by category (client-side after store filter)', async () => {
    writeEntry('a', { categories: ['alpha'] });
    writeEntry('b', { categories: ['beta'] });
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['a', 'b'] });

    const r = await getHandler('index_listArchived')!({ category: 'alpha' }) as { items: Array<{ id: string }>; count: number };
    expect(r.count).toBe(1);
    expect(r.items[0].id).toBe('a');
  });

  it('listArchived filters by contentType', async () => {
    writeEntry('inst', { contentType: 'instruction' });
    writeEntry('skl', { contentType: 'skill' });
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['inst', 'skl'] });

    const r = await getHandler('index_listArchived')!({ contentType: 'skill' }) as { items: Array<{ id: string }>; count: number };
    expect(r.count).toBe(1);
    expect(r.items[0].id).toBe('skl');
  });

  it('listArchived strips body by default (includeContent omitted)', async () => {
    writeEntry('e', { body: 'Lorem ipsum dolor' });
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['e'] });

    const r = await getHandler('index_listArchived')!({}) as { items: Array<{ id: string; body: string; archived?: true }> };
    const e = r.items.find(i => i.id === 'e')!;
    expect(e.archived).toBe(true);
    expect(e.body).toBe('');
  });

  it('listArchived returns body when includeContent:true', async () => {
    writeEntry('full', { body: 'KEEP ME' });
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['full'] });

    const r = await getHandler('index_listArchived')!({ includeContent: true }) as { items: Array<{ id: string; body: string }> };
    const e = r.items.find(i => i.id === 'full')!;
    expect(e.body).toBe('KEEP ME');
  });

  // ── purgeArchive bulkBlocked ──────────────────────────────────────────────

  it('purgeArchive bulk-blocks when ids exceed maxBulkDelete and force=false', async () => {
    writeEntry('p1');
    writeEntry('p2');
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['p1', 'p2'] });

    const r = await getHandler('index_purgeArchive')!({ ids: ['p1', 'p2'] }) as Record<string, unknown>;
    expect(r.bulkBlocked).toBe(true);
    expect(r.maxBulkDelete).toBe(1);
    expect(r.requestedCount).toBe(2);
    expect(r.purged).toBe(0);
    // Archive entries still on disk
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'p1.json'))).toBe(true);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'p2.json'))).toBe(true);
  });

  it('purgeArchive marks missing ids and still purges present ones', async () => {
    writeEntry('m1');
    await refreshIndex();
    await getHandler('index_archive')!({ ids: ['m1'] });

    const r = await getHandler('index_purgeArchive')!({ ids: ['m1', 'never-archived'], force: true }) as Record<string, unknown>;
    expect(r.purged).toBe(1);
    expect(r.purgedIds).toEqual(['m1']);
    expect(r.missing).toEqual(['never-archived']);
  });

  // ── getArchived empty / whitespace id ─────────────────────────────────────

  it.each([[''], ['   '], ['\t\n']])('getArchived returns notFound for blank id (%j)', async (id) => {
    const r = await getHandler('index_getArchived')!({ id }) as Record<string, unknown>;
    expect(r.notFound).toBe(true);
  });

  it('getArchived returns notFound for unknown id', async () => {
    const r = await getHandler('index_getArchived')!({ id: 'totally-unknown' }) as Record<string, unknown>;
    expect(r.notFound).toBe(true);
  });
});
