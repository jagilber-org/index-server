import path from 'path';
import fs from 'fs';
import os from 'os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, send, collectUntil } from './utils/rpcTestUtils';

// ------------------------------------------------------------------------------------------------
// This test enforces that governance/spec seed artifacts are NOT ingested into the runtime
// instruction index and that recursionRisk remains 'none'. It provides a hard guard against
// future refactors accidentally widening ingestion scope.
// ------------------------------------------------------------------------------------------------

describe('governance recursion guard', () => {
  let proc: ReturnType<typeof spawnServer>['proc'] | null = null;
  const INDEX_SERVER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-test-governance-'));
  beforeAll(() => {
  // Use consolidated mutation flag; empty string previously enabled legacy path.
  const spawned = spawnServer('dist/server/index-server.js', { INDEX_SERVER_MUTATION:'1', INDEX_SERVER_DIR: INDEX_SERVER_DIR });
  proc = spawned.proc;
  });
  afterAll(() => {
    try { proc?.kill(); } catch { /* ignore */ }
    try { fs.rmSync(INDEX_SERVER_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('reports recursionRisk none and no governance seeds present', async () => {
    if(!proc) throw new Error('proc not started');
  // Full initialize first (aligns with MCP handshake ordering)
  send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'recursion-spec', version:'0.0.0' }, capabilities:{ tools:{} } } });
  await collectUntil(proc, o=> o.id===1);
  // tools/list to ensure downstream tool registration snapshot (defensive)
  send(proc,{ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });
  await collectUntil(proc, o=> o.id===2);

  send(proc,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'index_health', arguments:{} } });
  const resp = await collectUntil(proc, o=> o.id===3);
    expect(resp.error).toBeUndefined();
    // Expanded extraction: account for tool returning plain object (result) or stringified JSON
    const extract = (env: any): any => {
      if(!env) return env;
      let r = env.result ?? env; // inner result or top-level
      if(r?.result) r = r.result; // nested result
      // Direct hit
      if(r && typeof r === 'object' && 'recursionRisk' in r) return r;
      // content envelope
      if(Array.isArray(r?.content)){
        for(const c of r.content){
          if(c?.data && typeof c.data === 'object' && 'recursionRisk' in c.data) return c.data;
          if(typeof c?.text === 'string'){
            try { const parsed = JSON.parse(c.text); if(parsed && typeof parsed === 'object' && 'recursionRisk' in parsed) return parsed; } catch { /* ignore */ }
          }
        }
      }
      // Some legacy paths may wrap under data
      if(r?.data && typeof r.data === 'object' && 'recursionRisk' in r.data) return r.data;
      return r;
    };
    const r = extract(resp);
    expect(r).toBeTruthy();
    expect(r.recursionRisk).toBe('none');
    // Leakage metrics exist and are small
    expect(r.leakage).toBeTruthy();
    expect(typeof r.leakage.leakageRatio).toBe('number');
    expect(r.leakage.leakageRatio).toBeLessThan(0.01);
    // Assert no bootstrapper/lifecycle ids accidentally present
    const forbiddenIds = ['000-bootstrapper','001-lifecycle-bootstrap','002-content-model'];
    const forbiddenPresent = (r.missing||[]).filter((id:string)=> forbiddenIds.includes(id)).length === 0 && forbiddenIds.every(fid => !(r.extra||[]).includes(fid));
    // Stronger guard: query index listing via dispatcher diff (list indirect) to ensure absence
    send(proc,{ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'list' } } });
  const listResp = await collectUntil(proc, o=> o.id===4);
  const lr: any = listResp.result || {};
  const items = lr.items || lr.list || lr.entries || [];
    for(const fid of forbiddenIds){
      const match = items.find((i: { id:string }) => i.id === fid);
      expect(match, `Forbidden governance seed appeared in Index: ${fid}`).toBeUndefined();
    }
    expect(forbiddenPresent).toBe(true);
  }, 25000);
});
