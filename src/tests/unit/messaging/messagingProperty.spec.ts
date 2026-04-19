/**
 * Property-based tests for messaging system using fast-check.
 * Fuzzes TTL clamping, recipient visibility, and message payloads.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentMailbox } from '../../../services/messaging/agentMailbox';
import { _resetDedupState } from '../../../services/messaging/messagingPersistence';
import {
  AgentMessageSchema,
  MAX_TTL_SECONDS,
} from '../../../services/messaging/messagingTypes';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'msg-prop-'));
}

describe('Messaging Property-Based Tests', () => {
  let tmpDir: string;
  let mailbox: AgentMailbox;

  beforeEach(() => {
    tmpDir = makeTempDir();
    _resetDedupState();
    mailbox = new AgentMailbox({ dir: tmpDir, maxMessages: 10000, sweepIntervalMs: 0 });
  });

  afterEach(() => {
    mailbox.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('TTL clamping', () => {
    it('ttlSeconds always clamped to [1, MAX_TTL_SECONDS] for non-persistent', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -10000, max: 200000 }),
          async (ttl) => {
            const id = await mailbox.send({
              channel: 'ttl-test',
              sender: 'a',
              recipients: ['*'],
              body: 'x',
              ttlSeconds: ttl,
            });
            const msg = mailbox.getMessage(id);
            expect(msg).toBeDefined();
            expect(msg!.ttlSeconds).toBeGreaterThanOrEqual(1);
            expect(msg!.ttlSeconds).toBeLessThanOrEqual(MAX_TTL_SECONDS);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('persistent messages always have ttlSeconds=0', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -1000, max: 200000 }),
          async (ttl) => {
            const id = await mailbox.send({
              channel: 'persist-test',
              sender: 'a',
              recipients: ['*'],
              body: 'x',
              ttlSeconds: ttl,
              persistent: true,
            });
            const msg = mailbox.getMessage(id);
            expect(msg!.ttlSeconds).toBe(0);
            expect(msg!.persistent).toBe(true);
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('Recipient visibility invariant', () => {
    it('broadcast messages always visible to any reader', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          async (reader) => {
            await mailbox.send({
              channel: 'vis',
              sender: 'sys',
              recipients: ['*'],
              body: 'broadcast',
            });
            const msgs = mailbox.read({ channel: 'vis', reader });
            expect(msgs.length).toBeGreaterThanOrEqual(1);
          },
        ),
        { numRuns: 20 },
      );
    });

    it('directed messages hidden from non-recipients', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }).filter(s => s !== 'sender' && s !== 'target'),
          async (outsider) => {
            const mb = new AgentMailbox({ dir: makeTempDir(), maxMessages: 100, sweepIntervalMs: 0 });
            await mb.send({
              channel: 'direct',
              sender: 'sender',
              recipients: ['target'],
              body: 'private',
            });
            const msgs = mb.read({ channel: 'direct', reader: outsider });
            expect(msgs).toHaveLength(0);
            mb.destroy();
          },
        ),
        { numRuns: 20 },
      );
    });
  });

  describe('Message body preservation', () => {
    it('body content survives round-trip without modification', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 1000 }),
          async (body) => {
            const mb = new AgentMailbox({ dir: makeTempDir(), maxMessages: 100, sweepIntervalMs: 0 });
            const id = await mb.send({
              channel: 'body-test',
              sender: 'a',
              recipients: ['*'],
              body,
            });
            const msg = mb.getMessage(id);
            expect(msg?.body).toBe(body);
            mb.destroy();
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('Schema validation', () => {
    it('AgentMessageSchema accepts all sent messages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            channel: fc.string({ minLength: 1, maxLength: 50 }),
            body: fc.string({ minLength: 1, maxLength: 500 }),
            priority: fc.constantFrom('low' as const, 'normal' as const, 'high' as const, 'critical' as const),
          }),
          async ({ channel, body, priority }) => {
            const id = await mailbox.send({
              channel,
              sender: 'agent',
              recipients: ['*'],
              body,
              priority,
            });
            const msg = mailbox.getMessage(id);
            const result = AgentMessageSchema.safeParse(msg);
            expect(result.success).toBe(true);
          },
        ),
        { numRuns: 30 },
      );
    });
  });

  describe('Channel listing consistency', () => {
    it('listChannels count matches actual message counts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.constantFrom('ch1', 'ch2', 'ch3'), { minLength: 1, maxLength: 20 }),
          async (channels) => {
            const mb = new AgentMailbox({ dir: makeTempDir(), maxMessages: 100, sweepIntervalMs: 0 });
            for (const ch of channels) {
              await mb.send({ channel: ch, sender: 'a', recipients: ['*'], body: 'x' });
            }
            const listed = mb.listChannels();
            const totalFromChannels = listed.reduce((s, c) => s + c.messageCount, 0);
            expect(totalFromChannels).toBe(channels.length);
            mb.destroy();
          },
        ),
        { numRuns: 20 },
      );
    });
  });
});
