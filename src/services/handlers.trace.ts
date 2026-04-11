import { registerHandler } from '../server/registry';
import { dumpTraceBufferNow, getTraceBuffer, summarizeTraceEnv } from './tracing';
import { getRuntimeConfig } from '../config/runtimeConfig';
import path from 'path';
import fs from 'fs';

// trace_dump: writes current in-memory ring buffer (if enabled) to a file and returns summary.
// Params: { file?: string }
registerHandler('trace_dump', (p:{ file?: string }) => {
  const tracingCfg = getRuntimeConfig().tracing;
  const fallback = path.join(process.cwd(),'snapshots','trace-buffer.json');
  const file = p?.file || tracingCfg.buffer.file || fallback;
  dumpTraceBufferNow(file);
  let size = 0; let bytes = 0;
  try { if(fs.existsSync(file)){ const stat = fs.statSync(file); bytes = stat.size; const raw = JSON.parse(fs.readFileSync(file,'utf8')); if(raw && Array.isArray(raw.records)) size = raw.records.length; } } catch { /* ignore */ }
  return { dumped:true, file, records:size, bytes, env: summarizeTraceEnv(), bufferEnabled: getTraceBuffer().length>0 };
});

export {};
