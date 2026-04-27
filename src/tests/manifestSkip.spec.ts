import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { callTool } from './testUtils';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

const DIR = path.join(process.cwd(),'tmp','manifest-skip');
// Manifest snapshot path is process.cwd()-relative inside writeManifestFromIndex.
// To avoid cross-test races on the shared snapshots/index-manifest.json under
// parallel pool execution, the test chdir's into an isolated tmp work dir so
// only this fork writes to its own snapshots/ tree.
const WORK = path.join(process.cwd(),'tmp','manifest-skip-work');
let originalCwd = '';
let SNAP = '';

beforeAll(async () => {
  process.env.INDEX_SERVER_MUTATION = '1';
  process.env.INDEX_SERVER_MANIFEST_WRITE = '1';
  process.env.INDEX_SERVER_DIR = DIR;
  reloadRuntimeConfig(); // Reload config after setting env vars
  fs.rmSync(DIR,{recursive:true,force:true});
  fs.mkdirSync(DIR,{recursive:true});
  fs.rmSync(WORK,{recursive:true,force:true});
  fs.mkdirSync(path.join(WORK,'snapshots'),{recursive:true});
  originalCwd = process.cwd();
  process.chdir(WORK);
  SNAP = path.join(WORK,'snapshots','index-manifest.json');
  // side-effect imports
  // @ts-expect-error dynamic side-effect import after env setup
  await import('../services/handlers.instructions');
  // @ts-expect-error dynamic side-effect import after env setup
  await import('../services/instructions.dispatcher');
  // @ts-expect-error dynamic side-effect import after env setup
  await import('../services/handlers.manifest');
});

afterAll(() => {
  if (originalCwd) process.chdir(originalCwd);
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
