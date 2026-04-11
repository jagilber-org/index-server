import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs'; // still used for initial directory setup
import os from 'os';
import { waitFor, parseToolPayload, getResponse, xorResultError, ensureFileExists, ensureDir, ensureJsonReadable } from './testUtils';
import { waitForDist } from './distReady';

const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(),'instr-persist-'));
async function ensureDist(){ await waitForDist(); }
function startServer(){
  return spawn('node', [path.join(__dirname, '../../dist/server/index-server.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, INDEX_SERVER_MUTATION:'1', INDEX_SERVER_DIR: ISOLATED_DIR } });
}
function send(proc: ReturnType<typeof startServer>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }

// Minimal helper to extract JSON-RPC response lines by id
function findLine(lines: string[], id: number): string | undefined {
  return lines.find(l=> { try { return JSON.parse(l).id === id; } catch { return false; } });
}

describe('index_add persistence & governance coverage', () => {
  const instructionsDir = ISOLATED_DIR;
  beforeAll(()=>{ ensureDir(instructionsDir); });

  it('adds multiple unique instructions and retains all on list', async () => {
    // Create 5 fresh ids
    const ids = Array.from({ length:5 }, (_,i)=> `add_persist_${Date.now()}_${i}`);
  await ensureDist();
  const server = startServer();
    const out: string[] = []; server.stdout.on('data', d=> out.push(...d.toString().trim().split(/\n+/)));
    // initialize
    await new Promise(r=> setTimeout(r,120));
    send(server,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'coverage', version:'0' }, capabilities:{ tools:{} } } });
  await waitFor(()=> !!findLine(out,1));

    // Baseline list count
  // List via tools/call dispatcher
    send(server,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'list' } } });
    await waitFor(()=> !!findLine(out,2));
    const baselineLine = findLine(out,2);
    const baselinePayload = baselineLine ? parseToolPayload<{ count?:number }>(baselineLine) : undefined;
    const baseline = baselinePayload?.count ?? 0;

  // Add each instruction (now governance fields should persist exactly as provided for alpha)
    for(let i=0;i<ids.length;i++){
      const id = ids[i];
      const addId = 100+i;
      send(server,{ jsonrpc:'2.0', id:addId, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id, title:id, body:`Body ${i}`, priority:50+i, audience:'all', requirement:'optional', categories:['temp','Test'], owner:`owner-${i}`, priorityTier:'P1', version:'9.9.9', classification:'internal', semanticSummary:`Custom summary ${i}` }, lax:true, overwrite:true } } });
      const env = await getResponse(out, addId, 6000);
      expect(xorResultError(env)).toBe(true);
      expect(env.error, `unexpected error for add ${id}: ${JSON.stringify(env.error)}`).toBeFalsy();
  const file = path.join(instructionsDir, id + '.json');
  await ensureFileExists(file, 6000);
  await ensureJsonReadable(file, 6000);
  const disk = JSON.parse(fs.readFileSync(file,'utf8'));
      expect(disk.owner).toBe(`owner-${i}`);
      expect(disk.version).toBe('9.9.9');
      expect(disk.priorityTier).toBe('P1');
      expect(disk.semanticSummary).toBe(`Custom summary ${i}`);
    }

    // List again and ensure at least baseline+5 items present (none silently dropped)
  send(server,{ jsonrpc:'2.0', id:500, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'list' } } });
  await waitFor(()=> !!findLine(out,500));
  const afterLine = findLine(out,500);
  const afterPayload = afterLine ? parseToolPayload<{ count?:number }>(afterLine) : undefined;
  const after = afterPayload?.count ?? 0;
    expect(after).toBeGreaterThanOrEqual(baseline + ids.length);

    // Export just added ids to verify all retrievable
  send(server,{ jsonrpc:'2.0', id:600, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'export', ids } } });
  await waitFor(()=> !!findLine(out,600));
  const exportLine = findLine(out,600);
  const exportPayload = exportLine ? parseToolPayload<{ count:number; items:{ id:string }[] }>(exportLine) : undefined;
  expect(exportPayload?.count).toBe(ids.length);
  if(!exportPayload) throw new Error('missing export response');
  const exportedIds = new Set(exportPayload.items.map(i=> i.id));
    ids.forEach(id=> expect(exportedIds.has(id)).toBe(true));

    server.kill();
  }, 15000);
});
