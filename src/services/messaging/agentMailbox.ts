/**
 * Core messaging service — AgentMailbox.
 *
 * In-memory message store with JSONL persistence, TTL sweep,
 * recipient visibility filtering, and cross-process file watching.
 *
 * Messages are NOT stored in the instruction index (A-3).
 * Config via runtimeConfig (S-4).
 */
import path from 'path';
import {
  type AgentMessage,
  type SendMessageOptions,
  type ReadMessagesOptions,
  type ChannelInfo,
  type MessagingStats,
  MAX_TTL_SECONDS,
  DEFAULT_TTL_SECONDS,
} from './messagingTypes';
import {
  appendMessage,
  loadMessages,
  rewriteMessages,
} from './messagingPersistence';
import type { MessagingConfig } from '../../config/runtimeConfig';

let messageCounter = 0;
const instanceId = `${process.pid}@${path.basename(process.cwd())}`;

export class AgentMailbox {
  private readonly store = new Map<string, AgentMessage>();
  private readonly idIndex = new Map<string, string>();
  private readonly config: MessagingConfig;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private loaded = false;

  constructor(config: MessagingConfig) {
    this.config = config;
    if (config.sweepIntervalMs > 0) {
      this.startSweep();
    }
  }

  /** Load messages from disk if not already loaded. */
  ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const msgs = loadMessages(this.config.dir);
    for (const msg of msgs) {
      const key = this.makeKey(msg);
      this.store.set(key, msg);
      this.idIndex.set(msg.id, key);
    }
  }

  /** Send a message. Returns the message ID. */
  async send(opts: SendMessageOptions): Promise<string> {
    this.ensureLoaded();

    const id = `msg-${++messageCounter}-${Date.now()}`;
    const ttl = opts.persistent
      ? 0
      : Math.min(Math.max(1, opts.ttlSeconds ?? DEFAULT_TTL_SECONDS), MAX_TTL_SECONDS);

    const msg: AgentMessage = {
      id,
      channel: opts.channel,
      sender: opts.sender,
      recipients: opts.recipients,
      body: opts.body,
      createdAt: new Date().toISOString(),
      ttlSeconds: ttl,
      persistent: opts.persistent,
      readBy: [],
      payload: opts.payload,
      priority: opts.priority,
      parentId: opts.parentId,
      requiresAck: opts.requiresAck,
      ackBySeconds: opts.ackBySeconds,
      tags: opts.tags,
      origin: instanceId,
    };

    const key = this.makeKey(msg);
    this.store.set(key, msg);
    this.idIndex.set(id, key);

    // Persist to JSONL
    appendMessage(msg, this.config.dir);

    return id;
  }

  /** Read messages with visibility filtering. */
  read(opts: ReadMessagesOptions = {}): AgentMessage[] {
    this.ensureLoaded();

    let messages = Array.from(this.store.values());

    // Filter by channel
    if (opts.channel) {
      messages = messages.filter(m => m.channel === opts.channel);
    }

    // Filter by recipient visibility
    if (opts.reader) {
      messages = messages.filter(m => this.isRecipient(m, opts.reader!));
    }

    // Filter unread-only
    if (opts.unreadOnly && opts.reader) {
      messages = messages.filter(m => !m.readBy?.includes(opts.reader!));
    }

    // Filter by tags (match any)
    if (opts.tags?.length) {
      messages = messages.filter(m => m.tags?.some(t => opts.tags!.includes(t)));
    }

    // Filter by sender
    if (opts.sender) {
      messages = messages.filter(m => m.sender === opts.sender);
    }

    // Sort by createdAt (oldest first)
    messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // Apply limit
    if (opts.limit && opts.limit > 0) {
      messages = messages.slice(0, opts.limit);
    }

    // Mark as read
    if (opts.markRead && opts.reader && opts.reader !== '*') {
      for (const msg of messages) {
        if (!msg.readBy) msg.readBy = [];
        if (!msg.readBy.includes(opts.reader)) {
          msg.readBy.push(opts.reader);
        }
      }
      this.persistAll();
    }

    return messages;
  }

  /** List all channels with message counts. */
  listChannels(): ChannelInfo[] {
    this.ensureLoaded();
    const channels = new Map<string, { count: number; latest: string | null }>();

    for (const msg of this.store.values()) {
      const info = channels.get(msg.channel) || { count: 0, latest: null };
      info.count++;
      if (!info.latest || msg.createdAt > info.latest) {
        info.latest = msg.createdAt;
      }
      channels.set(msg.channel, info);
    }

    return Array.from(channels.entries()).map(([channel, info]) => ({
      channel,
      messageCount: info.count,
      latestAt: info.latest,
    }));
  }

  /**
   * Acknowledge messages by marking them read.
   * Idempotent: returns the count of message IDs successfully resolved and ack'd
   * for the reader, regardless of whether the reader had already been added by a
   * prior `read({ markRead: true })` call. Unknown IDs are silently skipped.
   */
  ack(messageIds: string[], reader: string): number {
    this.ensureLoaded();
    let count = 0;
    let dirty = false;

    for (const id of messageIds) {
      const key = this.idIndex.get(id);
      if (!key) continue;
      const msg = this.store.get(key);
      if (!msg) continue;

      if (!msg.readBy) msg.readBy = [];
      if (!msg.readBy.includes(reader)) {
        msg.readBy.push(reader);
        dirty = true;
      }
      count++;
    }

    if (dirty) this.persistAll();
    return count;
  }

  /** Get stats for a reader. */
  getStats(reader: string): MessagingStats {
    this.ensureLoaded();
    const messages = Array.from(this.store.values());
    const visible = messages.filter(m => this.isRecipient(m, reader));
    const unread = visible.filter(m => !m.readBy?.includes(reader));
    const channelSet = new Set(visible.map(m => m.channel));

    return {
      total: visible.length,
      unread: unread.length,
      channels: channelSet.size,
    };
  }

  /** Get a single message by ID. */
  getMessage(id: string): AgentMessage | undefined {
    this.ensureLoaded();
    const key = this.idIndex.get(id);
    return key ? this.store.get(key) : undefined;
  }

  /** Update mutable fields of a message. */
  updateMessage(
    id: string,
    updates: { body?: string; recipients?: string[]; payload?: Record<string, unknown>; persistent?: boolean },
  ): AgentMessage | undefined {
    this.ensureLoaded();
    const key = this.idIndex.get(id);
    if (!key) return undefined;
    const msg = this.store.get(key);
    if (!msg) return undefined;

    if (updates.body !== undefined) msg.body = updates.body;
    if (updates.recipients !== undefined) msg.recipients = updates.recipients;
    if (updates.payload !== undefined) msg.payload = updates.payload;
    if (updates.persistent !== undefined) {
      msg.persistent = updates.persistent;
      if (updates.persistent) msg.ttlSeconds = 0;
    }

    this.persistAll();
    return msg;
  }

  /** Purge all messages. Returns count removed. */
  purgeAll(): number {
    this.ensureLoaded();
    const count = this.store.size;
    this.store.clear();
    this.idIndex.clear();
    rewriteMessages([], this.config.dir);
    return count;
  }

  /** Purge messages by channel. Returns count removed. */
  purgeChannel(channel: string): number {
    this.ensureLoaded();
    let count = 0;

    for (const [key, msg] of this.store.entries()) {
      if (msg.channel === channel) {
        this.store.delete(key);
        this.idIndex.delete(msg.id);
        count++;
      }
    }

    if (count > 0) this.persistAll();
    return count;
  }

  /** Delete specific messages by IDs. Returns count removed. */
  deleteMessages(ids: string[]): number {
    this.ensureLoaded();
    let count = 0;

    for (const id of ids) {
      const key = this.idIndex.get(id);
      if (!key) continue;
      this.store.delete(key);
      this.idIndex.delete(id);
      count++;
    }

    if (count > 0) this.persistAll();
    return count;
  }

  /** Remove expired non-persistent messages. */
  sweepExpired(): number {
    this.ensureLoaded();
    const now = Date.now();
    let count = 0;

    for (const [key, msg] of this.store.entries()) {
      if (msg.persistent) continue;
      if (msg.ttlSeconds <= 0) continue;
      const age = now - new Date(msg.createdAt).getTime();
      if (age > msg.ttlSeconds * 1000) {
        this.store.delete(key);
        this.idIndex.delete(msg.id);
        count++;
      }
    }

    if (count > 0) this.persistAll();
    return count;
  }

  /** Reply to a message, auto-populating channel, parentId, and original recipients. */
  async reply(
    parentId: string,
    sender: string,
    body: string,
    opts: { replyAll?: boolean; recipients?: string[]; priority?: string; tags?: string[]; persistent?: boolean; payload?: Record<string, unknown> } = {},
  ): Promise<{ messageId: string; channel: string; recipients: string[] }> {
    this.ensureLoaded();
    const parent = this.getMessage(parentId);
    if (!parent) throw new Error(`Parent message not found: ${parentId}`);

    let recipients: string[];
    if (opts.recipients?.length) {
      recipients = opts.recipients;
    } else if (opts.replyAll) {
      // Reply-all: original sender + all recipients, excluding self
      const all = new Set([parent.sender, ...parent.recipients]);
      all.delete(sender);
      all.delete('*');
      recipients = all.size > 0 ? Array.from(all) : [parent.sender];
    } else {
      // Default: reply to sender only
      recipients = [parent.sender];
    }

    const messageId = await this.send({
      channel: parent.channel,
      sender,
      recipients,
      body,
      parentId,
      priority: (opts.priority as SendMessageOptions['priority']) ?? parent.priority,
      tags: opts.tags,
      persistent: opts.persistent,
      payload: opts.payload,
    });

    return { messageId, channel: parent.channel, recipients };
  }

  /** Get all messages in a thread (by parentId). Returns parent + replies sorted chronologically. */
  getThread(parentId: string): AgentMessage[] {
    this.ensureLoaded();
    const results: AgentMessage[] = [];

    // Include the parent itself
    const parent = this.getMessage(parentId);
    if (parent) results.push(parent);

    // Find all replies (direct and nested)
    const idSet = new Set([parentId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const msg of this.store.values()) {
        if (msg.parentId && idSet.has(msg.parentId) && !idSet.has(msg.id)) {
          results.push(msg);
          idSet.add(msg.id);
          changed = true;
        }
      }
    }

    results.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return results;
  }

  /** Destroy the mailbox, stopping any timers. */
  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────

  private makeKey(msg: AgentMessage): string {
    return `msg/${msg.channel}/${new Date(msg.createdAt).getTime()}-${msg.id}`;
  }

  private isRecipient(msg: AgentMessage, reader: string): boolean {
    if (reader === '*') return true;
    if (msg.recipients.includes('*')) return true;
    if (msg.sender === reader) return true;
    return msg.recipients.includes(reader);
  }

  private persistAll(): void {
    const messages = Array.from(this.store.values());
    rewriteMessages(messages, this.config.dir);
  }

  private startSweep(): void {
    this.sweepTimer = setInterval(() => {
      this.sweepExpired();
    }, this.config.sweepIntervalMs);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }
}
