import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ensureLoaded } from './indexContext';
import { traceEnabled, emitTrace } from './tracing';
import { incrementCounter } from './features';
import { logInfo, logWarn } from './logger';
import { getRuntimeConfig } from '../config/runtimeConfig';

/**
 * Runtime manifest management.
 * Format (version 1):
 * {
 *   version: 1,
 *   generatedAt: ISO string,
 *   count: number,
 *   entries: [ { id, sourceHash, bodyHash } ]
 * }
 *
 * Design notes:
 * - We intentionally keep entries minimal (id + hashes) to reduce churn risk.
 * - Recomputing the manifest from the in‑memory index after a mutation is O(N) and
 *   acceptable for current index sizes (< few hundred). This favors simplicity & correctness
 *   over incremental append complexity (which can be added later if needed).
 * - Atomicity: write to tmp then rename to avoid partial file visibility.
 *
 * Phase F (simplification):
 * - Removed debounce / max-delay scheduling. Writes are now synchronous & deterministic.
 * - Added no-op short circuit: if projected manifest JSON unchanged, skip write.
 * - attemptManifestUpdate() is now a thin alias of scheduleManifestUpdate() which performs
 *   immediate write (naming preserved for backward compatibility with existing call sites).
 */
export interface ManifestEntry { id: string; sourceHash?: string; bodyHash?: string }
// Include optional $schema so editors / tooling can auto-associate the JSON Schema when opening
// the generated manifest. The relative path chosen resolves from snapshots/index-manifest.json
// to schemas/manifest.schema.json (one directory up then into schemas/).
export interface IndexManifest { $schema?: string; version: 1; generatedAt: string; count: number; entries: ManifestEntry[] }

const MANIFEST_RELATIVE = path.join('snapshots','index-manifest.json');
function getManifestPath(){ return path.join(process.cwd(), MANIFEST_RELATIVE); }

/**
 * Load the manifest from disk.
 * @returns The parsed {@link IndexManifest}, or `null` if the file is absent or unparseable
 */
export function loadManifest(): IndexManifest | null {
  const fp = getManifestPath();
  try {
    if(!fs.existsSync(fp)) return null;
    const data = JSON.parse(fs.readFileSync(fp,'utf8'));
    if(data && data.version === 1 && Array.isArray(data.entries)) return data as IndexManifest;
  } catch { /* ignore */ }
  return null;
}

/**
 * Write a fresh manifest reflecting the current in-memory index state.
 * Skips the write when the content is unchanged (stable `generatedAt` semantics).
 * No-op when `INDEX_SERVER_MANIFEST_WRITE=0`.
 * @returns The computed {@link IndexManifest}, or `null` when writing is disabled
 */
export function writeManifestFromIndex(): IndexManifest | null {
  if(!getRuntimeConfig().instructions.manifest.writeEnabled) return null; // feature disabled
  const started = Date.now();
  const st = ensureLoaded();
  const entries: ManifestEntry[] = st.list.map(e => ({
    id: e.id,
    sourceHash: e.sourceHash,
    bodyHash: crypto.createHash('sha256').update(e.body||'','utf8').digest('hex')
  })).sort((a,b)=> a.id.localeCompare(b.id));
  // We perform a two-phase write to enable generatedAt stability on no-op content:
  // 1. Build a draft manifest with a placeholder timestamp.
  // 2. If existing file content (ignoring generatedAt) is identical, we reuse the prior generatedAt
  //    so downstream processes observing timestamp do not treat the manifest as changed.
  const draftGeneratedAt = new Date().toISOString();
  let previousParsed: IndexManifest | null = null;
  const fp = getManifestPath();
  if(fs.existsSync(fp)){
    try { previousParsed = JSON.parse(fs.readFileSync(fp,'utf8')) as IndexManifest; } catch { previousParsed = null; }
  }
  const manifest: IndexManifest = {
    $schema: '../schemas/manifest.schema.json',
    version:1,
    generatedAt: draftGeneratedAt,
    count: entries.length,
    entries
  };
  // If previous manifest exists and structural content (excluding generatedAt) matches, reuse old timestamp.
  if(previousParsed){
    try {
      const prevComparable = { ...previousParsed, generatedAt: undefined };
      const nextComparable = { ...manifest, generatedAt: undefined };
      if(JSON.stringify(prevComparable) === JSON.stringify(nextComparable)){
        // Reuse timestamp to provide full stability rather than rewriting with new time.
        manifest.generatedAt = previousParsed.generatedAt;
      }
    } catch { /* ignore comparison errors */ }
  }
  // fp already declared above
  try {
    const dir = path.dirname(fp);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
    // No-op short circuit: if existing manifest content is byte-identical we skip write.
    let previous: string | undefined;
    if(fs.existsSync(fp)){
      try { previous = fs.readFileSync(fp,'utf8'); } catch { /* ignore */ }
    }
    const nextJson = JSON.stringify(manifest,null,2);
    if(previous && previous === nextJson){
      incrementCounter('manifest:skipNoChange');
      if(traceEnabled(2)) emitTrace('[trace:manifest:skip-nochange]', { count: manifest.count });
      return manifest; // treat as success (hash stable)
    }
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, nextJson);
    fs.renameSync(tmp, fp);
    incrementCounter('manifest:write');
    logInfo(`[manifest] wrote index-manifest.json count=${manifest.count} ms=${Date.now()-started}`);
    if(traceEnabled(1)) emitTrace('[trace:manifest:write]', { count: manifest.count, ms: Date.now()-started, path: fp });
  } catch (err) {
    incrementCounter('manifest:writeFailed');
    logWarn('[manifest] write failed', err as Error);
    if(traceEnabled(1)) emitTrace('[trace:manifest:write-error]', { error: (err as Error).message });
  }
  return manifest;
}

export interface DriftDetail { id: string; change: 'added' | 'removed' | 'hash-mismatch' }
export interface ManifestDriftReport { present: boolean; drift: number; details: DriftDetail[] }

/**
 * Compare the on-disk manifest against the live in-memory index and report any drift.
 * @returns A {@link ManifestDriftReport} describing added, removed, or hash-mismatched entries
 */
export function computeManifestDrift(): ManifestDriftReport {
  const st = ensureLoaded();
  const manifest = loadManifest();
  if(!manifest) return { present:false, drift: st.list.length? st.list.length: 0, details: st.list.map(e=> ({ id:e.id, change:'added' as const })) };

  // FASTLOAD SHORTCUT: if enabled and counts match we trust the manifest without recomputing hashes.
  // Rationale: On typical startup we only need to know "is there obvious drift?" to skip O(N) hashing.
  // If a subsequent mutation occurs we will rewrite manifest anyway. Safety: if counts differ we fall through
  // to full verification.
  const fastEnabled = manifestFastLoadEnabled();
  if(fastEnabled && manifest.count === st.list.length){
    if(traceEnabled(2)) emitTrace('[trace:manifest:fastload]', { count: st.list.length });
    return { present:true, drift: 0, details: [] };
  }

  const map = new Map(manifest.entries.map(e=> [e.id,e] as const));
  const details: DriftDetail[] = [];
  for(const e of st.list){
    const m = map.get(e.id);
    const bodyHash = crypto.createHash('sha256').update(e.body||'','utf8').digest('hex');
    if(!m) details.push({ id:e.id, change:'added' });
    else if(m.sourceHash !== e.sourceHash || m.bodyHash !== bodyHash) details.push({ id:e.id, change:'hash-mismatch' });
  }
  for(const id of map.keys()){
    if(!st.byId.has(id)) details.push({ id, change:'removed' });
  }
  const report = { present:true, drift: details.length, details } as ManifestDriftReport;
  if(traceEnabled(1)) emitTrace('[trace:manifest:drift]', { drift: report.drift, added: report.details.filter(d=>d.change==='added').length, removed: report.details.filter(d=>d.change==='removed').length, mismatch: report.details.filter(d=>d.change==='hash-mismatch').length, count: st.list.length, manifestCount: manifest.count });
  return report;
}

/**
 * Repair the manifest by rewriting it from the current in-memory index when drift is detected.
 * @returns Object with `repaired` flag and drift counts before and after repair
 */
export function repairManifest(): { repaired:boolean; driftBefore:number; driftAfter:number } {
  const before = computeManifestDrift();
  if(before.drift === 0){
    return { repaired:false, driftBefore:0, driftAfter:0 };
  }
  writeManifestFromIndex();
  const after = computeManifestDrift();
  if(traceEnabled(1)) emitTrace('[trace:manifest:repair]', { driftBefore: before.drift, driftAfter: after.drift });
  return { repaired:true, driftBefore: before.drift, driftAfter: after.drift };
}

// Phase F: simplified scheduling; we keep exported names for backward compatibility.
/** Synchronously write the manifest from the current in-memory index state. */
export function scheduleManifestUpdate(){
  // Single synchronous write (fast for current index sizes). Future high-churn mode could reintroduce batching behind env flag.
  writeManifestFromIndex();
}
/** Alias for {@link scheduleManifestUpdate}; called after any index mutation. */
export function onIndexMutationManifestUpdate(){ scheduleManifestUpdate(); }
// attemptManifestUpdate previously always invoked a write regardless of the INDEX_SERVER_MANIFEST_WRITE flag
// which caused tests expecting stability under INDEX_SERVER_MANIFEST_WRITE=0 to observe a timestamp change.
// We now explicitly no-op unless write mode is enabled, making "attempt" semantics truly conditional.
/** Conditionally write the manifest; only executes when `INDEX_SERVER_MANIFEST_WRITE=1`. */
export function attemptManifestUpdate(){
  if(getRuntimeConfig().instructions.manifest.writeEnabled) scheduleManifestUpdate();
}

/**
 * Check whether manifest fast-load mode is active (`INDEX_SERVER_MANIFEST_FASTLOAD=1`).
 * In fast-load mode, drift detection skips per-entry hash comparison when entry counts match.
 * @returns `true` when fast-load is enabled
 */
export function manifestFastLoadEnabled(){ return getRuntimeConfig().instructions.manifest.fastload; }
