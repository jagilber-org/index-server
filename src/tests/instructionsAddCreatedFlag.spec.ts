import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { waitForDist } from './distReady';
import { waitFor, getResponse, parseToolPayload } from './testUtils';

function start(dir:string){
  return spawn('node',[path.join(__dirname,'../../dist/server/index-server.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, INDEX_SERVER_MUTATION:'1', INDEX_SERVER_DIR: dir } });
}
function send(proc: ReturnType<typeof start>, msg: Record<string, unknown>){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function find(out:string[], id:number){ return out.find(l=> { try { return JSON.parse(l).id===id; } catch { return false; } }); }

// Helper to perform add via dispatcher
async function dispatchAdd(out:string[], proc: ReturnType<typeof start>, idNum:number, entry: any, extra: any = {}){
  send(proc,{ jsonrpc:'2.0', id:idNum, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry, ...extra } } });
  return await getResponse(out, idNum, 6000);
}

describe('index_add created flag & failure feedback guidance', () => {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(),'add-created-'));
  beforeAll(async ()=> { await waitForDist(); });

  it('returns created:true & verified:true only when record readable + retrievable', async () => {
    const proc = start(DIR); const out:string[]=[]; proc.stdout.on('data',d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'created-test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!find(out,1));
    const ADD_ID = 10;
    const entry = { id:'created_ok_'+Date.now(), title:'Title', body:'Some body', audience:'all', requirement:'optional', categories:['one'], owner:'owner-a', priorityTier:'P1' };
    const resp = await dispatchAdd(out, proc, ADD_ID, entry, { lax:true, overwrite:true });
    const payload = parseToolPayload<{ created?: boolean; verified?: boolean; error?: string }>(JSON.stringify(resp));
    expect(payload?.error).toBeFalsy();
    expect(payload?.created).toBe(true);
    expect(payload?.verified).toBe(true);
    // Follow-up get via dispatcher list+export to ensure present
    send(proc,{ jsonrpc:'2.0', id:20, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'get', id: entry.id } } });
    const getResp = await getResponse(out,20,4000);
    const getPayload = parseToolPayload<{ item?: any }>(JSON.stringify(getResp));
    expect(getPayload?.item?.id).toBe(entry.id);
    proc.kill();
  }, 10000);

  it('failure: P1 missing owner produces error with feedbackHint & reproEntry', async () => {
    const proc = start(DIR); const out:string[]=[]; proc.stdout.on('data',d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'created-test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!find(out,1));
    const ADD_ID = 30;
    const bad = { id:'fail_p1_'+Date.now(), title:'Fail Case', body:'Body', audience:'all', requirement:'optional', categories:['one'], priorityTier:'P1' };
    const resp = await dispatchAdd(out, proc, ADD_ID, bad, { lax:true, overwrite:true });
    const payload = parseToolPayload<{ created?: boolean; error?: string; feedbackHint?: string; reproEntry?: any }>(JSON.stringify(resp));
    expect(payload?.created).toBe(false);
    expect(payload?.error).toBe('P1 requires category & owner');
    expect(payload?.feedbackHint).toBeTruthy();
    expect(payload?.reproEntry?.id).toBe(bad.id);
    proc.kill();
  }, 10000);

  it('failure: mandatory missing owner with feedback guidance and repro', async () => {
    const proc = start(DIR); const out:string[]=[]; proc.stdout.on('data',d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'created-test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!find(out,1));
    const ADD_ID = 40;
    const bad = { id:'fail_mand_'+Date.now(), title:'Fail Mand', body:'Body', audience:'all', requirement:'mandatory', categories:['one'] };
    const resp = await dispatchAdd(out, proc, ADD_ID, bad, { lax:true, overwrite:true });
    const payload = parseToolPayload<{ created?: boolean; error?: string; feedbackHint?: string; reproEntry?: any }>(JSON.stringify(resp));
    expect(payload?.created).toBe(false);
    expect(payload?.error).toBe('mandatory/critical require owner');
    expect(payload?.feedbackHint).toBeTruthy();
    expect(payload?.reproEntry?.id).toBe(bad.id);
    proc.kill();
  }, 10000);

  it('failure: missing required fields (no title) surfaces repro & hint', async () => {
    const proc = start(DIR); const out:string[]=[]; proc.stdout.on('data',d=> out.push(...d.toString().trim().split(/\n+/)));
    await new Promise(r=> setTimeout(r,120));
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'created-test', version:'0' }, capabilities:{ tools:{} } } });
    await waitFor(()=> !!find(out,1));
    const ADD_ID = 50;
    const bad = { id:'fail_missing_'+Date.now(), body:'Body only' }; // lax:true will not inject title if absent? we rely on missing required after lax fill
    const resp = await dispatchAdd(out, proc, ADD_ID, bad, { lax:false, overwrite:true });
    const payload = parseToolPayload<{ created?: boolean; error?: string; feedbackHint?: string; reproEntry?: any }>(JSON.stringify(resp));
    expect(payload?.created).toBe(false);
    expect(payload?.error).toBe('missing required fields');
    expect(payload?.feedbackHint).toBeTruthy();
    expect(payload?.reproEntry?.id).toBe(bad.id);
    proc.kill();
  }, 10000);
});
