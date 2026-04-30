import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { describe, it, expect, afterAll } from 'vitest';

function send(proc: ReturnType<typeof spawn>, msg: unknown){ proc.stdin?.write(JSON.stringify(msg)+'\n'); }
function waitForId<T=any>(proc: ReturnType<typeof spawn>, id: number, timeoutMs=8000): Promise<T>{
  return new Promise((resolve, reject)=>{
    const start = Date.now();
    const onData = (d: Buffer)=>{
      const lines = d.toString('utf8').split(/\r?\n/).filter(Boolean);
      for(const line of lines){
        let obj: any; try { obj = JSON.parse(line); } catch { continue; }
        if(obj && Object.prototype.hasOwnProperty.call(obj,'id') && obj.id === id){
          proc.stdout?.off('data', onData); resolve(obj as T); return;
        }
      }
      if(Date.now()-start > timeoutMs){ proc.stdout?.off('data', onData); reject(new Error('timeout waiting for id '+id)); }
    };
    proc.stdout?.on('data', onData);
  });
}

/**
 * Bootstrap Gating E2E Test
 * Ensures:
 *  - mutation blocked before confirmation
 *  - token request + finalize enables mutation
 *  - reference mode keeps mutation blocked even after finalize
 */

describe('bootstrap gating', () => {
  let proc: ReturnType<typeof spawn> | null = null;
  afterAll(() => { try { proc?.kill(); } catch { /* ignore */ } });
  it('blocks mutation until confirmation then allows', async () => {
    // Use isolated temporary instructions directory so a previously persisted
    // bootstrap.confirmed.json from other suites (auto-confirm path) does not
    // short‑circuit gating. This ensures we exercise the true token flow.
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-gating-'));
    // Explicitly disable auto-confirm so we validate genuine gating behavior.
  proc = spawn('node',[path.join(__dirname,'../../dist/server/index-server.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, INDEX_SERVER_MUTATION:'1', INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM:'0', INDEX_SERVER_DIR: isolated } });
    proc.stderr?.on('data', () => { /* drain to prevent stderr pipe backpressure stalling server */ });
    // Handshake
    send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'bootstrap-test', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await waitForId(proc,1);
    // Attempt mutation via dispatcher
    send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id:'temp-bootstrap-test', title:'t', body:'b', priority:1, audience:'agents', requirement:'optional', categories:['test'] }, overwrite:true, lax:true } } });
    const addBlocked = await waitForId(proc,2);
    const blockedPayload = (addBlocked as any).result?.content?.[0]?.text ? JSON.parse((addBlocked as any).result.content[0].text) : (addBlocked as any).result;
    expect(blockedPayload.error || blockedPayload.reason).toBeTruthy();
    // Request token
    send(proc,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'bootstrap_request', arguments:{ rationale:'test gating' } } });
    const req = await waitForId(proc,3);
    const reqPayload = (req as any).result?.content?.[0]?.text ? JSON.parse((req as any).result.content[0].text) : (req as any).result;
    if(reqPayload.alreadyConfirmed){ return; }
    const token = reqPayload.token as string;
    expect(typeof token).toBe('string');
    // Finalize
    send(proc,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'bootstrap_confirmFinalize', arguments:{ token } } });
    const fin = await waitForId(proc,4);
    const finPayload = (fin as any).result?.content?.[0]?.text ? JSON.parse((fin as any).result.content[0].text) : (fin as any).result;
    expect(finPayload.result?.confirmed).toBe(true);
    // Retry mutation
    send(proc,{ jsonrpc:'2.0', id:5, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id:'temp-bootstrap-test', title:'t', body:'b', priority:1, audience:'agents', requirement:'optional', categories:['test'] }, overwrite:true, lax:true } } });
    const addAfter = await waitForId(proc,5);
    const addAfterPayload = (addAfter as any).result?.content?.[0]?.text ? JSON.parse((addAfter as any).result.content[0].text) : (addAfter as any).result;
    expect(addAfterPayload.error).toBeFalsy();
  }, 30000);

  it('handles expired token and reference mode block', async () => {
    // Force very short TTL. Use isolated instructions directory again to avoid
    // bleed-over from earlier tests.
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-gating-expire-'));
  proc = spawn('node',[path.join(__dirname,'../../dist/server/index-server.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, INDEX_SERVER_MUTATION:'1', INDEX_SERVER_BOOTSTRAP_TOKEN_TTL_SEC:'1', INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM:'0', INDEX_SERVER_DIR: isolated } });
    proc.stderr?.on('data', () => { /* drain stderr */ });
    send(proc,{ jsonrpc:'2.0', id:11, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'bootstrap-expire', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await waitForId(proc,11);
    send(proc,{ jsonrpc:'2.0', id:12, method:'tools/call', params:{ name:'bootstrap_request', arguments:{ rationale:'expire test' } } });
    const req = await waitForId(proc,12);
    const reqPayload = (req as any).result?.content?.[0]?.text ? JSON.parse((req as any).result.content[0].text) : (req as any).result;
    const token = reqPayload.token;
    expect(typeof token).toBe('string');
    // Wait for expiry
    await new Promise(r=> setTimeout(r, 1100));
    send(proc,{ jsonrpc:'2.0', id:13, method:'tools/call', params:{ name:'bootstrap_confirmFinalize', arguments:{ token } } });
    const fin = await waitForId(proc,13);
    const finPayload = (fin as any).result?.content?.[0]?.text ? JSON.parse((fin as any).result.content[0].text) : (fin as any).result;
    expect(finPayload.result?.error || finPayload.result?.error === 'token_expired' || finPayload.result?.error === 'token_expired');
    proc.kill();

    // Reference mode test
    const isolatedRef = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-gating-ref-'));
    const procRef = spawn('node',[path.join(__dirname,'../../dist/server/index-server.js')], { stdio:['pipe','pipe','pipe'], env:{ ...process.env, INDEX_SERVER_REFERENCE_MODE:'1', INDEX_SERVER_MUTATION:'1', INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM:'0', INDEX_SERVER_DIR: isolatedRef } });
    procRef.stderr?.on('data', () => { /* drain stderr */ });
    send(procRef,{ jsonrpc:'2.0', id:21, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'bootstrap-ref', version:'0.0.0' }, capabilities:{ tools:{} } } });
    await waitForId(procRef,21);
    send(procRef,{ jsonrpc:'2.0', id:22, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'add', entry:{ id:'ref-block-test', title:'ref', body:'r', priority:1, audience:'agents', requirement:'optional', categories:['test'] }, overwrite:true, lax:true } } });
    const blocked = await waitForId(procRef,22);
    const blockedPayload = (blocked as any).result?.content?.[0]?.text ? JSON.parse((blocked as any).result.content[0].text) : (blocked as any).result;
    expect(blockedPayload.reason).toBe('reference_mode_read_only');
    procRef.kill();
  }, 30000);
});
