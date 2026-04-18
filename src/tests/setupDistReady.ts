// Global test setup ensuring compiled dist artifacts exist before any test spawns the server.
// Centralizes previous per-spec waitForDist calls and reduces race-induced ENOENT/timeouts.
import { beforeAll } from 'vitest';
import { waitForDist } from './distReady';
import fs from 'fs';
import path from 'path';

// Lightweight ambient declarations to avoid requiring @types/node in test context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any; // provided by Node at runtime
// (Removed unused Buffer ambient to satisfy no-unused-vars; Node provides Buffer if needed.)

// Give this hook a timeout larger than the internal waitForDist window so we never fail *before* the poller
// exhausts its attempts. (Previous flake: hook default 10s < waitForDist 18s => premature 62‑suite cascades.)
// ----------------------------------------------------------------------------------
// Single‑run global initialization (production deploy drift sync only)
// ----------------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if(!g.__SETUP_DIST_READY_INIT){
  g.__SETUP_DIST_READY_INIT = true;
  try {
    // ------------------------------------------------------------------
    // Test bootstrap auto-confirm default
    // ------------------------------------------------------------------
    // Most historical test suites pre-date the bootstrap confirmation
    // gating flow and expect immediate mutation capability on a fresh
    // empty instructions directory. Rather than retrofitting dozens of
    // suites with explicit token request/finalize sequences we default
    // INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM=1 for the entire test process. Individual
    // gating-focused specs (e.g., bootstrapGating.spec.ts) explicitly
    // override this by spawning servers with INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM='0'.
    // If a developer wishes to exercise the true manual flow across all
    // tests they can launch with INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM=0 in the outer
    // environment which will skip this default assignment.
    if(typeof process.env.INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM === 'undefined'){
      process.env.INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM = '1';
    }

    // All tests use the dev repo's local dist/ — no production deploy sync needed.
    // If dist/ is missing, waitForDist (below) will handle it.
  } catch {/* ignore init errors */}
}

beforeAll(async () => {
  const start = Date.now();
  const baseDefault = 18000 + (process.env.EXTEND_DIST_WAIT === '1' && !process.env.DIST_WAIT_MS ? 6000 : 0);
  const requested = process.env.DIST_WAIT_MS ? parseInt(process.env.DIST_WAIT_MS, 10) : baseDefault;
  const timeoutMs = isNaN(requested) ? 18000 : requested;
  const pollInterval = 50;
  const ok = await waitForDist(timeoutMs, pollInterval);
  const elapsed = Date.now() - start;
  const marker = path.join(process.cwd(), '.last-dist-wait-failed');
  if(!ok){
    try { fs.writeFileSync(marker, new Date().toISOString()); } catch {/* ignore */}
    if(process.env.DIST_WAIT_DEBUG === '1'){
      const distDir = path.join(process.cwd(),'dist');
      const serverDir = path.join(distDir,'server');
      const distExists = fs.existsSync(distDir);
      const serverExists = fs.existsSync(serverDir);
      const listing = serverExists ? fs.readdirSync(serverDir).join(',') : '(missing)';
      // eslint-disable-next-line no-console
      console.error(`[setupDistReady] FAIL after ${elapsed}ms (timeout=${timeoutMs}). distExists=${distExists} serverDirExists=${serverExists} listing=${listing}`);
    }
    throw new Error('setupDistReady: dist/server/index-server.js did not materialize within timeout. Build may have failed.');
  } else if(fs.existsSync(marker)) {
    try { fs.unlinkSync(marker); } catch {/* ignore */}
  }
  if(process.env.DIST_WAIT_DEBUG === '1'){
    // eslint-disable-next-line no-console
    console.log(`[setupDistReady] dist/server/index-server.js detected after ${elapsed}ms (timeout=${timeoutMs})`);
  }
  try {
    const keep = path.join(process.cwd(),'dist','.keep');
    const rootKeep = path.join(process.cwd(),'.dist.keep');
    fs.mkdirSync(path.dirname(keep),{recursive:true});
    try { fs.writeFileSync(keep,'test sentinel', { flag: 'wx' }); } catch (e: unknown) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    try { fs.writeFileSync(rootKeep,'persist dist between rapid test cycles', { flag: 'wx' }); } catch (e: unknown) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  } catch {/* ignore */}
}, 25000);
