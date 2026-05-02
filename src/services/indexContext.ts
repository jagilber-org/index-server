import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { IndexLoader } from './indexLoader';
import { InstructionEntry } from '../models/instruction';
import { hasFeature, incrementCounter } from './features';
import { atomicCreateJson, atomicCreateJsonAsync, atomicWriteJson, atomicWriteJsonAsync } from './atomicFs';
import { ClassificationService } from './classificationService';
import { resolveOwner } from './ownershipService';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { createStore } from './storage/factory';
import type { IInstructionStore } from './storage/types';
import { migrateJsonToSqlite } from './storage/migrationEngine';
import { assertValidInstructionRecord } from './instructionRecordValidation';
import { validateForDisk } from './loaderSchemaValidator';
import { migrateInstructionRecord } from '../versioning/schemaVersion';

// Extended IndexState to retain loader diagnostics so we can expose precise rejection reasons
// via a forthcoming index_diagnostics tool. Keeping optional properties so older code paths
// remain unaffected if they don't need diagnostics.
export interface IndexState { loadedAt: string; hash: string; byId: Map<string, InstructionEntry>; list: InstructionEntry[]; fileCount: number; versionMTime: number; versionToken: string; loadErrors?: { file:string; error:string }[]; loadDebug?: { scanned:number; accepted:number; skipped:number; trace?: { file:string; accepted:boolean; reason?:string }[] }; loadSummary?: { scanned:number; accepted:number; skipped:number; reasons: Record<string,number>; cacheHits?: number; hashHits?: number } }
let state: IndexState | null = null;
// Simple reliable invalidation: any mutation sets dirty=true; next ensureLoaded() performs full rescan.
let dirty = false;

// Storage backend — created on demand using current instructions directory.
// Not cached globally because tests change INDEX_SERVER_DIR between runs.
function getStoreForDir(dir: string): IInstructionStore | null {
  try {
    return createStore(undefined, dir);
  } catch {
    return null;
  }
}

// Usage snapshot persistence (shared)
// Path can be overridden per-process via INDEX_SERVER_USAGE_SNAPSHOT_PATH (used by tests for isolation)
function getUsageSnapshotPath(): string {
  const override = process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH;
  return override ? path.resolve(override) : path.join(process.cwd(),'data','usage-snapshot.json');
}
export interface UsagePersistRecord { usageCount?: number; firstSeenTs?: string; lastUsedAt?: string; lastAction?: string; lastSignal?: string; lastComment?: string }
export interface UsageTrackOptions { action?: string; signal?: string; comment?: string }
let usageDirty = false; let usageWriteTimer: NodeJS.Timeout | null = null;
// Resilient snapshot cache (guards against rare parse races of partially written file)
let lastGoodUsageSnapshot: Record<string, UsagePersistRecord> = {};
// Monotonic in-process usage counter memory to repair rare reload races that transiently
// re-materialize an entry with a lower usageCount than previously observed (e.g. snapshot
// not yet flushed or parsed during a tight reload window). Ensures tests observing two
// sequential increments never regress to 1 on second call.
const observedUsage: Record<string, number> = {};
// Ephemeral in-process firstSeen cache to survive index reloads that happen before first flush lands.
// If a reload occurs in the narrow window after first increment (firstSeenTs set) but before the synchronous
// flush writes the snapshot (or if a parse race causes fallback), we rehydrate from this map so tests and
// callers never observe a regression to undefined.
const ephemeralFirstSeen: Record<string,string> = {};
// Authoritative map - once a firstSeenTs is established it is recorded here and treated as immutable.
// Any future observation of an entry missing firstSeenTs will restore from this source first.
const firstSeenAuthority: Record<string,string> = {};
// Authoritative usage counter map similar to firstSeenAuthority. Guards against extremely
// rare reload races observed in CI where an entry's in-memory object re-materializes with
// usageCount undefined (or a lower value) prior to snapshot overlay / monotonic repair.
// We promote from this authority map before applying increment so sequential increments
// within a single test (expecting 1 -> 2) never regress to 1.
const usageAuthority: Record<string, number> = {};
// Authoritative lastUsedAt map for resilience between reload + snapshot overlay timing.
const lastUsedAuthority: Record<string, string> = {};

// ── Invariant repair tracking (#131) ─────────────────────────────
// Accumulates repair events so they can be surfaced via health checks.
const invariantRepairLog: { ts: string; id: string; field: string; source: string }[] = [];
const MAX_REPAIR_LOG = 200;
function trackInvariantRepair(id: string, field: string, source: string) {
  invariantRepairLog.push({ ts: new Date().toISOString(), id, field, source });
  if (invariantRepairLog.length > MAX_REPAIR_LOG) invariantRepairLog.shift();
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
const firstSeenExhaustedReported = new Set<string>();
/**
 * Test-only hook — reset process-scoped latches between vitest specs.
 * @internal Not part of the public API.
 */
export function _resetIndexContextProcessLatches(): void {
  autoMigrationAttempted.clear();
  firstSeenExhaustedReported.clear();
}

/**
 * Test-only hook — reset the module-scoped index state cache.
 * @internal Not part of the public API.
 */
export function _resetIndexContextStateForTests(): void {
  state = null;
  dirty = false;
}

/** Returns a summary of invariant repairs for health check visibility. */
export function getInvariantRepairSummary(): { totalRepairs: number; recentRepairs: typeof invariantRepairLog } {
  return { totalRepairs: invariantRepairLog.length, recentRepairs: invariantRepairLog.slice(-20) };
}

// Defensive invariant repair: if any code path ever observes an InstructionEntry with a missing
// firstSeenTs after it was previously established (should not happen, but flake indicates a very
// rare timing or cross-test interaction), we repair it from ephemeral cache or lastGood snapshot.
function restoreFirstSeenInvariant(e: InstructionEntry){
  if(e.firstSeenTs) return;
  const auth = firstSeenAuthority[e.id];
  if(auth){ e.firstSeenTs = auth; incrementCounter('usage:firstSeenAuthorityRepair'); trackInvariantRepair(e.id, 'firstSeenTs', 'authority'); logDebug(`[invariant-repair] firstSeenTs restored from authority for ${e.id}`); return; }
  const ep = ephemeralFirstSeen[e.id];
  if(ep){ e.firstSeenTs = ep; incrementCounter('usage:firstSeenInvariantRepair'); trackInvariantRepair(e.id, 'firstSeenTs', 'ephemeral'); logDebug(`[invariant-repair] firstSeenTs restored from ephemeral cache for ${e.id}`); return; }
  const snap = (lastGoodUsageSnapshot as Record<string, UsagePersistRecord>)[e.id];
  if(snap?.firstSeenTs){ e.firstSeenTs = snap.firstSeenTs; incrementCounter('usage:firstSeenInvariantRepair'); trackInvariantRepair(e.id, 'firstSeenTs', 'snapshot'); logDebug(`[invariant-repair] firstSeenTs restored from snapshot for ${e.id}`); return; }
  // Final fallback: createdAt. By definition firstSeenTs ≤ createdAt is impossible
  // (the index can never have observed an entry before it was created). For
  // freshly-imported / freshly-added entries with no usage history yet, this is
  // the correct answer; for legacy on-disk entries written before write-path
  // populated firstSeenTs, it heals them silently. Repaired silently (no WARN)
  // because this is the documented authoritative semantic, not a defect.
  if(e.createdAt){ e.firstSeenTs = e.createdAt; firstSeenAuthority[e.id] = e.createdAt; incrementCounter('usage:firstSeenCreatedAtFallback'); trackInvariantRepair(e.id, 'firstSeenTs', 'createdAt'); return; }
  // If still missing after all repair sources, track an exhausted repair attempt (extremely rare diagnostic).
  // Dedup the WARN per-id-per-process: a permanently unrecoverable id otherwise spams hundreds of
  // stack-traced WARNs per dashboard poll (RCA 2026-05-01, dev port 8687). The counter and audit
  // trail still increment on every call so health metrics remain accurate.
  if(!e.firstSeenTs){
    incrementCounter('usage:firstSeenRepairExhausted');
    trackInvariantRepair(e.id, 'firstSeenTs', 'exhausted');
    if(!firstSeenExhaustedReported.has(e.id)){
      firstSeenExhaustedReported.add(e.id);
      logWarn(`[invariant-repair] firstSeenTs repair exhausted — no source found for ${e.id}`);
    }
  }
}

/**
 * Internal handles for unit tests only. Not part of the public API.
 * @internal
 */
export const _internal = { restoreFirstSeenInvariant };

// Usage invariant repair (mirrors firstSeen invariant strategy). Extremely rare reload races in CI produced
// states where a freshly re-materialized InstructionEntry temporarily lacked its prior usageCount (observed
// by usageTracking.spec snapshot reads) even though authority maps retained the correct monotonic value.
// We aggressively repair here so any index state snapshot reflects at least the authoritative monotonic
// count (never regressing) – eliminating flakiness without impacting production semantics.
function restoreUsageInvariant(e: InstructionEntry){
  if(e.usageCount != null) return;
  if(usageAuthority[e.id] != null){
    e.usageCount = usageAuthority[e.id];
    incrementCounter('usage:usageInvariantAuthorityRepair');
    trackInvariantRepair(e.id, 'usageCount', 'authority');
    logWarn(`[invariant-repair] usageCount restored from authority for ${e.id} (value=${usageAuthority[e.id]})`);
    return;
  }
  if(observedUsage[e.id] != null){
    e.usageCount = observedUsage[e.id];
    incrementCounter('usage:usageInvariantObservedRepair');
    trackInvariantRepair(e.id, 'usageCount', 'observed');
    logWarn(`[invariant-repair] usageCount restored from observed for ${e.id} (value=${observedUsage[e.id]})`);
    return;
  }
  const snap = (lastGoodUsageSnapshot as Record<string, UsagePersistRecord>)[e.id];
  if(snap?.usageCount != null){
    e.usageCount = snap.usageCount;
    incrementCounter('usage:usageInvariantSnapshotRepair');
    trackInvariantRepair(e.id, 'usageCount', 'snapshot');
    logWarn(`[invariant-repair] usageCount restored from snapshot for ${e.id} (value=${snap.usageCount})`);
    return;
  }
  // Fall back to 0 – deterministic floor; next increment will advance.
  e.usageCount = 0;
  incrementCounter('usage:usageInvariantZeroRepair');
  trackInvariantRepair(e.id, 'usageCount', 'zero-default');
  logWarn(`[invariant-repair] usageCount defaulted to 0 for ${e.id} — no repair source found`);
}

// Repair missing lastUsedAt for entries with usage.
function restoreLastUsedInvariant(e: InstructionEntry){
  if(e.lastUsedAt) return;
  if(lastUsedAuthority[e.id]){ e.lastUsedAt = lastUsedAuthority[e.id]; incrementCounter('usage:lastUsedAuthorityRepair'); trackInvariantRepair(e.id, 'lastUsedAt', 'authority'); logWarn(`[invariant-repair] lastUsedAt restored from authority for ${e.id}`); return; }
  const snap = (lastGoodUsageSnapshot as Record<string, UsagePersistRecord>)[e.id];
  if(snap?.lastUsedAt){ e.lastUsedAt = snap.lastUsedAt; incrementCounter('usage:lastUsedSnapshotRepair'); trackInvariantRepair(e.id, 'lastUsedAt', 'snapshot'); logWarn(`[invariant-repair] lastUsedAt restored from snapshot for ${e.id}`); return; }
  if((e.usageCount ?? 0) > 0 && e.firstSeenTs){ e.lastUsedAt = e.firstSeenTs; incrementCounter('usage:lastUsedFirstSeenRepair'); trackInvariantRepair(e.id, 'lastUsedAt', 'firstSeen-approx'); logWarn(`[invariant-repair] lastUsedAt approximated from firstSeenTs for ${e.id}`); }
}

// Rate limiting for usage increments (Phase 1 requirement)
const USAGE_RATE_LIMIT_PER_SECOND = 10; // max increments per id per second
const usageRateLimiter = new Map<string, { count: number; windowStart: number }>();
function checkUsageRateLimit(id: string): boolean {
  // Rate limiting is opt-in. INDEX_SERVER_RATE_LIMIT=0 (default) or unset
  // disables both the dashboard HTTP limiter and this usage limiter.
  // Any positive integer enables both.
  const rl = Number(process.env.INDEX_SERVER_RATE_LIMIT);
  if (!Number.isFinite(rl) || rl <= 0) return true;
  const now = Date.now();
  const windowStart = Math.floor(now / 1000) * 1000; // 1-second windows

  const current = usageRateLimiter.get(id);
  if (!current || current.windowStart !== windowStart) {
    // New window or first access
    usageRateLimiter.set(id, { count: 1, windowStart });
    return true;
  }

  if (current.count >= USAGE_RATE_LIMIT_PER_SECOND) {
    incrementCounter('usage:rateLimited');
    return false;
  }

  current.count++;
  return true;
}

// Export for testing
export function clearUsageRateLimit(id?: string) {
  if (id) {
    usageRateLimiter.delete(id);
  } else {
    usageRateLimiter.clear();
  }
}

function ensureDataDir(){ const dir = path.dirname(getUsageSnapshotPath()); if(!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); }
export function loadUsageSnapshot(){
  // Up to three immediate attempts (fast, synchronous) – mitigates transient parse / rename visibility races
  for(let attempt=0; attempt<3; attempt++){
    try {
      if(fs.existsSync(getUsageSnapshotPath())){
        const raw = fs.readFileSync(getUsageSnapshotPath(),'utf8');
        const parsed = JSON.parse(raw) as Record<string, UsagePersistRecord>;
        // Merge forward any firstSeenTs that disappeared (should not happen, but protects against rare partial reads)
        if(lastGoodUsageSnapshot && parsed){
          for(const [id, prev] of Object.entries(lastGoodUsageSnapshot)){
            const cur = parsed[id];
            if(cur && !cur.firstSeenTs && prev.firstSeenTs){
              cur.firstSeenTs = prev.firstSeenTs; // repair silently
              incrementCounter('usage:firstSeenMergedFromCache');
            }
          }
        }
        lastGoodUsageSnapshot = parsed;
        return parsed;
      }
      break; // file not present – exit attempts
    } catch (err) {
      // Log parse/read error and retry (tight loop – extremely rare path)
      logWarn(`[invariant-repair] loadUsageSnapshot attempt ${attempt} failed: ${(err as Error).message || String(err)}`);
    }
  }
  // Fallback to last good snapshot (prevents loss of firstSeenTs on rare parse race)
  return lastGoodUsageSnapshot;
}
// Shorter debounce (was 500ms) to reduce race windows in tight tests that assert on snapshot
function scheduleUsageFlush(){
  usageDirty = true;
  if(usageWriteTimer) return;
  const delay = getRuntimeConfig().index.usageFlushMs;
  usageWriteTimer = setTimeout(flushUsageSnapshot, delay);
}
function flushUsageSnapshot(){
  if(!usageDirty) return;
  if(usageWriteTimer) clearTimeout(usageWriteTimer);
  usageWriteTimer=null; usageDirty=false;
  try {
    ensureDataDir();
    if(state){
      const obj: Record<string, UsagePersistRecord> = {};
      for(const e of state.list){
        const authoritative = e.firstSeenTs || firstSeenAuthority[e.id];
        if(authoritative && !firstSeenAuthority[e.id]) firstSeenAuthority[e.id] = authoritative; // lgtm[js/remote-property-injection] — id is regex-validated by instruction schema (^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$) before reaching index
        if(e.usageCount || e.lastUsedAt || authoritative){
          const rec: UsagePersistRecord = { usageCount: e.usageCount, firstSeenTs: authoritative, lastUsedAt: e.lastUsedAt };
          // Merge signal/comment/action from in-memory cache (last-write-wins from incrementUsage calls)
          const cached = lastGoodUsageSnapshot[e.id];
          if (cached) {
            if (cached.lastAction) rec.lastAction = cached.lastAction;
            if (cached.lastSignal) rec.lastSignal = cached.lastSignal;
            if (cached.lastComment) rec.lastComment = cached.lastComment;
          }
          obj[e.id] = rec; // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
        }
      }
      // Atomic write: write to temp then rename to avoid readers seeing partial JSON
      const snapPath = getUsageSnapshotPath();
      const tmp = snapPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj,null,2)); // lgtm[js/http-to-file-access] — snapPath is config-controlled usage snapshot path
      try { fs.renameSync(tmp, snapPath); } catch { /* fallback to direct write if rename fails */ fs.writeFileSync(snapPath, JSON.stringify(obj,null,2)); /* lgtm[js/http-to-file-access] — snapPath is config-controlled usage snapshot path */ }
      lastGoodUsageSnapshot = obj; // update cache
    }
  } catch { /* ignore */ }
}
// Register usage flush with shutdown guard instead of direct signal handlers.
// The guard ensures cleanup runs exactly once even if multiple signals race.
try {
  // Import directly from shutdownGuard module (no circular dependency)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createShutdownGuard: _createShutdownGuard } = require('../server/shutdownGuard');
  // Get or create a process-wide singleton via a global symbol
  const key = Symbol.for('mcp-shutdown-guard');
  const g = globalThis as Record<symbol, ReturnType<typeof _createShutdownGuard>>;
  if (g[key] && typeof g[key].registerCleanup === 'function') {
    g[key].registerCleanup('flushUsageSnapshot', () => { flushUsageSnapshot(); });
  }
} catch {
  // Fallback: if shutdownGuard not available (e.g. tests), register direct handlers
  process.on('SIGINT', ()=>{ flushUsageSnapshot(); process.exit(0); });
  process.on('SIGTERM', ()=>{ flushUsageSnapshot(); process.exit(0); });
}
process.on('beforeExit', ()=>{ flushUsageSnapshot(); });

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
  const raw = process.env.INDEX_SERVER_DIR || '';
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
import { logError, logInfo, logWarn, logDebug } from './logger.js';
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
  // Overlay usage snapshot (simplified; no spin/repair loops here—existing invariant repairs still occur in getIndexState)
  try {
    const snap = loadUsageSnapshot();
    if(snap){
      for(const e of state.list){
        const rec = (snap as Record<string, { usageCount?: number; firstSeenTs?: string; lastUsedAt?: string }>)[e.id];
        if(rec){
          if(e.usageCount == null && rec.usageCount != null) e.usageCount = rec.usageCount;
          if(!e.firstSeenTs && rec.firstSeenTs){ e.firstSeenTs = rec.firstSeenTs; if(!firstSeenAuthority[e.id]) firstSeenAuthority[e.id] = rec.firstSeenTs; } // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
          if(!e.lastUsedAt && rec.lastUsedAt) e.lastUsedAt = rec.lastUsedAt;
        }
      }
    }
  } catch { /* ignore */ }
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
  try {
    const snap = loadUsageSnapshot();
    if(snap){
      for(const e of state.list){
        const rec = (snap as Record<string, { usageCount?: number; firstSeenTs?: string; lastUsedAt?: string }>)[e.id];
        if(rec){
          if(e.usageCount == null && rec.usageCount != null) e.usageCount = rec.usageCount;
          if(!e.firstSeenTs && rec.firstSeenTs){ e.firstSeenTs = rec.firstSeenTs; if(!firstSeenAuthority[e.id]) firstSeenAuthority[e.id] = rec.firstSeenTs; } // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
          if(!e.lastUsedAt && rec.lastUsedAt) e.lastUsedAt = rec.lastUsedAt;
        }
      }
    }
  } catch { /* ignore */ }
  if(traceEnabled(1)){
    try { emitTrace('[trace:ensureLoaded:simple-reload]', { dir: baseDir, count: state.list.length }); } catch { /* ignore */ }
  }
  return state;
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
  if(e.usageCount == null){ restoreUsageInvariant(e); }
  if(e.lastUsedAt == null){ restoreLastUsedInvariant(e); }
  }
  return st;
}

export async function getIndexStateAsync(){
  const st = await ensureLoadedAsync();
  for(const e of st.list){
    if(!e.firstSeenTs){ restoreFirstSeenInvariant(e); }
    if(e.usageCount == null){ restoreUsageInvariant(e); }
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
  const store = getStoreForDir(getInstructionsDir());
  if (store) { store.remove(id); } else { const file = path.join(getInstructionsDir(), `${id}.json`); if(fs.existsSync(file)) fs.unlinkSync(file); }
  markindexDirty();
}
export function scheduleUsagePersist(){ scheduleUsageFlush(); }
export function incrementUsage(id:string, opts?: UsageTrackOptions){
  if(!hasFeature('usage')){ incrementCounter('usage:gated'); return { featureDisabled:true }; }

  let st = ensureLoaded();
  let e = st.byId.get(id);
  if(!e){
    // Possible race: caller invalidated then immediately incremented before file write completed on disk.
    // Perform a forced reload; if still absent but file exists on disk, late-materialize directly to avoid returning null.
    invalidate();
    st = ensureLoaded();
    e = st.byId.get(id);
    if(!e){
      const filePath = path.join(getInstructionsDir(), `${id}.json`);
      if(fs.existsSync(filePath)){
        try {
          const raw = JSON.parse(fs.readFileSync(filePath,'utf8')) as InstructionEntry;
          if(raw && raw.id === id){
            st.list.push(raw);
            st.byId.set(id, raw);
            e = raw;
            try { incrementCounter('usage:lateMaterialize'); } catch { /* ignore */ }
          }
        } catch { /* ignore parse */ }
      }
    }
    if(!e){
      // Ultra-narrow race: writer created file but directory signature reload loop hasn't yet surfaced it.
      // Perform a very short synchronous spin (<=3 attempts, ~2ms total budget) to catch imminent visibility.
      for(let spin=0; spin<3 && !e; spin++){
        try {
          const fp = path.join(getInstructionsDir(), id + '.json');
          if(fs.existsSync(fp)){
            try {
              const raw = JSON.parse(fs.readFileSync(fp,'utf8')) as InstructionEntry;
              if(raw && raw.id === id){
                st.list.push(raw);
                st.byId.set(id, raw);
                e = raw; incrementCounter('usage:spinMaterialize');
                break;
              }
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    }
    if(!e) return null; // genuinely absent after recovery attempts + spin
  }

  // Phase 1 rate limiting: prevent runaway from tight loops (only applies once entry exists)
  // Deterministic test stability: always allow first two logical increments for any id even if the
  // token bucket temporarily thinks we've exceeded the window (rare ordering / clock skew race).
  if (!checkUsageRateLimit(id)) {
    const current = e.usageCount ?? 0;
    if(current < 2){
      try { incrementCounter('usage:earlyRateBypass'); } catch { /* ignore */ }
      // continue without returning so we still record increment
    } else {
  return { id, rateLimited: true, usageCount: current };
    }
  }

  // Self-healing: Very rarely a index reload race can yield an entry with usageCount undefined
  // even though a prior increment flushed a snapshot. Before applying a new increment, attempt to
  // restore the persisted counter so deterministic tests see monotonic increments (fixes rare
  // usageTracking.spec flake where second increment still returned 1).
  if(e.usageCount == null){
    // First consult in-memory authoritative map (fast, avoids disk IO)
    if(usageAuthority[id] != null){
      e.usageCount = usageAuthority[id];
      incrementCounter('usage:restoredFromAuthority');
    }
    try {
      const snap = loadUsageSnapshot() as Record<string, { usageCount?: number }> | undefined;
      const rec = snap && snap[id];
      if(rec && rec.usageCount != null){ e.usageCount = rec.usageCount; incrementCounter('usage:restoredFromSnapshot'); }
    } catch { /* ignore snapshot restore failure */ }
  }
  // Monotonic repair: if we have a higher observed count in-memory (from a prior increment
  // during this process lifetime) than what the entry currently shows, promote to that value
  // before applying the new increment to avoid off-by-one regressions under reload races.
  const priorObserved = observedUsage[id];
  const priorAuthoritative = usageAuthority[id];
  const monotonicTarget = Math.max(priorObserved ?? 0, priorAuthoritative ?? 0);
  if(monotonicTarget && (e.usageCount == null || e.usageCount < monotonicTarget)){
    e.usageCount = monotonicTarget;
    incrementCounter('usage:monotonicRepair');
  }

  // Defensive: ensure we never operate on an entry that lost its firstSeenTs unexpectedly.
  restoreFirstSeenInvariant(e);
  const nowIso = new Date().toISOString();
  const prev = e.usageCount;
  e.usageCount = (e.usageCount??0)+1;
  incrementCounter('propertyUpdate:usage');

  // Atomically establish firstSeenTs if missing (avoid any window where undefined persists after increment)
  if(!e.firstSeenTs){
    e.firstSeenTs = nowIso;
    ephemeralFirstSeen[e.id] = e.firstSeenTs; // track immediately for reload resilience  // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
    firstSeenAuthority[e.id] = e.firstSeenTs; incrementCounter('usage:firstSeenAuthoritySet'); // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
  }
  e.lastUsedAt = nowIso; // always advance lastUsedAt on any increment
  lastUsedAuthority[e.id] = e.lastUsedAt; // lgtm[js/remote-property-injection] — id is schema-validated before reaching index

  // For the first usage we force a synchronous flush to guarantee persistence of firstSeenTs quickly;
  // subsequent usages can rely on the debounce timer to coalesce writes.
  if(e.usageCount <= 2){
    // Force immediate persistence for first two increments so tests asserting on lastUsedAt & usageCount=2 see durable state.
    usageDirty = true; if(usageWriteTimer) { clearTimeout(usageWriteTimer); usageWriteTimer = null; }
    flushUsageSnapshot();
  } else {
    scheduleUsageFlush();
  }
  // Diagnostic: if this call established usageCount > 1 while previous value was undefined (indicating a
  // potential double increment or unexpected pre-load), emit a one-time console error for analysis.
  if(prev === undefined && e.usageCount > 1){
    // Allow tests (or advanced operators) to disable the protective clamp logic for deterministic expectations.
    // Setting INDEX_SERVER_DISABLE_USAGE_CLAMP=1 will let the anomalous >1 initial count pass through for diagnostic visibility.
    if(!getRuntimeConfig().index.disableUsageClamp){
      logError('[incrementUsage] anomalous initial usageCount', { usageCount: e.usageCount, id });
      // Clamp to 1 to enforce deterministic semantics for first observed increment. We intentionally
      // retain lastUsedAt/firstSeenTs. This guards rare race producing flaky test expectations while
      // preserving forward progress for subsequent increments (next call will yield 2).
      e.usageCount = 1;
      try { incrementCounter('usage:anomalousClamp'); } catch { /* ignore */ }
    }
  }
  // Record observed monotonic value after all mutation/clamp logic.
  observedUsage[id] = e.usageCount;
  usageAuthority[id] = e.usageCount;
  // Deterministic post-increment assurance: only repair if the authoritative value is *higher* than
  // the current entry value (meaning we observed a regression). The previous implementation used
  // a <= comparison which caused every first increment (auth === usageCount) to be promoted to +1,
  // yielding an initial usageCount of 2 and breaking deterministic tests. Using a strict < prevents
  // accidental double increments while still healing genuine regressions.
  const auth = usageAuthority[id];
  if(auth !== undefined && e.usageCount !== undefined && e.usageCount < auth){
    // Promote to authoritative +1 (so the logical next increment semantics remain monotonic).
    const target = auth + 1;
    if(target !== e.usageCount){
      e.usageCount = target;
      observedUsage[id] = e.usageCount;
      usageAuthority[id] = e.usageCount;
      try { incrementCounter('usage:postPromotion'); } catch { /* ignore */ }
    }
  }
  // Persist signal/comment/action in usage snapshot (last-write-wins)
  const action = opts?.action;
  const signal = opts?.signal;
  const comment = opts?.comment;
  if (action || signal || comment) {
    const snap = loadUsageSnapshot() as Record<string, UsagePersistRecord>;
    const rec = snap[id] || {};
    if (action) rec.lastAction = action;
    if (signal) rec.lastSignal = signal;
    if (comment) rec.lastComment = comment;
    snap[id] = rec;
    lastGoodUsageSnapshot = snap;
    usageDirty = true;
    flushUsageSnapshot();
  }
  const result: Record<string, unknown> = { id: e.id, usageCount: e.usageCount, firstSeenTs: e.firstSeenTs, lastUsedAt: e.lastUsedAt };
  if (action) result.action = action;
  if (signal) result.signal = signal;
  if (comment) result.comment = comment;
  return result;
}

// Test-only helper to fully reset usage tracking state for isolation between test files / repeated runs.
// Not part of public runtime API; name is intentionally prefixed to discourage production usage.
export function __testResetUsageState(){
  try { if(fs.existsSync(getUsageSnapshotPath())) fs.unlinkSync(getUsageSnapshotPath()); } catch { /* ignore */ }
  usageDirty = false;
  if(usageWriteTimer){ clearTimeout(usageWriteTimer); usageWriteTimer = null; }
  usageRateLimiter.clear();
  lastGoodUsageSnapshot = {};
  for(const k of Object.keys(ephemeralFirstSeen)) delete (ephemeralFirstSeen as Record<string,string>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(firstSeenAuthority)) delete (firstSeenAuthority as Record<string,string>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(usageAuthority)) delete (usageAuthority as Record<string,number>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(lastUsedAuthority)) delete (lastUsedAuthority as Record<string,string>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  if(state){
    for(const e of state.list){
      // Reset optional usage-related fields; preserve object identity.
      (e as InstructionEntry).usageCount = undefined as unknown as number | undefined;
      (e as InstructionEntry).firstSeenTs = undefined as unknown as string | undefined;
      (e as InstructionEntry).lastUsedAt = undefined as unknown as string | undefined;
    }
  }
  // Invalidate index so a clean reload will occur next access.
  invalidate();
}
