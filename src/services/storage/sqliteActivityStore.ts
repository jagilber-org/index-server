/**
 * SqliteActivityStore — persistent telemetry for dashboard time-series.
 *
 * Two tables, one database, deliberately independent of
 * INDEX_SERVER_STORAGE_BACKEND so the dashboard charts have real history in
 * both the `json` (default) and `sqlite` instruction-storage modes:
 *
 *   activity        append-only semantic events (added / modified / archived /
 *                   restored / removed / signaled). This is the *flow* series
 *                   and the only place a signal's history survives — the usage
 *                   snapshot keeps a last-write-wins `lastSignal` with no
 *                   timestamp, so `helpful` followed by `applied` erases the
 *                   `helpful` and no history can be reconstructed from it.
 *
 *   catalog_samples periodic *stock* snapshots (how many entries exist, how
 *                   they break down by signal / coverage). Keyed on ts so a
 *                   re-sample at the same millisecond replaces rather than
 *                   duplicates.
 *
 * Replaces the previous BufferRing JSONL persistence for catalog history,
 * which appended the whole ring on every write: the on-disk file had grown to
 * 17,094 records carrying only 312 distinct samples (2.0 MB for three days).
 *
 * Uses the Node.js built-in node:sqlite (DatabaseSync). No third-party deps.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

/** Semantic activity event types. Keep in sync with ACTIVITY_TYPES. */
export type ActivityType =
  | 'added'
  | 'modified'
  | 'archived'
  | 'restored'
  | 'removed'
  | 'signaled';

export const ACTIVITY_TYPES: readonly ActivityType[] = Object.freeze([
  'added',
  'modified',
  'archived',
  'restored',
  'removed',
  'signaled',
]);

export interface ActivityEvent {
  /** Epoch milliseconds. */
  ts: number;
  type: ActivityType;
  instructionId?: string | null;
  /** Only meaningful for type='signaled'. */
  signal?: string | null;
  /** Previous signal value, so signal *transitions* are recoverable. */
  prevSignal?: string | null;
  /** Server instance identifier, for per-instance attribution. */
  instance?: string | null;
  correlationId?: string | null;
}

export interface CatalogSampleRow {
  ts: number;
  indexCount: number;
  usageTotal: number;
  /** Entries carrying any signal. Equals the sum of the four sig* buckets. */
  signalCount: number;
  sigApplied: number;
  sigHelpful: number;
  sigNotRelevant: number;
  sigOutdated: number;
  /** Entries retrieved at least once but carrying no signal. */
  retrievedOnly: number;
  /** Entries never retrieved and never signaled. */
  neverUsed: number;
}

/** One time bucket of activity counts. */
export interface ActivityBucket {
  /** Bucket start, epoch ms. */
  ts: number;
  added: number;
  modified: number;
  archived: number;
  restored: number;
  removed: number;
  signaled: number;
  /** Signaled split by signal value. */
  signals: Record<string, number>;
}

export const ACTIVITY_DDL = `
CREATE TABLE IF NOT EXISTS activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  instruction_id TEXT,
  signal TEXT,
  prev_signal TEXT,
  instance TEXT,
  correlation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);
CREATE INDEX IF NOT EXISTS idx_activity_type_ts ON activity(type, ts);
CREATE INDEX IF NOT EXISTS idx_activity_instance_ts ON activity(instance, ts);

CREATE TABLE IF NOT EXISTS catalog_samples (
  ts INTEGER PRIMARY KEY,
  index_count INTEGER NOT NULL,
  usage_total INTEGER NOT NULL,
  signal_count INTEGER NOT NULL,
  sig_applied INTEGER NOT NULL DEFAULT 0,
  sig_helpful INTEGER NOT NULL DEFAULT 0,
  sig_not_relevant INTEGER NOT NULL DEFAULT 0,
  sig_outdated INTEGER NOT NULL DEFAULT 0,
  retrieved_only INTEGER NOT NULL DEFAULT 0,
  never_used INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_catalog_samples_ts ON catalog_samples(ts);
`;

const ACTIVITY_PRAGMAS = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=NORMAL;
`;

function toSampleRow(r: Record<string, unknown>): CatalogSampleRow {
  return {
    ts: Number(r.ts),
    indexCount: Number(r.index_count) || 0,
    usageTotal: Number(r.usage_total) || 0,
    signalCount: Number(r.signal_count) || 0,
    sigApplied: Number(r.sig_applied) || 0,
    sigHelpful: Number(r.sig_helpful) || 0,
    sigNotRelevant: Number(r.sig_not_relevant) || 0,
    sigOutdated: Number(r.sig_outdated) || 0,
    retrievedOnly: Number(r.retrieved_only) || 0,
    neverUsed: Number(r.never_used) || 0,
  };
}

export class SqliteActivityStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    // Create the parent directory first — a configured path whose directory
    // does not exist otherwise fails with "unable to open database file".
    const dir = path.dirname(dbPath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(ACTIVITY_PRAGMAS);
    this.db.exec(ACTIVITY_DDL);
  }

  /** Append one activity event. */
  recordActivity(ev: ActivityEvent): void {
    this.db
      .prepare(
        `INSERT INTO activity (ts, type, instruction_id, signal, prev_signal, instance, correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Math.round(ev.ts),
        ev.type,
        ev.instructionId ?? null,
        ev.signal ?? null,
        ev.prevSignal ?? null,
        ev.instance ?? null,
        ev.correlationId ?? null,
      );
  }

  /** Raw events, newest first. Primarily for the activity table / drill-down. */
  listActivity(opts: { since?: number; until?: number; type?: ActivityType; instance?: string; limit?: number } = {}): ActivityEvent[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.since !== undefined) { conditions.push('ts >= ?'); params.push(Math.round(opts.since)); }
    if (opts.until !== undefined) { conditions.push('ts <= ?'); params.push(Math.round(opts.until)); }
    if (opts.type) { conditions.push('type = ?'); params.push(opts.type); }
    if (opts.instance) { conditions.push('instance = ?'); params.push(opts.instance); }

    let sql = 'SELECT * FROM activity';
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY ts DESC, seq DESC LIMIT ?';
    params.push(Math.max(1, Math.min(opts.limit ?? 500, 10_000)));

    return this.db.prepare(sql).all(...params).map((r) => ({
      ts: Number(r.ts),
      type: r.type as ActivityType,
      instructionId: (r.instruction_id as string | null) ?? null,
      signal: (r.signal as string | null) ?? null,
      prevSignal: (r.prev_signal as string | null) ?? null,
      instance: (r.instance as string | null) ?? null,
      correlationId: (r.correlation_id as string | null) ?? null,
    }));
  }

  /**
   * Activity aggregated into fixed-width time buckets — the *flow* series.
   *
   * Buckets are aligned to absolute epoch multiples of bucketMs (not to
   * `since`), so the same wall-clock interval always lands in the same bucket
   * regardless of the query window. Empty buckets are omitted; callers that
   * need a dense series should fill gaps against the requested range.
   */
  bucketActivity(opts: { since: number; until?: number; bucketMs: number; instance?: string }): ActivityBucket[] {
    const bucketMs = Math.max(1, Math.round(opts.bucketMs));
    const until = opts.until ?? Date.now();

    const conditions = ['ts >= ?', 'ts <= ?'];
    const params: unknown[] = [Math.round(opts.since), Math.round(until)];
    if (opts.instance) { conditions.push('instance = ?'); params.push(opts.instance); }

    // CAST(... AS INTEGER) is load-bearing: node:sqlite binds JS numbers as
    // REAL, so a bare `(ts / ?) * ?` is floating-point division and returns
    // the original timestamp (off by ~1e-4). Every event then lands in its own
    // bucket and no aggregation happens at all.
    const rows = this.db
      .prepare(
        `SELECT CAST(ts / ? AS INTEGER) * ? AS bucket, type, signal, COUNT(*) AS n
         FROM activity
         WHERE ${conditions.join(' AND ')}
         GROUP BY bucket, type, signal
         ORDER BY bucket ASC`,
      )
      .all(bucketMs, bucketMs, ...params);

    const byBucket = new Map<number, ActivityBucket>();
    for (const r of rows) {
      const ts = Number(r.bucket);
      let b = byBucket.get(ts);
      if (!b) {
        b = { ts, added: 0, modified: 0, archived: 0, restored: 0, removed: 0, signaled: 0, signals: {} };
        byBucket.set(ts, b);
      }
      const type = r.type as ActivityType;
      const n = Number(r.n) || 0;
      // Whitelist rather than `type in b`: an unrecognised type must not be
      // able to clobber `ts` or `signals` via property injection.
      if (ACTIVITY_TYPES.includes(type)) {
        (b as unknown as Record<string, number>)[type] += n;
      }
      if (type === 'signaled') {
        const sig = (r.signal as string | null) ?? 'unspecified';
        b.signals[sig] = (b.signals[sig] || 0) + n;
      }
    }
    return [...byBucket.values()].sort((a, b) => a.ts - b.ts);
  }

  /** Per-instance activity totals over a window — powers the instance report. */
  summarizeByInstance(opts: { since: number; until?: number }): Array<{ instance: string } & Omit<ActivityBucket, 'ts'>> {
    const until = opts.until ?? Date.now();
    const rows = this.db
      .prepare(
        `SELECT COALESCE(instance, 'unknown') AS instance, type, signal, COUNT(*) AS n
         FROM activity
         WHERE ts >= ? AND ts <= ?
         GROUP BY instance, type, signal`,
      )
      .all(Math.round(opts.since), Math.round(until));

    const byInstance = new Map<string, { instance: string } & Omit<ActivityBucket, 'ts'>>();
    for (const r of rows) {
      const instance = String(r.instance);
      let acc = byInstance.get(instance);
      if (!acc) {
        acc = { instance, added: 0, modified: 0, archived: 0, restored: 0, removed: 0, signaled: 0, signals: {} };
        byInstance.set(instance, acc);
      }
      const type = r.type as ActivityType;
      const n = Number(r.n) || 0;
      if (ACTIVITY_TYPES.includes(type)) {
        (acc as unknown as Record<string, number>)[type] += n;
      }
      if (type === 'signaled') {
        const sig = (r.signal as string | null) ?? 'unspecified';
        acc.signals[sig] = (acc.signals[sig] || 0) + n;
      }
    }
    return [...byInstance.values()].sort((a, b) => a.instance.localeCompare(b.instance));
  }

  /** Upsert a catalog stock sample. Keyed on ts, so re-sampling is idempotent. */
  recordSample(s: CatalogSampleRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO catalog_samples (
           ts, index_count, usage_total, signal_count,
           sig_applied, sig_helpful, sig_not_relevant, sig_outdated,
           retrieved_only, never_used
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Math.round(s.ts),
        s.indexCount,
        s.usageTotal,
        s.signalCount,
        s.sigApplied,
        s.sigHelpful,
        s.sigNotRelevant,
        s.sigOutdated,
        s.retrievedOnly,
        s.neverUsed,
      );
  }

  /**
   * Catalog samples in ascending time order.
   *
   * `limit` keeps the most RECENT n samples (the tail), then returns them
   * oldest-first for direct plotting — a plain `ORDER BY ts ASC LIMIT n` would
   * return the oldest n instead, which silently pins the chart to ancient
   * history as the table grows.
   */
  getSamples(opts: { since?: number; until?: number; limit?: number } = {}): CatalogSampleRow[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.since !== undefined) { conditions.push('ts >= ?'); params.push(Math.round(opts.since)); }
    if (opts.until !== undefined) { conditions.push('ts <= ?'); params.push(Math.round(opts.until)); }

    let sql = 'SELECT * FROM catalog_samples';
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY ts DESC';
    if (opts.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(Math.max(1, Math.min(opts.limit, 100_000)));
    }

    const rows = this.db.prepare(sql).all(...params).map(toSampleRow);
    return rows.reverse();
  }

  /** Total sample count — used by health/diagnostics. */
  countSamples(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM catalog_samples').get() as { n?: number } | undefined;
    return Number(row?.n) || 0;
  }

  /** Total activity event count — used by health/diagnostics. */
  countActivity(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM activity').get() as { n?: number } | undefined;
    return Number(row?.n) || 0;
  }

  /**
   * Delete rows older than `cutoffMs`. Returns rows removed per table.
   * Retention is time-based rather than count-based so the chart's x-range is
   * predictable regardless of sampling cadence or event volume.
   */
  prune(cutoffMs: number): { activity: number; samples: number } {
    const cutoff = Math.round(cutoffMs);
    const activity = this.db.prepare('DELETE FROM activity WHERE ts < ?').run(cutoff).changes;
    const samples = this.db.prepare('DELETE FROM catalog_samples WHERE ts < ?').run(cutoff).changes;
    return { activity, samples };
  }

  /**
   * Checkpoint the WAL into the main database file.
   *
   * node:sqlite's DatabaseSync never auto-checkpoints, so without this call
   * ALL data lives in the WAL file exclusively. That has two consequences:
   *   1. External tools (sqlite3 CLI from a different build, backup scripts)
   *      that open the database may not see WAL-only data if the SHM state
   *      is stale or the SQLite version differs.
   *   2. The WAL grows without bound until the connection closes.
   *
   * PASSIVE never blocks writers — it checkpoints only pages that are not
   * currently in use. Called alongside prune so the cadence is automatic.
   */
  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE)');
  }

  /**
   * Import rows from another activity database (e.g. a legacy database left
   * behind after a STATE_ROOT migration). Skips rows whose `ts` already
   * exists in the target so re-running is idempotent.
   */
  importFrom(sourcePath: string): { activity: number; samples: number } {
    if (!fs.existsSync(sourcePath)) return { activity: 0, samples: 0 };

    let sourceDb: DatabaseSync;
    try {
      sourceDb = new DatabaseSync(sourcePath, { readOnly: true } as never);
    } catch {
      return { activity: 0, samples: 0 };
    }

    let activity = 0;
    let samples = 0;
    try {
      const hasTables = sourceDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('activity','catalog_samples')")
        .all()
        .map((r) => (r as { name: string }).name);

      if (hasTables.includes('activity')) {
        const minTs = this.db.prepare('SELECT MIN(ts) AS mn FROM activity').get() as { mn: number | null } | undefined;
        const cutoff = minTs?.mn ?? Number.MAX_SAFE_INTEGER;
        const rows = sourceDb.prepare('SELECT * FROM activity WHERE ts < ? ORDER BY ts ASC').all(cutoff);
        const ins = this.db.prepare(
          `INSERT OR IGNORE INTO activity (ts, type, instruction_id, signal, prev_signal, instance, correlation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of rows) {
          ins.run(r.ts, r.type, r.instruction_id ?? null, r.signal ?? null, r.prev_signal ?? null, r.instance ?? null, r.correlation_id ?? null);
          activity++;
        }
      }

      if (hasTables.includes('catalog_samples')) {
        const minTs = this.db.prepare('SELECT MIN(ts) AS mn FROM catalog_samples').get() as { mn: number | null } | undefined;
        const cutoff = minTs?.mn ?? Number.MAX_SAFE_INTEGER;
        const rows = sourceDb.prepare('SELECT * FROM catalog_samples WHERE ts < ? ORDER BY ts ASC').all(cutoff);
        const ins = this.db.prepare(
          `INSERT OR IGNORE INTO catalog_samples (
             ts, index_count, usage_total, signal_count,
             sig_applied, sig_helpful, sig_not_relevant, sig_outdated,
             retrieved_only, never_used
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of rows) {
          ins.run(r.ts, r.index_count, r.usage_total, r.signal_count,
            r.sig_applied ?? 0, r.sig_helpful ?? 0, r.sig_not_relevant ?? 0, r.sig_outdated ?? 0,
            r.retrieved_only ?? 0, r.never_used ?? 0);
          samples++;
        }
      }
    } finally {
      try { sourceDb.close(); } catch { /* already closed */ }
    }
    return { activity, samples };
  }

  close(): void {
    try { this.db.close(); } catch { /* already closed */ }
  }
}
