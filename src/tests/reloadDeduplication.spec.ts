/**
 * Regression test for stale search index after reload (feedback ID: 032a80fe49a9da62).
 * After adding an entry and reloading/invalidating the Index, search must return the entry
 * exactly once — no duplicates caused by inconsistent list vs byId state.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry.js';
import { reloadRuntimeConfig } from '../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'reload-dedup-test');

describe('search index deduplication after reload', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../services/handlers.instructions.js');
    await import('../services/handlers.search.js');
    await import('../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('reload-dedup-test');
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
  });

  it('entry appears exactly once in search after add → reload → search', async () => {
    const { invalidate, ensureLoaded } = await import('../services/indexContext.js');
    const dispatch = getHandler('index_dispatch')!;
    const search = getHandler('index_search')!;

    const uniqueKeyword = `zebratest-${Date.now()}`;
    const id = `reload-dedup-${Date.now()}`;

    // Add the entry
    const addResult = await dispatch({
      action: 'add',
      entry: {
        id,
        title: `Reload Dedup Test ${uniqueKeyword}`,
        body: `Body containing unique keyword ${uniqueKeyword} for deduplication test.`,
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
      },
      lax: true,
      overwrite: true,
    }) as Record<string, unknown>;

    expect(addResult.error).toBeFalsy();
    expect(addResult.created).toBe(true);

    // Invalidate and reload the Index
    invalidate();
    ensureLoaded();

    // Search for the entry by its unique keyword
    const searchResult = await search({ keywords: [uniqueKeyword], mode: 'keyword', limit: 50 }) as Record<string, unknown>;
    const results = searchResult.results as Array<{ instructionId: string }>;

    // The entry must appear exactly once — no duplicates
    const matches = results.filter(r => r.instructionId === id);
    expect(matches.length).toBe(1);
  });

  it('two files with same id field produce only one entry in index after reload', async () => {
    const { invalidate, ensureLoaded } = await import('../services/indexContext.js');

    const sharedId = `shared-id-dedup-${Date.now()}`;

    // Write two files with the SAME id field (simulating a "Index mangle")
    const fileA = path.join(TMP_DIR, `${sharedId}-file-a.json`);
    const fileB = path.join(TMP_DIR, `${sharedId}-file-b.json`);
    const entry = {
      id: sharedId,
      title: 'Dedup Test Entry',
      body: 'Body for deduplication test.',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['dedup'],
      schemaVersion: '4',
      version: '1.0.0',
      contentType: 'instruction',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(fileA, JSON.stringify(entry, null, 2));
    fs.writeFileSync(fileB, JSON.stringify({ ...entry, title: 'Dedup Test Entry (copy)' }, null, 2));

    // Reload from disk — should produce exactly one entry in state.list
    invalidate();
    const st = ensureLoaded();

    const inList = st.list.filter(e => e.id === sharedId);
    expect(inList.length).toBe(1);

    // Clean up the duplicate file
    fs.unlinkSync(fileA);
    fs.unlinkSync(fileB);
  });
});
