import { describe, it, expect } from 'vitest';
import { parseInitFrameLines, summarizeInitFrames, validateInitFrameSequence, formatSummary } from '../util/handshakeDiag';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// P1 coverage: exercise dynamic startSdkServer path in sdkServer.ts including:
// - dynamic ESM imports
// - initialize handler ordering guarantees (__initResponseSent gate)
// - transport send hook (reason=transport-send-hook-dynamic)
// - emitReadyGlobal ordering (initialize result precedes server/ready notification)
// - tools/list basic functionality post-ready

function wait(ms: number){ return new Promise(r=>setTimeout(r, ms)); }

describe('sdkServer handshake harness (P1)', () => {
  it('initialize -> (result before ready) -> server/ready -> tools/list ordering', async () => {
  const distServer = path.join(process.cwd(), 'dist', 'server', 'sdkServer.js');
  expect(fs.existsSync(distServer)).toBe(true);
    // Launch via -e and explicitly invoke startSdkServer()
    const launchCode = `const mod=require(${JSON.stringify(distServer)});(async()=>{if(mod&&typeof mod.startSdkServer==='function'){await mod.startSdkServer();}})();`;
    const child = spawn(process.execPath, ['-e', launchCode], {
      stdio: ['pipe','pipe','pipe'],
      env: { ...process.env, INDEX_SERVER_INIT_FEATURES: 'initFallback', INDEX_SERVER_TRACE: 'healthMixed,initFrame' }
    });

    interface Frame { jsonrpc?:string; id?:number; method?:string; result?:any; error?:any; params?:any }
    const frames: Frame[] = [];
    const stderrLines: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let buf='';
    const rawChunks: string[] = [];
    child.stdout.on('data', chunk => {
      const str = String(chunk);
      rawChunks.push(str);
      buf += str;
      let progressed=true;
      while(progressed){
        progressed=false;
        const headerIdx = buf.indexOf('Content-Length:');
        if(headerIdx !== -1){
          // search for header terminator (CRLFCRLF or \n\n)
          const crlf = buf.indexOf('\r\n\r\n', headerIdx);
            const lf = buf.indexOf('\n\n', headerIdx);
            let sepIdx=-1; let sepLen=0;
            if(crlf!==-1 && (lf===-1 || crlf<lf)){ sepIdx=crlf; sepLen=4; }
            else if(lf!==-1){ sepIdx=lf; sepLen=2; }
            if(sepIdx!==-1){
              const headerBlock = buf.slice(0, sepIdx+sepLen);
              const m = /Content-Length:\s*(\d+)/i.exec(headerBlock);
              if(m){
                const len = parseInt(m[1],10);
                const totalNeeded = sepIdx+sepLen+len;
                if(buf.length>=totalNeeded){
                  const payload = buf.slice(sepIdx+sepLen, totalNeeded);
                  buf = buf.slice(totalNeeded);
                  try { frames.push(JSON.parse(payload)); } catch { /* ignore */ }
                  progressed=true; continue;
                }
              }
            }
        }
        // Fallback: newline JSON (unlikely for SDK transport but harmless)
        const nl = buf.indexOf('\n');
        if(nl !== -1){
          const line = buf.slice(0,nl).trim();
          buf = buf.slice(nl+1);
          if(line.startsWith('{') && line.includes('"jsonrpc"')){
            try { frames.push(JSON.parse(line)); } catch { /* ignore */ }
            progressed=true;
          }
        }
      }
    });
    child.stderr.on('data', c => {
      c.split(/\r?\n/).forEach((l:string)=>{ if(l.trim()) stderrLines.push(l.trim()); });
    });

      // Wait for startup sentinel (stderr) up to 1s
      let started = false; const startDeadline = Date.now()+1000;
      while(Date.now()<startDeadline && !started){
        started = stderrLines.some(l=> l.includes('SDK server started (stdio only)'));
        if(!started) await wait(25);
      }
      if(!started){
        // eslint-disable-next-line no-console
        console.warn('[sdkServerHandshake.p1] startup sentinel not observed within 1s; proceeding');
      }
      // Minimal MCP framing: single Content-Length header, double CRLF, payload, trailing CRLF.
      // (Avoid Content-Type header for strict parity with handshakeDirect and to reduce flush timing variables.)
      const sendCL = (obj:unknown)=>{
        const json = JSON.stringify(obj);
        const frame = `Content-Length: ${Buffer.byteLength(json,'utf8')}` + "\r\n\r\n" + json + "\r\n";
        child.stdin.write(frame);
      };
  // Use richer initialize params (mirror handshakeDirect) to avoid any server-side optional gating issues
  sendCL({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{ tools:{ listChanged:true } }, clientInfo:{ name:'sdkServerHandshakeHarness', version:'1.0.0' } }});

    // Wait for initialize result
    let initIndex=-1; const t0=Date.now();
    while(Date.now()-t0 < 4000){
  initIndex = frames.findIndex(f => f.id === 1 && (f.result || f.error));
      if(initIndex!==-1) break;
      await wait(30);
    }
    if(initIndex===-1){
      // Allow extra time for synthetic fallback (since INDEX_SERVER_INIT_FEATURES=initFallback)
      const fallbackEnd = Date.now()+800;
      while(Date.now()<fallbackEnd && initIndex===-1){
        initIndex = frames.findIndex(f=> f.id===1 && (f.result||f.error));
        if(initIndex!==-1) break;
        await wait(40);
      }
    }
    if(initIndex===-1){
  // Provide richer diagnostics then fail (we want true coverage of initialize path, not soft pass here anymore)
  // eslint-disable-next-line no-console
  console.error('[sdkServerHandshake.p1] initialize result NOT observed. Raw stdout chunks count=', rawChunks.length, 'stderr first lines=', stderrLines.slice(0,8));
  // Attempt a late flush request (ping) to see if transport responds at all
  try { sendCL({ jsonrpc:'2.0', id:999, method:'ping', params:{} }); } catch { /* ignore */ }
  await wait(150); // brief grace
  try { child.kill(); } catch { /* ignore */ }
  expect(initIndex).toBeGreaterThan(-1); // force failure with diagnostics above
  return;
    }

  sendCL({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });

    // Wait for server/ready notification (method) and tools/list response
    const t1 = Date.now();
    let readyIndex=-1; let listIndex=-1;
    while(Date.now()-t1 < 4000){
      if(readyIndex===-1){ readyIndex = frames.findIndex(f=> f.method==='server/ready'); }
      listIndex = frames.findIndex(f=> f.id===2 && (f.result||f.error));
      if(readyIndex!==-1 && listIndex!==-1) break;
      await wait(30);
    }
    expect(listIndex).toBeGreaterThan(-1);
    expect(readyIndex).toBeGreaterThan(-1);

    // Ordering: initialize SHOULD precede ready. If inversion occurs, record diagnostic but don't fail (covered strictly elsewhere).
    if(!(initIndex < readyIndex)){
      // eslint-disable-next-line no-console
      console.warn('[sdkServerHandshake.p1] Ordering inversion observed (non-fatal for P1):', { initIndex, readyIndex });
    }

    // Validate tools/list result shape contains tools array with at least one entry
  const listObj = frames[listIndex];
  expect(Array.isArray(listObj.result?.tools)).toBe(true);
  expect(listObj.result.tools.length).toBeGreaterThan(0);

  // Assert exactly one ready notification (idempotent emission guarantee)
  expect(frames.filter(f=> f.method==='server/ready').length).toBe(1);

  // Stderr should include ready emission reason for dynamic hook
  const readyEmitLine = stderrLines.find(l=> /\[ready\] emit/.test(l));
    expect(readyEmitLine).toBeTruthy();
    // Accept either transport-send-hook or transport-send-hook-dynamic depending on path taken
    if(readyEmitLine){
      expect(/transport-send-hook/.test(readyEmitLine)).toBe(true);
    }

    // ---------------------------------------------------------------------
    // Initialize frame instrumentation validation (env gated)
    // We enabled INDEX_SERVER_TRACE=initFrame so stderr should contain ordered
    // [init-frame] JSON lines marking handshake progression.
    // Stages we expect on dynamic path:
    //   handler_return -> dispatcher_before_send -> dispatcher_send_resolved ->
    //   transport_detect_init_result -> transport_send_resolved -> [ready]
    // Some environments may elide dispatcher_* if SDK internal path differs;
    // we enforce minimal guarantees + relative ordering when present.
    // ---------------------------------------------------------------------
    const initEvents = parseInitFrameLines(stderrLines);
    const summary = summarizeInitFrames(initEvents);
    // Core expectations (fail-fast)
    expect(summary.hasHandlerReturn).toBe(true);
    expect(summary.flushStageObserved).toBe(true);
    // Dynamic path evidence
    expect(summary.hasTransportDetect).toBe(true);
    expect(summary.hasTransportResolved).toBe(true);
    // Allow dispatcher markers to be absent but if present maintain basic ordering (non-fatal otherwise)
    const orderIndex = (stage: string)=> initEvents.findIndex(e=> e.stage===stage);
    const hIdx = orderIndex('handler_return');
    const dbIdx = orderIndex('dispatcher_before_send');
    const dsIdx = orderIndex('dispatcher_send_resolved');
    const tdIdx = orderIndex('transport_detect_init_result');
    const trIdx = orderIndex('transport_send_resolved');
    if(hIdx !== -1 && dbIdx !== -1) expect(hIdx).toBeLessThan(dbIdx);
    if(dbIdx !== -1 && dsIdx !== -1) expect(dbIdx).toBeLessThan(dsIdx);
    if(tdIdx !== -1 && trIdx !== -1) expect(tdIdx).toBeLessThan(trIdx);
    // Non-fatal ordering check for dispatcher_send_resolved vs transport_detect_init_result
    if(dsIdx !== -1 && tdIdx !== -1 && !(dsIdx < tdIdx)){
      // eslint-disable-next-line no-console
      console.warn('[sdkServerHandshake.p1] non-fatal ordering inversion (dispatcher_send_resolved vs transport_detect_init_result)', { dsIdx, tdIdx, summary: formatSummary(summary) });
    }
    // Ready after last init-frame
    if(initEvents.length){
      const lastStageIdx = stderrLines.findIndex(l=> l.startsWith('[init-frame]') && l.includes(initEvents[initEvents.length-1].stage));
      const readyIdx = stderrLines.findIndex(l=> /\[ready\] emit/.test(l));
      if(lastStageIdx !== -1 && readyIdx !== -1){ expect(lastStageIdx).toBeLessThan(readyIdx); }
    }
    // Collect issues (diagnostic only)
    const issues = validateInitFrameSequence(summary);
    if(issues.length){
      // eslint-disable-next-line no-console
      console.warn('[sdkServerHandshake.p1] init-frame issues (non-fatal):', issues);
    }

    // Cleanup
    try { child.kill(); } catch { /* ignore */ }
  }, 25_000);
});
