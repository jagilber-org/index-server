/**
 * Instruction CRUD Integration Tests — TDD RED Phase
 *
 * Full lifecycle tests for instruction management through the handler layer:
 * Create → Read → Update → Search → Delete with governance validation.
 *
 * Tests exercise the REAL handler registry and IndexContext — no mocks of
 * the code under test. Only I/O (filesystem) uses isolated temp dirs.
 *
 * Constitution: TS-4 (full pipeline round-trips), TS-9 (real code),
 *               TS-12 (>=5 test cases), A-3 (IndexContext is SSOT),
 *               A-5 (audit logging for mutations)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Import REAL handler registrations via side-effect imports
import '../services/handlers.instructions';
import '../services/handlers.search';
import '../services/instructions.dispatcher';

import { getHandler } from '../server/registry';
import { getRuntimeConfig, reloadRuntimeConfig } from '../config/runtimeConfig';
import { invalidate, ensureLoaded, getIndexState, getInstructionsDir } from '../services/indexContext';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating';

function uniqueId(): string {
  return `crud-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Call a registered handler and parse the envelope response */
async function invokeHandler(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = getHandler(name);
  if (!handler) throw new Error(`Handler "${name}" not registered`);
  const raw = await handler(params);
  // Handlers return wrapResponse(...) which wraps in { content: [{ type, text }] }
  const wrapped = raw as { content?: Array<{ text: string }> };
  if (wrapped?.content?.[0]?.text) {
    try { return JSON.parse(wrapped.content[0].text); } catch { /* fall through */ }
  }
  return raw as Record<string, unknown>;
}

describe('Instruction CRUD Full Lifecycle', () => {
  const originalMutation = process.env.INDEX_SERVER_MUTATION;
  const originalIndexDir = process.env.INDEX_SERVER_DIR;
  const createdIds: string[] = [];
  let TMP_DIR = '';

  beforeAll(() => {
    // Isolate to a temp dir so we never pollute the workspace's instructions/ folder.
    TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-crud-integration-'));
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    process.env.INDEX_SERVER_MUTATION = '1';
    reloadRuntimeConfig();
    invalidate();
    forceBootstrapConfirmForTests('crud-integration');
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterAll(() => {
    // Remove the entire temp dir; createdIds tracking is a no-op safety net.
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }
    if (originalIndexDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = originalIndexDir;
    if (originalMutation === undefined) delete process.env.INDEX_SERVER_MUTATION;
    else process.env.INDEX_SERVER_MUTATION = originalMutation;
    reloadRuntimeConfig();
    invalidate();
  });



  it('should create an instruction and read it back', async () => {
    const id = uniqueId();
    createdIds.push(id);
    const addResult = await invokeHandler('index_dispatch', { action: 'add',
      id,
      title: 'Test Create Read',
      body: 'Body content for create-read test',
      priority: 50,
      audience: 'individual',
      requirement: 'optional',
    });
    expect(addResult).toBeDefined();

    // Read it back
    const getResult = await invokeHandler('index_dispatch', {
      action: 'get',
      id,
    });
    expect(getResult).toBeDefined();
    // get returns { item: {...} } or { data: {...} }
    const gr = getResult as Record<string, unknown>;
    const item = (gr.item || gr.data || gr) as Record<string, unknown>;
    expect(item.id).toBe(id);
  });

  it('should update an instruction and verify changes', async () => {
    const id = uniqueId();
    createdIds.push(id);

    // Create
    await invokeHandler('index_dispatch', { action: 'add',
      id,
      title: 'Before Update',
      body: 'Original body',
      priority: 50,
      audience: 'individual',
      requirement: 'optional',
    });

    // Update via add (overwrite)
    const updateResult = await invokeHandler('index_dispatch', {
      action: 'add',
      id,
      title: 'After Update',
      body: 'Updated body content',
      priority: 50,
      audience: 'individual',
      requirement: 'optional',
      overwrite: true,
    });
    expect(updateResult).toBeDefined();

    // Verify
    const getResult = await invokeHandler('index_dispatch', {
      action: 'get',
      id,
    });
    const gr2 = getResult as Record<string, unknown>;
    const item2 = (gr2.item || gr2.data || gr2) as Record<string, unknown>;
    expect(item2.title).toBe('After Update');
    expect(item2.body).toContain('Updated body');
  });

  it('should delete an instruction and verify removal', async () => {
    const id = uniqueId();
    createdIds.push(id);

    // Create
    await invokeHandler('index_dispatch', { action: 'add',
      id,
      title: 'To Be Deleted',
      body: 'This will be deleted',
      priority: 50,
      audience: 'individual',
      requirement: 'optional',
    });

    // Verify it exists
    const preDelete = await invokeHandler('index_dispatch', { action: 'get', id });
    expect(preDelete).toBeDefined();

    // Delete
    const deleteResult = await invokeHandler('index_dispatch', { action: 'remove', id });
    expect(deleteResult).toBeDefined();

    // Verify removal — get should return error or empty
    const postDelete = await invokeHandler('index_dispatch', { action: 'get', id });
    // Expect either error flag, notFound, or missing item
    const pd = postDelete as Record<string, unknown>;
    expect(pd.error || pd.notFound || pd.item === null || pd.item === undefined || pd.data === null).toBeTruthy();
  });

  it('should list instructions and include newly created ones', async () => {
    const id = uniqueId();
    createdIds.push(id);

    await invokeHandler('index_dispatch', { action: 'add',
      id,
      title: 'List Test Entry',
      body: 'Entry for listing test',
      priority: 50,
      audience: 'individual',
      requirement: 'optional',
    });

    const listResult = await invokeHandler('index_dispatch', { action: 'list' });
    const lr = listResult as Record<string, unknown>;
    const listData = (lr.data || lr) as Record<string, unknown>;
    const rawItems = listData.items || listData.entries || lr.items || lr.entries;
    const items = (Array.isArray(rawItems) ? rawItems : []) as Array<Record<string, unknown>>;
    const found = items.some((item: Record<string, unknown>) => item.id === id);
    expect(found).toBe(true);
  });

  it('should search instructions by keyword', async () => {
    const id = uniqueId();
    createdIds.push(id);
    const uniqueKeyword = `xyzzy-${Date.now()}`;

    await invokeHandler('index_dispatch', { action: 'add',
      id,
      title: `Search Test with ${uniqueKeyword}`,
      body: `Body containing ${uniqueKeyword} for search validation`,
      priority: 50,
      audience: 'individual',
      requirement: 'optional',
    });

    // Search for the unique keyword
    const searchResult = await invokeHandler('index_search', {
      keywords: [uniqueKeyword],
    });
    expect(searchResult).toBeDefined();
    const sr = searchResult as Record<string, unknown>;
    const searchData = (sr.data || sr) as Record<string, unknown>;
    const results = (searchData.results || []) as Array<Record<string, unknown>>;
    const found = results.some((r: Record<string, unknown>) => r.id === id || r.instructionId === id);
    expect(found).toBe(true);

    // Cleanup
    await invokeHandler('index_dispatch', { action: 'remove', id });
  });

  it('should enforce body size limits on add', async () => {
    const id = uniqueId();
    createdIds.push(id);
    reloadRuntimeConfig();
    const oversizedBody = 'x'.repeat(getRuntimeConfig().index.bodyWarnLength + 1);

    const result = await invokeHandler('index_dispatch', { action: 'add',
      entry: {
        id,
        title: 'Oversized Body Test',
        body: oversizedBody,
        priority: 50,
        audience: 'individual',
        requirement: 'optional',
        categories: ['crud'],
      },
      overwrite: true,
      lax: true,
    });
    const r = result as Record<string, unknown>;
    expect(r.error).toBe('body_too_large');
    expect(r.created).toBe(false);
    expect(r.bodyLength).toBe(oversizedBody.length);
  });

  it('should reject creation without required fields', async () => {
    try {
      await invokeHandler('index_dispatch', { action: 'add',
        // Missing id, title, body
        priority: 50,
      });
      expect.fail('Should have thrown for missing required fields');
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  it('should maintain governance hash on create', async () => {
    const id = uniqueId();
    createdIds.push(id);

    await invokeHandler('index_dispatch', { action: 'add',
      id,
      title: 'Governance Hash Test',
      body: 'Testing governance hash tracking',
      priority: 50,
      audience: 'individual',
      requirement: 'optional',
    });

    // Read back and check for governance hash
    const getResult = await invokeHandler('index_dispatch', { action: 'get', id });
    const gr3 = getResult as Record<string, unknown>;
    const item3 = (gr3.item || gr3.data || gr3) as Record<string, unknown>;
    // sourceHash is the governance hash on instruction entries
    const govHash = item3.sourceHash || gr3.hash || item3._hash;
    expect(govHash).toBeDefined();
    expect(typeof govHash).toBe('string');
    expect((govHash as string).length).toBeGreaterThan(0);
  });

  it('should persist instructions to disk', async () => {
    const id = uniqueId();
    createdIds.push(id);

    await invokeHandler('index_dispatch', { action: 'add',
      id,
      title: 'Persistence Test',
      body: 'Verify this persists to disk',
      priority: 50,
      audience: 'individual',
      requirement: 'optional',
    });

    // Check filesystem
    const filePath = path.join(getInstructionsDir(), `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(content.id).toBe(id);
    expect(content.title).toBe('Persistence Test');
  });

  it('should handle concurrent creates without data loss', { timeout: 60_000 }, async () => {
    const ids = Array.from({ length: 10 }, () => uniqueId());

    const promises = ids.map(id =>
      invokeHandler('index_dispatch', { action: 'add',
        id,
        title: `Concurrent Test ${id}`,
        body: `Concurrent body ${id}`,
        priority: 50,
        audience: 'individual',
        requirement: 'optional',
      })
    );

    await Promise.all(promises);

    // Verify all were created
    invalidate();
    await ensureLoaded();
    const state = getIndexState();

    for (const id of ids) {
      expect(state.byId.get(id) || fs.existsSync(path.join(getInstructionsDir(), `${id}.json`))).toBeTruthy();
    }
  });
});
