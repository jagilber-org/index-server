/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Transport initialization, request dispatcher override, and diagnostics
 * wrappers for the MCP server.
 */
import { getRuntimeConfig } from '../config/runtimeConfig';
import { emitReadyGlobal, initFrameLog } from './handshakeManager';

// Helper to perform a true dynamic ESM import that TypeScript won't down-level to require()
export const dynamicImport = (specifier: string) => (Function('m', 'return import(m);'))(specifier);

/**
 * Set up stdout diagnostics wrapper for backpressure monitoring.
 * Enabled via INDEX_SERVER_TRACE=healthMixed.
 */
export async function setupStdoutDiagnostics(): Promise<void> {
  const __diagEnabled = getRuntimeConfig().trace.has('healthMixed');
  const __diag = (msg: string) => { if(__diagEnabled){ try { process.stderr.write(`[diag] ${Date.now()} ${msg}\n`); } catch { /* ignore */ } } };
  // Emit a one-time version marker so tests can assert the newer diagnostic wrapper code is actually loaded.
  if(__diagEnabled){
    try {
      const buildMarker = 'sdkServerDiagV1';
      // Include a coarse content hash surrogate: file size + mtime if available
      let fsMeta = '';
      try {
        const fsMod = await import('fs');
        const stat = fsMod.statSync(__filename);
        fsMeta = ` size=${stat.size} mtimeMs=${Math.trunc(stat.mtimeMs)}`;
      } catch { /* ignore meta */ }
      process.stderr.write(`[diag] ${Date.now()} diag_start marker=${buildMarker}${fsMeta}\n`);
    } catch { /* ignore */ }
  }
  if(__diagEnabled){
    try {
      const origWrite = (process.stdout.write as any).bind(process.stdout);
      let backpressureEvents = 0;
      let bytesTotal = 0;
      let lastReportAt = Date.now();
      (process.stdout as any).on?.('drain', ()=>{ __diag('stdout_drain'); });
      (process.stdout.write as any) = function(chunk: any, encoding?: any, cb?: any){
        try {
          const size = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
          bytesTotal += size;
          const ret = origWrite(chunk, encoding, cb);
          if(!ret){
            backpressureEvents++;
            __diag(`stdout_backpressure size=${size} backpressureEvents=${backpressureEvents}`);
          }
          const now = Date.now();
          if(now - lastReportAt > 2000){
            __diag(`stdout_summary bytesTotal=${bytesTotal} backpressureEvents=${backpressureEvents}`);
            lastReportAt = now;
          }
          return ret;
        } catch(e){
          try { __diag(`stdout_write_wrapper_error ${(e as Error)?.message||String(e)}`); } catch { /* ignore */ }
          return origWrite(chunk, encoding, cb);
        }
      };
    } catch { /* ignore */ }
  }
}

// Robust semantic error preservation: deep scan for JSON-RPC code/message
function deepScan(obj: any, depth = 0, seen = new Set<any>()): number | undefined {
  if(!obj || typeof obj !== 'object' || depth > 4 || seen.has(obj)) return undefined;
  seen.add(obj);
  if(Number.isSafeInteger((obj as any).code)){
    const c = (obj as any).code as number;
    if(c === -32601 || c === -32602) return c; // prioritize semantic validation codes
  }
  // Prefer specific well-known nesting keys first
  const keys = ['error','original','cause','data'];
  for(const k of keys){
    try {
      const child = (obj as any)[k];
      const found = deepScan(child, depth+1, seen);
      if(found !== undefined) return found;
    } catch { /* ignore */ }
  }
  // Fallback: generic property iteration (shallow) to catch unexpected wrappers
  if(depth < 2){
    try {
      for(const v of Object.values(obj)){
        const found = deepScan(v, depth+1, seen);
        if(found !== undefined) return found;
      }
    } catch { /* ignore */ }
  }
  return undefined;
}

// Categorize request for diagnostics
function categorizeRequest(request: any): string {
  const metaName = request.method === 'tools/call' ? request?.params?.name : '';
  if(request.method === 'initialize') return 'init';
  if(request.method === 'health_check' || metaName === 'health_check') return 'health';
  if(request.method === 'metrics_snapshot' || metaName === 'metrics_snapshot') return 'metrics';
  if(metaName === 'meta_tools') return 'meta';
  return 'other';
}

/**
 * Override the internal request dispatcher to retain error.data & emit diagnostics.
 * The upstream SDK has used both `_onRequest` (camel) and `_onrequest` (lower) across versions;
 * we defensively hook whichever exists and assign our wrapper to BOTH names.
 */
export function setupDispatcherOverride(server: any): void {
  const existingLower = (server as any)._onrequest;
  const existingCamel = (server as any)._onRequest;
  const originalOnRequest = (existingCamel || existingLower) ? (existingCamel || existingLower).bind(server) : undefined;
  let __diagQueueDepth = 0;
  if(originalOnRequest){
    const wrapped = function(this: any, request: any): any {
      const diagEnabled = getRuntimeConfig().trace.has('healthMixed');
      let startedAt: number | undefined;
      if(diagEnabled){
        const category = categorizeRequest(request);
        if(category === 'health' || category === 'meta' || category === 'metrics' || category === 'init'){
          startedAt = Date.now();
          try {
            __diagQueueDepth++;
            process.stderr.write(`[diag] ${startedAt} rq_enqueue method=${request.method} cat=${category} id=${request.id} qdepth=${__diagQueueDepth}\n`);
            if(category === 'health'){
              if(!(server as any).__firstHealthEnqueueAt){ (server as any).__firstHealthEnqueueAt = startedAt; }
              if(request.id === 1 && !(server as any).__healthId1EnqueueAt){ (server as any).__healthId1EnqueueAt = startedAt; }
            }
            if(!(server as any).__activeDiagRequests){ (server as any).__activeDiagRequests = new Map(); }
            (server as any).__activeDiagRequests.set(request.id, { id: request.id, method: request.method, cat: category, start: startedAt });
            // Mis-order detection: health/metrics/meta before initialize observed
            if((category === 'health' || category === 'metrics' || category === 'meta') && !(server as any).__sawInitializeRequest){
              try { process.stderr.write(`[diag] ${Date.now()} rq_misorder_before_init method=${request.method} id=${request.id} cat=${category} qdepth=${__diagQueueDepth}\n`); } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        }
      }
      const handler = (this as any)._requestHandlers.get(request.method) ?? (this as any).fallbackRequestHandler;
      if(handler === undefined){
        return (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, error:{ code: -32601, message:'Method not found', data:{ method: request.method } }}).catch(()=>{});
      }
      const abortController = new AbortController();
      (this as any)._requestHandlerAbortControllers.set(request.id, abortController);
      // IMPORTANT: We intentionally never early-return without sending a response
      Promise.resolve()
        .then(()=> handler(request, { signal: abortController.signal }))
        .then((result:any)=>{
          if(startedAt !== undefined){
            try {
              const dur = Date.now() - startedAt;
              const category = categorizeRequest(request);
              if(category === 'health' || category === 'meta' || category === 'metrics' || category === 'init'){
                __diagQueueDepth = Math.max(0, __diagQueueDepth - 1);
                process.stderr.write(`[diag] ${Date.now()} rq_complete method=${request.method} cat=${category} id=${request.id} dur_ms=${dur} qdepth=${__diagQueueDepth}\n`);
                try { (server as any).__activeDiagRequests?.delete(request.id); } catch { /* ignore */ }
              }
            } catch { /* ignore */ }
          }
          if(abortController.signal.aborted){
            try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[rpc] aborted-but-sending method=${request.method} id=${request.id}\n`); } catch { /* ignore */ }
          } else {
            try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[rpc] response method=${request.method} id=${request.id} ok\n`); } catch { /* ignore */ }
          }
          const sendPromise = (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, result });
          if(request.method === 'initialize'){
            initFrameLog('dispatcher_before_send', { id: request.id });
            (sendPromise?.then?.(()=> {
              initFrameLog('dispatcher_send_resolved', { id: request.id });
              (server as any).__initResponseSent = true;
              setTimeout(()=> emitReadyGlobal(server,'transport-send-hook'), 0);
            }))?.catch(()=>{});
          }
          return sendPromise;
        }, (error:any)=>{
          if(startedAt !== undefined){
            try {
              const dur = Date.now() - startedAt;
              const category = categorizeRequest(request);
              if(category === 'health' || category === 'meta' || category === 'metrics' || category === 'init'){
                __diagQueueDepth = Math.max(0, __diagQueueDepth - 1);
                process.stderr.write(`[diag] ${Date.now()} rq_error method=${request.method} cat=${category} id=${request.id} dur_ms=${dur} qdepth=${__diagQueueDepth}\n`);
                try { (server as any).__activeDiagRequests?.delete(request.id); } catch { /* ignore */ }
              }
            } catch { /* ignore */ }
          }
          if(abortController.signal.aborted){
            try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[rpc] aborted-error-path method=${request.method} id=${request.id}\n`); } catch { /* ignore */ }
          }
          // Robust semantic error preservation: search multiple nests for a JSON-RPC code/message
          let errCode: unknown = error?.code;
          if(!Number.isSafeInteger(errCode)) errCode = error?.data?.code;
          if(!Number.isSafeInteger(errCode)) errCode = error?.original?.code;
          if(!Number.isSafeInteger(errCode)) errCode = error?.cause?.code;
          if(!Number.isSafeInteger(errCode)) errCode = error?.error?.code;
          const rawBeforeDeep = errCode;
          if(!Number.isSafeInteger(errCode) || errCode === -32603){
            const deep = deepScan(error);
            if(Number.isSafeInteger(deep)) errCode = deep;
          }
          const safeCode = Number.isSafeInteger(errCode) ? errCode as number : undefined;
          let errMessage: string | undefined = error?.message;
          if(!errMessage) errMessage = error?.data?.message;
          if(!errMessage) errMessage = error?.original?.message;
          if(!errMessage) errMessage = error?.cause?.message;
          if(!errMessage) errMessage = error?.error?.message;
          if(typeof errMessage !== 'string' || !errMessage.trim()) errMessage = 'Internal error';
          let data: any = error?.data;
          if(data && typeof data === 'object'){
            if(typeof data.message !== 'string') data = { ...data, message: errMessage };
          } else if(error && typeof error === 'object') {
            data = { message: errMessage, ...(error.method ? { method: error.method }: {}) };
          }
          let finalCode = (safeCode !== undefined) ? safeCode : -32603;
          if(finalCode === -32603 && data && typeof data === 'object'){
            try {
              const reason = (data as any).reason || (data as any).data?.reason;
              if(reason === 'missing_action') finalCode = -32602;
              else if(reason === 'unknown_action' || reason === 'mutation_disabled' || reason === 'unknown_handler') finalCode = -32601;
            } catch { /* ignore */ }
          }
          try {
            if(getRuntimeConfig().logging.verbose){
              const before = Number.isSafeInteger(rawBeforeDeep)? rawBeforeDeep : 'n/a';
              if((before === 'n/a' || before === -32603) && (finalCode === -32601 || finalCode === -32602)){
                const reasonHint = (data as any)?.reason || (data as any)?.data?.reason;
                process.stderr.write(`[rpc] deep_recover_semantic code=${finalCode} from=${before} reasonHint=${reasonHint||''}\n`);
              }
            }
          } catch { /* ignore */ }
          try { if(getRuntimeConfig().logging.verbose) process.stderr.write(`[rpc] response method=${request.method} id=${request.id} error=${errMessage} code=${finalCode}\n`); } catch { /* ignore */ }
          return (this as any)._transport?.send({ jsonrpc:'2.0', id: request.id, error:{ code: finalCode, message: errMessage, data } });
        })
        .catch(()=>{})
        .finally(()=>{ (this as any)._requestHandlerAbortControllers.delete(request.id); });
    };
    // Attach wrapper to BOTH potential internal symbols to guarantee interception.
    (server as any)._onRequest = wrapped;
    (server as any)._onrequest = wrapped;
    (server as any).__dispatcherOverrideActive = true;
    try { if(getRuntimeConfig().trace.has('healthMixed')) process.stderr.write(`[diag] ${Date.now()} dispatcher_override applied props=${[existingCamel? '_onRequest(original)':'', existingLower? '_onrequest(original)':''].filter(Boolean).join(',')||'none'}\n`); } catch { /* ignore */ }
    // Starvation watchdog
    if(getRuntimeConfig().trace.has('healthMixed') && !(server as any).__starvationWatchdogStarted){
      (server as any).__starvationWatchdogStarted = true;
      let ticks = 0;
      const iv = setInterval(()=>{
        try {
          ticks++;
          const active: any = (server as any).__activeDiagRequests;
          const firstH = (server as any).__healthId1EnqueueAt;
          if(active && active.size){
            const pending = Array.from(active.values()).map((r: any)=>({ id:r.id, cat:r.cat, age: Date.now()-r.start })).sort((a:any,b:any)=>a.id-b.id).slice(0,12);
            const hasHealth1 = !!active.get?.(1);
            if(hasHealth1 || (firstH && Date.now()-firstH > 40)){
              process.stderr.write(`[diag] ${Date.now()} starvation_watchdog tick=${ticks} pending=${pending.length} details=${JSON.stringify(pending)} firstHealthAge=${firstH? Date.now()-firstH: -1} hasHealth1=${hasHealth1}\n`);
            }
            if(!hasHealth1 && firstH && Date.now()-firstH>400){
              process.stderr.write(`[diag] ${Date.now()} starvation_watchdog_health1_missing age=${Date.now()-firstH}\n`);
            }
          }
          if(ticks>40 || ((server as any).__activeDiagRequests && !(server as any).__activeDiagRequests.get(1))){
            clearInterval(iv);
          }
        } catch { /* ignore */ }
      }, 25);
      iv.unref?.();
    }
  } else if(getRuntimeConfig().trace.has('healthMixed')){
    try { process.stderr.write(`[diag] ${Date.now()} dispatcher_override_skipped no_original_handler_found`); } catch { /* ignore */ }
  }
  // Enumerate server properties once for debugging missing override
  try {
    if(getRuntimeConfig().trace.has('healthMixed')){
      const props = Object.getOwnPropertyNames(server).filter(p=>/_on|request|handler/i.test(p)).slice(0,60);
      process.stderr.write(`[diag] ${Date.now()} server_props ${props.join(',')}\n`);
    }
  } catch { /* ignore */ }
}

/**
 * Wrap transport.send to detect initialize response flush and emit ready.
 */
export function wrapTransportSend(server: any, transport: any): void {
  try {
    const origSend = (transport as any)?.send?.bind(transport);
    if(origSend && !(transport as any).__wrappedForReady){
      (transport as any).__wrappedForReady = true;
      (transport as any).send = (msg: any) => {
        let isInitResult = false;
        try {
          isInitResult = !!(msg && typeof msg === 'object' && 'id' in msg && msg.result && msg.result.protocolVersion);
        } catch { /* ignore */ }
        const sendPromise = origSend(msg);
        // Fallback completion / error logging if dispatcher override not active
        try {
          if(getRuntimeConfig().trace.has('healthMixed') && !(server as any).__dispatcherOverrideActive && msg && typeof msg === 'object' && Object.prototype.hasOwnProperty.call(msg,'id')){
            const map = (server as any).__diagRQMap;
            if(map && map.has(msg.id)){
              const rec = map.get(msg.id);
              map.delete(msg.id);
              (server as any).__diagQueueDepthSniff = Math.max(0, (server as any).__diagQueueDepthSniff - 1);
              const kind = (msg as any).error ? 'rq_error' : 'rq_complete';
              const dur = Date.now() - rec.start;
              process.stderr.write(`[diag] ${Date.now()} ${kind} method=${rec.method} cat=${rec.cat} id=${msg.id} dur_ms=${dur} qdepth=${(server as any).__diagQueueDepthSniff} src=sniff-send\n`);
            }
          }
        } catch { /* ignore */ }
        if(isInitResult && !(server as any).__readyNotified){
          (server as any).__sawInitializeRequest = true;
          initFrameLog('transport_detect_init_result', { id: msg.id });
          sendPromise?.then?.(()=>{
            initFrameLog('transport_send_resolved', { id: msg.id });
            (server as any).__initResponseSent = true;
            setTimeout(()=> emitReadyGlobal(server,'transport-send-hook-dynamic'), 0);
          })?.catch?.(()=>{});
        }
        return sendPromise;
      };
    }
  } catch { /* ignore wrapper errors */ }
}

/**
 * Explicit keepalive to avoid premature process exit before first client request.
 * @param label - Optional label for diagnostic log messages (e.g. 'secondary')
 */
export function setupKeepalive(label = ''): void {
  try {
    if(process.stdin.readable) process.stdin.resume();
    process.stdin.on('data', ()=>{}); // no-op to anchor listener
    const ka = setInterval(()=>{/* keepalive */}, 10_000); ka.unref?.();
    if(getRuntimeConfig().logging.diagnostics){
      const prefix = label ? ` (${label})` : '';
      const stdinListenerCount = process.stdin.listenerCount('data');
      try { process.stderr.write(`[transport-init]${prefix} keepalive setup complete stdin.dataListeners=${stdinListenerCount}\n`); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}
