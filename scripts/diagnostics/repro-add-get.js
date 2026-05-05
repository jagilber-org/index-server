#!/usr/bin/env node
/*
 * Minimal deterministic add->get atomic visibility repro harness.
 * Exit code: 0 = PASS (add visible immediately via get + list)
 *            1 = FAIL (any missing visibility or protocol error)
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DIST_ENTRY = path.join(__dirname,'..','dist','server', 'index-server.js');
if(!fs.existsSync(DIST_ENTRY)){
  console.error('[repro] dist build missing:', DIST_ENTRY);
  process.exit(1);
}

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-repro-'));
const INDEX_SERVER_DIR = path.join(TEMP_DIR,'instructions');
fs.mkdirSync(INDEX_SERVER_DIR,{recursive:true});

const server = spawn(process.execPath, [DIST_ENTRY], {
  cwd: path.join(__dirname,'..'),
  env: { ...process.env, INDEX_SERVER_MUTATION:'1', INDEX_SERVER_DIR },
  stdio: ['pipe','pipe','pipe']
});

const lines = [];
server.stdout.on('data', d => {
  const parts = d.toString().split(/\r?\n/).filter(Boolean);
  for(const p of parts){ lines.push(p); }
});
server.stderr.on('data', d => {
  const parts = d.toString().split(/\r?\n/).filter(Boolean);
  for(const p of parts){ lines.push(p); }
});

function send(msg){ server.stdin.write(JSON.stringify(msg)+'\n'); }
function find(id){ return lines.find(l=>{ try { return JSON.parse(l).id===id; } catch { return false; } }); }
function waitFor(fn, ms=4000, step=40){ return new Promise((res,rej)=>{ const start=Date.now(); (function poll(){ if(fn()) return res(true); if(Date.now()-start>ms) return rej(new Error('timeout')); setTimeout(poll,step); })(); }); }

(async () => {
  const id = 'repro-'+Date.now();
  try {
    // initialize
    send({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{ name:'repro', version:'0' } }});
    await waitFor(()=> !!find(1), 6000);
    // add
    send({ jsonrpc:'2.0', id:2, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'add', entry:{ id, title:id, body:'Body', priority:10, audience:'all', requirement:'optional', categories:['repro'] }, overwrite:true, lax:true } }});
    await waitFor(()=> !!find(2), 6000);
    const addLine = find(2);
    let verified=false; let payloadId;
    try { const outer=JSON.parse(addLine); const txt=outer?.result?.content?.[0]?.text; if(txt){ const payload=JSON.parse(txt); verified = !!payload.verified; payloadId=payload.id; } } catch { /* parse failure */ }
    if(!verified || payloadId!==id) throw new Error('add not verified or id mismatch');
    // immediate get
    send({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'get', id } }});
    await waitFor(()=> !!find(3), 4000);
    const getLine = find(3);
    let got=false; try { const outer=JSON.parse(getLine); const txt=outer?.result?.content?.[0]?.text; if(txt){ const payload=JSON.parse(txt); got = !!payload.item && payload.item.id===id; } } catch { /* parse failure */ }
    if(!got) throw new Error('get missing item');
    // immediate list
    send({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'instructions/dispatch', arguments:{ action:'list' } }});
    await waitFor(()=> !!find(4), 4000);
    const listLine = find(4);
    let listed=false; try { const outer=JSON.parse(listLine); const txt=outer?.result?.content?.[0]?.text; if(txt){ const payload=JSON.parse(txt); listed = Array.isArray(payload.items) && payload.items.some(i=> i.id===id); } } catch { /* parse failure */ }
    if(!listed) throw new Error('list missing id');
    console.log('[repro] PASS id', id);
    process.exit(0);
  } catch(e){
    console.error('[repro] FAIL', e.message);
    // dump last few lines for diagnostics
    for(const l of lines.slice(-15)) console.error('[repro][tail]', l);
    process.exit(1);
  } finally { try { server.kill(); } catch { /* process already exited */ } }
})();
