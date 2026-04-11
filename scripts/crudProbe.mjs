// Diagnostic CRUD visibility probe (A-E)
// Runs against current instructions directory to investigate creates not appearing in list.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const server = spawn('node', ['dist/server/index-server.js'], { stdio: ['pipe','pipe','pipe'], env:{ ...process.env, INDEX_SERVER_MUTATION:'1' } });
const out = [];
server.stdout.on('data', d=>{ out.push(...d.toString().trim().split(/\n+/).filter(l=>l)); });
server.stderr.on('data', d=>{ /* suppress for clean JSON; could log to file if needed */ });

let nextId = 1;
function send(method, params){ const id = nextId++; server.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params })+'\n'); return id; }
function waitId(id, timeout=4000){ const start=Date.now(); return new Promise((resolve,reject)=>{ const iv=setInterval(()=>{ for(const l of out){ try { const o=JSON.parse(l); if(o && o.id===id){ clearInterval(iv); return resolve(o); } } catch{} } if(Date.now()-start>timeout){ clearInterval(iv); reject(new Error('timeout id='+id)); } },25); }); }

async function rpc(method, params, timeout){ const id=send(method, params); return await waitId(id, timeout); }

function summarizeList(resp){ if(!resp || !resp.result) return { count:0, ids:[] }; return { count: resp.result.count, ids: (resp.result.items||[]).map(i=>i.id).sort() }; }

(async ()=>{
  const summary = { baseline:null, afterAdds:null, getA:null, afterReload:null, afterRepair:null, afterImport:null, afterShortId:null, afterOverwrite:null, notes:[] };
  await rpc('initialize',{ protocolVersion:'2025-06-18', clientInfo:{ name:'crudProbe', version:'0' }, capabilities:{ tools:{} } });
  const baseline = await rpc('instructions_dispatch',{ action:'list' }); summary.baseline = summarizeList(baseline);

  // A & B: create two entries
  const addA = await rpc('instructions_add',{ entry:{ id:'crud-simple-a', title:'crud-simple-a', body:'A body', priority:10, audience:'all', requirement:'optional', categories:['probe'] }, overwrite:true });
  const addB = await rpc('instructions_add',{ entry:{ id:'crud-simple-b', title:'crud-simple-b', body:'B body', priority:11, audience:'all', requirement:'optional', categories:['probe'] }, overwrite:true });
  summary.notes.push({ addA, addB });
  const listAfterAdds = await rpc('instructions_dispatch',{ action:'list' }); summary.afterAdds = summarizeList(listAfterAdds);

  // Probe A: get by id
  const getA = await rpc('instructions_dispatch',{ action:'get', id:'crud-simple-a' }); summary.getA = getA;

  // Probe B: reload then list
  await rpc('instructions_reload',{}); const listAfterReload = await rpc('instructions_dispatch',{ action:'list' }); summary.afterReload = summarizeList(listAfterReload);

  // Probe B continued: repair then list
  await rpc('instructions_repair',{}); const listAfterRepair = await rpc('instructions_dispatch',{ action:'list' }); summary.afterRepair = summarizeList(listAfterRepair);

  // Probe C: import snapshot containing crud-simple-a (should be overwrite noop)
  const importResp = await rpc('instructions_import',{ entries:[{ id:'crud-simple-a', title:'crud-simple-a', body:'A body import', priority:10, audience:'all', requirement:'optional', categories:['probe','imported'] }], mode:'overwrite' }); summary.afterImport = importResp;
  const listAfterImport = await rpc('instructions_dispatch',{ action:'list' }); summary.afterImportList = summarizeList(listAfterImport);

  // Probe D: short id 't'
  await rpc('instructions_add',{ entry:{ id:'t', title:'t', body:'short id', priority:5, audience:'all', requirement:'optional', categories:['probe'] }, overwrite:true });
  const listAfterShort = await rpc('instructions_dispatch',{ action:'list' }); summary.afterShortId = summarizeList(listAfterShort);

  // Probe E: overwrite existing visible baseline entry if any
  const baseIds = summary.baseline.ids; if(baseIds.length){ const target = baseIds[0]; await rpc('instructions_add',{ entry:{ id:target, title:target+' updated', body:'updated body', priority:1, audience:'all', requirement:'optional', categories:['probe','updated'] }, overwrite:true }); const listAfterOverwrite = await rpc('instructions_dispatch',{ action:'list' }); summary.afterOverwrite = summarizeList(listAfterOverwrite); }

  // Persist raw log for offline review
  const logPath = path.join(process.cwd(),'crudProbe.log.jsonl');
  try { fs.writeFileSync(logPath, out.join('\n')); summary.notes.push({ logPath }); } catch {}

  // Output summary JSON (single line)
  process.stdout.write(JSON.stringify({ summary })+'\n');
  server.kill();
})().catch(err=>{ process.stdout.write(JSON.stringify({ error:err.message })+'\n'); try{ server.kill(); }catch{} });
