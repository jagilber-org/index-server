/**
 * Usage snapshot file access — the on-disk counter store for the JSON backend.
 *
 * `incrementUsage` flushes counters to `data/usage-snapshot.json` and does NOT
 * rewrite the instruction entry files, so for the JSON backend this file — not
 * `<instructionsDir>/<id>.json` — is the authoritative source of accumulated
 * usage. Anything that copies instructions between backends must therefore read
 * it too, or every counter is silently lost.
 *
 * This module is intentionally dependency-free (no indexContext / indexUsage
 * imports) so the migration engine can use it without creating an import cycle.
 */

import fs from 'fs';
import path from 'path';
import { mergeSignalHistory, type SignalHistoryItem } from '../../models/instruction';
import { resolveUsageSnapshotPath as resolveUsageSnapshotPathFromConfig } from '../../config/serviceEnv';

/** Per-instruction usage record as persisted in the snapshot file. */
export interface UsageSnapshotRecord {
  usageCount?: number;
  retrievedCount?: number;
  appliedCount?: number;
  firstSeenTs?: string;
  lastUsedAt?: string;
  lastRetrievedAt?: string;
  lastAppliedAt?: string;
  lastAction?: string;
  lastSignal?: string;
  lastComment?: string;
  lastSignaledAt?: string;
  signalHistory?: SignalHistoryItem[];
}

/**
 * Resolve the usage snapshot path.
 *
 * Honours INDEX_SERVER_USAGE_SNAPSHOT_PATH (used by tests for isolation),
 * otherwise `<cwd>/data/usage-snapshot.json`. Must stay behaviourally identical
 * to indexUsage.getUsageSnapshotPath().
 */
export function resolveUsageSnapshotPath(): string {
  // Resolution lives in `config/serviceEnv` (#611), re-read per call: specs
  // repoint INDEX_SERVER_USAGE_SNAPSHOT_PATH at a temp file after boot to keep
  // counters isolated, which a memoized snapshot would defeat.
  return resolveUsageSnapshotPathFromConfig();
}

/** Read a usage snapshot file. Returns {} when absent or unparseable. */
export function readUsageSnapshotFile(snapshotPath: string): Record<string, UsageSnapshotRecord> {
  try {
    if (!fs.existsSync(snapshotPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as Record<string, UsageSnapshotRecord>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Write a usage snapshot file atomically (tmp + rename), creating parent dirs. */
export function writeUsageSnapshotFile(
  snapshotPath: string,
  data: Record<string, UsageSnapshotRecord>,
): void {
  const dir = path.dirname(snapshotPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(data, null, 2);
  const tmp = `${snapshotPath}.tmp`;
  try {
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, snapshotPath);
  } catch {
    fs.writeFileSync(snapshotPath, payload);
  }
}

/**
 * Merge a snapshot record onto an entry, taking the HIGHER of the two counter
 * values per field.
 *
 * The snapshot normally leads the entry file (the entry file usually has no
 * counters at all), but a snapshot can also be stale — e.g. restored from an
 * older backup, or truncated by a crash between flushes. Counters are monotonic
 * by contract, so max() is the only merge that cannot lose ground in either
 * direction. Timestamps take the later of the two for the same reason.
 *
 * Mutates and returns `entry`.
 */
export function mergeUsageRecord<T extends Record<string, unknown>>(
  entry: T,
  rec: UsageSnapshotRecord | undefined,
): T {
  if (!rec) return entry;
  const e = entry as Record<string, unknown>;

  const maxNum = (a: unknown, b: unknown): number | undefined => {
    const an = typeof a === 'number' ? a : undefined;
    const bn = typeof b === 'number' ? b : undefined;
    if (an == null) return bn;
    if (bn == null) return an;
    return Math.max(an, bn);
  };
  const maxTs = (a: unknown, b: unknown): string | undefined => {
    const as = typeof a === 'string' ? a : undefined;
    const bs = typeof b === 'string' ? b : undefined;
    if (as == null) return bs;
    if (bs == null) return as;
    return as >= bs ? as : bs;
  };

  const retrieved = maxNum(e.retrievedCount, rec.retrievedCount);
  const applied = maxNum(e.appliedCount, rec.appliedCount);
  if (retrieved != null) e.retrievedCount = retrieved;
  if (applied != null) e.appliedCount = applied;

  e.lastRetrievedAt = maxTs(e.lastRetrievedAt, rec.lastRetrievedAt);
  e.lastAppliedAt = maxTs(e.lastAppliedAt, rec.lastAppliedAt);
  e.lastUsedAt = maxTs(e.lastUsedAt, rec.lastUsedAt);
  e.lastSignaledAt = maxTs(e.lastSignaledAt, rec.lastSignaledAt);

  // Union rather than pick-one: under multi-client operation (one store, many
  // processes) each side legitimately holds events the other has never seen,
  // so overwriting either way silently loses signals. mergeSignalHistory
  // de-dups, re-sorts newest-first and re-applies the cap.
  const history = mergeSignalHistory(
    e.signalHistory as SignalHistoryItem[] | undefined,
    rec.signalHistory,
  );
  if (history.length) e.signalHistory = history;

  // firstSeenTs is the EARLIEST observation, so it takes min(), not max().
  const efs = typeof e.firstSeenTs === 'string' ? e.firstSeenTs : undefined;
  const rfs = rec.firstSeenTs;
  if (efs == null) { if (rfs != null) e.firstSeenTs = rfs; }
  else if (rfs != null && rfs < efs) e.firstSeenTs = rfs;

  // usageCount is derived; keep it consistent with the split when we have one.
  const derived = (retrieved ?? 0) + (applied ?? 0);
  const explicit = maxNum(e.usageCount, rec.usageCount);
  e.usageCount = retrieved != null || applied != null
    ? Math.max(derived, explicit ?? 0)
    : explicit;

  // Clean up keys we set to undefined so they don't serialize as nulls.
  for (const k of ['lastRetrievedAt', 'lastAppliedAt', 'lastUsedAt', 'lastSignaledAt', 'usageCount']) {
    if (e[k] === undefined) delete e[k];
  }
  return entry;
}
