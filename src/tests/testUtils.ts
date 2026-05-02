/**
 * Shared lightweight test utilities (kept intentionally dependency‑light).
 * Purpose: remove duplicated ad‑hoc body extraction & hash assertion logic.
 */
// Generic record type without pulling in external declaration surfaces
export type AnyRecord = Record<string, unknown> | undefined | null;

// Normalize instruction body out of varied response envelopes (create/get/update variants)
export function normalizeBody(obj: AnyRecord): string | undefined {
  if(!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  const direct = typeof o.body === 'string' ? o.body : undefined;
  if(direct) return direct;
  const item = o.item && typeof o.item === 'object' ? o.item as Record<string, unknown> : undefined;
  const nested = item && typeof item.body === 'string' ? item.body : undefined;
  return nested;
}

export function pick<T = unknown>(obj: AnyRecord, path: string[]): T | undefined {
  let cur: unknown = obj;
  for(const segment of path){
    if(cur && typeof cur === 'object' && segment in (cur as Record<string, unknown>)){
      cur = (cur as Record<string, unknown>)[segment];
    } else return undefined;
  }
  return cur as T | undefined;
}

// Hash assertions kept minimal to avoid importing vitest directly (call within test scope)
// Use loose typing; caller supplies expect from vitest. ctx kept for future richer messaging.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function assertHashStable(expectFn: (v: any)=>any, before: string | undefined, after: string | undefined, _ctx='hash stable') {
  expectFn(!!(before && after && before === after)).toBe(true);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function assertHashChanged(expectFn: (v: any)=>any, before: string | undefined, after: string | undefined, _ctx='hash changed') {
  expectFn(!!(before && after && before !== after)).toBe(true);
}
export async function waitFor(predicate: () => boolean, timeoutMs = 2000, intervalMs = 40): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return predicate();
}

// Parse a tools/call success line and return decoded inner JSON payload (content[0].text) if present
export function parseToolPayload<T=unknown>(line: string): T | undefined {
  try {
    const outer = JSON.parse(line);
    const text = outer.result?.content?.[0]?.text;
    if (typeof text === 'string') {
      try {
        const parsed = JSON.parse(text) as unknown;
        // Type guard for envelope shape
        interface Envelope { version: number; serverVersion: string; data: unknown }
        const isEnvelope = (v: unknown): v is Envelope => {
          if(!v || typeof v !== 'object') return false;
          const o = v as Record<string, unknown>;
          return typeof o.version === 'number' && o.version === 1 && typeof o.serverVersion === 'string' && Object.prototype.hasOwnProperty.call(o,'data') && typeof o.data === 'object' && o.data !== null;
        };
        if(isEnvelope(parsed)) return parsed.data as T;
        return parsed as T;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return undefined;
}

// --- Atomic Create Contract Enforcement Utilities -----------------------------------------
// We enforce that every test which performs an index_dispatch add action validates:
// 1. Success envelope semantics (either verified:true OR created:true inside payload JSON)
// 2. Immediate follow-up visibility via at least one list/get of the same id (same test file)
// This is implemented via lightweight static scanning + runtime registration hook.

export interface AddInvocationRecord { file: string; idLiteral?: string; line: number; verifiedAsserted: boolean; createdAsserted: boolean; visibilityQueried: boolean; }
const __addContractRegistry: AddInvocationRecord[] = [];

// Called by meta-test after dynamic scan populates registry entries (injected by transform or manual code additions)
export function registerAddContract(rec: AddInvocationRecord){ __addContractRegistry.push(rec); }

export function getAddContractRegistry(){ return __addContractRegistry.slice(); }

// Helper for tests to manually record when they perform a get/list for a given id (string literal only)
export function markVisibility(id: string, file: string){
  for(const r of __addContractRegistry){ if(r.file===file && r.idLiteral===id){ r.visibilityQueried = true; } }
}

// Helper for tests to mark verified or created assertion executed (to be called right after expect())
export function markAssertion(id: string, file: string, kind: 'verified'|'created'){
  for(const r of __addContractRegistry){ if(r.file===file && r.idLiteral===id){ if(kind==='verified') r.verifiedAsserted = true; else r.createdAsserted = true; } }
}

// NOTE: Existing tests will be gradually instrumented to call markVisibility / markAssertion.
// Meta-test will fail for any add invocation missing required assertions until migration complete.

// Minimal JSON-RPC envelope type used in tests
export interface RpcEnvelope {
  id?: number;
  result?: unknown;
  error?: { code: number; message?: string; data?: unknown };
}

// Standard JSON-RPC error codes we assert against in tests
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// Normalize an arbitrary thrown error-like value into a JSON-RPC error shape.
// - If it already has a safe integer code in the JSON-RPC range, preserve it (unless out-of-policy)
// - Map dispatcher validation problems to INVALID_PARAMS
// - Map unknown action/tool/method issues to METHOD_NOT_FOUND
// - Fallback to INTERNAL_ERROR
export function normalizeError(e: unknown, fallbackMethod?: string){
  const base: { code: number; message: string; data?: Record<string, unknown> } = { code: JSON_RPC_ERRORS.INTERNAL_ERROR, message: 'Internal error' };
  const obj = (typeof e === 'object' && e) ? e as Record<string, unknown> : {};
  const code = typeof obj.code === 'number' ? obj.code : undefined;
  const message = typeof obj.message === 'string' ? obj.message : undefined;
  const data = (obj.data && typeof obj.data === 'object') ? obj.data as Record<string, unknown> : undefined;
  if(code && Number.isSafeInteger(code) && code <= -32000 && code >= -32768){
    base.code = code as number; base.message = message || base.message; if(data) base.data = data; return base;
  }
  // Heuristic message classification
  const msg = (message || '').toLowerCase();
  if(/unknown (action|tool|method)/.test(msg)){
    base.code = JSON_RPC_ERRORS.METHOD_NOT_FOUND;
    base.message = message || 'Method not found';
  } else if(/missing (action|param|required)/.test(msg) || /invalid param/.test(msg)){
    base.code = JSON_RPC_ERRORS.INVALID_PARAMS;
    base.message = message || 'Invalid params';
  } else {
    base.code = JSON_RPC_ERRORS.INTERNAL_ERROR;
    base.message = message || base.message;
  }
  if(fallbackMethod){ base.data = { ...(base.data||{}), method: fallbackMethod }; }
  return base;
}

// Assert (optionally) that an envelope satisfies XOR invariant: exactly one of result or error present (and id defined unless notification)
export function xorResultError(e: RpcEnvelope): boolean {
  // Notifications have no id and no result/error; only enforce when id is present
  if (e.id === undefined) return true;
  const hasResult = e.result !== undefined;
  const hasError = e.error !== undefined;
  return (hasResult ? 1 : 0) + (hasError ? 1 : 0) === 1;
}

// Shared response finder: returns the first parsed line matching id that has either result or error
export function findResponse(lines: string[], id: number): RpcEnvelope | undefined {
  for (const l of lines) {
    try {
      const o = JSON.parse(l) as RpcEnvelope;
      if (o && o.id === id && (o.result !== undefined || o.error !== undefined)) return o;
    } catch { /* ignore malformed */ }
  }
  return undefined;
}

// Convenience wait helper for an id (wraps waitFor). Returns the envelope if found else undefined.
export async function waitForResponse(lines: string[], id: number, timeoutMs = 4000): Promise<RpcEnvelope | undefined> {
  await waitFor(() => !!findResponse(lines, id), timeoutMs);
  return findResponse(lines, id);
}

// Deterministic getResponse: waits then returns envelope or throws with diagnostic context
export async function getResponse(lines: string[], id: number, timeoutMs = 4000): Promise<RpcEnvelope> {
  const ok = await waitFor(() => !!findResponse(lines, id), timeoutMs);
  if(!ok){
    // include last few lines for debugging
    const tail = lines.slice(-10).join('\n');
    throw new Error(`Timeout waiting for response id=${id}. Tail:\n${tail}`);
  }
  const env = findResponse(lines, id)!;
  if(!xorResultError(env)) {
    throw new Error(`Invariant violation (result XOR error) for id=${id}: ${JSON.stringify(env)}`);
  }
  return env;
}

// Wait for a file to appear (and optionally satisfy a predicate) up to timeout
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry';
// Add explicit .js extension for Node16 moduleResolution compliance (TS2835 avoidance)
import { IndexLoader } from '../services/indexLoader.js';
import type { InstructionEntry } from '../models/instruction';
export async function waitForFile(filePath: string, timeoutMs = 4000, predicate: (txt: string)=>boolean = ()=>true): Promise<string> {
  const start = Date.now();
  let content = '';
  while(Date.now() - start < timeoutMs){
    if(fs.existsSync(filePath)){
      try { content = fs.readFileSync(filePath,'utf8'); if(predicate(content)) return content; } catch { /* ignore read race */ }
    }
    await new Promise(r=> setTimeout(r, 40));
  }
  throw new Error(`waitForFile timeout (${timeoutMs}ms) path=${filePath}`);
}

  // Convenience: only wait for existence (no JSON parse).
  export async function ensureFileExists(filePath:string, timeoutMs=4000, intervalMs=50):Promise<void>{
    const start = Date.now();
    while(Date.now() - start < timeoutMs){
      if(fs.existsSync(filePath)) return;
      await new Promise(r=> setTimeout(r, intervalMs));
    }
    throw new Error(`timeout waiting for file ${filePath}`);
  }

  // Wait for a file to exist AND be valid JSON (returns parsed JSON) to mitigate transient EBUSY / partial write races on Windows with AV scanners.
  export async function ensureJsonReadable<T=unknown>(filePath: string, timeoutMs=4000, intervalMs=50): Promise<T> {
    const start = Date.now();
    let lastErr: string | undefined;
    while(Date.now() - start < timeoutMs){
      if(fs.existsSync(filePath)){
        try {
          const txt = fs.readFileSync(filePath,'utf8');
          // Heuristic: ensure file not empty and last char likely '}' or ']' to reduce chance of truncation
          if(txt.trim().length && /[}\]]\s*$/.test(txt)){
            return JSON.parse(txt) as T;
          }
          lastErr = 'incomplete content heuristic failed';
        } catch(e){
          lastErr = (e as Error).message;
        }
      }
      await new Promise(r=> setTimeout(r, intervalMs));
    }
    throw new Error(`ensureJsonReadable timeout for ${filePath} lastErr=${lastErr}`);
  }

  // Poll a directory for a index entry id using IndexLoader (fresh instance each attempt) with diagnostics.
  export async function waitForIndexEntry(dir: string, id: string, timeoutMs=3000, intervalMs=50): Promise<{ entry: InstructionEntry; errors: string[]; attempts: number; }> {
    const start = Date.now();
    let lastErrors: string[] = [];
    let attempts = 0;
    while(Date.now() - start < timeoutMs){
      attempts++;
      try {
        const { entries, errors } = new IndexLoader(dir).load();
        lastErrors = errors.map(e=> e.error);
        const found = entries.find(e=> e.id === id);
        if(found) return { entry: found, errors: lastErrors, attempts };
      } catch (loadErr) {
        lastErrors = [(loadErr as Error).message];
        // assignment above feeds the next iteration's diagnostic context;
        // overwritten on the timeout path's final IndexLoader.load() below.
      }
      await new Promise(r=> setTimeout(r, intervalMs));
    }
    // One final attempt to gather diagnostics
    const final = new IndexLoader(dir).load();
    lastErrors = final.errors.map(e=> e.error);
    const listing = fs.existsSync(dir)? fs.readdirSync(dir).join(',') : 'missing-dir';
    const filePath = path.join(dir, id + '.json');
    const present = fs.existsSync(filePath);
    let snippet = '';
    if(present){
      try { snippet = fs.readFileSync(filePath,'utf8').slice(0,200); } catch(err){ snippet = 'read error: ' + (err as Error).message; }
    }
    throw new Error(`waitForIndexEntry timeout id=${id} dir=${dir} attempts=${attempts} errors=${lastErrors.join('|')} listing=${listing} filePresent=${present} snippet=${snippet}`);
  }

  // Wait for a file to be removed (inverse of ensureFileExists)
  export async function ensureFileGone(filePath:string, timeoutMs=4000, intervalMs=50):Promise<void>{
    const start = Date.now();
    while(Date.now() - start < timeoutMs){
      if(!fs.existsSync(filePath)) return;
      await new Promise(r=> setTimeout(r, intervalMs));
    }
    throw new Error(`timeout waiting for file removal ${filePath}`);
  }

  // Idempotent directory ensure (used to replace ad-hoc mkdir guards in specs)
  export function ensureDir(dirPath: string){
    try {
      if(!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive:true });
    } catch (e){
      // surface with context
      throw new Error(`ensureDir failed for ${dirPath}: ${(e as Error)?.message || e}`);
    }
  }

// Send a JSON-RPC message to a spawned server process
function send(proc: { stdin?: NodeJS.WritableStream|null }, msg: Record<string, unknown>){
  proc.stdin?.write(JSON.stringify(msg) + '\n');
}

interface ServerReadyOptions {
  initId?: number;
  metaId?: number;
  timeoutMs?: number; // total budget for each phase
  capabilities?: Record<string, unknown>;
  clientName?: string;
  clientVersion?: string;
  protocolVersion?: string;
  probeList?: boolean; // if true, perform an index_dispatch list probe after meta_tools
  listId?: number; // id to use for list probe (default metaId+1)
}

// Waits for MCP server readiness by performing initialize then meta_tools call.
// Returns the meta_tools outer JSON-RPC envelope (with result.content[0].text) or undefined on timeout.
// This aligns with MCP protocol (initialize first; tools/call for registry) and avoids ad-hoc sleeps.
export async function waitForServerReady(proc: { stdin?: NodeJS.WritableStream|null }, lines: string[], opts: ServerReadyOptions = {}){
  const {
    initId = 7000,
    metaId = 7001,
    timeoutMs = 5000,
    capabilities = { tools: {} },
    clientName = 'test-harness',
    clientVersion = '0.0.0',
  protocolVersion = '2025-06-18',
  probeList = false,
  listId = metaId + 1
  } = opts;

  // If initialize response already present, skip sending again (support reuse in some tests)
  const hasInit = () => !!findResponse(lines, initId);
  if(!hasInit()){
    send(proc, { jsonrpc:'2.0', id: initId, method:'initialize', params:{ protocolVersion, clientInfo:{ name:clientName, version:clientVersion }, capabilities } });
  }
  await waitFor(hasInit, timeoutMs);

  const hasMeta = () => !!findResponse(lines, metaId);
  if(!hasMeta()){
    send(proc, { jsonrpc:'2.0', id: metaId, method:'tools/call', params:{ name:'meta_tools', arguments:{} } });
  }
  await waitFor(hasMeta, timeoutMs);
  // Optional readiness probe: issue a list call and ensure we get a proper success envelope
  if(probeList){
    const hasList = () => !!findResponse(lines, listId);
    if(!hasList()){
      send(proc, { jsonrpc:'2.0', id: listId, method:'tools/call', params:{ name:'index_dispatch', arguments:{ action:'list' } } });
    }
    await waitFor(hasList, timeoutMs);
    const env = findResponse(lines, listId);
    if(!env || env.error){
      const tail = lines.slice(-10).join('\n');
      throw new Error(`waitForServerReady list probe failed id=${listId} env=${JSON.stringify(env)} tail=\n${tail}`);
    }
  }
  return findResponse(lines, metaId);
}

// Attach a line collector to a child process (stderr + stdout) returning the backing array (idempotent).
export function attachLineCollector(proc: { stdout?: NodeJS.ReadableStream|null; stderr?: NodeJS.ReadableStream|null }, out: string[]): string[]{
  const add = (chunk: Buffer|string) => {
    const text = (chunk instanceof Buffer)? chunk.toString('utf8'): String(chunk);
    for(const line of text.split(/\r?\n/)){ if(line.trim()) out.push(line); }
  };
  proc.stdout?.on('data', add);
  proc.stderr?.on('data', add);
  return out;
}

// Expect helper: assert envelope is an error with specific code (optional message regex)
export function expectError(env: RpcEnvelope, code: number, msgPattern?: RegExp){
  if(!env.error) throw new Error(`Expected error envelope code=${code} got success`);
  if(env.error.code !== code) throw new Error(`Expected error code ${code} got ${env.error.code}`);
  if(msgPattern && !msgPattern.test(env.error.message || '')) throw new Error(`Error message mismatch pattern=${msgPattern} actual=${env.error.message}`);
}

// Lightweight direct tool invocation helper (bypasses JSON-RPC transport) used by graph tests.
// Returns the unwrapped data portion of the handler response envelope.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function callTool<T=any>(name: string, args: Record<string, unknown>): Promise<T>{
  const handler = getHandler(name);
  if(!handler) throw new Error(`tool handler not registered: ${name}`);
  // Handlers are wrapped to return responseEnvelope shape { version, serverVersion, data }
  const raw = await handler(args) as unknown;
  // Temporary diagnostic instrumentation for flaky graph_export undefined results.
  if(name === 'graph_export'){
    try {
      // Avoid noisy gigantic logs: summarize shape only.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summary: Record<string, unknown> = { type: typeof raw };
      if(raw && typeof raw === 'object'){
        const o = raw as Record<string, unknown>;
        summary.keys = Object.keys(o).slice(0,10);
        // Capture meta schema version if present
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta = (o as any).meta;
        if(meta && typeof meta === 'object'){
          summary.metaKeys = Object.keys(meta);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          summary.graphSchemaVersion = (meta as any).graphSchemaVersion;
        }
        if('version' in o && 'data' in o){
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = (o as any).data;
          if(d && typeof d === 'object'){
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            summary.envelopeDataKeys = Object.keys(d as any).slice(0,10);
          }
        }
      }
      // Emit single-line JSON so tests can grep if needed.
      // Intentionally using stderr to avoid interfering with stdout-based parsers.
      // Prefix aids filtering.
      // eslint-disable-next-line no-console
      console.error('[graph-export-diag]', JSON.stringify(summary));
    } catch { /* ignore diag errors */ }
  }
  // Envelope detection: only treat as envelope if object has explicit data property AND version field.
  if(raw && typeof raw === 'object'){
    const maybeObj = raw as { data?: unknown; version?: unknown; serverVersion?: unknown };
    if('data' in maybeObj && typeof maybeObj.version === 'number'){
      return maybeObj.data as T;
    }
  }
  // Feature flag likely disabled => handler returned bare result directly.
  return raw as T;
}
