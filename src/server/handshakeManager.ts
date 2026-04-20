/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Handshake/protocol negotiation logic for the MCP server.
 * Manages protocol version negotiation, handshake tracing, ready notification
 * emission, stdin sniffing for initialize detection, and safety fallbacks.
 */
import { getRuntimeConfig } from '../config/runtimeConfig';

// ---------------------------------------------------------------------------
// Optional handshake tracing (enable via INDEX_SERVER_TRACE=handshake)
// Emits structured JSON lines to stderr prefixed with [handshake].
// Each event receives a monotonic sequence number.
// ---------------------------------------------------------------------------
export function isHandshakeTraceEnabled() { return getRuntimeConfig().trace.has('handshake'); }
let HANDSHAKE_SEQ = 0;
export function handshakeLog(stage: string, data?: Record<string, unknown>){
  if(!isHandshakeTraceEnabled()) return; // fast path
  try {
    const payload = { handshake: true, seq: ++HANDSHAKE_SEQ, ts: new Date().toISOString(), stage, ...(data||{}) };
    process.stderr.write(`[handshake] ${JSON.stringify(payload)}\n`);
  } catch { /* ignore */ }
}

// Central gating flag: by default we disable ALL non-primary ready fallbacks (watchdogs, safety timeouts,
// stdin sniff synthetic initialize, unconditional init fallbacks, etc.). Enable via
// INDEX_SERVER_INIT_FEATURES=handshakeFallbacks to re-enable the safety nets.
export function isHandshakeFallbacksEnabled() { return getRuntimeConfig().initFeatures.has('handshakeFallbacks'); }

// Supported protocol versions (ordered descending preference – first is default)
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18','2024-11-05','2024-10-07'];

// Lightweight in-memory handshake event ring buffer for diagnostics
export interface HandshakeEvent { seq: number; ts: string; stage: string; extra?: Record<string,unknown>; }
const HANDSHAKE_EVENTS: HandshakeEvent[] = [];
export function record(stage: string, extra?: Record<string,unknown>){
  const evt: HandshakeEvent = { seq: ++HANDSHAKE_SEQ, ts: new Date().toISOString(), stage, extra };
  HANDSHAKE_EVENTS.push(evt); if(HANDSHAKE_EVENTS.length > 50) HANDSHAKE_EVENTS.shift();
  if(isHandshakeTraceEnabled()){ try { process.stderr.write(`[handshake] ${JSON.stringify(evt)}\n`); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// Initialize frame instrumentation (opt-in via INDEX_SERVER_TRACE=initFrame)
// Provides high-fidelity breadcrumbs to stderr with prefix [init-frame]
// ---------------------------------------------------------------------------
export function isInitFrameDiagEnabled() { return getRuntimeConfig().trace.has('initFrame'); }
export function initFrameLog(stage: string, extra?: Record<string, unknown>){
  if(!isInitFrameDiagEnabled()) return;
  try {
    const payload = { stage, t: Date.now(), ...(extra||{}) };
    process.stderr.write(`[init-frame] ${JSON.stringify(payload)}\n`);
  } catch { /* ignore */ }
}

// Expose reference for diagnostics_handshake tool (read-only access)
try { (global as unknown as { HANDSHAKE_EVENTS_REF?: HandshakeEvent[] }).HANDSHAKE_EVENTS_REF = HANDSHAKE_EVENTS; } catch { /* ignore */ }

// Helper: negotiate a protocol version with graceful fallback
export function negotiateProtocolVersion(requested?: string){
  if(!requested) return SUPPORTED_PROTOCOL_VERSIONS[0];
  if(SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
  // Future: could attempt minor compatibility mapping. For now choose latest supported.
  return SUPPORTED_PROTOCOL_VERSIONS[0];
}

// Module-level idempotent ready emitter so both createSdkServer and startSdkServer dynamic paths can use it.
export function emitReadyGlobal(server: any, reason: string){
  // Unified, ordering-safe emission of server/ready. Invoked ONLY after the
  // initialize response has been (or is about to be) flushed.
  try {
    if(!server) return;
    if((server as any).__readyNotified) return;
    // Ordering gate: ONLY allow emission if initialize response actually flushed
    if(!(server as any).__initResponseSent){
      if(!isHandshakeFallbacksEnabled()){
        return; // strict mode: never emit early
      }
      const allowReasons = new Set(['unconditional-init-fallback','unconditional-init-fallback-direct','forced-init-fallback']);
      if(!allowReasons.has(reason)) return;
    }
    const v = (server as any).__declaredVersion || (server as any).version || '0.0.0';
    // Mark before sending to avoid re-entrancy
    (server as any).__readyNotified = true;
    record('ready_emitted', { reason, version: v });
    try { process.stderr.write(`[ready] emit reason=${reason} version=${v}\n`); } catch { /* ignore */ }
    const msg = { jsonrpc: '2.0', method: 'server/ready', params: { version: v } };
    let dispatched = false;
    // Prefer raw transport to bypass any SDK notification filtering.
    try {
      const t = (server as any)._transport;
      if(t?.send){
        t.send(msg)?.catch?.(()=>{});
        dispatched = true;
      }
    } catch { /* ignore */ }
    if(!dispatched){
      try { (server as any).sendNotification?.({ method: 'server/ready', params: { version: v } }); dispatched = true; } catch { /* ignore */ }
    }
    if(!dispatched){
      // Final fallback direct stdout (rare path)
      try { process.stdout.write(JSON.stringify(msg)+'\n'); } catch { /* ignore */ }
    }
    // Always follow with tools/list_changed AFTER ready to guarantee ordering.
    try { if(typeof (server as any).sendToolListChanged === 'function'){ (server as any).sendToolListChanged(); record('list_changed_after_ready'); } } catch { /* ignore */ }
  } catch { /* ignore */ }
}

/**
 * Pre-connect stdin sniffer: if we observe an initialize request but downstream logic fails
 * to emit server/ready, schedule a guarded fallback emission.
 */
export function setupStdinSniffer(server: any): void {
  try {
    const disableInitSniff = getRuntimeConfig().initFeatures.has('disableSniff');
    if(!server || disableInitSniff) return;
    const INIT_FALLBACK_ENABLED = getRuntimeConfig().initFeatures.has('initFallback');
    let __sniffBuf = '';
    if(getRuntimeConfig().trace.has('healthMixed')){
      try {
        if(!(server as any).__diagRQMap){
          (server as any).__diagRQMap = new Map();
          (server as any).__diagQueueDepthSniff = 0;
        }
      } catch { /* ignore */ }
    }
    process.stdin.on('data', (chunk: Buffer) => {
      try {
        // Log first chunk (sanitized) once for corruption triage
        if(getRuntimeConfig().trace.has('healthMixed') && !(server as any).__diagFirstChunkLogged){
          (server as any).__diagFirstChunkLogged = true;
          const raw = chunk.toString('utf8');
          const snippet = raw.replace(/\r/g,' ').replace(/\n/g,'\\n').slice(0,240);
          process.stderr.write(`[diag] ${Date.now()} stdin_first_chunk size=${chunk.length} snippet="${snippet}"\n`);
        }
        __sniffBuf += chunk.toString('utf8');
        // Fast substring / subsequence search instead of full JSON parse
        if(!((server as any).__sniffedInit)){
          const bufForScan = __sniffBuf.slice(-8000); // bound work
          const direct = /"method"\s*:\s*"initialize"/.test(bufForScan);
          let fuzzy = false;
          let subseq = false;
          if(!direct){
            // Fuzzy reconstruction (bounded gaps) scoped near a method sentinel
            const target = 'initialize';
            const methodIdx = bufForScan.indexOf('"method"');
            const sliceA = methodIdx !== -1 ? bufForScan.slice(methodIdx, methodIdx + 1200) : '';
            const trySlices: string[] = sliceA ? [sliceA] : [];
            if(!sliceA && getRuntimeConfig().trace.has('healthMixed')) trySlices.push(bufForScan.slice(-2000));
            for(const slice of trySlices){
              let ti = 0; let gaps = 0;
              for(let i=0;i<slice.length && ti < target.length;i++){
                const ch = slice[i];
                if(ch.toLowerCase?.() === target[ti]){ ti++; gaps = 0; continue; }
                if(gaps < 3){ gaps++; continue; }
                ti = 0; gaps = 0;
                if(ch.toLowerCase?.() === target[ti]){ ti++; }
              }
              if(ti === target.length){ fuzzy = true; break; }
            }
            // Subsequence (very tolerant) – strip non-letters and search contiguous
            if(!fuzzy){
              const letters = bufForScan.replace(/[^a-zA-Z]/g,'').toLowerCase();
              let ti = 0;
              for(let i=0;i<letters.length && ti < target.length;i++){
                if(letters[i] === target[ti]) ti++;
              }
              if(ti === target.length) subseq = true;
            }
          }
          if(direct || fuzzy || subseq){
            (server as any).__sniffedInit = true;
            const mode = direct ? 'direct' : (fuzzy ? 'fuzzy' : 'subseq');
            if(getRuntimeConfig().trace.has('healthMixed')){
              try {
                const norm = bufForScan.slice(0,400).replace(/\r/g,' ').replace(/\n/g,'\\n');
                process.stderr.write(`[diag] ${Date.now()} sniff_init_${mode}_detect buffer_bytes=${__sniffBuf.length} preview="${norm}"\n`);
              } catch { /* ignore */ }
            }
            // Schedule marking + optional synthetic dispatch if initialize not parsed normally
            setTimeout(()=>{
              try {
                if(!(server as any).__sawInitializeRequest){
                  (server as any).__sawInitializeRequest = true;
                  if(getRuntimeConfig().trace.has('healthMixed')){
                    try { process.stderr.write(`[diag] ${Date.now()} sniff_init_mark_sawInit mode=${mode}\n`); } catch { /* ignore */ }
                  }
                }
                if(INIT_FALLBACK_ENABLED && !(server as any).__initResponseSent){
                  setTimeout(()=>{
                    try {
                      if((server as any).__initResponseSent || (server as any).__syntheticInitDispatched) return;
                      let id = 1;
                      const idMatch = /"id"\s*:\s*(\d{1,6})/.exec(bufForScan);
                      if(idMatch) id = parseInt(idMatch[1],10);
                      const req = { jsonrpc:'2.0', id, method:'initialize', params:{} };
                      (server as any).__syntheticInitDispatched = true;
                      const dispatch = (server as any)._onRequest || (server as any)._onrequest;
                      if(typeof dispatch === 'function'){
                        if(getRuntimeConfig().trace.has('healthMixed')){
                          try { process.stderr.write(`[diag] ${Date.now()} sniff_init_synthetic_dispatch id=${id}\n`); } catch { /* ignore */ }
                        }
                        try { dispatch.call(server, req); } catch { /* ignore */ }
                      }
                    } catch { /* ignore */ }
                  }, 40).unref?.();
                  if(INIT_FALLBACK_ENABLED){
                    // Forced result fallback if still not sent after additional grace
                    setTimeout(()=>{
                      try {
                        if((server as any).__initResponseSent) return;
                        const tr = (server as any)._transport || (server as any).__transportRef;
                        if(tr && typeof tr.send === 'function'){
                          let negotiated = '2024-11-05';
                          try { negotiated = negotiateProtocolVersion('2024-11-05') || negotiated; } catch { /* ignore */ }
                          const frame = { jsonrpc:'2.0', id:1, result:{ protocolVersion: negotiated, capabilities:{}, instructions:'Use initialize -> tools/list -> tools/call { name, arguments }. (forced-init-fallback)' } };
                          (server as any).__initResponseSent = true;
                          if(getRuntimeConfig().trace.has('healthMixed')){
                            try { process.stderr.write(`[diag] ${Date.now()} sniff_init_forced_result_emit id=1 negotiated=${negotiated}\n`); } catch { /* ignore */ }
                          }
                          Promise.resolve(tr.send(frame)).then(()=>{
                            if(!(server as any).__readyNotified){ emitReadyGlobal(server,'forced-init-fallback'); }
                          }).catch(()=>{});
                        }
                      } catch { /* ignore */ }
                    }, 140).unref?.();
                  } else if(getRuntimeConfig().trace.has('healthMixed')){
                    try { process.stderr.write(`[diag] ${Date.now()} sniff_init_forced_result_skip gating_off\n`); } catch { /* ignore */ }
                  }
                }
                if(isHandshakeFallbacksEnabled()){
                  if((server as any).__initResponseSent && !(server as any).__readyNotified){
                    emitReadyGlobal(server,'stdin-sniff-fallback');
                  }
                }
              } catch { /* ignore */ }
            }, 60).unref?.();
          }
        }
        // Fallback rq_* enqueue capture (only if diag flag set AND dispatcher override not active)
        if(getRuntimeConfig().trace.has('healthMixed') && !(server as any).__dispatcherOverrideActive){
          try {
            let idx: number;
            while((idx = __sniffBuf.indexOf('\n')) !== -1){
              const line = __sniffBuf.slice(0,idx).trim();
              __sniffBuf = __sniffBuf.slice(idx+1);
              if(!line) continue;
              let obj: any;
              try { obj = JSON.parse(line); } catch (e) {
                if(/jsonrpc|method/i.test(line)){
                  const frag = line.replace(/\r/g,' ').replace(/\n/g,' ').slice(0,200);
                  process.stderr.write(`[diag] ${Date.now()} malformed_json_line len=${line.length} frag="${frag}" err=${(e as Error).message||e}\n`);
                }
                continue;
              }
              if(obj && obj.jsonrpc === '2.0' && obj.method && Object.prototype.hasOwnProperty.call(obj,'id')){
                const metaName = obj.method === 'tools/call' ? obj?.params?.name : '';
                const category = (()=>{
                  if(obj.method === 'initialize') return 'init';
                  if(obj.method === 'health_check' || metaName === 'health_check') return 'health';
                  if(obj.method === 'metrics_snapshot' || metaName === 'metrics_snapshot') return 'metrics';
                  if(metaName === 'meta_tools') return 'meta';
                  return 'other';
                })();
                if(category === 'health' || category === 'metrics' || category === 'meta' || category === 'init'){
                  try {
                    (server as any).__diagQueueDepthSniff++;
                    (server as any).__diagRQMap.set(obj.id, { start: Date.now(), cat: category, method: obj.method });
                    process.stderr.write(`[diag] ${Date.now()} rq_enqueue method=${obj.method} cat=${category} id=${obj.id} qdepth=${(server as any).__diagQueueDepthSniff} src=sniff\n`);
                  } catch { /* ignore */ }
                }
              }
            }
          } catch { /* ignore */ }
        }
        // Truncate buffer to avoid unbounded growth
        if(__sniffBuf.length > 10_000){
          __sniffBuf = __sniffBuf.slice(-2048);
        }
      } catch { /* ignore */ }
    });
  } catch { /* ignore */ }
}

/**
 * Safety fallback timers for missed ready emissions, unconditional DIAG fallback,
 * and _oninitialize patch for protocol negotiation.
 */
export function setupSafetyFallbacks(server: any): void {
  // Safety fallback: if server/ready not emitted within 100ms of start
  if(isHandshakeFallbacksEnabled()){
    setTimeout(()=>{
      try {
        // Only emit via safety-timeout if initialize response was already sent (ordering guarantee)
        if((server as any).__sawInitializeRequest && (server as any).__initResponseSent && !(server as any).__readyNotified){
          handshakeLog('safety_timeout_emit_attempt', { label:'safety-timeout-100ms', sawInit:true, initRespSent: true });
          emitReadyGlobal(server,'safety-timeout-100ms');
        }
      } catch { /* ignore */ }
    }, 100).unref?.();
  }
  // Unconditional DIAG fallback (gated): if no initialize request OR response observed very early
  if(isHandshakeFallbacksEnabled()){
    setTimeout(()=>{
      try {
        const INIT_FALLBACK_ENABLED = getRuntimeConfig().initFeatures.has('initFallback');
        if(getRuntimeConfig().trace.has('healthMixed') && !(server as any).__initResponseSent){
        if(!INIT_FALLBACK_ENABLED){
          try { process.stderr.write(`[diag] ${Date.now()} init_unconditional_fallback_skip gating_off\n`); } catch { /* ignore */ }
          return;
        }
        if(!(server as any).__sawInitializeRequest){
          if(process.stderr && !(server as any).__diagForcedInitLogged){
            (server as any).__diagForcedInitLogged = true;
            try { process.stderr.write(`[diag] ${Date.now()} init_unconditional_fallback_emit id=1 reason=no_init_seen_150ms\n`); } catch { /* ignore */ }
          }
        } else {
          try { process.stderr.write(`[diag] ${Date.now()} init_unconditional_fallback_emit id=1 reason=init_seen_no_response_150ms\n`); } catch { /* ignore */ }
        }
        const negotiated = '2024-11-05';
        const frame = { jsonrpc:'2.0', id:1, result:{ protocolVersion: negotiated, capabilities:{}, instructions:'Use initialize -> tools/list -> tools/call { name, arguments }. (unconditional-init-fallback)' } };
        const tr = (server as any)._transport || (server as any).__transportRef;
        (server as any).__initResponseSent = true;
        if(tr && typeof tr.send==='function'){
          Promise.resolve(tr.send(frame)).then(()=>{ if(!(server as any).__readyNotified) emitReadyGlobal(server,'unconditional-init-fallback'); }).catch(()=>{});
        } else {
          try { process.stdout.write(JSON.stringify(frame)+'\n'); } catch { /* ignore */ }
          if(!(server as any).__readyNotified) emitReadyGlobal(server,'unconditional-init-fallback-direct');
        }
      }
      } catch { /* ignore */ }
    }, 150).unref?.();
  }
  // Patch initialize result for instructions (SDK internal property)
  const originalInit = (server as any)._oninitialize;
  if(originalInit && !(server as any).__initPatched){
    (server as any).__initPatched = true;
    (server as any)._oninitialize = async function(this: any, request: any){
      try {
        (this as any).__sawInitializeRequest = true;
        handshakeLog('oninitialize_enter', { sawInit:true, ready: !!(this as any).__readyNotified, initRespSent: !!(server as any).__initResponseSent });
      } catch { /* ignore */ }
      const result = await originalInit.call(this, request);
      try {
        const negotiated = negotiateProtocolVersion(request?.params?.protocolVersion);
        (result as any).protocolVersion = negotiated;
        if(result && typeof result === 'object' && !('instructions' in result)){
          (result as any).instructions = 'Use initialize -> tools/list -> tools/call { name, arguments }. Health: tools/call health_check. Metrics: tools/call metrics_snapshot. Ping: ping.';
        }
        // Do NOT emit server/ready here; ordering handled strictly by transport send hook.
      } catch {/* ignore */}
      return result;
    };
  }
}
