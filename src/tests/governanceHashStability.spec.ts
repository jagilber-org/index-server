import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { callTool } from './testUtils';
import { computeGovernanceHash, ensureLoaded } from '../services/indexContext';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

const DIR = path.join(process.cwd(),'tmp','gov-hash-stability');

beforeAll(async () => {
  process.env.INDEX_SERVER_MUTATION = '1';
  process.env.INDEX_SERVER_MANIFEST_WRITE = '1';
  process.env.INDEX_SERVER_DIR = DIR;
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

describe('governance hash stability across redundant manifest refresh', () => {
  it('hash unchanged after consecutive refreshes with no semantic changes', async () => {
    const idA = 'gov-hash-a-' + Date.now();
    const idB = 'gov-hash-b-' + (Date.now()+1);
    await callTool('index_add', { entry:{ id:idA, body:'A body', title:'A', priority:10, audience:'all', requirement:'optional', categories:['gov'] }, overwrite:false });
    await callTool('index_add', { entry:{ id:idB, body:'B body', title:'B', priority:20, audience:'all', requirement:'optional', categories:['gov'] }, overwrite:false });
    // Initial governance hash
    const st1 = ensureLoaded();
    const hash1 = computeGovernanceHash(st1.list);
    await callTool('manifest_refresh', {});
    const st2 = ensureLoaded();
    const hash2 = computeGovernanceHash(st2.list);
    await callTool('manifest_refresh', {}); // redundant
    const st3 = ensureLoaded();
    const hash3 = computeGovernanceHash(st3.list);
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });
});
