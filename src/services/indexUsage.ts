/**
 * Usage tracking subsystem for the instruction index.
 *
 * Split out of indexContext.ts (#461, finding F-003) to keep that module under the
 * CQ-1 size ceiling. This is a faithful, behavior-preserving move — the logic is
 * unchanged. It owns the usage counters, split-counter authority maps, firstSeen /
 * usageCount / lastUsedAt invariant repair, usage-snapshot persistence, and per-id
 * rate limiting.
 *
 * Dependency note: this module and indexContext.ts form a *runtime-only* import
 * cycle. indexContext imports the invariant-repair functions (called during index
 * materialization), and this module reads the raw index state via
 * `getRawIndexState()` and calls `ensureLoaded` / `invalidate` / `getInstructionsDir`.
 * All cross-calls happen at call time, not module-load time, so CommonJS resolves
 * the cycle correctly.
 */
import fs from 'fs';
import path from 'path';
import { InstructionEntry, SignalHistoryItem, mergeSignalHistory } from '../models/instruction';
import { hasFeature, incrementCounter } from './features';
import { recordActivity } from './activityLog';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { rawIndexFeaturesSetting } from '../config/featureConfig';
import { logWarn, logDebug } from './logger.js';
import { resolveUsageKind, type UsageKind } from './usageCounters';
import { getRawIndexState, ensureLoaded, invalidate, getInstructionsDir } from './indexContext';
import { readPersistedUsage, writePersistedUsage, closeUsagePersistence } from './usagePersistence';
import { resolveUsageSnapshotPath } from './storage/usageSnapshotFile';

// Usage snapshot persistence (shared)
// Path can be overridden per-process via INDEX_SERVER_USAGE_SNAPSHOT_PATH (used by tests for isolation)
function getUsageSnapshotPath(): string {
  // Single source of truth — shared with the migration engine so both agree on
  // which file holds the JSON backend's counters.
  return resolveUsageSnapshotPath();
}
export interface UsagePersistRecord { usageCount?: number; retrievedCount?: number; appliedCount?: number; firstSeenTs?: string; lastUsedAt?: string; lastRetrievedAt?: string; lastAppliedAt?: string; lastAction?: string; lastSignal?: string; lastComment?: string; lastSignaledAt?: string; signalHistory?: SignalHistoryItem[] }
export interface UsageTrackOptions { action?: string; signal?: string; comment?: string; kind?: 'retrieved' | 'applied' }
let usageDirty = false; let usageWriteTimer: NodeJS.Timeout | null = null;
// Resilient snapshot cache (guards against rare parse races of partially written file)
let lastGoodUsageSnapshot: Record<string, UsagePersistRecord> = {};
// Monotonic in-process usage counter memory to repair rare reload races that transiently
// re-materialize an entry with a lower usageCount than previously observed (e.g. snapshot
// not yet flushed or parsed during a tight reload window). Ensures tests observing two
// sequential increments never regress to 1 on second call.
const observedUsage: Record<string, number> = {};
// Ephemeral in-process firstSeen cache to survive index reloads that happen before first flush lands.
const ephemeralFirstSeen: Record<string,string> = {};
// Authoritative map - once a firstSeenTs is established it is recorded here and treated as immutable.
// Exported because indexContext's write/overlay paths also record firstSeen authority (shared by reference).
export const firstSeenAuthority: Record<string,string> = {};
// Authoritative usage counter map similar to firstSeenAuthority.
const usageAuthority: Record<string, number> = {};
// Authoritative lastUsedAt map for resilience between reload + snapshot overlay timing.
const lastUsedAuthority: Record<string, string> = {};
// Split-counter authority maps (issue #418): per-counter monotonic floors mirroring usageAuthority.
const retrievedAuthority: Record<string, number> = {};
const appliedAuthority: Record<string, number> = {};
const lastRetrievedAuthority: Record<string, string> = {};
const lastAppliedAuthority: Record<string, string> = {};

// ── Invariant repair tracking (#131) ─────────────────────────────
const invariantRepairLog: { ts: string; id: string; field: string; source: string }[] = [];
const MAX_REPAIR_LOG = 200;
function trackInvariantRepair(id: string, field: string, source: string) {
  invariantRepairLog.push({ ts: new Date().toISOString(), id, field, source });
  if (invariantRepairLog.length > MAX_REPAIR_LOG) invariantRepairLog.shift();
}

// Process-scoped latch for firstSeen repair-exhausted WARN dedup (RCA 2026-05-01, dev port 8687).
const firstSeenExhaustedReported = new Set<string>();
/** Test-only hook — reset the usage process latch between vitest specs. @internal */
export function resetUsageProcessLatches(): void {
  firstSeenExhaustedReported.clear();
}

/** Returns a summary of invariant repairs for health check visibility. */
export function getInvariantRepairSummary(): { totalRepairs: number; recentRepairs: typeof invariantRepairLog } {
  return { totalRepairs: invariantRepairLog.length, recentRepairs: invariantRepairLog.slice(-20) };
}

// Defensive invariant repair: if any code path ever observes an InstructionEntry with a missing
// firstSeenTs after it was previously established, repair it from ephemeral cache or lastGood snapshot.
export function restoreFirstSeenInvariant(e: InstructionEntry){
  if(e.firstSeenTs) return;
  const auth = firstSeenAuthority[e.id];
  if(auth){ e.firstSeenTs = auth; incrementCounter('usage:firstSeenAuthorityRepair'); trackInvariantRepair(e.id, 'firstSeenTs', 'authority'); logDebug(`[invariant-repair] firstSeenTs restored from authority for ${e.id}`); return; }
  const ep = ephemeralFirstSeen[e.id];
  if(ep){ e.firstSeenTs = ep; incrementCounter('usage:firstSeenInvariantRepair'); trackInvariantRepair(e.id, 'firstSeenTs', 'ephemeral'); logDebug(`[invariant-repair] firstSeenTs restored from ephemeral cache for ${e.id}`); return; }
  const snap = (lastGoodUsageSnapshot as Record<string, UsagePersistRecord>)[e.id];
  if(snap?.firstSeenTs){ e.firstSeenTs = snap.firstSeenTs; incrementCounter('usage:firstSeenInvariantRepair'); trackInvariantRepair(e.id, 'firstSeenTs', 'snapshot'); logDebug(`[invariant-repair] firstSeenTs restored from snapshot for ${e.id}`); return; }
  // Final fallback: createdAt.
  if(e.createdAt){ e.firstSeenTs = e.createdAt; firstSeenAuthority[e.id] = e.createdAt; incrementCounter('usage:firstSeenCreatedAtFallback'); trackInvariantRepair(e.id, 'firstSeenTs', 'createdAt'); return; }
  if(!e.firstSeenTs){
    incrementCounter('usage:firstSeenRepairExhausted');
    trackInvariantRepair(e.id, 'firstSeenTs', 'exhausted');
    if(!firstSeenExhaustedReported.has(e.id)){
      firstSeenExhaustedReported.add(e.id);
      logWarn(`[invariant-repair] firstSeenTs repair exhausted — no source found for ${e.id}`);
    }
  }
}

/** Internal handles for unit tests only. Not part of the public API. @internal */
export const _internal = { restoreFirstSeenInvariant };

// Usage invariant repair (mirrors firstSeen invariant strategy).
export function restoreUsageInvariant(e: InstructionEntry){
  // Split-counter restore (issue #418): prefer authority maps, then the snapshot's REAL split.
  if(e.retrievedCount == null && retrievedAuthority[e.id] != null) e.retrievedCount = retrievedAuthority[e.id];
  if(e.appliedCount == null && appliedAuthority[e.id] != null) e.appliedCount = appliedAuthority[e.id];
  const snapRec = (lastGoodUsageSnapshot as Record<string, UsagePersistRecord>)[e.id];
  if(snapRec){
    if(e.retrievedCount == null && snapRec.retrievedCount != null) e.retrievedCount = snapRec.retrievedCount;
    if(e.appliedCount == null && snapRec.appliedCount != null) e.appliedCount = snapRec.appliedCount;
  }
  if(e.retrievedCount != null || e.appliedCount != null){
    if(e.retrievedCount == null) e.retrievedCount = 0;
    if(e.appliedCount == null) e.appliedCount = 0;
    if(e.usageCount != null && e.usageCount > e.retrievedCount + e.appliedCount){
      e.retrievedCount += e.usageCount - (e.retrievedCount + e.appliedCount);
    }
    e.usageCount = e.retrievedCount + e.appliedCount;
    return;
  }
  if(e.usageCount != null){ e.retrievedCount = e.usageCount; e.appliedCount = 0; return; }
  if(usageAuthority[e.id] != null){
    e.usageCount = usageAuthority[e.id];
    e.retrievedCount = e.usageCount; e.appliedCount = 0;
    incrementCounter('usage:usageInvariantAuthorityRepair');
    trackInvariantRepair(e.id, 'usageCount', 'authority');
    logWarn(`[invariant-repair] usageCount restored from authority for ${e.id} (value=${usageAuthority[e.id]})`);
    return;
  }
  if(observedUsage[e.id] != null){
    e.usageCount = observedUsage[e.id];
    e.retrievedCount = e.usageCount; e.appliedCount = 0;
    incrementCounter('usage:usageInvariantObservedRepair');
    trackInvariantRepair(e.id, 'usageCount', 'observed');
    logWarn(`[invariant-repair] usageCount restored from observed for ${e.id} (value=${observedUsage[e.id]})`);
    return;
  }
  const snap = (lastGoodUsageSnapshot as Record<string, UsagePersistRecord>)[e.id];
  if(snap?.usageCount != null){
    e.usageCount = snap.usageCount;
    e.retrievedCount = e.usageCount; e.appliedCount = 0;
    incrementCounter('usage:usageInvariantSnapshotRepair');
    trackInvariantRepair(e.id, 'usageCount', 'snapshot');
    logWarn(`[invariant-repair] usageCount restored from snapshot for ${e.id} (value=${snap.usageCount})`);
    return;
  }
  e.usageCount = 0;
  e.retrievedCount = 0; e.appliedCount = 0;
  incrementCounter('usage:usageInvariantZeroRepair');
  trackInvariantRepair(e.id, 'usageCount', 'zero-default');
}

// Repair missing lastUsedAt for entries with usage.
export function restoreLastUsedInvariant(e: InstructionEntry){
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
  // Any positive integer enables both. Parsed centrally via runtimeConfig (S-4).
  const rl = getRuntimeConfig().dashboard.http.rateLimitPerMinute;
  if (!Number.isFinite(rl) || rl <= 0) return true;
  const now = Date.now();
  const windowStart = Math.floor(now / 1000) * 1000; // 1-second windows

  const current = usageRateLimiter.get(id);
  if (!current || current.windowStart !== windowStart) {
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
  for(let attempt=0; attempt<3; attempt++){
    try {
      // Counters are persisted to whichever backend is active (JSON snapshot
      // file or the SQLite `usage` table). readPersistedUsage() returns {} when
      // nothing has been persisted yet, which is indistinguishable from the
      // previous "file absent" case.
      const parsed = readPersistedUsage() as Record<string, UsagePersistRecord>;
      if(Object.keys(parsed).length > 0){
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
      logWarn(`[invariant-repair] loadUsageSnapshot attempt ${attempt} failed: ${(err as Error).message || String(err)}`);
    }
  }
  return lastGoodUsageSnapshot;
}
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
    const st = getRawIndexState();
    if(st){
      const obj: Record<string, UsagePersistRecord> = {};
      for(const e of st.list){
        const authoritative = e.firstSeenTs || firstSeenAuthority[e.id];
        if(authoritative && !firstSeenAuthority[e.id]) firstSeenAuthority[e.id] = authoritative; // lgtm[js/remote-property-injection] — id is regex-validated by instruction schema (^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$) before reaching index
        const cached = lastGoodUsageSnapshot[e.id];
        const hasSignalMeta = !!((cached && (cached.lastAction || cached.lastSignal || cached.lastComment)) || (Array.isArray(e.signalHistory) && e.signalHistory.length));
        const retrievedCount = e.retrievedCount;
        const appliedCount = e.appliedCount;
        const derivedTotal = (retrievedCount ?? 0) + (appliedCount ?? 0);
        const usageCount = e.usageCount != null ? e.usageCount : derivedTotal;
        if(usageCount || retrievedCount || appliedCount || e.lastUsedAt || authoritative || hasSignalMeta){
          const rec: UsagePersistRecord = {
            usageCount: usageCount || derivedTotal,
            retrievedCount: retrievedCount ?? 0,
            appliedCount: appliedCount ?? 0,
            firstSeenTs: authoritative,
            lastUsedAt: e.lastUsedAt,
          };
          if(e.lastRetrievedAt) rec.lastRetrievedAt = e.lastRetrievedAt;
          if(e.lastAppliedAt) rec.lastAppliedAt = e.lastAppliedAt;
          if(e.lastSignaledAt) rec.lastSignaledAt = e.lastSignaledAt;
          // Without this the entry round-trips as "signalled at T" with an
          // empty history -- an asymmetric round-trip (DI-4), and a new split
          // between the timestamp and the record it timestamps.
          if(Array.isArray(e.signalHistory) && e.signalHistory.length) rec.signalHistory = e.signalHistory;
          if (cached) {
            if (cached.lastAction) rec.lastAction = cached.lastAction;
            if (cached.lastSignal) rec.lastSignal = cached.lastSignal;
            if (cached.lastComment) rec.lastComment = cached.lastComment;
          }
          obj[e.id] = rec; // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
        }
      }
      // Routes to the active backend: the JSON snapshot file, or the SQLite
      // `usage` table when storage.backend === 'sqlite'. Both writers are atomic.
      writePersistedUsage(obj);
      lastGoodUsageSnapshot = obj; // update cache
    }
  } catch { /* ignore */ }
}
// Register usage flush with shutdown guard instead of direct signal handlers.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createShutdownGuard: _createShutdownGuard } = require('../server/shutdownGuard');
  const key = Symbol.for('mcp-shutdown-guard');
  const g = globalThis as Record<symbol, ReturnType<typeof _createShutdownGuard>>;
  if (g[key] && typeof g[key].registerCleanup === 'function') {
    g[key].registerCleanup('flushUsageSnapshot', () => { flushUsageSnapshot(); });
  }
} catch {
  process.on('SIGINT', ()=>{ flushUsageSnapshot(); process.exit(0); });
  process.on('SIGTERM', ()=>{ flushUsageSnapshot(); process.exit(0); });
}
process.on('beforeExit', ()=>{ flushUsageSnapshot(); });

export function scheduleUsagePersist(){ scheduleUsageFlush(); }
export function incrementUsage(id:string, opts?: UsageTrackOptions){
  if(!hasFeature('usage')){
    incrementCounter('usage:gated');
    return {
      featureDisabled: true,
      gate: 'INDEX_SERVER_FEATURES',
      required: 'usage',
      observed: rawIndexFeaturesSetting(),
      hint: 'Set env INDEX_SERVER_FEATURES to include "usage" (csv) and restart the server to enable usage tracking.',
    };
  }

  let st = ensureLoaded();
  let e = st.byId.get(id);
  if(!e){
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

  if (!checkUsageRateLimit(id)) {
    const current = (e.retrievedCount ?? 0) + (e.appliedCount ?? 0);
    if(current < 2){
      try { incrementCounter('usage:earlyRateBypass'); } catch { /* ignore */ }
    } else {
  return { id, rateLimited: true, usageCount: current, retrievedCount: e.retrievedCount ?? 0, appliedCount: e.appliedCount ?? 0 };
    }
  }

  const action = opts?.action;
  const signal = opts?.signal;
  const comment = opts?.comment;
  const kind: UsageKind = opts?.kind ? opts.kind : resolveUsageKind(action, signal);

  const restoreSnap = (() => { try { return loadUsageSnapshot() as Record<string, UsagePersistRecord> | undefined; } catch { return undefined; } })();

  // Signal history (#525 follow-up). The persisted record keeps only
  // last-write-wins `lastSignal` with no timestamp, so `helpful` followed by
  // `applied` erases the `helpful` and no time series can be reconstructed
  // from the snapshot. Append an immutable event here — carrying the previous
  // value so signal *transitions* stay recoverable — before the snapshot
  // overwrite below. Read before write: `restoreSnap` still holds the prior
  // value at this point.
  if (signal) {
    const prev = restoreSnap?.[id]?.lastSignal;
    recordActivity('signaled', id, { signal, prevSignal: prev ?? null });

    const signalTs = new Date().toISOString();
    const item: SignalHistoryItem = { signal, ts: signalTs };
    if (comment) item.comment = comment;
    // mergeSignalHistory rather than a local unshift+truncate: it is the same
    // routine the snapshot merge uses, so ordering, de-dup and the cap cannot
    // drift between the write path and the restore path. It also tolerates a
    // corrupt (non-array) signalHistory, which a bare spread would throw on.
    e.signalHistory = mergeSignalHistory([item], e.signalHistory);
    e.lastSignaledAt = signalTs;
  }
  if(e.retrievedCount == null){
    if(retrievedAuthority[id] != null){ e.retrievedCount = retrievedAuthority[id]; incrementCounter('usage:restoredFromAuthority'); }
    else { const rec = restoreSnap && restoreSnap[id]; if(rec){ if(rec.retrievedCount != null) e.retrievedCount = rec.retrievedCount; else if(rec.usageCount != null && rec.appliedCount == null){ e.retrievedCount = rec.usageCount; incrementCounter('usage:restoredFromSnapshot'); } } }
  }
  if(e.appliedCount == null){
    if(appliedAuthority[id] != null){ e.appliedCount = appliedAuthority[id]; }
    else { const rec = restoreSnap && restoreSnap[id]; if(rec?.appliedCount != null) e.appliedCount = rec.appliedCount; }
  }
  if(e.retrievedCount == null) e.retrievedCount = 0;
  if(e.appliedCount == null) e.appliedCount = 0;
  if(retrievedAuthority[id] != null && e.retrievedCount < retrievedAuthority[id]){ e.retrievedCount = retrievedAuthority[id]; incrementCounter('usage:monotonicRepair'); }
  if(appliedAuthority[id] != null && e.appliedCount < appliedAuthority[id]){ e.appliedCount = appliedAuthority[id]; incrementCounter('usage:monotonicRepair'); }

  restoreFirstSeenInvariant(e);

  if(kind === 'none'){
    e.usageCount = e.retrievedCount + e.appliedCount;
    if(!e.firstSeenTs){
      const nowIso0 = new Date().toISOString();
      e.firstSeenTs = nowIso0;
      ephemeralFirstSeen[e.id] = nowIso0; firstSeenAuthority[e.id] = nowIso0; // lgtm[js/remote-property-injection]
    }
    if (action || signal || comment) {
      const snap = (restoreSnap || {}) as Record<string, UsagePersistRecord>;
      const rec = snap[id] || {};
      if (action) rec.lastAction = action;
      if (signal) rec.lastSignal = signal;
      if (comment) rec.lastComment = comment;
      snap[id] = rec;
      lastGoodUsageSnapshot = snap;
      usageDirty = true;
      flushUsageSnapshot();
    }
    const noneResult: Record<string, unknown> = { id: e.id, usageCount: e.usageCount, retrievedCount: e.retrievedCount, appliedCount: e.appliedCount, firstSeenTs: e.firstSeenTs, lastUsedAt: e.lastUsedAt };
    if (action) noneResult.action = action;
    if (signal) noneResult.signal = signal;
    if (comment) noneResult.comment = comment;
    return noneResult;
  }

  const nowIso = new Date().toISOString();
  if(kind === 'applied'){
    e.appliedCount = e.appliedCount + 1;
    e.lastAppliedAt = nowIso;
    appliedAuthority[id] = e.appliedCount; lastAppliedAuthority[id] = nowIso; // lgtm[js/remote-property-injection]
    incrementCounter('propertyUpdate:usage:applied');
  } else {
    e.retrievedCount = e.retrievedCount + 1;
    e.lastRetrievedAt = nowIso;
    retrievedAuthority[id] = e.retrievedCount; lastRetrievedAuthority[id] = nowIso; // lgtm[js/remote-property-injection]
    incrementCounter('propertyUpdate:usage:retrieved');
  }
  e.usageCount = e.retrievedCount + e.appliedCount;
  incrementCounter('propertyUpdate:usage');

  if(!e.firstSeenTs){
    e.firstSeenTs = nowIso;
    ephemeralFirstSeen[e.id] = e.firstSeenTs; // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
    firstSeenAuthority[e.id] = e.firstSeenTs; incrementCounter('usage:firstSeenAuthoritySet'); // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
  }
  e.lastUsedAt = nowIso; // always advance lastUsedAt on any counter increment
  lastUsedAuthority[e.id] = e.lastUsedAt; // lgtm[js/remote-property-injection] — id is schema-validated before reaching index

  if(e.usageCount <= 2){
    usageDirty = true; if(usageWriteTimer) { clearTimeout(usageWriteTimer); usageWriteTimer = null; }
    flushUsageSnapshot();
  } else {
    scheduleUsageFlush();
  }
  observedUsage[id] = e.usageCount;
  usageAuthority[id] = e.usageCount;
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
  const result: Record<string, unknown> = { id: e.id, usageCount: e.usageCount, retrievedCount: e.retrievedCount, appliedCount: e.appliedCount, firstSeenTs: e.firstSeenTs, lastUsedAt: e.lastUsedAt };
  if (e.lastRetrievedAt) result.lastRetrievedAt = e.lastRetrievedAt;
  if (e.lastAppliedAt) result.lastAppliedAt = e.lastAppliedAt;
  if (action) result.action = action;
  if (signal) result.signal = signal;
  if (comment) result.comment = comment;
  return result;
}

// Test-only helper to fully reset usage tracking state for isolation between test files / repeated runs.
export function __testResetUsageState(){
  try { if(fs.existsSync(getUsageSnapshotPath())) fs.unlinkSync(getUsageSnapshotPath()); } catch { /* ignore */ }
  // Also clear the SQLite `usage` table when that backend is active, otherwise
  // counters leak across tests that switch backends.
  try { writePersistedUsage({}); } catch { /* ignore */ }
  try { closeUsagePersistence(); } catch { /* ignore */ }
  usageDirty = false;
  if(usageWriteTimer){ clearTimeout(usageWriteTimer); usageWriteTimer = null; }
  usageRateLimiter.clear();
  lastGoodUsageSnapshot = {};
  for(const k of Object.keys(ephemeralFirstSeen)) delete (ephemeralFirstSeen as Record<string,string>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(firstSeenAuthority)) delete (firstSeenAuthority as Record<string,string>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(usageAuthority)) delete (usageAuthority as Record<string,number>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(lastUsedAuthority)) delete (lastUsedAuthority as Record<string,string>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(retrievedAuthority)) delete (retrievedAuthority as Record<string,number>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(appliedAuthority)) delete (appliedAuthority as Record<string,number>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(lastRetrievedAuthority)) delete (lastRetrievedAuthority as Record<string,string>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  for(const k of Object.keys(lastAppliedAuthority)) delete (lastAppliedAuthority as Record<string,string>)[k]; // lgtm[js/remote-property-injection] — k is own-key from internal object reset (test helper)
  const st = getRawIndexState();
  if(st){
    for(const e of st.list){
      (e as InstructionEntry).usageCount = undefined as unknown as number | undefined;
      (e as InstructionEntry).retrievedCount = undefined as unknown as number | undefined;
      (e as InstructionEntry).appliedCount = undefined as unknown as number | undefined;
      (e as InstructionEntry).firstSeenTs = undefined as unknown as string | undefined;
      (e as InstructionEntry).lastUsedAt = undefined as unknown as string | undefined;
      (e as InstructionEntry).lastRetrievedAt = undefined as unknown as string | undefined;
      (e as InstructionEntry).lastAppliedAt = undefined as unknown as string | undefined;
    }
  }
  invalidate();
}
