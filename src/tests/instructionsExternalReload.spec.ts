/**
 * Permanent regression test: verifies that instruction files created directly on disk
 * (outside the server mutation APIs) become visible after invoking the explicit
 * reload tool (index_reload). It guards against stale in‑memory Index
 * scenarios where externally added JSON files are not surfaced via list/get.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnServer } from './helpers/mcpTestClient.js';

function buildInstruction(id: string){
  return {
    id,
    title: id.replace(/[-_]/g,' ').slice(0,60) || id,
    body: 'External file visibility test body for '+id,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['test','visibility']
  };
}

// Write minimal valid instruction JSON to disk
function writeInstructionFile(dir: string, rec: Record<string, unknown>){
  const file = path.join(dir, rec.id as string + '.json');
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
  return file;
}

describe('instructions: external file visibility + reload', () => {
  const tmpDir = path.join(process.cwd(), 'tmp', 'external-visibility-test');
  const preIds = Array.from({ length:3 }, (_,i)=> `ext-pre-${Date.now()}-${i+1}`);
  const postIds = Array.from({ length:2 }, (_,i)=> `ext-post-${Date.now()}-${i+1}`);
  let client: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let transport: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    // Ensure clean directory
    if(fs.existsSync(tmpDir)){
      for(const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir,f));
    } else {
      fs.mkdirSync(tmpDir, { recursive:true });
    }
    // Pre-populate 3 instruction files BEFORE server starts
    for(const id of preIds){ writeInstructionFile(tmpDir, buildInstruction(id)); }
    // Load connect helper
  const conn = await spawnServer({ env: { INDEX_SERVER_DIR: tmpDir, INDEX_SERVER_MUTATION:'1' } });
    client = conn.client; transport = conn.transport;
  }, 30000);

  afterAll(async () => { try { await transport?.close(); } catch {/* ignore */} });

  async function listIds(){
    const resp = await client.callTool({ name:'index_dispatch', arguments:{ action:'list' } });
    const txt = resp.content?.[0]?.text; if(!txt) return [] as string[];
    try { const obj = JSON.parse(txt); return Array.isArray(obj.items)? obj.items.map((i:any)=> i.id): []; } catch { return []; }
  }

  it('should surface externally added files after explicit reload', async () => {
    // Initial list should include all preIds
    const initialIds = await listIds();
    for(const id of preIds){ expect(initialIds.includes(id), `initial list missing pre-created ${id}`).toBe(true); }

    // Add postIds directly on disk AFTER server already running
    for(const id of postIds){ writeInstructionFile(tmpDir, buildInstruction(id)); }

    // Immediate list (may or may not include new ones depending on detection timing)
    const beforeReloadIds = await listIds();
    const missingBefore = postIds.filter(id=> !beforeReloadIds.includes(id));

    // Force reload
    await client.callTool({ name:'index_reload', arguments:{} });

    const afterReloadIds = await listIds();
    for(const id of [...preIds, ...postIds]){ expect(afterReloadIds.includes(id), `after reload missing ${id}`).toBe(true); }

    // Emit diagnostics
    // eslint-disable-next-line no-console
    console.log('[EXTERNAL-VISIBILITY-DIAG]', JSON.stringify({ preIds, postIds, initialCount: initialIds.length, beforeReloadCount: beforeReloadIds.length, missingBefore, afterReloadCount: afterReloadIds.length }, null, 2));
  }, 60000);
});
