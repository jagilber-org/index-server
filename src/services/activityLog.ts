/**
 * activityLog — process-level facade over the persistent activity store.
 *
 * Why this exists separately from `auditLog`:
 *
 * The audit log is a JSONL file dominated by `http` and `read` entries (the
 * dashboard polls several endpoints every 10s), read by slurping the whole
 * file and slicing the tail. It is the right tool for forensics and the wrong
 * tool for a chart: deriving a signal series from it means parsing megabytes
 * of request noise, and the tail limit silently drops old mutations.
 *
 * This module records only *semantic* events — one row per meaningful change —
 * into an indexed SQLite table that can be bucketed by time in a single query.
 *
 * Every entry point is failure-tolerant: telemetry must never break a
 * mutation. Errors are counted and warned once, then swallowed.
 */

import fs from 'fs';
import path from 'path';
import { logWarn, logInfo } from './logger';
import { isTestEnvironment } from '../utils/envUtils.js';
import { INSTALL_ROOT } from '../config/configUtils.js';
import {
  activityDbConfigured,
  activityLogSetting,
  activityRetentionDays,
  resolveActivityDbPath,
} from '../config/serviceEnv.js';
import {
  SqliteActivityStore,
  type ActivityEvent,
  type ActivityType,
  type CatalogSampleRow,
} from './storage/sqliteActivityStore.js';

const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const INIT_RETRY_MS = 5 * 60 * 1000; // 5 min cooldown before retrying a failed init

interface ActivityLogState {
  writeFailures: number;
  initFailures: number;
  lastError?: string;
  warningActive: boolean;
  lastPruneMs: number;
  lastInitAttemptMs: number;
  legacyMigrated: boolean;
}

const state: ActivityLogState = {
  writeFailures: 0,
  initFailures: 0,
  warningActive: false,
  lastPruneMs: 0,
  lastInitAttemptMs: 0,
  legacyMigrated: false,
};

let store: SqliteActivityStore | null | undefined;

/**
 * Stable identifier for this server process. Matches the convention already
 * used by the agent mailbox (`<pid>@<cwd basename>`) so events, mailboxes and
 * port files describe instances the same way.
 */
export function getInstanceId(): string {
  return `${process.pid}@${path.basename(process.cwd())}`;
}

function isEnabled(): boolean {
  const setting = activityLogSetting();
  if (setting === 'off') return false;

  // Default OFF under the test runner unless a path was explicitly configured.
  // logAudit() calls this on every mutation, so leaving it on made every
  // mutation-touching spec in the suite open and write the repository's real
  // metrics/activity.db — one run left a 4 MB WAL behind. Specs that exercise
  // the store set INDEX_SERVER_ACTIVITY_DB to a temp path, or construct
  // SqliteActivityStore directly.
  //
  // This check deliberately runs BEFORE the `setting === 'on'` branch below. It used to run
  // after, which meant INDEX_SERVER_ACTIVITY_LOG=1 silently re-armed writes
  // under vitest and, with no INDEX_SERVER_ACTIVITY_DB set, resolveDbPath()
  // sent them to the installation's own metrics/activity.db. That is how test
  // fixtures ended up in a production catalog's telemetry: of 907 rows in one
  // real database, 902 referenced ids that exist nowhere in the catalog
  // (`bulk-rm-0`, `test-remove-target`, `ci-test-<run>-c0-op0`, …), leaving the
  // dashboard's Catalog Activity chart rendering the test suite.
  //
  // Turning telemetry ON is never urgent enough to justify aiming it at a
  // shared database by accident, so under a test runner the only way to enable
  // it is to also say explicitly where it should go.
  // `isTestEnvironment()` (envUtils) is the shared runner sniff: `VITEST`
  // covers in-process specs and any child that inherits the environment,
  // `NODE_ENV=test` catches runners that set only that. A child spawned with a
  // deliberately scrubbed environment can still slip through — such specs must
  // pass INDEX_SERVER_ACTIVITY_LOG=0 explicitly, as activityDbPath.spec.ts
  // already does.
  if (isTestEnvironment() && !activityDbConfigured()) return false;

  if (setting === 'on') return true; // explicit opt-in, outside a test runner
  return true; // on by default in production
}

/**
 * Resolve the activity database path.
 *
 * Precedence: explicit DB override, then the metrics directory override, then
 * STATE_ROOT/metrics. Resolution itself lives in `config/serviceEnv` (#611).
 */
export function resolveDbPath(): string {
  return resolveActivityDbPath();
}

function markFailure(error: unknown, phase: string): void {
  state.lastError = error instanceof Error ? error.message : String(error);
  if (!state.warningActive) {
    state.warningActive = true;
    logWarn('[activity] Activity telemetry unavailable; dashboard history will be incomplete', {
      phase,
      error: state.lastError,
    });
  }
}

/**
 * Resolve the store, creating it on first use. Returns null when disabled or
 * when the database could not be opened — callers treat null as "skip".
 *
 * A failed open is cached as `null` and retried after INIT_RETRY_MS so a
 * transient failure (locked file, missing dir) can self-heal without
 * spamming on every mutation.
 */
function getStore(): SqliteActivityStore | null {
  if (store) return store;
  if (store === null && !isEnabled()) return null;
  if (store === null && Date.now() - state.lastInitAttemptMs < INIT_RETRY_MS) return null;
  if (!isEnabled()) {
    store = null;
    return store;
  }
  state.lastInitAttemptMs = Date.now();
  try {
    store = new SqliteActivityStore(resolveDbPath());
    state.warningActive = false;
    maybeMigrateLegacy();
    store.checkpoint();
    maybePrune();
  } catch (error) {
    state.initFailures += 1;
    markFailure(error, 'open');
    store = null;
  }
  return store;
}

/** Time-based retention sweep + WAL checkpoint, throttled to PRUNE_INTERVAL_MS. */
function maybePrune(): void {
  const now = Date.now();
  if (now - state.lastPruneMs < PRUNE_INTERVAL_MS) return;
  state.lastPruneMs = now;
  try {
    store?.prune(now - activityRetentionDays() * 24 * 60 * 60 * 1000);
    store?.checkpoint();
  } catch (error) {
    markFailure(error, 'prune');
  }
}

/**
 * One-shot import of activity history from the pre-migration install-root
 * database. Runs at most once per process lifetime: if the legacy database
 * exists and STATE_ROOT differs from INSTALL_ROOT, its rows are imported
 * (skipping timestamps already present in the target).
 */
function maybeMigrateLegacy(): void {
  if (state.legacyMigrated || !store) return;
  state.legacyMigrated = true;

  const legacyDb = path.join(INSTALL_ROOT, 'metrics', 'activity.db');
  const currentDb = resolveDbPath();
  if (path.resolve(legacyDb) === path.resolve(currentDb)) return;
  if (!fs.existsSync(legacyDb)) return;

  try {
    const result = store.importFrom(legacyDb);
    if (result.activity > 0 || result.samples > 0) {
      logInfo('[activity] Migrated legacy activity history', {
        source: legacyDb,
        activity: result.activity,
        samples: result.samples,
      });
      store.checkpoint();
    }
  } catch (error) {
    logWarn('[activity] Legacy migration failed (non-fatal)', {
      source: legacyDb,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Record one semantic activity event. Never throws.
 *
 * `ts` and `instance` default to now / this process, so call sites only supply
 * what they actually know.
 */
export function recordActivity(
  type: ActivityType,
  instructionId?: string | null,
  extra?: { signal?: string | null; prevSignal?: string | null; correlationId?: string | null; ts?: number; instance?: string | null },
): void {
  const s = getStore();
  if (!s) return;
  try {
    s.recordActivity({
      ts: extra?.ts ?? Date.now(),
      type,
      instructionId: instructionId ?? null,
      signal: extra?.signal ?? null,
      prevSignal: extra?.prevSignal ?? null,
      instance: extra?.instance ?? getInstanceId(),
      correlationId: extra?.correlationId ?? null,
    });
    maybePrune();
  } catch (error) {
    state.writeFailures += 1;
    markFailure(error, 'write');
  }
}

/** Persist one catalog stock sample. Never throws. */
export function recordCatalogSample(sample: CatalogSampleRow): void {
  const s = getStore();
  if (!s) return;
  try {
    s.recordSample(sample);
  } catch (error) {
    state.writeFailures += 1;
    markFailure(error, 'sample');
  }
}

/** Read catalog samples for charting. Returns [] when unavailable. */
export function getCatalogSamples(opts: { since?: number; until?: number; limit?: number } = {}): CatalogSampleRow[] {
  const s = getStore();
  if (!s) return [];
  try {
    return s.getSamples(opts);
  } catch (error) {
    markFailure(error, 'read');
    return [];
  }
}

/** Bucketed activity flow series. Returns [] when unavailable. */
export function getActivityBuckets(opts: { since: number; until?: number; bucketMs: number; instance?: string }) {
  const s = getStore();
  if (!s) return [];
  try {
    return s.bucketActivity(opts);
  } catch (error) {
    markFailure(error, 'read');
    return [];
  }
}

/** Per-instance totals for the activity report. Returns [] when unavailable. */
export function getInstanceActivity(opts: { since: number; until?: number }) {
  const s = getStore();
  if (!s) return [];
  try {
    return s.summarizeByInstance(opts);
  } catch (error) {
    markFailure(error, 'read');
    return [];
  }
}

/** Raw events for drill-down. Returns [] when unavailable. */
export function listActivity(opts: { since?: number; until?: number; type?: ActivityType; instance?: string; limit?: number } = {}): ActivityEvent[] {
  const s = getStore();
  if (!s) return [];
  try {
    return s.listActivity(opts);
  } catch (error) {
    markFailure(error, 'read');
    return [];
  }
}

/**
 * Map an audit action to a semantic activity type, or null to ignore it.
 *
 * `logAudit` is the single choke point every committed instruction mutation
 * already passes through, so hooking here captures add / patch / archive /
 * restore / purge without touching each handler. The allowlist is deliberate:
 * the audit stream also carries per-tool and per-HTTP-request rows that must
 * not be mistaken for catalog changes.
 *
 * Meta is consulted because the action name alone is ambiguous:
 *   - `add` with `created:false` is an overwrite, i.e. a modification
 *   - `add` with `skipped:true` changed nothing at all
 *   - `patch` with `changed:false` is a no-op or a rejected precondition
 */
export function activityTypeFromAudit(
  action: string,
  meta?: Record<string, unknown>,
): ActivityType | null {
  switch (action) {
    case 'add': {
      if (meta?.skipped === true) return null;
      if (meta?.mutation_persist_failed === true) return null;
      // `created` is absent on some legacy rows; treat absence as a create.
      return meta?.created === false || meta?.overwritten === true ? 'modified' : 'added';
    }
    case 'patch':
      return meta?.changed === true ? 'modified' : null;
    case 'archive_edit':
      return 'modified';
    case 'archive':
      return 'archived';
    case 'restore':
      return 'restored';
    case 'purge':
    case 'remove':
      return 'removed';
    default:
      return null;
  }
}

/**
 * Bridge from the audit stream. Records one activity row per affected id.
 * Never throws — telemetry must not be able to fail a mutation.
 */
export function recordActivityFromAudit(
  action: string,
  ids: string[] | undefined,
  meta: Record<string, unknown> | undefined,
  correlationId?: string,
): void {
  const type = activityTypeFromAudit(action, meta);
  if (!type) return;
  const targets = ids && ids.length ? ids : [null];
  for (const id of targets) {
    recordActivity(type, id, { correlationId: correlationId ?? null });
  }
}

export interface ActivityLogHealth {
  enabled: boolean;
  available: boolean;
  file: string | null;
  writeFailures: number;
  initFailures: number;
  degraded: boolean;
  retentionDays: number;
  activityCount: number;
  sampleCount: number;
  lastError?: string;
}

export function getActivityLogHealth(): ActivityLogHealth {
  const enabled = isEnabled();
  const s = enabled ? getStore() : null;
  let activityCount = 0;
  let sampleCount = 0;
  if (s) {
    try {
      activityCount = s.countActivity();
      sampleCount = s.countSamples();
    } catch (error) {
      markFailure(error, 'health');
    }
  }
  return {
    enabled,
    available: !!s,
    file: enabled ? resolveDbPath() : null,
    writeFailures: state.writeFailures,
    initFailures: state.initFailures,
    degraded: state.writeFailures > 0 || state.initFailures > 0,
    retentionDays: activityRetentionDays(),
    activityCount,
    sampleCount,
    lastError: state.lastError,
  };
}

/** Close and forget the store. Tests use this between temp directories. */
export function resetActivityLog(): void {
  try { store?.close(); } catch { /* already closed */ }
  store = undefined;
  state.writeFailures = 0;
  state.initFailures = 0;
  state.lastError = undefined;
  state.warningActive = false;
  state.lastPruneMs = 0;
  state.legacyMigrated = false;
}

/** Inject a store directly. Tests use this to avoid touching the filesystem. */
export function setActivityStore(next: SqliteActivityStore | null): void {
  store = next;
}

export type { ActivityEvent, ActivityType, CatalogSampleRow };
