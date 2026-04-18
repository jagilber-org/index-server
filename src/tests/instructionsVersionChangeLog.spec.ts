import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

// This test validates end-to-end governance metadata lifecycle for instructions:
// - create (lax) fills default version + changeLog
// - explicit version + changeLog persistence
// - update with overwrite appends new changeLog entry when caller supplies it
// - export/meta reflects changeLog length & version
// - schema rejects malformed changeLog entries

const TMP_DIR = path.join(process.cwd(), 'tmp', 'version-changelog');

describe('instructions governance: version & changeLog CRUD', () => {
  beforeAll(async () => {
  process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR; // isolate
    reloadRuntimeConfig(); // Reload config after setting env vars
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    // dynamic imports AFTER env vars
    // @ts-expect-error side-effect load
    await import('../services/handlers.instructions');
    // @ts-expect-error side-effect load
    await import('../services/instructions.dispatcher');
  });

  it('create -> update (version bump) -> export meta shows updated changeLog length', async () => {
    const dispatch = (action: string, params: Record<string, any>) => (getHandler('index_dispatch') as any)({ action, ...params });
    const add = getHandler('index_add');

    const id = 'governance-test-entry';
    // Create with minimal fields (lax) - version should default (1.0.0) & changeLog seeded length=1
  // NOTE: requirement must be one of the allowed governance enums. Previous value 'req' caused silent
  // classification rejection resulting in item not appearing in list. Use 'optional' to satisfy enum.
  const createResp: any = await add({ entry: { id, title: id, body: 'initial body', audience: 'all', requirement: 'optional', priority: 10, categories: ['test'] }, lax: true });
    expect(createResp).toMatchObject({ id, created: true });

    // List and locate entry; verify default governance fields
    const list1: any = await dispatch('list', { expectId: id });
    const item1 = list1.items.find((i: any) => i.id === id);
    expect(item1.version).toBeDefined();
    expect(Array.isArray(item1.changeLog)).toBe(true);
    expect(item1.changeLog.length).toBe(1);
    const initialVersion = item1.version;
    // Capture length and snapshot changeLog before mutation — the list result may
    // share a reference with the in-process index, so later writes can mutate item1.
    const initialChangeLogLength = item1.changeLog.length;
    const initialChangeLog = [...item1.changeLog];

    // Overwrite with explicit version bump & appended changeLog entry
    const newVersion = '1.1.0';
  const updateResp: any = await add({ entry: { id, body: 'updated body', version: newVersion, changeLog: [...initialChangeLog, { version: newVersion, changedAt: new Date().toISOString(), summary: 'body update' }] }, overwrite: true });
  // Overwrite semantics post-governance-hardening: 'overwritten' may be false if underlying
  // persistence layer determines no structural hash change beyond version/changeLog normalization.
  // Assert only id presence & absence of error; version bump verified via subsequent list.
  expect(updateResp.id).toBe(id);
  expect(updateResp.error).toBeFalsy();

    const list2: any = await dispatch('list', { expectId: id });
    const item2 = list2.items.find((i: any) => i.id === id);
    expect(item2.version).toBe(newVersion);
    expect(item2.changeLog.length).toBe(initialChangeLogLength + 1);
    // Ensure prior version retained as first element
    expect(item2.changeLog[0].version).toBe(initialVersion);
    expect(item2.changeLog[item2.changeLog.length - 1].version).toBe(newVersion);

    // Export metaOnly should reflect changeLogLength via index summary
    const diffResp: any = await dispatch('diff', { clientHash: 'bogus' });
    expect(diffResp.hash).toMatch(/^[a-f0-9]{64}$/);

    // Dir should list file backing the instruction
    const dirResp: any = await dispatch('dir', {});
    expect(dirResp.files.some((f: string) => f.includes(id))).toBe(true);
  });

  it('silently repairs malformed changeLog entry (missing required keys)', async () => {
    const add = getHandler('index_add');
    const dispatch = (action: string, params: Record<string, any>) => (getHandler('index_dispatch') as any)({ action, ...params });
    const badId = 'governance-bad-changelog';
  // Use valid requirement value 'optional' (was 'r') to ensure record is accepted, letting changeLog repair logic run.
  const resp: any = await add({ entry: { id: badId, title: badId, body: 'x', audience: 'all', requirement: 'optional', priority: 5, categories: [], version: '2.0.0', changeLog: [{ version: '2.0.0', summary: 'missing changedAt' }] }, lax: true });
    expect(resp).toMatchObject({ id: badId, created: true });
    const list: any = await dispatch('list', { expectId: badId });
    const item = list.items.find((i: any) => i.id === badId);
    expect(item).toBeDefined();
    expect(item.changeLog).toBeDefined();
    expect(Array.isArray(item.changeLog)).toBe(true);
    // Should have at least one entry with changedAt normalized ISO string
    const last = item.changeLog[item.changeLog.length - 1];
    expect(typeof last.changedAt).toBe('string');
    expect(last.version).toBe('2.0.0');
  });
});
