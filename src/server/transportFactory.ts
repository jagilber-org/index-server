/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Transport bootstrap helpers for the MCP server.
 */
import { getRuntimeConfig } from '../config/runtimeConfig';

// Helper to perform a true dynamic ESM import that TypeScript won't down-level to require()
export const dynamicImport = (specifier: string) => (Function('m', 'return import(m);'))(specifier);

/**
 * Emit a lightweight diagnostic marker without intercepting stdout writes.
 * Enabled via INDEX_SERVER_TRACE=healthMixed.
 */
export async function setupStdoutDiagnostics(): Promise<void> {
  if(!getRuntimeConfig().trace.has('healthMixed')) return;
  try {
    const buildMarker = 'sdkServerDiagV2';
    let fsMeta = '';
    try {
      const fsMod = await import('fs');
      const stat = fsMod.statSync(__filename);
      fsMeta = ` size=${stat.size} mtimeMs=${Math.trunc(stat.mtimeMs)}`;
    } catch { /* ignore meta */ }
    process.stderr.write(`[diag] ${Date.now()} diag_start marker=${buildMarker}${fsMeta}\n`);
  } catch { /* ignore */ }
}

/**
 * Keep diagnostics on public surfaces only; private SDK dispatcher hooks are no longer patched.
 */
export function setupDispatcherOverride(_server: any): void {
  if(!getRuntimeConfig().trace.has('healthMixed')) return;
  try {
    process.stderr.write(`[diag] ${Date.now()} dispatcher_override disabled public_api_only\n`);
  } catch { /* ignore */ }
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
