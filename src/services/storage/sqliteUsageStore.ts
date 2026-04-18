/**
 * SqliteUsageStore — Usage tracking backed by node:sqlite.
 *
 * Stores instruction usage counts, timestamps, and signals in the
 * usage table. Provides atomic increment and bulk snapshot operations.
 */

import { DatabaseSync } from 'node:sqlite';
import { INSTRUCTIONS_DDL, PRAGMAS } from './sqliteSchema.js';

export interface UsageRecord {
  instructionId: string;
  usageCount: number;
  firstSeenTs: string | null;
  lastUsedAt: string | null;
  lastAction: string | null;
  lastSignal: string | null;
  lastComment: string | null;
}

export interface TrackOptions {
  action?: string;
  signal?: string;
  comment?: string;
}

export class SqliteUsageStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(PRAGMAS);
    this.db.exec(INSTRUCTIONS_DDL);
  }

  /** Get usage record for an instruction. */
  get(instructionId: string): UsageRecord | null {
    const row = this.db.prepare(
      'SELECT * FROM usage WHERE instruction_id = ?'
    ).get(instructionId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      instructionId: row.instruction_id as string,
      usageCount: (row.usage_count as number) ?? 0,
      firstSeenTs: row.first_seen_ts as string | null,
      lastUsedAt: row.last_used_at as string | null,
      lastAction: row.last_action as string | null,
      lastSignal: row.last_signal as string | null,
      lastComment: row.last_comment as string | null,
    };
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
      const r = row as Record<string, unknown>;
      const id = r.instruction_id as string;
      result[id] = {
        instructionId: id,
        usageCount: (r.usage_count as number) ?? 0,
        firstSeenTs: r.first_seen_ts as string | null,
        lastUsedAt: r.last_used_at as string | null,
        lastAction: r.last_action as string | null,
        lastSignal: r.last_signal as string | null,
        lastComment: r.last_comment as string | null,
      };
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
