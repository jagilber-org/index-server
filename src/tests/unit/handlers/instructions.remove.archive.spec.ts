/**
 * index_remove archive-mode tests (Phase D / D2).
 *
 * Verifies:
 *  - mode='archive' moves entries to .archive.
 *  - mode='purge' still hard-deletes (legacy behavior).
 *  - omitted mode warns about default behavior change (defaults to purge for now).
 *  - purge:true alias works (back-compat).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../../server/registry.js';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../../../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'remove-archive-test');

function writeEntry(id: string): void {
  const e = {
    id, title: `T:${id}`, body: `Body ${id}`, priority: 50,
    audience: 'all', requirement: 'optional', categories: ['general'],
    schemaVersion: '7', version: '1.0.0', contentType: 'instruction',
    sourceHash: 'a'.repeat(64),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(TMP_DIR, `${id}.json`), JSON.stringify(e, null, 2));
}

async function refresh(): Promise<void> {
  const { invalidate, ensureLoaded } = await import('../../../services/indexContext.js');
  invalidate(); ensureLoaded();
}

describe('index_remove archive-mode (Phase D / D2)', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../../../services/handlers.instructions.js');
    forceBootstrapConfirmForTests('remove-archive-test');
  });

  afterAll(() => { fs.rmSync(TMP_DIR, { recursive: true, force: true }); });

  beforeEach(async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await refresh();
  });

  it('mode="archive" moves the entry to .archive', async () => {
    writeEntry('one'); await refresh();
    const r = await getHandler('index_remove')!({ ids: ['one'], mode: 'archive' }) as Record<string, unknown>;
    expect(r.mode).toBe('archive');
    expect(fs.existsSync(path.join(TMP_DIR, 'one.json'))).toBe(false);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'one.json'))).toBe(true);
  });

  it('mode="purge" still hard-deletes', async () => {
    writeEntry('two'); await refresh();
    const r = await getHandler('index_remove')!({ ids: ['two'], mode: 'purge' }) as Record<string, unknown>;
    expect(r.mode).toBe('purge');
    expect(fs.existsSync(path.join(TMP_DIR, 'two.json'))).toBe(false);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'two.json'))).toBe(false);
  });

  it('omitted mode purges and surfaces defaultBehaviorChangeWarning', async () => {
    writeEntry('three'); await refresh();
    const r = await getHandler('index_remove')!({ ids: ['three'] }) as Record<string, unknown>;
    expect(r.mode).toBe('purge');
    expect(r.defaultBehaviorChangeWarning).toBeDefined();
    expect(String(r.defaultBehaviorChangeWarning)).toMatch(/archive/i);
    expect(fs.existsSync(path.join(TMP_DIR, 'three.json'))).toBe(false);
  });

  it('purge:true alias is treated as mode="purge" (no warning)', async () => {
    writeEntry('four'); await refresh();
    const r = await getHandler('index_remove')!({ ids: ['four'], purge: true }) as Record<string, unknown>;
    expect(r.mode).toBe('purge');
    expect(r.defaultBehaviorChangeWarning).toBeUndefined();
    expect(fs.existsSync(path.join(TMP_DIR, 'four.json'))).toBe(false);
  });

  it('dryRun in archive mode reports without moving files', async () => {
    writeEntry('five'); await refresh();
    const r = await getHandler('index_remove')!({ ids: ['five'], mode: 'archive', dryRun: true }) as Record<string, unknown>;
    expect(r.mode).toBe('archive');
    expect(r.dryRun).toBe(true);
    expect(fs.existsSync(path.join(TMP_DIR, 'five.json'))).toBe(true);
    expect(fs.existsSync(path.join(TMP_DIR, '.archive', 'five.json'))).toBe(false);
  });
});
