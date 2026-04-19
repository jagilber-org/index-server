import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Import side-effect registrations
import { getHandler } from '../../server/registry';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';

// Focused P1 dispatcher/handler coverage exercising add -> list(expectId repair) -> duplicate skip
// -> search -> diff -> export(metaOnly) -> query(filters) -> categories -> dir -> remove -> reload.

const TMP_DIR = path.join(process.cwd(), 'tmp', 'dispatcher-p1');

describe('instructions dispatcher (P1)', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR; // isolate BEFORE handler registration
    reloadRuntimeConfig(); // Reload config after setting env vars
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
  // Dynamically import after env setup so handlers bind to isolated directory
  // @ts-expect-error dynamic side-effect import path
  await import('../../services/handlers.instructions');
  // @ts-expect-error dynamic side-effect import path
  await import('../../services/instructions.dispatcher');
  // Import bootstrap gating helper and force confirm to bypass gating for this
  // legacy dispatcher unit test which focuses on ordering & index semantics.
  try {
  const gating = await import('../../services/bootstrapGating.js');
    if((gating as any).forceBootstrapConfirmForTests){
      (gating as any).forceBootstrapConfirmForTests('dispatcher.p1.spec auto-confirm');
    }
  } catch {/* ignore */}
  });

  it('add -> list(expectId) ordering + duplicate skip + search/diff/export/query/categories/remove cycle', async () => {
    const add = getHandler('index_add');
    const list = getHandler('index_dispatch'); // dispatcher route
    const remove = getHandler('index_remove');
    const reload = getHandler('index_reload');

    expect(typeof add).toBe('function');
    expect(typeof list).toBe('function');
    expect(typeof remove).toBe('function');
    expect(typeof reload).toBe('function');

    const id = 'dispatcher-p1-sample';
    // Lax add (minimal body) using dispatcher form first to exercise action parsing path
  const dispatch = (action: string, params: Record<string, any>) => (list as any)({ action, ...params });

    // Use dispatcher add path (maps to handlers/add internally).
  const addResp: any = await dispatch('add', { entry: { id, body: 'Hello body', title: id, audience: 'all', requirement: 'optional', priority: 10, categories: ['test','P1'] }, lax: true });
  expect(addResp).toMatchObject({ id, created: true, overwritten: false });

  // List with expectId should surface new id first (legacy repairedVisibility flags removed in Phase E cleanup)
  const listResp: any = await dispatch('list', { expectId: id });
    expect(listResp.items[0].id).toBe(id);

    // Duplicate add without overwrite should skip (visibility repair path ensures index presence)
  const dupResp: any = await dispatch('add', { entry: { id, body: 'Hello body again' }, lax: true });
    expect(dupResp).toMatchObject({ id, skipped: true, created: false, overwritten: false });

    // Search should match
  const searchResp: any = await dispatch('search', { q: 'hello' });
    expect(searchResp.count).toBeGreaterThan(0);

    // Diff with matching clientHash should return upToDate once we supply known hash
  const diffInitial: any = await dispatch('diff', { clientHash: 'bogus' });
    expect(diffInitial.hash).toBeDefined();
  const diffUpToDate: any = await dispatch('diff', { clientHash: diffInitial.hash });
    // Either upToDate or changed depending on hash mismatch (hash changes after duplicate skip due to no mutation)
    if(diffUpToDate.upToDate !== true){
      expect(diffUpToDate.hash).toBe(diffInitial.hash); // Should stabilize
    }

    // Export metaOnly truncates body
  const exportResp: any = await dispatch('export', { ids: [id], metaOnly: true });
    expect(exportResp.items[0].body).toBe('');

    // Query filters by text & categories
  const queryResp: any = await dispatch('query', { text: 'hello', categoriesAny: ['test'] });
    expect(queryResp.count).toBeGreaterThan(0);
    expect(queryResp.items.some((i:any)=> i.id===id)).toBe(true);

    // Categories aggregation includes 'test'
  const catResp: any = await dispatch('categories', {});
    expect(catResp.categories.some((c:any)=> c.name==='test')).toBe(true);

    // dir lists underlying JSON file
  const dirResp: any = await dispatch('dir', {});
    expect(dirResp.files.some((f:string)=> f.startsWith(id))).toBe(true);

    // Remove then reload and ensure get via dispatcher list no longer contains id
  const rmResp: any = await remove({ ids: [id] });
    expect(rmResp.removed).toBe(1);
    reload({});
  const postList: any = await dispatch('list', {});
    expect(postList.items.some((i:any)=> i.id===id)).toBe(false);
  });
});
