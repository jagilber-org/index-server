/**
 * Messaging types, Zod schemas, and constants.
 *
 * Defines the data model for the inter-agent messaging system.
 * Messages are short-term, ephemeral (not stored in the instruction index)
 * but persist across instances/sessions via JSONL files.
 */
import { z } from 'zod';

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum time-to-live in seconds (24 hours). */
export const MAX_TTL_SECONDS = 86_400;

/** Default time-to-live in seconds (1 hour). */
export const DEFAULT_TTL_SECONDS = 3_600;

/** Sweep interval in milliseconds (60 seconds). */
export const SWEEP_INTERVAL_MS = 60_000;

/** Maximum body size in characters (100KB). */
export const MAX_BODY_LENGTH = 100_000;

/** Maximum messages per read response. */
export const MAX_READ_LIMIT = 500;

// ── Priority enum ────────────────────────────────────────────────────────────

export const MESSAGE_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type MessagePriority = (typeof MESSAGE_PRIORITIES)[number];

// ── Zod schemas ──────────────────────────────────────────────────────────────

export const AgentMessageSchema = z.object({
  id: z.string().min(1),
  channel: z.string().min(1),
  sender: z.string().min(1),
  recipients: z.array(z.string().min(1)).min(1),
  body: z.string().min(1).max(MAX_BODY_LENGTH),
  createdAt: z.string().min(1),
  ttlSeconds: z.number().int().min(0).max(MAX_TTL_SECONDS),
  persistent: z.boolean().optional(),
  readBy: z.array(z.string()).optional(),
  payload: z.record(z.unknown()).optional(),
  priority: z.enum(MESSAGE_PRIORITIES).optional(),
  parentId: z.string().optional(),
  requiresAck: z.boolean().optional(),
  ackBySeconds: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
  origin: z.string().optional(),
}).strict();

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const SendMessageOptionsSchema = z.object({
  channel: z.string().min(1),
  sender: z.string().min(1),
  recipients: z.array(z.string().min(1)).min(1),
  body: z.string().min(1).max(MAX_BODY_LENGTH),
  ttlSeconds: z.number().int().min(1).max(MAX_TTL_SECONDS).optional(),
  persistent: z.boolean().optional(),
  payload: z.record(z.unknown()).optional(),
  priority: z.enum(MESSAGE_PRIORITIES).optional(),
  parentId: z.string().optional(),
  requiresAck: z.boolean().optional(),
  ackBySeconds: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
}).strict();

export type SendMessageOptions = z.infer<typeof SendMessageOptionsSchema>;

export const ReadMessagesOptionsSchema = z.object({
  channel: z.string().min(1).optional(),
  reader: z.string().min(1).optional(),
  unreadOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(MAX_READ_LIMIT).optional(),
  markRead: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  sender: z.string().min(1).optional(),
}).strict();

export type ReadMessagesOptions = z.infer<typeof ReadMessagesOptionsSchema>;

// ── Channel info type ────────────────────────────────────────────────────────

export interface ChannelInfo {
  channel: string;
  messageCount: number;
  latestAt: string | null;
}

// ── Stats type ───────────────────────────────────────────────────────────────

export interface MessagingStats {
  total: number;
  unread: number;
  channels: number;
}
