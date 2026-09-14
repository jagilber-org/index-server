/**
 * SqliteUsageStore — Usage tracking backed by node:sqlite.
 *
 * Stores instruction usage counts, timestamps, and signals in the
 * usage table. Provides atomic increment and bulk snapshot operations.
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { INSTRUCTIONS_DDL, PRAGMAS } from './sqliteSchema.js';
import type { UsageSnapshotRecord } from './usageSnapshotFile.js';

export interface UsageRecord {
  instructionId: string;
  usageCount: number;
  firstSeenTs: string | null;
  lastUsedAt: string | null;
  lastAction: string | null;
  lastSignal: string | null;
  lastComment: string | null;
  /** Split usage counters (issue #418). Null means "unknown", not "zero". */
  retrievedCount: number | null;
  appliedCount: number | null;
  lastRetrievedAt: string | null;
  lastAppliedAt: string | null;
}

export interface TrackOptions {
  action?: string;
  signal?: string;
  comment?: string;
}

/** Map a `usage` table row to a UsageRecord. */
function toRecord(r: Record<string, unknown>): UsageRecord {
  return {
    instructionId: r.instruction_id as string,
    usageCount: (r.usage_count as number) ?? 0,
    firstSeenTs: r.first_seen_ts as string | null,
    lastUsedAt: r.last_used_at as string | null,
    lastAction: r.last_action as string | null,
    lastSignal: r.last_signal as string | null,
    lastComment: r.last_comment as string | null,
    retrievedCount: (r.retrieved_count as number | null) ?? null,
    appliedCount: (r.applied_count as number | null) ?? null,
    lastRetrievedAt: (r.last_retrieved_at as string | null) ?? null,
    lastAppliedAt: (r.last_applied_at as string | null) ?? null,
  };
}

export class SqliteUsageStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    // Create the parent directory first, matching JsonFileStore /
    // JsonEmbeddingStore / migrationEngine. Without this, a configured path
    // whose directory does not yet exist fails with "unable to open database
    // file", and the usage adapter silently falls back to the JSON snapshot —
    // splitting counters across two stores instead of failing loudly.
    const dir = path.dirname(dbPath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(PRAGMAS);
    this.db.exec(INSTRUCTIONS_DDL);
    this.ensureColumn('retrieved_count', 'INTEGER');
    this.ensureColumn('applied_count', 'INTEGER');
    this.ensureColumn('last_retrieved_at', 'TEXT');
    this.ensureColumn('last_applied_at', 'TEXT');
  }

  /** Additively add a column to the `usage` table if a pre-existing DB lacks it. */
  private ensureColumn(column: string, ddl: string): void {
    const rows = this.db.prepare('PRAGMA table_info(usage)').all() as Array<{ name?: string }>;
    if (rows.some(r => r.name === column)) return;
    try {
      this.db.exec(`ALTER TABLE usage ADD COLUMN ${column} ${ddl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (!msg.includes('duplicate column')) throw err;
    }
  }

  /**
   * Read the whole usage table in the snapshot record shape used by the usage
   * subsystem. This is the SQLite equivalent of reading usage-snapshot.json.
   */
  readAll(): Record<string, UsageSnapshotRecord> {
    const rows = this.db.prepare('SELECT * FROM usage').all();
    const out: Record<string, UsageSnapshotRecord> = {};
    for (const row of rows) {
      const r = toRecord(row as Record<string, unknown>);
      const rec: UsageSnapshotRecord = {};
      if (r.usageCount != null) rec.usageCount = r.usageCount;
      if (r.retrievedCount != null) rec.retrievedCount = r.retrievedCount;
      if (r.appliedCount != null) rec.appliedCount = r.appliedCount;
      if (r.firstSeenTs) rec.firstSeenTs = r.firstSeenTs;
      if (r.lastUsedAt) rec.lastUsedAt = r.lastUsedAt;
      if (r.lastRetrievedAt) rec.lastRetrievedAt = r.lastRetrievedAt;
      if (r.lastAppliedAt) rec.lastAppliedAt = r.lastAppliedAt;
      if (r.lastAction) rec.lastAction = r.lastAction;
      if (r.lastSignal) rec.lastSignal = r.lastSignal;
      if (r.lastComment) rec.lastComment = r.lastComment;
      out[r.instructionId] = rec;
    }
    return out;
  }

  /**
   * Replace the usage table with `data`, in a single transaction.
   *
   * Mirrors the atomic tmp+rename semantics of the JSON snapshot writer: a
   * crash mid-write must not leave counters partially applied.
   */
  writeAll(data: Record<string, UsageSnapshotRecord>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO usage (
        instruction_id, usage_count, first_seen_ts, last_used_at,
        last_action, last_signal, last_comment,
        retrieved_count, applied_count, last_retrieved_at, last_applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM usage');
      for (const [id, rec] of Object.entries(data)) {
        stmt.run(
          id,
          rec.usageCount ?? 0,
          rec.firstSeenTs ?? null,
          rec.lastUsedAt ?? null,
          rec.lastAction ?? null,
          rec.lastSignal ?? null,
          rec.lastComment ?? null,
          rec.retrievedCount ?? null,
          rec.appliedCount ?? null,
          rec.lastRetrievedAt ?? null,
          rec.lastAppliedAt ?? null,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw err;
    }
  }

  /** Get usage record for an instruction. */
  get(instructionId: string): UsageRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM usage WHERE instruction_id = ?'
    ).get(instructionId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return toRecord(row);
  }

  /** Increment usage count and update timestamps/signals. */
  increment(instructionId: string, opts?: TrackOptions): UsageRecord {
    const now = new Date().toISOString();
    const existing = this.get(instructionId);

    if (existing) {
      this.db.prepare(`
        UPDATE usage SET
          usage_count = usage_count + 1,
          last_used_at = ?,
          last_action = COALESCE(?, last_action),
          last_signal = COALESCE(?, last_signal),
          last_comment = COALESCE(?, last_comment)
        WHERE instruction_id = ?
      `).run(now, opts?.action ?? null, opts?.signal ?? null, opts?.comment ?? null, instructionId);
    } else {
      this.db.prepare(`
        INSERT INTO usage (instruction_id, usage_count, first_seen_ts, last_used_at, last_action, last_signal, last_comment)
        VALUES (?, 1, ?, ?, ?, ?, ?)
      `).run(instructionId, now, now, opts?.action ?? null, opts?.signal ?? null, opts?.comment ?? null);
    }

    return this.get(instructionId)!;
  }

  /** Get all usage records as a snapshot. */
  snapshot(): Record<string, UsageRecord> {
    const rows = this.db.prepare('SELECT * FROM usage').all();
    const result: Record<string, UsageRecord> = {};
    for (const row of rows) {
      const r = toRecord(row as Record<string, unknown>);
      result[r.instructionId] = r;
    }
    return result;
  }

  /** Reset usage for a specific instruction or all. */
  flush(instructionId?: string): void {
    if (instructionId) {
      this.db.prepare('DELETE FROM usage WHERE instruction_id = ?').run(instructionId);
    } else {
      this.db.exec('DELETE FROM usage');
    }
  }

  /** Count of tracked instructions. */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM usage').get() as Record<string, unknown>;
    return (row?.cnt as number) ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
