/**
 * Raw MCP JSON-RPC Handshake Compliance Test (client + server adherence)
 * Verifies ordering invariants per modelcontextprotocol.io expectations:
 *  - initialize response precedes server/ready
 *  - single server/ready notification
 *  - tools/list_changed (if emitted) follows server/ready
 *  - tools/list succeeds and returns >=1 tool
 *  - ping succeeds
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

interface Frame { jsonrpc?: string; id?: number; method?: string; result?: any; error?: any; params?: Record<string,unknown>; }

describe('MCP Raw Handshake Compliance', () => {
  it('initialize -> server/ready -> tools/list_changed (optional) ordering + list + ping', async () => {
    // Use full SDK server path (Content-Length framed). This locks handshake semantics against drift.
  const child = spawn('node', ['dist/server/index-server.js'], { stdio:['pipe','pipe','pipe'], env:{ ...process.env } });
    const frames: Frame[] = [];
    let closed = false;
    child.on('close', ()=> closed = true);
    // Frame parser for MCP SDK (Content-Length based JSON-RPC)
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buf += String(chunk);
      // First: handle any Content-Length framed messages
      let progressed = true;
      while(progressed){
        progressed = false;
        const headerIdx = buf.indexOf('Content-Length:');
        if(headerIdx !== -1){
          const splitIdx = buf.indexOf('\n\n', headerIdx);
            const splitCRLFIdx = buf.indexOf('\r\n\r\n', headerIdx);
            let sepIdx = -1; let sepLen = 0;
            if(splitCRLFIdx !== -1 && (splitIdx === -1 || splitCRLFIdx < splitIdx)){ sepIdx = splitCRLFIdx; sepLen = 4; }
            else if(splitIdx !== -1){ sepIdx = splitIdx; sepLen = 2; }
            if(sepIdx !== -1){
              const headerBlock = buf.slice(0, sepIdx + sepLen);
              const m = /Content-Length:\s*(\d+)/i.exec(headerBlock);
              if(m){
                const len = parseInt(m[1],10);
                const totalNeeded = sepIdx + sepLen + len;
                if(buf.length >= totalNeeded){
                  const jsonStr = buf.slice(sepIdx + sepLen, totalNeeded);
                  buf = buf.slice(totalNeeded);
                  try { frames.push(JSON.parse(jsonStr)); } catch { /* ignore */ }
                  progressed = true;
                  continue; // attempt next frame
                }
              }
            }
        }
        // Next: consume any complete newline-delimited JSON objects (shortcircuit mode)
        const nlIdx = buf.indexOf('\n');
        if(nlIdx !== -1){
          const line = buf.slice(0, nlIdx).trim();
          buf = buf.slice(nlIdx+1);
          if(line.startsWith('{') && line.includes('"jsonrpc"')){
            try { frames.push(JSON.parse(line)); } catch { /* ignore */ }
            progressed = true;
          }
        }
      }
    });
    let started = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      const s = String(chunk);
      if(s.includes('SDK server started (stdio only)')) started = true;
    });
    const sendCL = (obj:unknown) => {
      const json = JSON.stringify(obj);
      const frame = `Content-Length: ${Buffer.byteLength(json,'utf8')}\r\n\r\n${json}\r\n`;
      child.stdin.write(frame);
    };
  // Wait up to 1s for startup sentinel to reduce chance of early frame loss
  const startWaitEnd = Date.now()+1000;
  while(!started && Date.now()<startWaitEnd){ await new Promise(r=>setTimeout(r,25)); }
  sendCL({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{ tools:{ listChanged:true } }, clientInfo:{ name:'raw-handshake', version:'1.0.0' } } });
    const tEnd = Date.now()+5000;
    let initIdx=-1, readyIdx=-1, listChangedIdx=-1;
    while(Date.now()<tEnd){
      initIdx = frames.findIndex(f=>f.id===1 && (f.result||f.error));
      if(initIdx>=0){
        readyIdx = frames.findIndex((f,i)=> i>initIdx && f.method==='server/ready');
        listChangedIdx = frames.findIndex((f,i)=> i>(readyIdx>=0?readyIdx:initIdx) && f.method==='notifications/tools/list_changed');
        if(readyIdx>=0) break;
      }
      await new Promise(r=>setTimeout(r,25));
    }
    expect(initIdx).toBeGreaterThanOrEqual(0);
    if(readyIdx<0){
      const grace = Date.now()+300; while(Date.now()<grace && readyIdx<0){ readyIdx = frames.findIndex((f,i)=> i>initIdx && f.method==='server/ready'); await new Promise(r=>setTimeout(r,20)); }
    }
    expect(readyIdx).toBeGreaterThan(initIdx);
    expect(frames.filter(f=>f.method==='server/ready').length).toBe(1);
    if(listChangedIdx<0){ const g2=Date.now()+300; while(Date.now()<g2 && listChangedIdx<0){ listChangedIdx = frames.findIndex((f,i)=> i>readyIdx && f.method==='notifications/tools/list_changed'); await new Promise(r=>setTimeout(r,20)); } }
    if(listChangedIdx>=0){ expect(listChangedIdx).toBeGreaterThan(readyIdx); }
  // tools/list (Content-Length framed)
  sendCL({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} });
    let listResp: Frame|undefined; const listEnd = Date.now()+3000;
    while(Date.now()<listEnd && !listResp){ listResp = frames.find(f=>f.id===2 && (f.result||f.error)); if(!listResp) await new Promise(r=>setTimeout(r,30)); }
    expect(listResp && listResp.result).toBeTruthy();
    const tools = Array.isArray(listResp?.result?.tools) ? listResp?.result?.tools : [];
    expect(tools.length).toBeGreaterThan(0);
  // ping
  sendCL({ jsonrpc:'2.0', id:3, method:'ping', params:{} });
    let pingResp: Frame|undefined; const pingEnd = Date.now()+1500;
    while(Date.now()<pingEnd && !pingResp){ pingResp = frames.find(f=>f.id===3 && (f.result||f.error)); if(!pingResp) await new Promise(r=>setTimeout(r,25)); }
    expect(pingResp && pingResp.result).toBeTruthy();
    try { child.kill(); } catch { /* ignore */ }
    expect(closed).toBe(false);
  }, 15000);
});
