// Global run-level sentinel: creates a unique marker file *once* when the entire Vitest
// process is about to exit (after all suites finish). External automation can poll for
// this file to know the run is definitively complete (versus mid-execution partial logs).
//
// Rationale: Some test phases run for multiple minutes; relying on stdout parsing for
// completion was ambiguous when child processes or lingering async operations produced
// delayed output. A single atomic file write removes ambiguity.
//
// Behavior:
// - Writes .test-run-complete.<epoch>.marker in repo root on 'beforeExit'.
// - Also updates (overwrites) .test-run-complete.latest for stable path watchers.
// - Includes JSON payload with timing + summary environment context.
// - Safe to include multiple times: guarded against duplicate hook registration.
//
// NOTE: This does not guarantee all async teardown tasks have fully flushed if they
// are scheduled *after* 'beforeExit'. For our single-worker configuration and
// synchronous teardown patterns this is sufficient; if we later add parallel workers
// we may need a custom Vitest reporter instead.

import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if(!g.__RUN_SENTINEL_INSTALLED){
  g.__RUN_SENTINEL_INSTALLED = true;
  const started = Date.now();
  const root = process.cwd();
  process.once('beforeExit', (code)=>{
    try {
      const ended = Date.now();
      const durationMs = ended - started;
      const markerName = `.test-run-complete.${Date.now()}.marker`;
      const markerPath = path.join(root, markerName);
      const latestPath = path.join(root, '.test-run-complete.latest');
      // Purge stale markers from prior runs so the repo root doesn't accumulate them.
      try {
        for (const entry of fs.readdirSync(root)) {
          if (entry.startsWith('.test-run-complete.') && entry.endsWith('.marker')) {
            try { fs.unlinkSync(path.join(root, entry)); } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
      const payload = {
        code,
        ended,
        durationMs,
        node: process.version,
        pid: process.pid,
        env: {
          INDEX_SERVER_FORCE_REBUILD: process.env.INDEX_SERVER_FORCE_REBUILD || undefined,
          VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS || undefined,
        }
      };
      fs.writeFileSync(markerPath, JSON.stringify(payload,null,2));
      fs.writeFileSync(latestPath, markerName,'utf8');
      // Also write a concise always-overwritten status file
      fs.writeFileSync(path.join(root,'.test-run-status.json'), JSON.stringify(payload,null,2));
      // eslint-disable-next-line no-console
      console.log(`[runSentinel] Wrote completion marker ${markerName} (duration=${durationMs}ms code=${code})`);
    } catch(err){
      // eslint-disable-next-line no-console
      console.error('[runSentinel] Failed to write completion marker:', (err as Error).message);
    }
  });
}
