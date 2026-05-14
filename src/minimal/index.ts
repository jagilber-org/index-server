// Minimal standalone MCP server (handshake + health + ping) with strict ordering
// Inspired by simplified PowerShell reference: respond to initialize, then emit server/ready, then tools/list_changed.
// No SDK, no fallbacks, no extra watchdogs. Deterministic ordering and tiny surface.
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';
// Apply runtime overrides overlay BEFORE any getRuntimeConfig() call.
// Overlay > process.env > defaults (plan §2.3, issue #359).
import { applyOverlay } from '../config/runtimeOverrides';
applyOverlay();
import { getRuntimeConfig } from '../config/runtimeConfig';

// High resolution timestamp helper for ordering diagnostics
function ts(){
  try {
    return Number(process.hrtime.bigint() % BigInt(1e12)).toString().padStart(12,'0');
  } catch { return Date.now().toString(); }
}

interface JsonRpcReq { jsonrpc:'2.0'; id?: number|string|null; method:string; params?: Record<string,unknown> }

const VERSION = (()=>{ try { const p = path.join(process.cwd(),'package.json'); return JSON.parse(fs.readFileSync(p,'utf8')).version || '0.0.0'; } catch { return '0.0.0'; } })();

const rl = createInterface({ input: process.stdin });
const DEBUG_ORDER = getRuntimeConfig().minimal.debugOrdering;

function write(obj: unknown){ try { process.stdout.write(JSON.stringify(obj)+'\n'); } catch { /* ignore */ } }
function debug(msg:string){ if(DEBUG_ORDER){ try { process.stderr.write('[minimal-debug] '+msg+'\n'); } catch { /* ignore */ } } }

function sendInitResult(id: number|string|null|undefined, protocolVersion: string){
  const payload = { jsonrpc:'2.0', id: id ?? 1, result:{ protocolVersion, serverInfo:{ name:'mcp-minimal-server', version:VERSION }, capabilities:{ tools:{ listChanged:true } }, instructions:'minimal mode' } };
  const line = JSON.stringify(payload)+'\n';
  try {
    debug(`init-write-start hr=${ts()}`);
    // Synchronous write to eliminate any chance the initialize line isn't flushed before ready scheduling.
    // fs.writeSync bypasses stream buffering semantics of process.stdout.write callback timing.
    fs.writeSync(1, line);
  // Extra hard flush (rarely needed, but guards against odd buffering on some platforms / CI setups)
  try { fs.fsyncSync(1); } catch { /* ignore */ }
  // Emit a deterministic sentinel (debuggable) to stdout directly after initialize result for test harness correlation.
  // If tests ever report missing initialize but this sentinel appears, the loss happened in parsing logic not emission.
  fs.writeSync(1, JSON.stringify({ jsonrpc:'2.0', method:'minimal/handshake_sentinel', params:{ hr: ts() } })+'\n');
    debug(`init-write-done hr=${ts()} bytes=${line.length}`);
  } catch (e){ debug('init-write-error '+(e as Error).message); }
  // Originally this used setImmediate; move to nextTick for tighter ordering while still deferring until after synchronous writes.
  // Empirically reduces rare duplicate ready observations caused by unexpected re-entrancy in exotic environments.
  process.nextTick(()=> scheduleReady('post-init-nextTick'));
}

function scheduleReady(reason:string){
  if(recentReadyEmitted){
    debug(`ready-skip-duplicate hr=${ts()} reason=${reason}`);
    return; }
  // Single scheduling point; we assume initialize already flushed.
  recentReadyEmitted = true;
  debug(`ready-start hr=${ts()} reason=${reason}`);
  write({ jsonrpc:'2.0', method:'server/ready', params:{ version: VERSION, reason, hr: ts() } });
  write({ jsonrpc:'2.0', method:'notifications/tools/list_changed', params:{ hr: ts() } });
  debug(`ready-done hr=${ts()}`);
}

let recentReadyEmitted = false;
rl.on('line', line => {
  const raw = line.trim(); if(!raw) return;
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return; }
  if(!isRequest(parsed)) return;
  const m = parsed;
  switch(m.method){
    case 'initialize': {
  const proto = (m.params?.protocolVersion as string) || '2025-06-18';
  sendInitResult(m.id, proto);
      return;
    }
    case 'ping': {
      write({ jsonrpc:'2.0', id: m.id ?? null, result:{ timestamp: new Date().toISOString() } });
      return;
    }
    case 'tools/list': {
      write({ jsonrpc:'2.0', id: m.id ?? null, result:{ tools: [] } });
      return;
    }
    case 'tools/call': {
  const name = typeof m.params?.name === 'string' ? m.params.name : undefined;
      if(name === 'health_check'){
        write({ jsonrpc:'2.0', id: m.id ?? null, result:{ content:[{ type:'text', text: JSON.stringify({ status:'ok', version:VERSION }) }] } });
      } else {
        write({ jsonrpc:'2.0', id: m.id ?? null, error:{ code:-32601, message:'Unknown tool', data:{ method:name } } });
      }
      return;
    }
    case 'shutdown': {
      write({ jsonrpc:'2.0', id: m.id ?? null, result:{ shuttingDown:true } });
      return;
    }
    case 'exit': {
      write({ jsonrpc:'2.0', id: m.id ?? null, result:{ exiting:true } });
      setTimeout(()=> process.exit(0), 0);
      return;
    }
    default: {
      if(Object.prototype.hasOwnProperty.call(m,'id')){
        write({ jsonrpc:'2.0', id: m.id ?? null, error:{ code:-32601, message:'Method not found', data:{ method:m.method } } });
      }
    }
  }
});

function isRequest(v: unknown): v is JsonRpcReq {
  if(!v || typeof v !== 'object') return false;
  const obj = v as Record<string,unknown>;
  return obj.jsonrpc === '2.0' && typeof obj.method === 'string';
}

// Keep alive in case no stdin activity yet
process.stdin.resume();
