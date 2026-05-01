import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { callTool } from './testUtils';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

const DIR = path.join(process.cwd(),'tmp','manifest-skip');
// Isolate manifest output per-fork to avoid races with parallel manifest-writing tests
// (vitest pool=forks, maxWorkers=4 share process.cwd() but each test file gets its own
// fork; the manifest snapshot path is otherwise process-cwd-relative and shared on disk).
const SNAP = path.join(DIR,'index-manifest.json');

beforeAll(async () => {
  process.env.INDEX_SERVER_MUTATION = '1';
  process.env.INDEX_SERVER_MANIFEST_WRITE = '1';
  process.env.INDEX_SERVER_DIR = DIR;
  process.env.INDEX_SERVER_MANIFEST_PATH = SNAP;
  reloadRuntimeConfig(); // Reload config after setting env vars
  fs.rmSync(DIR,{recursive:true,force:true});
  fs.mkdirSync(DIR,{recursive:true});
  // side-effect imports
  // @ts-expect-error dynamic side-effect import after env setup
  await import('../services/handlers.instructions');
  // @ts-expect-error dynamic side-effect import after env setup
  await import('../services/instructions.dispatcher');
  // @ts-expect-error dynamic side-effect import after env setup
  await import('../services/handlers.manifest');
});

describe('manifest no-change skip', () => {
  it('second refresh does not rewrite identical manifest', async () => {
    const id = 'skip-test-' + Date.now();
    await callTool('index_add', { entry:{ id, body:'body', title:'Title', priority:1, audience:'all', requirement:'optional', categories:['skip'] }, overwrite:false });
    // First explicit refresh
    await callTool('manifest_refresh', {});
    expect(fs.existsSync(SNAP)).toBe(true); // lgtm[js/file-system-race]
    const stat1 = fs.statSync(SNAP);
    const content1 = fs.readFileSync(SNAP,'utf8'); // lgtm[js/file-system-race] — test reads SNAP after explicit refresh; race acceptable in test infra
    // Wait a tiny bit to ensure mtime difference would be observable if write occurred
    await new Promise(r=>setTimeout(r,25));
    // Second refresh should detect no change and skip write
    await callTool('manifest_refresh', {});
    const stat2 = fs.statSync(SNAP); // lgtm[js/file-system-race]
    const content2 = fs.readFileSync(SNAP,'utf8'); // lgtm[js/file-system-race] — test reads SNAP after explicit refresh; race acceptable in test infra
    expect(content2).toBe(content1);
    expect(stat2.mtimeMs).toBe(stat1.mtimeMs); // skipped write preserves mtime
  });
});
