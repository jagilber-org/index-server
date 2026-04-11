/**
 * SqliteMessageStore — Message persistence backed by node:sqlite.
 *
 * Stores agent messages in the messages table with indexing on
 * channel, sender, parent_id, and created_at for efficient queries.
 */

import { DatabaseSync } from 'node:sqlite';
import { INSTRUCTIONS_DDL, PRAGMAS } from './sqliteSchema.js';

export interface StoredMessage {
  id: string;
  channel: string;
  sender: string;
  recipients: string[];
  body: string;
  priority: string;
  tags: string[];
  parentId: string | null;
  persistent: boolean;
  ttlSeconds: number | null;
  requiresAck: boolean;
  ackBySeconds: number | null;
  readBy: string[];
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface MessageQuery {
  channel?: string;
  sender?: string;
  tags?: string[];
  parentId?: string;
  limit?: number;
  offset?: number;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function rowToMessage(row: Record<string, unknown>): StoredMessage {
  return {
    id: row.id as string,
    channel: row.channel as string,
    sender: row.sender as string,
    recipients: safeJsonParse(row.recipients as string, []),
    body: row.body as string,
    priority: (row.priority as string) ?? 'normal',
    tags: safeJsonParse(row.tags as string, []),
    parentId: row.parent_id as string | null,
    persistent: !!(row.persistent as number),
    ttlSeconds: row.ttl_seconds as number | null,
    requiresAck: !!(row.requires_ack as number),
    ackBySeconds: row.ack_by_seconds as number | null,
    readBy: safeJsonParse(row.read_by as string, []),
    payload: safeJsonParse(row.payload as string, null),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export class SqliteMessageStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(PRAGMAS);
    this.db.exec(INSTRUCTIONS_DDL);
  }

  /** Store a message. */
  write(msg: StoredMessage): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO messages (
        id, channel, sender, recipients, body, priority, tags,
        parent_id, persistent, ttl_seconds, requires_ack, ack_by_seconds,
        read_by, payload, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id, msg.channel, msg.sender,
      JSON.stringify(msg.recipients), msg.body, msg.priority,
      JSON.stringify(msg.tags), msg.parentId,
      msg.persistent ? 1 : 0, msg.ttlSeconds,
      msg.requiresAck ? 1 : 0, msg.ackBySeconds,
      JSON.stringify(msg.readBy), JSON.stringify(msg.payload),
      msg.createdAt, msg.updatedAt,
    );
  }

  /** Get a message by ID. */
  get(id: string): StoredMessage | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToMessage(row) : null;
  }

  /** Query messages with filters. */
  query(opts: MessageQuery): StoredMessage[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.channel) { conditions.push('channel = ?'); params.push(opts.channel); }
    if (opts.sender) { conditions.push('sender = ?'); params.push(opts.sender); }
    if (opts.parentId) { conditions.push('parent_id = ?'); params.push(opts.parentId); }

    let sql = 'SELECT * FROM messages';
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    if (opts.offset) { sql += ' OFFSET ?'; params.push(opts.offset); }

    const rows = this.db.prepare(sql).all(...params);
    let results = rows.map(r => rowToMessage(r as Record<string, unknown>));

    // Tag filtering (post-query since tags are JSON arrays)
    if (opts.tags?.length) {
      const tagSet = new Set(opts.tags);
      results = results.filter(m => m.tags.some(t => tagSet.has(t)));
    }

    return results;
  }

  /** Get thread (parent + all descendants). */
  getThread(parentId: string): StoredMessage[] {
    const results: StoredMessage[] = [];
    const parent = this.get(parentId);
    if (parent) results.push(parent);

    // Recursive CTE would be ideal but simple BFS for now
    const children = this.db.prepare(
      'SELECT * FROM messages WHERE parent_id = ? ORDER BY created_at ASC'
    ).all(parentId);

    for (const row of children) {
      const msg = rowToMessage(row as Record<string, unknown>);
      results.push(msg);
      // Recursively get children of children
      const descendants = this.getThread(msg.id);
      // Skip the first element (which is msg itself from the recursive call's parent lookup)
      results.push(...descendants.slice(1));
    }

    return results;
  }

  /** List distinct channels. */
  channels(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT channel FROM messages ORDER BY channel').all();
    return rows.map(r => (r as Record<string, unknown>).channel as string);
  }

  /** Delete a message by ID. */
  remove(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  }

  /** Purge all messages in a channel. */
  purgeChannel(channel: string): number {
    const result = this.db.prepare('DELETE FROM messages WHERE channel = ?').run(channel);
    return result.changes;
  }

  /** Count messages. */
  count(channel?: string): number {
    if (channel) {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM messages WHERE channel = ?').get(channel) as Record<string, unknown>;
      return (row?.cnt as number) ?? 0;
    }
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM messages').get() as Record<string, unknown>;
    return (row?.cnt as number) ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
