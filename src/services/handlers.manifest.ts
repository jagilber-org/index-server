import { registerHandler } from '../server/registry';
import { computeManifestDrift, loadManifest, repairManifest, writeManifestFromIndex } from './manifestManager';
import { ensureLoaded } from './indexContext';

// manifest_status: returns current drift (without repairing) and manifest presence.
registerHandler('manifest_status', ()=>{
  const st = ensureLoaded();
  const manifest = loadManifest();
  const drift = computeManifestDrift();
  return { hash: st.hash, manifestPresent: !!manifest, count: st.list.length, drift: drift.drift, details: drift.details.slice(0,25) };
});

// manifest_refresh: force rewrite from current index (non-mutating to index itself)
registerHandler('manifest_refresh', ()=>{
  const st = ensureLoaded();
  const manifest = writeManifestFromIndex();
  return { refreshed: !!manifest, count: manifest?.count ?? 0, hash: st.hash };
});

// manifest_repair: recompute manifest if drift present.
registerHandler('manifest_repair', ()=>{
  const st = ensureLoaded();
  const result = repairManifest();
  return { hash: st.hash, ...result };
});

export {};
