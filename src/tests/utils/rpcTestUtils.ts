import { spawn, SpawnOptions } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface SpawnResult { proc: ReturnType<typeof spawn>; stderr: string[]; }

export interface JsonContentBlock { text?: string; data?: unknown; [k: string]: unknown }
export interface JsonRpcEnvelope {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: unknown | { result?: unknown; data?: unknown; content?: JsonContentBlock[] };
  error?: { code: number; message: string; data?: unknown };
  [k: string]: unknown;
}

export function spawnServer(relativeDistPath='dist/server/index-server.js', extraEnv: NodeJS.ProcessEnv = {}): SpawnResult {
  const serverPath = path.resolve(__dirname, '../../..', relativeDistPath);
  if(!fs.existsSync(serverPath)) throw new Error('Server dist artifact missing at '+serverPath+' (ensure build ran)');
  const env = { ...process.env, ...extraEnv };
  const proc = spawn('node',[serverPath], { stdio:['pipe','pipe','pipe'], env } as SpawnOptions);
  const stderr: string[] = [];
  proc.stderr?.on('data', d=> stderr.push(d.toString('utf8')));
  return { proc, stderr };
}

export function send(proc: ReturnType<typeof spawn>, msg: unknown){
  try { proc.stdin?.write(JSON.stringify(msg)+'\n'); } catch {/* ignore */}
}

export function collectUntil(
  proc: ReturnType<typeof spawn>,
  predicate: (obj: JsonRpcEnvelope)=>boolean,
  timeoutMs=8000
): Promise<JsonRpcEnvelope> {
  return new Promise((resolve, reject)=>{
    const start = Date.now();
    let buffer = '';
    let settled = false;

    const finalize = (err: Error | null, value: JsonRpcEnvelope | null)=>{
      if(settled) return; settled = true;
      proc.stdout?.off('data', onData);
      proc.off('exit', onExit);
      proc.off('error', onErr);
      if(err) reject(err); else resolve(value || {});
    };

    const tryLines = ()=>{
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for(const line of lines){
        if(!line.trim()) continue;
        try {
          const obj: JsonRpcEnvelope = JSON.parse(line);
          if(predicate(obj)) return finalize(null, obj);
        } catch {/* ignore */}
      }
    };

    const onData = (d: Buffer)=>{
      if(settled) return;
      buffer += d.toString('utf8');
      tryLines();
      if(!settled && Date.now() - start > timeoutMs){
        finalize(new Error('collectUntil timeout after '+timeoutMs+'ms'), null);
      }
    };
    const onExit = (code: number|null, signal: string|null)=>{
      if(!settled) finalize(new Error(`process exited before predicate (code=${code} signal=${signal})`), null);
    };
    const onErr = (err: Error)=>{ if(!settled) finalize(new Error('process error before predicate: '+err.message), null); };

    proc.stdout?.on('data', onData);
    proc.once('exit', onExit);
    proc.once('error', onErr);
  });
}

export interface HelpOverviewShape {
  generatedAt?: string;
  sections?: Array<{ id: string; title?: string; [k: string]: unknown }>;
  version?: string;
  [k: string]: unknown;
}

export function extractHelpLike(env: JsonRpcEnvelope): HelpOverviewShape | undefined {
  if(!env) return undefined;
  let r: unknown = env.result ?? env;
  // unwrap nested result containers
  if(typeof r === 'object' && r && 'result' in (r as Record<string, unknown>)) {
    const inner = (r as Record<string, unknown>).result;
    if(inner !== undefined) r = inner;
  }
  if(typeof r === 'string'){
    try {
      const parsed = JSON.parse(r);
      if(parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).generatedAt) return parsed as HelpOverviewShape;
    } catch {/* ignore */}
  }
  if(r && typeof r === 'object'){
    const ro = r as Record<string, unknown>;
    if(ro.data && typeof ro.data === 'object' && (ro.data as Record<string, unknown>).generatedAt) return ro.data as HelpOverviewShape;
    if(ro.generatedAt && ro.sections) return ro as HelpOverviewShape;
    const content = ro.content;
    if(Array.isArray(content)){
      for(const c of content){
        if(c && typeof c === 'object'){
          const co = c as Record<string, unknown>;
            if(co.data && typeof co.data === 'object' && (co.data as Record<string, unknown>).generatedAt) return co.data as HelpOverviewShape;
            if(typeof co.text === 'string'){
              try { const obj = JSON.parse(co.text); if(obj && obj.generatedAt && obj.sections) return obj as HelpOverviewShape; } catch {/* ignore */}
            }
        }
      }
    }
  }
  return undefined;
}
