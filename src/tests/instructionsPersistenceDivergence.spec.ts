/**
 * @fileoverview Former RED persistence divergence reproduction test now GREEN.
 * Original failure condition (phantom writes: add success without list/get/hash change)
 * was determined to be baseline drift: IDs already existed so adds were overwrites,
 * leaving count & synthetic hash stable. This GREEN test asserts correctness for:
 *  - Overwrite path keeps visibility (list + read) and does not shrink Index.
 *  - If any supplied IDs are NEW, count increases accordingly and synthetic hash changes.
 *  - All target IDs remain (or become) visible via list/read after operations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import os from 'node:os';
import { createTestClient } from './helpers/mcpTestClient.js';

const IDS = [
  'github-mermaid-dark-theme-quick-guide-2025',
  'github-mermaid-dark-theme-quick-guide-2025-2',
  'github-mermaid-dark-theme-quick-guide-2025-3',
  'github-mermaid-dark-theme-quick-guide-2025-4',
  'github-mermaid-dark-theme-quick-guide-2025-5'
];

const BASE_ENTRY = {
  title: 'GitHub Mermaid Dark Theme Quick Guide',
  body: 'Minimal body for persistence verification (GREEN).',
  priority: 50,
  audience: 'all',
  requirement: 'optional',
  categories: ['github','documentation','visualization','markdown'],
  owner: 'documentation-team'
};

// helper wrappers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function add(client: any, id: string){ return client.create({ id, ...BASE_ENTRY }, { overwrite:true }); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasId(listObj: any, id: string){ return !!listObj?.items?.some((i: any)=> i.id === id); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNotFound(obj: any){ return !!obj?.notFound; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deriveSyntheticHash(listObj: any){
  const ids = (listObj?.items||[]).map((i: any)=> i.id).sort();
  let h = 2166136261 >>> 0;
  for(const id of ids){ for(let i=0;i<id.length;i++){ h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } }
  return h.toString(16).padStart(8,'0');
}

describe('Instruction Persistence Divergence (resolved GREEN)', ()=>{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeAll(async () => {
    let instructionsDir: string;
    if(process.env.TEST_INDEX_SERVER_DIR){
      instructionsDir = process.env.TEST_INDEX_SERVER_DIR;
    } else {
      const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-persist-div-'));
      instructionsDir = tmpBase;
    }
    client = await createTestClient({ forceMutation:true, instructionsDir });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('add/overwrite operations maintain visibility and update count/hash appropriately', async () => {
    const initial = await client.list();
    const initialCount = (initial.items||[]).length;
    const initialHash = deriveSyntheticHash(initial);
    const preExisting = new Set<string>();
    for(const id of IDS){ if(hasId(initial,id)) preExisting.add(id); }

    const results: any[] = [];
    for(const id of IDS){ results.push(await add(client,id)); }

    for(let i=0;i<results.length;i++){
      const r = results[i];
      expect(r && (r.created || r.overwritten)).toBeTruthy();
      if('skipped' in r) expect(r.skipped).toBe(false);
    }

    const after = await client.list();
    const afterCount = (after.items||[]).length;
    const afterHash = deriveSyntheticHash(after);

    const newlyCreated = IDS.filter(id=> !preExisting.has(id));
    if(newlyCreated.length){
      expect(afterCount).toBeGreaterThanOrEqual(initialCount + newlyCreated.length);
      expect(afterHash).not.toBe(initialHash);
    } else {
      // pure overwrites: count stable or higher, hash may remain stable if bodies unchanged
      expect(afterCount).toBeGreaterThanOrEqual(initialCount);
    }

    for(const id of IDS){
      expect(hasId(after,id), `List should contain ${id}`).toBe(true);
      const rec = await client.read(id);
      expect(isNotFound(rec)).toBe(false);
    }
  }, 60000);
});
