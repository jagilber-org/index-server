import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { describe, it, expect, afterAll } from 'vitest';

function send(proc: ReturnType<typeof spawn>, msg: unknown){
  // best-effort write; swallow if already closed
  try { proc.stdin?.write(JSON.stringify(msg)+'\n'); } catch {/* ignore */}
}

/**
 * Collect first JSON-RPC-ish object satisfying predicate with:
 * - Exit / error early rejection (gives clearer diagnostics than silent timeout)
 * - Adaptive line buffering (handles partial chunks)
 * - Timeout safety
 */
function collectUntil(proc: ReturnType<typeof spawn>, predicate: (obj: any)=>boolean, timeoutMs=8000): Promise<any>{
  return new Promise((resolve, reject)=>{
    const start = Date.now();
    let buffer = '';
    let settled = false;

    const finalize = (err: Error | null, value?: any)=>{
      if(settled) return; settled = true;
      proc.stdout?.off('data', onData);
      proc.off('exit', onExit);
      proc.off('error', onErr);
      if(err) reject(err); else resolve(value);
    };

    const tryLines = ()=>{
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for(const line of lines){
        if(!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if(predicate(obj)) return finalize(null, obj);
        } catch {/* ignore */}
      }
    };

    const onData = (d: Buffer)=>{
      if(settled) return;
      buffer += d.toString('utf8');
      tryLines();
      if(!settled && Date.now() - start > timeoutMs){
        finalize(new Error('collectUntil timeout after '+timeoutMs+'ms'));
      }
    };
    const onExit = (code: number|null, signal: string|null)=>{
      if(!settled) finalize(new Error(`process exited before predicate (code=${code} signal=${signal})`));
    };
    const onErr = (err: Error)=>{ if(!settled) finalize(new Error('process error before predicate: '+err.message)); };

    proc.stdout?.on('data', onData);
    proc.once('exit', onExit);
    proc.once('error', onErr);
  });
}

describe('help_overview onboarding guidance', () => {
  const serverPath = path.join(__dirname,'../../dist/server/index-server.js');
  const env = { ...process.env };
  let proc: ReturnType<typeof spawn> | null = null;
  afterAll(()=>{ try { proc?.kill(); } catch { /* ignore */ } });

  it('returns structured onboarding payload with required sections (robust handshake)', async () => {
    // Pre-flight: give clearer failure if dist missing.
    if(!fs.existsSync(serverPath)) throw new Error('Server dist artifact missing at '+serverPath+' (ensure build ran)');

  // Force deterministic log flushing & potentially skip any non-critical slow paths if env honors them
  env.INDEX_SERVER_LOG_SYNC = '1';
  proc = spawn('node',[serverPath], { stdio:['pipe','pipe','pipe'], env });

    // Capture early stderr for diagnostics if handshake fails.
    const stderr: string[] = [];
    proc.stderr?.on('data', d=> stderr.push(d.toString('utf8')));

  // Optionally wait briefly for any startup banner to reduce race (adaptive, up to 1s)
  await new Promise(r=> setTimeout(r, 50));

  // initialize (extended timeout for large instruction indexs)
  send(proc,{ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', clientInfo:{ name:'onboarding-test', version:'0.0.0' }, capabilities:{ tools:{} } } });
  const init = await collectUntil(proc, o=> o.id===1 && (o.result?.capabilities || o.error), 15000);
    if(init?.error) throw new Error('Initialize failed: '+JSON.stringify(init.error));

    // tools list (meta_tools via tools/call) to ensure help tool registered
  send(proc,{ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'meta_tools', arguments:{} } });
  const meta = await collectUntil(proc, o=> o.id===2, 12000);
    expect(meta?.error).toBeUndefined();
    const metaTextTools = JSON.stringify(meta);
    expect(metaTextTools).toContain('help_overview');

    // call help_overview
  send(proc,{ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'help_overview', arguments:{} } });
  const help = await collectUntil(proc, o=> o.id===3, 12000);
    expect(help?.error).toBeUndefined();

    // Robust extraction across possible envelope shapes similar to governanceRecursionGuard
    function extract(env: any): any {
      if(!env) return env;
      let r = env.result ?? env;
      if(r?.result) r = r.result;
      if(typeof r === 'string'){
        try { const parsed = JSON.parse(r); if(parsed && parsed.generatedAt && parsed.sections) return parsed; } catch { /* ignore */ }
      }
      if(r?.data && typeof r.data === 'object') return r.data;
      if(r && typeof r === 'object' && r.generatedAt && r.sections) return r;
      if(Array.isArray(r?.content)){
        for(const c of r.content){
          if(c && typeof c === 'object'){
            if(c.data && typeof c.data === 'object' && c.data.generatedAt) return c.data;
            if(typeof c.text === 'string'){
              try { const obj = JSON.parse(c.text); if(obj && obj.generatedAt && obj.sections) return obj; } catch { /* ignore */ }
            }
          }
        }
      }
      return r;
    }
    const result = extract(help);
    if(!result){
      throw new Error('No result extracted. Stderr:\n'+stderr.join(''));
    }
    expect(result.generatedAt).toBeTruthy();
    expect(result.version).toBeTruthy();
    expect(Array.isArray(result.sections)).toBe(true);
    const sectionIds = result.sections.map((s: any)=> s.id);
    for(const required of ['intro','discovery','lifecycle','promotion','mutation-safety','recursion-safeguards','next-steps']){
      expect(sectionIds).toContain(required);
    }
    expect(result.lifecycleModel?.tiers?.length).toBeGreaterThan(0);
    expect(result.lifecycleModel?.promotionChecklist?.length).toBeGreaterThan(3);
    expect(Array.isArray(result.toolDiscovery.primary)).toBe(true);
    expect(result.toolDiscovery.primary.length).toBeGreaterThan(5);
  }, 30000); // explicit extended timeout (30s) for CI variance
});
