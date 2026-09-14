import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IndexLoader } from './indexLoader';
import { InstructionEntry } from '../models/instruction';
import { incrementCounter } from './features';
import { atomicCreateJson, atomicCreateJsonAsync, atomicWriteJson, atomicWriteJsonAsync } from './atomicFs';
import { ClassificationService } from './classificationService';
import { resolveOwner } from './ownershipService';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { createStore } from './storage/factory';
import type { IInstructionStore, ArchiveMeta, ListArchivedOpts, RestoreMode } from './storage/types';
import { migrateJsonToSqlite } from './storage/migrationEngine';
import { assertValidInstructionRecord } from './instructionRecordValidation';
import { validateForDisk } from './loaderSchemaValidator';
import { migrateInstructionRecord } from '../versioning/schemaVersion';
import { deriveUsageCount, backfillLegacyCounters } from './usageCounters';
// Usage subsystem — split out for CQ-1 (#461 F-003). Runtime-only import cycle:
// these functions run during index materialization; indexUsage reads the raw
// state back via getRawIndexState(). No cross-calls happen at module-load time.
import {
  restoreFirstSeenInvariant,
  restoreUsageInvariant,
  restoreLastUsedInvariant,
  loadUsageSnapshot,
  incrementUsage,
  scheduleUsagePersist,
  clearUsageRateLimit,
  __testResetUsageState,
  getInvariantRepairSummary,
  _internal,
  resetUsageProcessLatches,
  firstSeenAuthority,
} from './indexUsage';
import type { UsagePersistRecord, UsageTrackOptions } from './indexUsage';
// Re-export the public usage API + types for backward compatibility (these were
// previously defined in this module; external importers still import them here).
export { incrementUsage, scheduleUsagePersist, clearUsageRateLimit, loadUsageSnapshot, __testResetUsageState, getInvariantRepairSummary, _internal };
export type { UsagePersistRecord, UsageTrackOptions };

// Extended IndexState to retain loader diagnostics so we can expose precise rejection reasons
// via a forthcoming index_diagnostics tool. Keeping optional properties so older code paths
// remain unaffected if they don't need diagnostics.
export interface IndexState { loadedAt: string; hash: string; byId: Map<string, InstructionEntry>; list: InstructionEntry[]; fileCount: number; versionMTime: number; versionToken: string; loadErrors?: { file:string; error:string }[]; loadDebug?: { scanned:number; accepted:number; skipped:number; trace?: { file:string; accepted:boolean; reason?:string }[] }; loadSummary?: { scanned:number; accepted:number; skipped:number; reasons: Record<string,number>; cacheHits?: number; hashHits?: number } }
let state: IndexState | null = null;
// Simple reliable invalidation: any mutation sets dirty=true; next ensureLoaded() performs full rescan.
let dirty = false;

/** Internal seam for the usage subsystem (indexUsage.ts): returns the raw cached
 *  index state without triggering materialization/invariant repair. @internal */
export function getRawIndexState(): IndexState | null { return state; }

// ── Bulk-mutation guard ──────────────────────────────────────────
//
// `ensureLoaded()` swaps `state` atomically, so a reload is never observable
// half-done. The exposure is `materializeWrittenEntry()` (below), which pushes
// entries into the LIVE `state.list` one at a time. During a bulk import or a
// backup restore that means `state.list.length` climbs from ~0 to its final
// value across many event-loop turns, and anything reading it in between sees a
// count that was never a real catalog size.
//
// Observed: catalog samples recorded index_count=2 and index_count=112 while
// the catalog actually held 284 entries (metrics/activity.db, 2026-09-06
// 10:51 and 12:18). Those two points render as full-height spikes on the
// dashboard's index-composition chart, because a stacked area chart has no way
// to distinguish "the index shrank to 2" from "we measured mid-write".
//
// Callers that rebuild the index entry-by-entry wrap the loop in
// `withBulkMutation*`; background samplers skip while `isIndexSettling()`.
let bulkMutationDepth = 0;
let bulkMutationStartedAt = 0;

/**
 * Failsafe. A guard that is only ever released by a `finally` still wedges if a
 * process is killed mid-scope and the counter is module state that outlives it,
 * or if a caller forgets the pairing entirely. A permanently-stuck depth would
 * silently stop catalog sampling forever — a far worse failure than the spikes
 * this guard exists to prevent — so the scope self-expires.
 *
 * 5 minutes is one full sampling interval: long enough that no legitimate bulk
 * import is cut short, short enough that a leak costs at most one sample.
 */
const BULK_MUTATION_MAX_MS = 300_000;

/** Open a bulk-mutation scope. Prefer `withBulkMutation*` over calling directly. */
export function beginBulkMutation(): void {
  if (bulkMutationDepth === 0) bulkMutationStartedAt = Date.now();
  bulkMutationDepth++;
}

/** Close a bulk-mutation scope. Never drops below zero. */
export function endBulkMutation(): void {
  if (bulkMutationDepth > 0) bulkMutationDepth--;
  if (bulkMutationDepth === 0) bulkMutationStartedAt = 0;
}

/**
 * True while the index is being rebuilt entry-by-entry and `state.list.length`
 * is therefore a partial count.
 *
 * Read by background samplers, never by request paths — a dashboard request
 * that lands mid-import should still get the best available answer, whereas a
 * sampler is writing a permanent data point and can simply wait 5 minutes.
 */
export function isIndexSettling(): boolean {
  if (bulkMutationDepth === 0) return false;
  if (Date.now() - bulkMutationStartedAt > BULK_MUTATION_MAX_MS) {
    // Leaked scope — release it rather than blocking sampling indefinitely.
    bulkMutationDepth = 0;
    bulkMutationStartedAt = 0;
    return false;
  }
  return true;
}

/** Run `fn` inside a bulk-mutation scope, releasing it even if `fn` throws. */
export function withBulkMutation<T>(fn: () => T): T {
  beginBulkMutation();
  try { return fn(); } finally { endBulkMutation(); }
}

/** Async form of {@link withBulkMutation}. */
export async function withBulkMutationAsync<T>(fn: () => Promise<T>): Promise<T> {
  beginBulkMutation();
  try { return await fn(); } finally { endBulkMutation(); }
}

/** Test-only: force the guard closed. @internal */
export function _resetBulkMutationGuard(): void {
  bulkMutationDepth = 0;
  bulkMutationStartedAt = 0;
}

// Storage backend — created on demand using current instructions directory.
// Not cached globally because tests change INDEX_SERVER_DIR between runs.
function getStoreForDir(dir: string): IInstructionStore | null {
  try {
    return createStore(undefined, dir);
  } catch {
    return null;
  }
}


// ── Process-scoped latches for noise + work suppression ──────────
// Symptom that motivated these latches (observed live on dev port 8687,
// 2026-05-01): every dashboard request triggered ensureLoaded() →
// migrateJsonToSqlite() because jsonFiles.length > sqliteRowCount was
// permanently true (a few JSON files failed loader validation), and every
// /api/admin/stats request emitted hundreds of stack-traced WARN entries
// from restoreFirstSeenInvariant for entries whose firstSeenTs was
// genuinely unrecoverable. Both of those are infinite-cost loops once the
// process is up. We dedupe both per-process here.
const autoMigrationAttempted = new Set<string>();
/**
 * Test-only hook — reset process-scoped latches between vitest specs.
 * @internal Not part of the public API.
 */
export function _resetIndexContextProcessLatches(): void {
  autoMigrationAttempted.clear();
  resetUsageProcessLatches();
}

/**
 * Test-only hook — reset the module-scoped index state cache.
 * @internal Not part of the public API.
 */
export function _resetIndexContextStateForTests(): void {
  state = null;
  dirty = false;
}

// Dynamically pinned index directory.
// Original implementation captured environment at module load which made later per-suite
// INDEX_SERVER_DIR overrides (set in individual test files *after* other suites imported
// indexContext) ineffective. This caused cross-suite state leakage (graph_export test
// observing large production index). We now repin on demand when the environment value
// changes. Any directory change triggers a full invalidation so subsequent ensureLoaded()
// performs a clean scan of the newly pinned directory.
let PINNED_INDEX_SERVER_DIR: string | null = null;
let LAST_ENV_INDEX_SERVER_DIR: string | null = null;
export function getInstructionsDir(){
  const envVal = process.env.INDEX_SERVER_DIR;
  if (envVal === 'undefined') { logWarn('[indexContext] INDEX_SERVER_DIR is the literal string "undefined" — ignoring (likely a test env restore bug)'); }
  const raw = (envVal && envVal !== 'undefined') ? envVal : '';
  const desired = raw ? path.resolve(raw) : path.join(process.cwd(),'instructions');
  if(!PINNED_INDEX_SERVER_DIR){
    PINNED_INDEX_SERVER_DIR = desired; LAST_ENV_INDEX_SERVER_DIR = raw || '';
    if(!fs.existsSync(PINNED_INDEX_SERVER_DIR)){
      try { fs.mkdirSync(PINNED_INDEX_SERVER_DIR,{recursive:true}); } catch {/* ignore */}
    }
  } else if(desired !== PINNED_INDEX_SERVER_DIR){
    // Environment updated since initial pin -> repin and invalidate index state
    PINNED_INDEX_SERVER_DIR = desired; LAST_ENV_INDEX_SERVER_DIR = raw || '';
    dirty = true; // force reload on next ensureLoaded
    state = null; // drop prior state referencing old directory
    if(!fs.existsSync(PINNED_INDEX_SERVER_DIR)){
      try { fs.mkdirSync(PINNED_INDEX_SERVER_DIR,{recursive:true}); } catch {/* ignore */}
    }
  } else if((raw || '') !== (LAST_ENV_INDEX_SERVER_DIR || '')){
    // Raw env string changed (e.g. different relative path that resolves to same absolute).
    LAST_ENV_INDEX_SERVER_DIR = raw || '';
  }
  return PINNED_INDEX_SERVER_DIR;
}
// Centralized tracing utilities
import { emitTrace, traceEnabled } from './tracing';
import { logInfo, logWarn } from './logger.js';
// Throttled file trace emission (avoid per-get amplification). We emit per-file decisions only
// on true reloads AND if file signature changed OR time since last emission > threshold.
// (legacy file-level trace removed in simplified loader)
// Lightweight diagnostics for external callers (startup logging / health checks)
export function diagnoseInstructionsDir(){
  const dir = getInstructionsDir();
  let exists = false; let writable = false; let error: string | null = null;
  try {
    exists = fs.existsSync(dir);
    if(exists){
      // attempt a tiny write to check permissions (guard against sandbox / readonly mounts)
      const probe = path.join(dir, `.wprobe-${Date.now()}.tmp`);
      try { fs.writeFileSync(probe, 'ok'); writable = true; fs.unlinkSync(probe); } catch(w){ writable = false; error = (w as Error).message; }
    }
  } catch(e){ error = (e as Error).message; }
  return { dir, exists, writable, error };
}
// Removed computeDirMeta and related signature hashing in simplified model.

// Simple explicit version marker file touched on every mutation for robust cross-process cache invalidation.
function getVersionFile(){ return path.join(getInstructionsDir(), '.index-version'); }
export function touchIndexVersion(){
  try {
    const vf = getVersionFile();
    // Write a monotonically increasing token (time + random) to avoid same-millisecond mtime coalescing on some filesystems
    const token = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    fs.writeFileSync(vf, token);
  } catch { /* ignore */ }
}
function readVersionMTime(): number {
  try {
    const vf = getVersionFile();
    if (fs.existsSync(vf)) {
      const st = fs.statSync(vf);
      return st.mtimeMs || 0;
    }
  } catch { /* ignore */ }
  // Fallback: when no .index-version file exists, use the instructions
  // directory's own mtime so the ensureLoaded() cache short-circuit can still
  // recognize an unchanged source. RCA 2026-05-01 (live dev port 8787 vs an
  // operator-explored repo with no version file): readVersionMTime() returned
  // 0, the falsy short-circuit `if (currentVersionMTime && ...)` always failed,
  // every dashboard poll triggered a full disk reload + simple-reload trace,
  // saturating the event loop and breaking dashboard imports.
  try {
    const baseDir = getInstructionsDir();
    const st = fs.statSync(baseDir);
    return st.mtimeMs || 0;
  } catch { /* ignore */ }
  return 0;
}
function readVersionToken(): string { try { const vf=getVersionFile(); if(fs.existsSync(vf)){ return fs.readFileSync(vf,'utf8').trim(); } } catch { /* ignore */ } return ''; }
export function markindexDirty(){ dirty = true; }
function syncTouchedVersionIntoState(){
  try {
    touchIndexVersion();
    const vfMTime = (function(){ try { const vf = path.join(getInstructionsDir(), '.index-version'); if(fs.existsSync(vf)){ return fs.statSync(vf).mtimeMs || 0; } } catch { /* ignore */ } return 0; })();
    const vfToken = (function(){ try { const vf = path.join(getInstructionsDir(), '.index-version'); if(fs.existsSync(vf)){ return fs.readFileSync(vf,'utf8').trim(); } } catch { /* ignore */ } return ''; })();
    if(state){
      if(vfMTime && state.versionMTime !== vfMTime){ state.versionMTime = vfMTime; }
      if(vfToken && state.versionToken !== vfToken){ state.versionToken = vfToken; }
    }
  } catch { /* ignore */ }
}

function materializeWrittenEntry(record: InstructionEntry){
  if(state){
    const existing = state.byId.get(record.id);
    if(existing){
      Object.assign(existing, record);
      try { incrementCounter('index:inMemoryUpdate'); } catch { /* ignore */ }
    } else {
      state.list.push(record);
      state.byId.set(record.id, record);
      try { incrementCounter('index:inMemoryMaterialize'); } catch { /* ignore */ }
    }
    syncTouchedVersionIntoState();
    return;
  }
  markindexDirty();
  syncTouchedVersionIntoState();
}

export function ensureLoaded(): IndexState {
  const baseDir = getInstructionsDir();
  // Always reload if no state or dirty or version file changed.
  const currentVersionMTime = readVersionMTime();
  const currentVersionToken = readVersionToken();
  if(state && !dirty){
    if(currentVersionMTime && currentVersionMTime === state.versionMTime && currentVersionToken === state.versionToken){
      return state;
    }
  }
  // Use store for sqlite backend; IndexLoader for json (has normalization/salvaging logic)
  const backend = getRuntimeConfig().storage?.backend ?? 'json';
  const store = backend === 'sqlite' ? getStoreForDir(baseDir) : null;
  let result = store ? store.load() : new IndexLoader(baseDir).load();
  // Auto-migrate JSON → SQLite when JSON files on disk outnumber SQLite rows.
  // Per-process latch (RCA 2026-05-01): without this, mismatched counts caused by
  // a few unparseable JSON files (jsonFiles.length permanently > sqlite rows) made
  // ensureLoaded() re-invoke migrateJsonToSqlite() on every reload tick, causing
  // INSERT-OR-REPLACE storms and unbounded WAL growth (~1.21 GB observed in dev
  // before the fix). One attempt per (baseDir, dbPath) per process is enough; if
  // an operator truly needs a re-migrate, they restart the server.
  if (store && getRuntimeConfig().storage?.sqliteMigrateOnStart) {
    const dbPath = getRuntimeConfig().storage?.sqlitePath ?? path.join(process.cwd(), 'data', 'index.db');
    const latchKey = `${baseDir}|${dbPath}`;
    if (!autoMigrationAttempted.has(latchKey)) {
      autoMigrationAttempted.add(latchKey);
      const jsonFiles = fs.existsSync(baseDir) ? fs.readdirSync(baseDir).filter(f => f.endsWith('.json') && !f.startsWith('_')) : [];
      if (jsonFiles.length > result.entries.length) {
        try {
          const mr = migrateJsonToSqlite(baseDir, dbPath);
          if (mr.migrated > 0) {
            logInfo(`[storage] Auto-migrated ${mr.migrated} instruction(s) from JSON → SQLite`);
            result = store.load();
          }
        } catch (err) { logWarn('[storage] Auto-migration failed:', err); }
      }
    }
  }
  const byId = new Map<string, InstructionEntry>(); result.entries.forEach(e=>byId.set(e.id,e));
  // Deduplicate list using byId so two on-disk files with the same id field never produce duplicate
  // search results. byId already uses last-write-wins semantics; list must be consistent with it.
  const deduplicatedList = Array.from(byId.values());
  // RCA 2026-05-01 (live dev port 8787): IndexLoader.load() writes _manifest.json
  // and _skipped.json into baseDir as a side-effect, which bumps the directory's
  // mtime. If we cached the pre-load mtime here, the very next ensureLoaded()
  // call would observe a newer mtime, miss the cache, and reload again — an
  // unbounded loop that emitted [trace:ensureLoaded:simple-reload] hundreds of
  // times per second and saturated the event loop (dashboard imports failed).
  // Re-read the mtime AFTER load so the cached value reflects the post-write
  // state; subsequent calls without source changes will then short-circuit.
  const postLoadVersionMTime = readVersionMTime();
  const postLoadVersionToken = readVersionToken();
  state = { loadedAt: new Date().toISOString(), hash: result.hash, byId, list: deduplicatedList, fileCount: deduplicatedList.length, versionMTime: postLoadVersionMTime || currentVersionMTime, versionToken: postLoadVersionToken || currentVersionToken, loadErrors: result.errors, loadDebug: result.debug, loadSummary: result.summary };
  dirty = false;
  // Overlay usage snapshot. Snapshot is the AUTHORITATIVE source for monotonic
  // usage counters because incrementUsage flushes to the snapshot but does NOT
  // rewrite the entry file (entry-file writes happen only on index_add /
  // index_update / writeEntry calls, which may bake a stale usageCount onto
  // disk that lags later increments). Constitution: DI-1 (state MUST auto-
  // restore) and DI-4 (write/read symmetry). RCA 2026-05-20: live restart
  // reverted usageCount because the prior overlay only filled when the entry
  // field was missing, letting a stale entry-file value win over the newer
  // snapshot value.
  applyUsageSnapshotOverlay(state);
  if(traceEnabled(1)){
    try { emitTrace('[trace:ensureLoaded:simple-reload]', { dir: baseDir, count: state.list.length }); } catch { /* ignore */ }
  }
  return state;
}

export async function ensureLoadedAsync(): Promise<IndexState> {
  const baseDir = getInstructionsDir();
  const currentVersionMTime = readVersionMTime();
  const currentVersionToken = readVersionToken();
  if(state && !dirty){
    if(currentVersionMTime && currentVersionMTime === state.versionMTime && currentVersionToken === state.versionToken){
      return state;
    }
  }
  const backend = getRuntimeConfig().storage?.backend ?? 'json';
  if(backend === 'sqlite'){
    return ensureLoaded();
  }
  const result = await new IndexLoader(baseDir).loadAsync();
  const byId = new Map<string, InstructionEntry>(); result.entries.forEach(e=>byId.set(e.id,e));
  const deduplicatedList = Array.from(byId.values());
  // See RCA comment in ensureLoaded() above: re-read mtime AFTER load to absorb
  // _manifest.json / _skipped.json side-effect writes.
  const postLoadVersionMTime = readVersionMTime();
  const postLoadVersionToken = readVersionToken();
  state = { loadedAt: new Date().toISOString(), hash: result.hash, byId, list: deduplicatedList, fileCount: deduplicatedList.length, versionMTime: postLoadVersionMTime || currentVersionMTime, versionToken: postLoadVersionToken || currentVersionToken, loadErrors: result.errors, loadDebug: result.debug, loadSummary: result.summary };
  dirty = false;
  // See ensureLoaded() above for DI-1/DI-4 rationale.
  applyUsageSnapshotOverlay(state);
  if(traceEnabled(1)){
    try { emitTrace('[trace:ensureLoaded:simple-reload]', { dir: baseDir, count: state.list.length }); } catch { /* ignore */ }
  }
  return state;
}

// Snapshot overlay: snapshot is authoritative for monotonic counters
// (usageCount, lastUsedAt). Entry-file value only wins when strictly greater
// (defensive against backup restore / manual edit holding a higher count).
// firstSeenTs is immutable once set, so only fill when missing.
function applyUsageSnapshotOverlay(s: IndexState){
  try {
    const snap = loadUsageSnapshot();
    if(!snap) return;
    const map = snap as Record<string, UsagePersistRecord>;
    for(const e of s.list){
      const rec = map[e.id];
      if(!rec) continue;
      // lastUsedAt is coupled to usageCount: whichever side's count wins also
      // contributes the lastUsedAt for that same observation. Decoupling them
      // (the prior implementation compared lastUsedAt strings independently)
      // produced impossible pairings — e.g. snapshot count=4 paired with an
      // entry-file lastUsedAt from an earlier count=2 observation — because a
      // fresh writeEntry between increments can stamp a NEWER lastUsedAt onto
      // disk than the snapshot's authoritative count records.
      const snapCount = rec.usageCount != null ? rec.usageCount : deriveUsageCount(rec);
      const snapCountWins = (rec.usageCount != null || rec.retrievedCount != null || rec.appliedCount != null) && (e.usageCount == null || snapCount > e.usageCount);
      if(snapCountWins){
        // Split counters (issue #418): snapshot is authoritative. Legacy snapshots
        // carrying only usageCount are interpreted as retrievals (applied=0).
        const split = backfillLegacyCounters({ retrievedCount: rec.retrievedCount, appliedCount: rec.appliedCount, usageCount: rec.usageCount });
        e.retrievedCount = split.retrievedCount;
        e.appliedCount = split.appliedCount;
        e.usageCount = split.usageCount;
        if(rec.lastUsedAt) e.lastUsedAt = rec.lastUsedAt;
        if(rec.lastRetrievedAt) e.lastRetrievedAt = rec.lastRetrievedAt;
        if(rec.lastAppliedAt) e.lastAppliedAt = rec.lastAppliedAt;
      } else {
        // Entry count wins (or ties); only fill missing fields from snapshot.
        if(e.retrievedCount == null && rec.retrievedCount != null) e.retrievedCount = rec.retrievedCount;
        if(e.appliedCount == null && rec.appliedCount != null) e.appliedCount = rec.appliedCount;
        if(rec.lastUsedAt && !e.lastUsedAt) e.lastUsedAt = rec.lastUsedAt;
        if(rec.lastRetrievedAt && !e.lastRetrievedAt) e.lastRetrievedAt = rec.lastRetrievedAt;
        if(rec.lastAppliedAt && !e.lastAppliedAt) e.lastAppliedAt = rec.lastAppliedAt;
      }
      if(!e.firstSeenTs && rec.firstSeenTs){
        e.firstSeenTs = rec.firstSeenTs;
        if(!firstSeenAuthority[e.id]) firstSeenAuthority[e.id] = rec.firstSeenTs; // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
      }
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Cross-instance index version poller
// ---------------------------------------------------------------------------
// Lightweight interval that watches the .index-version file for changes made
// by OTHER processes. Our own mutations already mark the index dirty when we
// touch the version file (touchIndexVersion). The poller simply shortens the
// staleness window for read-only processes that never mutate.
//
// Design principles:
//  - Minimal overhead: single stat + optional file read each interval
//  - Configurable interval (env INDEX_SERVER_POLL_MS, default 10000ms)
//  - Safe to call multiple times (idempotent start)
//  - Optional proactive reload (env INDEX_SERVER_POLL_PROACTIVE=1)
//  - Detects directory repin: if INDEX_SERVER_DIR changes, token snapshot resets
//  - Exposed stop function for tests / deterministic shutdown
// ---------------------------------------------------------------------------
let versionPoller: NodeJS.Timeout | null = null;
let lastPollDir: string | null = null;
let lastSeenToken: string | null = null;
let lastSeenMTime = 0;

export interface IndexPollerOptions { intervalMs?: number; proactive?: boolean }

export function startIndexVersionPoller(opts: IndexPollerOptions = {}){
  if(versionPoller) return; // already running
  const pollerConfig = getRuntimeConfig().server.indexPolling;
  const intervalMs = Math.max(500, opts.intervalMs ?? pollerConfig.intervalMs);
  const proactive = opts.proactive ?? pollerConfig.proactive;
  // Prime snapshot
  try {
    const dir = getInstructionsDir();
    lastPollDir = dir;
    lastSeenMTime = readVersionMTime();
    lastSeenToken = readVersionToken();
  } catch { /* ignore */ }
  versionPoller = setInterval(()=>{
    try {
      const dir = getInstructionsDir();
      if(dir !== lastPollDir){
        // Directory changed (repin) -> reset snapshot so next diff triggers reload
        lastPollDir = dir; lastSeenMTime = 0; lastSeenToken = null;
      }
      const mt = readVersionMTime();
      const tk = readVersionToken();
      // Fast path: nothing changed
      if(mt === lastSeenMTime && tk === lastSeenToken){ return; }
      // Update snapshot first to avoid duplicate work if ensureLoaded triggers another poll cycle
      const prevToken = lastSeenToken;
      lastSeenMTime = mt; lastSeenToken = tk;
      // If we already have state and token truly changed, mark dirty. We compare tokens first as
      // a stronger signal; mt changes without token content change are rare (overwrite with same value).
      if(prevToken !== tk){
        markindexDirty();
        try { incrementCounter('index:pollerVersionChanged'); } catch { /* ignore */ }
        if(proactive){
          // Proactive reload to keep process view hot; ignore errors.
          try { ensureLoaded(); incrementCounter('index:pollerProactiveReload'); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore poll errors */ }
  }, intervalMs);
  try { incrementCounter('index:pollerStarted'); } catch { /* ignore */ }
}

export function stopIndexVersionPoller(){ if(versionPoller){ clearInterval(versionPoller); versionPoller = null; } }

// Mutation helpers (import/add/remove/groom share)
export function invalidate(){ state = null; dirty = true; }
export function getIndexState(){
  // Always enforce invariant on access in case an entry transiently lost firstSeenTs
  const st = ensureLoaded();
  for(const e of st.list){
    if(!e.firstSeenTs){ restoreFirstSeenInvariant(e); }
  if(e.usageCount == null || e.retrievedCount == null || e.appliedCount == null){ restoreUsageInvariant(e); }
  if(e.lastUsedAt == null){ restoreLastUsedInvariant(e); }
  }
  return st;
}

export async function getIndexStateAsync(){
  const st = await ensureLoadedAsync();
  for(const e of st.list){
    if(!e.firstSeenTs){ restoreFirstSeenInvariant(e); }
    if(e.usageCount == null || e.retrievedCount == null || e.appliedCount == null){ restoreUsageInvariant(e); }
    if(e.lastUsedAt == null){ restoreLastUsedInvariant(e); }
  }
  return st;
}

// Lightweight debug snapshot WITHOUT forcing a reload (observes current in-memory view vs disk)
export function getDebugIndexSnapshot(){
  const dir = getInstructionsDir();
  let files:string[] = [];
  try { files = fs.readdirSync(dir).filter(f=> f.endsWith('.json')).sort(); } catch { /* ignore */ }
  const current = state; // do not trigger ensureLoaded here
  const loadedIds = current ? new Set(current.list.map(e=> e.id)) : new Set<string>();
  const missingIds = current ? files.map(f=> f.replace(/\.json$/,'')).filter(id=> !loadedIds.has(id)) : [];
  const extraLoaded = current ? current.list.filter(e=> !files.includes(e.id + '.json')).map(e=> e.id) : [];
  return {
    dir,
    fileCountOnDisk: files.length,
    fileNames: files,
    indexLoaded: !!current,
    indexCount: current? current.list.length: 0,
    dirtyFlag: dirty,
    missingIds,
    extraLoaded,
    loadedAt: current?.loadedAt,
    versionMTime: current?.versionMTime
  };
}

// New diagnostics accessor (read-only) summarizing loader acceptance vs rejection reasons.
// Does NOT trigger a reload beyond normal ensureLoaded execution; focuses on most recent load.
export function getIndexDiagnostics(opts?: { includeTrace?: boolean }){
  const st = ensureLoaded();
  const dir = getInstructionsDir();
  const debug = st.loadDebug;
  const errors = st.loadErrors || [];
  let filesOnDisk: string[] = [];
  try { filesOnDisk = fs.readdirSync(dir).filter(f=> f.endsWith('.json')); } catch { /* ignore */ }
  const diskIds = new Set(filesOnDisk.map(f=> f.replace(/\.json$/,'')));
  const missingOnIndex = [...diskIds].filter(id=> !st.byId.has(id));
  // Adjust anomaly: previously accepted template files (e.g. powershell.template.*) might appear
  // in missing list if downstream exposure filters hide them. We only want genuinely skipped
  // (never accepted) files here. Cross-check trace (if available) to prune accepted ones.
  if(debug?.trace){
    const acceptedSet = new Set(debug.trace.filter(t=> t.accepted).map(t=> t.file.replace(/\.json$/,'')));
    for(let i=missingOnIndex.length-1; i>=0; i--){
      const id = missingOnIndex[i];
      if(acceptedSet.has(id)) missingOnIndex.splice(i,1);
    }
  }
  // Reason aggregation from trace (preferred) then fallback to errors array messages.
  const reasonCounts: Record<string, number> = {};
  if(debug?.trace){
    for(const t of debug.trace){
      if(!t.accepted){
        const r = t.reason || 'rejected:unknown';
        reasonCounts[r] = (reasonCounts[r]||0)+1;
      }
    }
  } else if(errors.length){
    for(const e of errors){
      const key = e.error.split(':')[0];
      reasonCounts[key] = (reasonCounts[key]||0)+1;
    }
  }
  return {
    dir,
    loadedAt: st.loadedAt,
    hash: st.hash,
    scanned: debug?.scanned ?? (debug? debug.accepted + debug.skipped : st.fileCount),
    accepted: debug?.accepted ?? st.fileCount,
    skipped: debug?.skipped ?? Math.max(0, (debug? debug.scanned : st.fileCount) - st.fileCount),
    fileCountOnDisk: filesOnDisk.length,
    indexCount: st.list.length,
    missingOnIndexCount: missingOnIndex.length,
    missingOnIndex: missingOnIndex.slice(0,25),
    reasons: reasonCounts,
    errorSamples: errors.slice(0,25),
    traceSample: opts?.includeTrace && debug?.trace ? debug.trace.slice(0,50) : undefined
  };
}

// Governance projection & hash
export function projectGovernance(e: InstructionEntry){
  return { id:e.id, title:e.title, version: e.version||'1.0.0', owner: e.owner||'unowned', priorityTier: e.priorityTier||'P4', nextReviewDue: e.nextReviewDue||'', semanticSummarySha256: crypto.createHash('sha256').update(e.semanticSummary||'','utf8').digest('hex'), changeLogLength: Array.isArray(e.changeLog)? e.changeLog.length:0 };
}
export function computeGovernanceHash(entries: InstructionEntry[]): string {
  const h = crypto.createHash('sha256');
  // Optional deterministic stabilization: if env set, ensure stable newline termination and explicit sorting already applied
  const lines = entries.slice().sort((a,b)=> a.id.localeCompare(b.id)).map(e=> JSON.stringify(projectGovernance(e)));
  if(getRuntimeConfig().index.govHash.trailingNewline){ lines.push(''); }
  h.update(lines.join('\n'),'utf8');
  return h.digest('hex');
}

// Mutation helpers (import/add/remove/groom share)
export function isDuplicateInstructionWriteError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EEXIST') return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('unique constraint failed') || message.includes('duplicate key');
}

export function writeEntry(entry: InstructionEntry, opts?: { createOnly?: boolean }){
  const file = path.join(getInstructionsDir(), `${entry.id}.json`);
  // Establish firstSeenTs at the write boundary if the caller omitted it.
  // Semantically firstSeenTs ≤ createdAt always — for fresh entries this is
  // the correct value, and persisting it on disk avoids spurious
  // [invariant-repair] WARN spam on every subsequent getIndexState() poll
  // (RCA 2026-05-01 dev port 8687, third loop in chain after PR #285/#286).
  if(!entry.firstSeenTs){ entry.firstSeenTs = entry.createdAt || new Date().toISOString(); firstSeenAuthority[entry.id] = entry.firstSeenTs; }
  const classifier = new ClassificationService();
  let record = classifier.normalize(entry);
  if(record.owner === 'unowned'){ const auto = resolveOwner(record.id); if(auto){ record.owner = auto; record.updatedAt = new Date().toISOString(); } }
  record = assertValidInstructionRecord(record);
  // Run the SAME migration the loader runs on read so the write path is
  // symmetric with the read path. This brings legacy in-memory records
  // (carrying old schemaVersion or missing v3+ defaults) up to current
  // schema BEFORE validateForDisk gates them against the loader schema.
  // Without this, callers passing legacy records would be silently rejected
  // by the loader-symmetric validator even though the loader itself would
  // have migrated them transparently.
  migrateInstructionRecord(record as unknown as Record<string, unknown>);
  // Validate against the SAME JSON schema the loader uses at reload time.
  // This prevents schema drift from silently dropping entries on reload.
  const diskCheck = validateForDisk(record);
  if (!diskCheck.valid) {
    const err = new Error(`Pre-write loader-schema validation failed for '${entry.id}': ${diskCheck.errors?.join('; ')}`);
    (err as unknown as Record<string, unknown>).validationErrors = diskCheck.errors;
    (err as unknown as Record<string, unknown>).isInstructionValidation = true;
    throw err;
  }
  const store = getStoreForDir(getInstructionsDir());
  if (store) {
    store.write(record, opts);
  } else if (opts?.createOnly) {
    atomicCreateJson(file, record);
  } else {
    atomicWriteJson(file, record);
  }
  // Post-write read-back: verify the file on disk passes the loader schema
  if (!store) {
    try {
      const diskRaw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      const postCheck = validateForDisk(diskRaw);
      if (!postCheck.valid) {
        logWarn(`[writeEntry] Post-write validation FAILED for '${entry.id}': ${postCheck.errors?.join('; ')}`);
      }
    } catch (readErr) {
      logWarn(`[writeEntry] Post-write read-back failed for '${entry.id}': ${(readErr as Error).message}`);
    }
  }
  materializeWrittenEntry(record);
}

export async function writeEntryAsync(entry: InstructionEntry, opts?: { createOnly?: boolean }){
  const file = path.join(getInstructionsDir(), `${entry.id}.json`);
  // See writeEntry: establish firstSeenTs at the write boundary if missing.
  if(!entry.firstSeenTs){ entry.firstSeenTs = entry.createdAt || new Date().toISOString(); firstSeenAuthority[entry.id] = entry.firstSeenTs; }
  const classifier = new ClassificationService();
  let record = classifier.normalize(entry);
  if(record.owner === 'unowned'){ const auto = resolveOwner(record.id); if(auto){ record.owner = auto; record.updatedAt = new Date().toISOString(); } }
  record = assertValidInstructionRecord(record);
  // Mirror the loader's migration step before validating against the loader
  // schema. See writeEntry for full rationale.
  migrateInstructionRecord(record as unknown as Record<string, unknown>);
  // Validate against the SAME JSON schema the loader uses at reload time.
  const diskCheck = validateForDisk(record);
  if (!diskCheck.valid) {
    const err = new Error(`Pre-write loader-schema validation failed for '${entry.id}': ${diskCheck.errors?.join('; ')}`);
    (err as unknown as Record<string, unknown>).validationErrors = diskCheck.errors;
    (err as unknown as Record<string, unknown>).isInstructionValidation = true;
    throw err;
  }
  const store = getStoreForDir(getInstructionsDir());
  if (store) {
    store.write(record, opts);
  } else if (opts?.createOnly) {
    await atomicCreateJsonAsync(file, record);
  } else {
    await atomicWriteJsonAsync(file, record);
  }
  // Post-write read-back: verify the file on disk passes the loader schema
  if (!store) {
    try {
      const diskRaw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      const postCheck = validateForDisk(diskRaw);
      if (!postCheck.valid) {
        logWarn(`[writeEntryAsync] Post-write validation FAILED for '${entry.id}': ${postCheck.errors?.join('; ')}`);
      }
    } catch (readErr) {
      logWarn(`[writeEntryAsync] Post-write read-back failed for '${entry.id}': ${(readErr as Error).message}`);
    }
  }
  materializeWrittenEntry(record);
}
export function removeEntry(id:string){
  const dir = getInstructionsDir();
  const store = getStoreForDir(dir);
  if (store) { store.remove(id); }
  // Always also unlink the JSON file on disk. After auto-migration
  // (JSON → SQLite) both representations can coexist; deleting only the
  // sqlite row leaves an orphan JSON file that the IndexLoader path (used
  // when backend resolves to 'json' on a later ensureLoaded, or when
  // auto-migration re-triggers under a different latch key) will
  // resurrect on the next reload. Removing the file unconditionally keeps
  // the on-disk and in-store views consistent.
  const file = path.join(dir, `${id}.json`);
  try { if(fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
  markindexDirty();
}

// ── Archive lifecycle (spec 006 Phase C) ─────────────────────────────────────
// Embedding eviction hook — set by the embedding subsystem (or a test) to
// receive notifications when an instruction is archived or permanently purged.
// IndexContext does not import the embedding store directly: this keeps the
// dependency direction one-way (services → IndexContext) and makes the wiring
// trivially mockable in unit tests.
//
// Per plan §6:
//   - archive(id) → evict(id)   (drop the vector + entryHash; archived ids
//                                must not surface in semantic search)
//   - purge(id)   → evict(id)   (same reason — entry is irrecoverable)
//   - restore(id) → markStale(id) (vector retained but flagged for refresh;
//                                  body may have drifted relative to cache)
export interface EmbeddingEvictionHook {
  evict?(id: string): void;
  markStale?(id: string): void;
}
let embeddingEvictionHook: EmbeddingEvictionHook | null = null;
/**
 * Register a callback invoked when an entry is archived / purged / restored.
 * Best-effort: hook errors are swallowed so archive operations never fail
 * because of an embedding cache issue.
 */
export function setEmbeddingEvictionHook(hook: EmbeddingEvictionHook | null): void {
  embeddingEvictionHook = hook;
}
/** Test-only accessor for the currently registered hook. @internal */
export function _getEmbeddingEvictionHookForTests(): EmbeddingEvictionHook | null {
  return embeddingEvictionHook;
}
function safeEvictEmbedding(id: string): void {
  const hook = embeddingEvictionHook;
  if (!hook?.evict) return;
  try { hook.evict(id); } catch (err) {
    try { logWarn(`[archive] embedding evict('${id}') failed: ${err instanceof Error ? err.message : 'unknown'}`); } catch { /* ignore */ }
  }
}
export function safeMarkStaleEmbedding(id: string): void {
  const hook = embeddingEvictionHook;
  if (!hook?.markStale) return;
  try { hook.markStale(id); } catch (err) {
    try { logWarn(`[archive] embedding markStale('${id}') failed: ${err instanceof Error ? err.message : 'unknown'}`); } catch { /* ignore */ }
  }
}

// File-mode fallback paths (mirror removeEntry's pattern): when getStoreForDir
// returns null (factory failure), we operate on the .archive/<id>.json layout
// directly so callers in JSON-only environments still get a working API.
function archiveDirPath(): string { return path.join(getInstructionsDir(), '.archive'); }
function archiveFilePath(id: string): string { return path.join(archiveDirPath(), `${id}.json`); }
function ensureArchiveDirExists(): void {
  const dir = archiveDirPath();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function readArchiveFileFallback(id: string): InstructionEntry | null {
  const file = archiveFilePath(id);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw) as InstructionEntry;
    if (!parsed.id || !parsed.title || !parsed.body) return null;
    return parsed;
  } catch {
    return null;
  }
}

function archiveEntryFallback(id: string, meta?: ArchiveMeta): InstructionEntry {
  const activeFile = path.join(getInstructionsDir(), `${id}.json`);
  if (!fs.existsSync(activeFile)) {
    throw new Error(`archive: no active entry with id "${id}"`);
  }
  const raw = fs.readFileSync(activeFile, 'utf-8').replace(/^\uFEFF/, '');
  const active = JSON.parse(raw) as InstructionEntry;
  const archived: InstructionEntry = {
    ...active,
    archivedAt: meta?.archivedAt ?? new Date().toISOString(),
    archivedBy: meta?.archivedBy,
    archiveReason: meta?.archiveReason,
    archiveSource: meta?.archiveSource,
    restoreEligible: meta?.restoreEligible ?? true,
  };
  ensureArchiveDirExists();
  const archivePath = archiveFilePath(id);
  atomicWriteJson(archivePath, archived);
  try {
    fs.unlinkSync(activeFile);
  } catch (err) {
    try { if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath); } catch { /* swallow */ }
    throw err instanceof Error ? err : new Error('archive: failed to remove active file');
  }
  return archived;
}

function restoreEntryFallback(id: string, mode: RestoreMode): InstructionEntry {
  const archived = readArchiveFileFallback(id);
  if (!archived) {
    throw new Error(`restore: no archived entry with id "${id}"`);
  }
  if (archived.restoreEligible === false) {
    throw new Error(`restore: entry "${id}" is marked restoreEligible=false (ineligible)`);
  }
  const activePath = path.join(getInstructionsDir(), `${id}.json`);
  if (fs.existsSync(activePath) && mode !== 'overwrite') {
    throw new Error(`restore: active entry with id "${id}" already exists (collision)`);
  }
  const restored: InstructionEntry = { ...archived };
  delete restored.archivedAt;
  delete restored.archivedBy;
  delete restored.archiveReason;
  delete restored.archiveSource;
  delete restored.restoreEligible;
  const archivePath = archiveFilePath(id);
  atomicWriteJson(activePath, restored);
  try {
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
  } catch (err) {
    if (mode !== 'overwrite') {
      try { if (fs.existsSync(activePath)) fs.unlinkSync(activePath); } catch { /* swallow */ }
    }
    throw err instanceof Error ? err : new Error('restore: failed to remove archive file');
  }
  return restored;
}

function purgeEntryFallback(id: string): void {
  const file = archiveFilePath(id);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* no-op */ }
}

/**
 * Archive an active entry. Atomic at the storage layer (the entry never
 * appears in both active + archive sets at rest). Invalidates the in-memory
 * index and emits an embedding eviction so the archived id cannot surface
 * in semantic search results.
 *
 * @throws If no active entry with the given id exists.
 */
export function archiveEntry(id: string, meta?: ArchiveMeta): InstructionEntry {
  const store = getStoreForDir(getInstructionsDir());
  const archived = store ? store.archive(id, meta) : archiveEntryFallback(id, meta);
  invalidate();
  touchIndexVersion();
  safeEvictEmbedding(id);
  return archived;
}

/**
 * Restore an archived entry back to active storage.
 *
 * @param id - Archived id to restore.
 * @param opts.mode - Collision behaviour when an active entry already exists.
 *   Defaults to `'reject'`. Use `'overwrite'` to replace the active entry.
 *
 * @remarks Does NOT pre-compute the embedding (plan §6): the entry is marked
 * stale so the next refresh recomputes the vector. This keeps restore cheap.
 *
 * @throws If no archived entry exists, the entry is `restoreEligible:false`,
 *   or an active entry with the same id exists and `mode !== 'overwrite'`.
 */
export function restoreEntry(id: string, opts?: { mode?: RestoreMode }): InstructionEntry {
  const mode: RestoreMode = opts?.mode ?? 'reject';
  const store = getStoreForDir(getInstructionsDir());
  const restored = store ? store.restore(id, mode) : restoreEntryFallback(id, mode);
  invalidate();
  touchIndexVersion();
  safeMarkStaleEmbedding(id);
  return restored;
}

/**
 * Permanently delete an archived entry. Irreversible.
 * No-op if the id is not present in the archive store.
 */
export function purgeEntry(id: string): void {
  const store = getStoreForDir(getInstructionsDir());
  if (store) { store.purge(id); } else { purgeEntryFallback(id); }
  invalidate();
  touchIndexVersion();
  safeEvictEmbedding(id);
}

/**
 * Update an archived entry in place without round-tripping through the active
 * surface. The entry must already exist in the archive store; archive
 * metadata fields on `entry` are honored (callers should preserve them from
 * the original archived record).
 *
 * @throws If no archived entry exists with `entry.id`.
 */
export function updateArchivedEntry(entry: InstructionEntry): InstructionEntry {
  const id = entry.id;
  if (!id) throw new Error('updateArchivedEntry: entry.id is required');
  const store = getStoreForDir(getInstructionsDir());
  let updated: InstructionEntry;
  if (store) {
    updated = store.updateArchived(entry);
  } else {
    const file = archiveFilePath(id);
    if (!fs.existsSync(file)) {
      throw new Error(`updateArchived: no archived entry with id "${id}"`);
    }
    ensureArchiveDirExists();
    atomicWriteJson(file, entry);
    updated = entry;
  }
  touchIndexVersion();
  // Mark the embedding stale so a future restore-then-search picks up the
  // edited body. The archived id is currently evicted from active search, so
  // markStale is a forward-looking signal rather than an immediate refresh.
  safeMarkStaleEmbedding(id);
  return updated;
}

// ── Archive read accessors (no state mutation, no invalidation) ──────────────

/**
 * Read a single archived entry by id without touching the active cache.
 * @returns The archived entry, or `null` if not present.
 */
export function getArchivedEntry(id: string): InstructionEntry | null {
  const store = getStoreForDir(getInstructionsDir());
  if (store) return store.getArchived(id);
  return readArchiveFileFallback(id);
}

/**
 * List archived entries with optional filters. Does not invalidate the cache
 * or modify `state`.
 */
export function listArchivedEntries(opts?: ListArchivedOpts): InstructionEntry[] {
  const store = getStoreForDir(getInstructionsDir());
  if (store) return store.listArchived(opts);
  // Fallback path: walk the .archive directory directly using the same
  // filter / ordering rules as JsonFileStore.listArchived.
  const dir = archiveDirPath();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.') && !f.startsWith('_'));
  const out: InstructionEntry[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8').replace(/^\uFEFF/, '');
      const entry = JSON.parse(raw) as InstructionEntry;
      if (!entry.id || !entry.title || !entry.body) continue;
      out.push(entry);
    } catch { /* skip unreadable */ }
  }
  let result = out;
  if (opts?.reason) result = result.filter(e => e.archiveReason === opts.reason);
  if (opts?.source) result = result.filter(e => e.archiveSource === opts.source);
  if (opts?.archivedBy) result = result.filter(e => e.archivedBy === opts.archivedBy);
  if (opts?.restoreEligible !== undefined) {
    result = result.filter(e => (e.restoreEligible ?? true) === opts.restoreEligible);
  }
  result.sort((a, b) => {
    const ta = a.archivedAt ?? '';
    const tb = b.archivedAt ?? '';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.id.localeCompare(b.id);
  });
  if (opts?.offset) result = result.slice(opts.offset);
  if (opts?.limit !== undefined) result = result.slice(0, opts.limit);
  return result;
}

/**
 * Return active + archive governance hashes without invalidating the cache.
 * Active hash uses the same projection as `computeHash()`; archive hash uses
 * `computeArchiveHash()`. Identical sets across backends yield identical
 * hashes (REQ-13).
 */
export function computeActiveAndArchiveHashes(): { active: string; archive: string } {
  const store = getStoreForDir(getInstructionsDir());
  if (store) {
    return { active: store.computeHash(), archive: store.computeArchiveHash() };
  }
  // File-mode fallback: derive active hash from the loaded state (already
  // computed by IndexLoader), and archive hash from listArchivedEntries.
  const active = ensureLoaded().hash;
  // Lazy-import to avoid a circular type dependency.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { computeArchiveHashFromEntries } = require('./storage/hashUtils') as {
    computeArchiveHashFromEntries: (entries: InstructionEntry[]) => string;
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { active, archive: computeArchiveHashFromEntries(listArchivedEntries()) };
}
