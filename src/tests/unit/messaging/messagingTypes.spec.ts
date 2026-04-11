/**
 * Unit tests for messaging types, Zod schemas, and constants.
 * TDD Phase: RED — write tests before implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentMessageSchema,
  SendMessageOptionsSchema,
  ReadMessagesOptionsSchema,
  MAX_TTL_SECONDS,
  DEFAULT_TTL_SECONDS,
  SWEEP_INTERVAL_MS,
  type AgentMessage,
  type SendMessageOptions,
  type ReadMessagesOptions,
  type MessagePriority,
} from '../../../services/messaging/messagingTypes';

describe('Messaging Types & Constants', () => {
  describe('Constants', () => {
    it('MAX_TTL_SECONDS is 86400 (24h)', () => {
      expect(MAX_TTL_SECONDS).toBe(86_400);
    });

    it('DEFAULT_TTL_SECONDS is 3600 (1h)', () => {
      expect(DEFAULT_TTL_SECONDS).toBe(3_600);
    });

    it('SWEEP_INTERVAL_MS is 60000 (60s)', () => {
      expect(SWEEP_INTERVAL_MS).toBe(60_000);
    });
  });

  describe('AgentMessageSchema', () => {
    const validMessage: AgentMessage = {
      id: 'msg-1-1711929600000',
      channel: 'general',
      sender: 'agent-a',
      recipients: ['*'],
      body: 'Hello world',
      createdAt: '2026-04-04T00:00:00.000Z',
      ttlSeconds: 3600,
    };

    it('accepts a valid minimal message', () => {
      const result = AgentMessageSchema.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    it('accepts a fully populated message', () => {
      const full: AgentMessage = {
        ...validMessage,
        persistent: true,
        readBy: ['agent-b'],
        payload: { key: 'value' },
        priority: 'high',
        parentId: 'msg-0-1711929599000',
        requiresAck: true,
        ackBySeconds: 300,
        tags: ['urgent', 'review'],
        origin: '12345@index-server',
      };
      const result = AgentMessageSchema.safeParse(full);
      expect(result.success).toBe(true);
    });

    it('rejects message with missing required fields', () => {
      const result = AgentMessageSchema.safeParse({ id: 'msg-1' });
      expect(result.success).toBe(false);
    });

    it('rejects message with empty id', () => {
      const result = AgentMessageSchema.safeParse({ ...validMessage, id: '' });
      expect(result.success).toBe(false);
    });

    it('rejects message with empty channel', () => {
      const result = AgentMessageSchema.safeParse({ ...validMessage, channel: '' });
      expect(result.success).toBe(false);
    });

    it('rejects message with invalid priority', () => {
      const result = AgentMessageSchema.safeParse({ ...validMessage, priority: 'ultra' });
      expect(result.success).toBe(false);
    });

    it('rejects message with ttlSeconds below 0', () => {
      const result = AgentMessageSchema.safeParse({ ...validMessage, ttlSeconds: -1 });
      expect(result.success).toBe(false);
    });

    it('rejects message with ttlSeconds above MAX_TTL_SECONDS', () => {
      const result = AgentMessageSchema.safeParse({ ...validMessage, ttlSeconds: MAX_TTL_SECONDS + 1 });
      expect(result.success).toBe(false);
    });

    it('allows ttlSeconds of 0 for persistent messages', () => {
      const result = AgentMessageSchema.safeParse({ ...validMessage, ttlSeconds: 0, persistent: true });
      expect(result.success).toBe(true);
    });

    it('rejects empty recipients array', () => {
      const result = AgentMessageSchema.safeParse({ ...validMessage, recipients: [] });
      expect(result.success).toBe(false);
    });

    it('validates priority enum values', () => {
      for (const p of ['low', 'normal', 'high', 'critical'] as MessagePriority[]) {
        const result = AgentMessageSchema.safeParse({ ...validMessage, priority: p });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('SendMessageOptionsSchema', () => {
    const validOpts: SendMessageOptions = {
      channel: 'general',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'Test message',
    };

    it('accepts valid minimal options', () => {
      const result = SendMessageOptionsSchema.safeParse(validOpts);
      expect(result.success).toBe(true);
    });

    it('accepts options with all optional fields', () => {
      const full: SendMessageOptions = {
        ...validOpts,
        ttlSeconds: 7200,
        persistent: false,
        payload: { task: 'review' },
        priority: 'high',
        parentId: 'msg-0',
        requiresAck: true,
        ackBySeconds: 600,
        tags: ['dev'],
      };
      const result = SendMessageOptionsSchema.safeParse(full);
      expect(result.success).toBe(true);
    });

    it('rejects options missing channel', () => {
      const { channel: _, ...rest } = validOpts;
      const result = SendMessageOptionsSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('rejects options missing sender', () => {
      const { sender: _, ...rest } = validOpts;
      const result = SendMessageOptionsSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('rejects options missing body', () => {
      const { body: _, ...rest } = validOpts;
      const result = SendMessageOptionsSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it('rejects options with body exceeding 100KB', () => {
      const result = SendMessageOptionsSchema.safeParse({ ...validOpts, body: 'x'.repeat(100_001) });
      expect(result.success).toBe(false);
    });
  });

  describe('ReadMessagesOptionsSchema', () => {
    it('accepts empty options (all defaults)', () => {
      const result = ReadMessagesOptionsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('accepts full read options', () => {
      const opts: ReadMessagesOptions = {
        channel: 'general',
        reader: 'agent-a',
        unreadOnly: true,
        limit: 50,
        markRead: true,
      };
      const result = ReadMessagesOptionsSchema.safeParse(opts);
      expect(result.success).toBe(true);
    });

    it('rejects limit below 1', () => {
      const result = ReadMessagesOptionsSchema.safeParse({ limit: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects limit above 500', () => {
      const result = ReadMessagesOptionsSchema.safeParse({ limit: 501 });
      expect(result.success).toBe(false);
    });
  });
});
