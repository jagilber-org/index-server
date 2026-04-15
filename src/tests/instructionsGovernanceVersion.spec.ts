import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'governance-version');

describe('index_add governance versioning', () => {
  let add: any; let dispatch: (action:string, params:Record<string,any>)=>Promise<any>;
  beforeAll(async () => {
  process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig(); // Reload config after setting env vars
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    // dynamic imports after env
    // @ts-expect-error side effect
    await import('../services/handlers.instructions');
    // @ts-expect-error side effect
    await import('../services/instructions.dispatcher');
    add = getHandler('index_add');
    dispatch = (action, params) => (getHandler('index_dispatch') as any)({ action, ...params });
  });

  it('auto bumps patch when body changes and version omitted', async () => {
    const id = 'auto-bump-test';
    let resp = await add({ entry: { id, title: id, body: 'first', audience:'all', requirement:'optional', priority:10, categories:['gov'] }, lax:true });
    expect(resp).toMatchObject({ id, created:true });
    let list = await dispatch('list', { expectId: id });
    let rec = list.items.find((i:any)=> i.id===id);
    expect(rec.version).toBe('1.0.0');
    expect(rec.changeLog.length).toBe(1);
    // Second write: body changed, no version -> auto bump to 1.0.1
    resp = await add({ entry: { id, body: 'second body update' }, overwrite:true, lax:true });
    expect(resp).toMatchObject({ id, overwritten:true });
    list = await dispatch('list', { expectId: id });
    rec = list.items.find((i:any)=> i.id===id);
    expect(rec.version).toBe('1.0.1');
    expect(rec.changeLog.length).toBe(2);
    expect(rec.changeLog[1].summary).toMatch(/auto bump|body update/);
  });

  it('rejects non-semver version', async () => {
    const id = 'bad-semver';
    const resp = await add({ entry: { id, title:id, body:'x', version:'1.0', audience:'all', requirement:'optional', priority:5, categories:['gov'] }, lax:true });
    expect(resp.error).toBe('invalid_semver');
  });

  it('rejects body change without higher version', async () => {
    const id = 'no-bump';
  const r = await add({ entry: { id, title:id, body:'base', audience:'all', requirement:'optional', priority:5, categories:['gov'], version:'2.0.0' }, lax:true });
    expect(r).toMatchObject({ id, created:true });
    // Attempt body change with same version
    const r2 = await add({ entry: { id, body:'base modified', version:'2.0.0' }, overwrite:true, lax:true });
    expect(r2.error).toBe('version_not_bumped');
    // Attempt body change with lower version
    const r3 = await add({ entry: { id, body:'base modified again', version:'1.9.9' }, overwrite:true, lax:true });
    expect(r3.error).toBe('version_not_bumped');
  });

  it('allows metadata-only change with higher version even if body unchanged', async () => {
    const id = 'meta-bump';
  const r = await add({ entry: { id, title:id, body:'same', audience:'all', requirement:'optional', priority:5, categories:['gov'], version:'3.0.0' }, lax:true });
    expect(r).toMatchObject({ id, created:true });
    // metadata only (priority) + higher version
    const r2 = await add({ entry: { id, priority:20, version:'3.0.1' }, overwrite:true, lax:true });
    expect(r2).toMatchObject({ id, overwritten:true });
    const list = await dispatch('list', { expectId: id });
    const rec = list.items.find((i:any)=> i.id===id);
    expect(rec.version).toBe('3.0.1');
    expect(rec.changeLog[rec.changeLog.length-1].version).toBe('3.0.1');
  });
});
