// Minimal Vitest custom reporter emitting a consolidated JSON summary for CI artifact upload.
// Produces: test-results/results.json (one file) with high-level pass/fail stats and failed test details.
import type { Reporter, Vitest, File } from 'vitest';
import fs from 'fs';
import path from 'path';

export default class JsonResultsReporter implements Reporter {
  onInit(ctx: Vitest) {
    // Ensure target directory exists early (harmless if already present)
    try { fs.mkdirSync('test-results', { recursive: true }); } catch { /* ignore */ }
    ctx.logger.log('[jsonResultsReporter] initialized');
  }
  // Conform to Reporter interface: onFinished(files, errors, coverage?)
  // We derive minimal stats here; ignore 'errors' array (failures already inside files).
  onFinished(files: File[], _errors: unknown[]): void | Promise<void> {
    try {
      const failedFiles = files.filter(f => f.result?.state === 'fail');
      const summary = {
        fileCount: files.length,
        failedFileCount: failedFiles.length,
        passedFileCount: files.filter(f => f.result?.state === 'pass').length,
        testFailures: failedFiles.flatMap(f => (f.tasks || []).filter(t => t.result?.state === 'fail').map(t => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const firstErr = (t.result as any)?.errors?.[0];
          return {
            name: t.name,
            file: f.name,
            error: firstErr ? {
              message: firstErr.message,
              stack: typeof firstErr.stack === 'string' ? firstErr.stack.split('\n').slice(0,10).join('\n') : undefined
            } : undefined
          };
        }))
      };
      const outPath = path.join('test-results','results.json');
      fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[jsonResultsReporter] failed to write results:', (err as Error).message);
    }
  }
}
