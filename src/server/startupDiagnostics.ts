import type { RuntimeConfig } from '../config/runtimeConfig';
import { listRegisteredMethods } from './registry';
import { getIndexState, diagnoseInstructionsDir } from '../services/indexContext';

export async function emitStartupDiagnostics(
  runtime: RuntimeConfig,
  bufferEnabled: boolean,
  earlyInitChunks: Buffer[],
): Promise<void> {
  if (runtime.logging.verbose || runtime.logging.diagnostics) {
    try {
      const methods = listRegisteredMethods();
      const idx = getIndexState();
      const mutation = runtime.mutationEnabled;
      const dirDiag = diagnoseInstructionsDir();
      process.stderr.write(`[startup] toolsRegistered=${methods.length} mutationEnabled=${mutation} indexCount=${idx.list.length} indexHash=${idx.hash} instructionsDir="${dirDiag.dir}" exists=${dirDiag.exists} writable=${dirDiag.writable}${dirDiag.error ? ` dirError=${dirDiag.error.replace(/\s+/g, ' ')}` : ''}\n`);
      try {
        const { summarizeTraceEnv } = await import('../services/tracing.js');
        const sum = summarizeTraceEnv();
        process.stderr.write(`[startup] trace level=${sum.level} session=${sum.session} file=${sum.file || 'none'} categories=${sum.categories ? sum.categories.join(',') : '*'} maxFileSize=${sum.maxFileSize || 0} rotationIndex=${sum.rotationIndex}\n`);
      } catch { /* ignore */ }
    } catch (e) {
      process.stderr.write(`[startup] diagnostics_error ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }

  if (bufferEnabled && runtime.logging.diagnostics) {
    try {
      const totalBytes = earlyInitChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const hasContentLength = earlyInitChunks.some(chunk => chunk.toString('utf8').includes('Content-Length'));
      process.stderr.write(`[handshake-buffer] pre-start buffered=${earlyInitChunks.length} totalBytes=${totalBytes} hasContentLength=${hasContentLength}\n`);
    } catch { /* ignore */ }
  }
}
