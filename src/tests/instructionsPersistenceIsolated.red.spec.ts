/**
 * @fileoverview Isolated RED test variant for instruction persistence divergence.
 * Purpose: Eliminate baseline drift (pre-existing instruction IDs) by using a fresh, empty
 * temporary instructions directory. This determines whether the previously observed failure
 * was due to genuine phantom write behavior or simply the IDs already existing in the
 * shared repository instructions directory.
 *
 * Logic:
 * 1. Create an empty temporary instructions directory under ./tmp/red-isolated-persistence-test.
 * 2. Initialize MCP test client pointed exclusively at that directory.
 * 3. Add five deterministic instruction IDs (same IDs as production report but isolation guarantees
 *    they do NOT exist prior to the test).
 * 4. List after adds and assert count === 5 and per-ID visibility via list() and read().
 * 5. Assert synthetic hash changed from initial (empty) baseline.
 *
 * Interpretation:
 * - If THIS isolated test passes (GREEN) while the original shared-directory RED test fails, the
 *   original failure cause is baseline contamination (pre-existing IDs) rather than a persistence bug.
 * - If THIS isolated test fails with unchanged count/hash, a genuine persistence visibility defect
 *   exists independent of baseline drift.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
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
  body: 'Minimal body for isolated persistence divergence reproduction.',
  priority: 50,
  audience: 'all',
  requirement: 'optional',
  categories: ['github','documentation','visualization','markdown'],
  owner: 'documentation-team'
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function add(client: any, id: string){
  return client.create({ id, ...BASE_ENTRY }, { overwrite:true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasId(listObj: any, id: string){
  return !!listObj?.items?.some((i: any)=> i.id === id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isNotFound(obj: any){ return !!obj?.notFound; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deriveSyntheticHash(listObj: any){
  const ids = (listObj?.items||[]).map((i: any)=> i.id).sort();
  let h = 2166136261 >>> 0;
  for(const id of ids){
    for(let i=0;i<id.length;i++){
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h.toString(16).padStart(8,'0');
}

describe('RED: Isolated Instruction Persistence Divergence (fresh directory)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  let tempDir: string;

  beforeAll(async () => {
    // Prepare isolated directory
    tempDir = path.join(process.cwd(), 'tmp', 'red-isolated-persistence-test');
    if(fs.existsSync(tempDir)){
      for(const f of fs.readdirSync(tempDir)){
        fs.unlinkSync(path.join(tempDir,f));
      }
    } else {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    client = await createTestClient({ forceMutation:true, instructionsDir: tempDir });
  }, 30000);

  afterAll(async () => { await client?.close(); });

  it('should create 5 new instructions in an empty directory (expected GREEN if no core bug)', async () => {
    const initialList = await client.list();
    expect((initialList.items||[]).length).toBe(0);
    const initialHash = deriveSyntheticHash(initialList);

    const results: any[] = [];
    for(const id of IDS){ results.push(await add(client,id)); }

    const postList = await client.list();
    const postHash = deriveSyntheticHash(postList);

    // Emit diagnostics
    // eslint-disable-next-line no-console
    console.log('[ISOLATED-PERSISTENCE-DIAG]', JSON.stringify({ initialCount: (initialList.items||[]).length, postCount: (postList.items||[]).length, initialHash, postHash, perId: IDS.map((id,i)=> ({ id, add: results[i] })) }, null, 2));

    // Core assertions
    expect((postList.items||[]).length).toBe(IDS.length);
    for(const id of IDS){
      expect(hasId(postList,id), `List should contain ${id}`).toBe(true);
      const read = await client.read(id);
      expect(isNotFound(read), `Read should succeed for ${id}`).toBe(false);
    }
    expect(postHash).not.toBe(initialHash);
  }, 30000);
});
