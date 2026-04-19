/**
 * Unit tests for AgentMailbox core service.
 * TDD Phase: RED → GREEN
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentMailbox } from '../../../services/messaging/agentMailbox';
import { _resetDedupState } from '../../../services/messaging/messagingPersistence';
import type { AgentMessage } from '../../../services/messaging/messagingTypes';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mailbox-test-'));
}

describe('AgentMailbox', () => {
  let tmpDir: string;
  let mailbox: AgentMailbox;

  beforeEach(() => {
    tmpDir = makeTempDir();
    _resetDedupState();
    mailbox = new AgentMailbox({ dir: tmpDir, maxMessages: 1000, sweepIntervalMs: 0 });
  });

  afterEach(() => {
    mailbox.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('send()', () => {
    it('returns a message ID', async () => {
      const id = await mailbox.send({
        channel: 'general',
        sender: 'agent-a',
        recipients: ['*'],
        body: 'Hello',
      });
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('generates unique IDs', async () => {
      const id1 = await mailbox.send({ channel: 'c', sender: 's', recipients: ['*'], body: 'a' });
      const id2 = await mailbox.send({ channel: 'c', sender: 's', recipients: ['*'], body: 'b' });
      expect(id1).not.toBe(id2);
    });

    it('persists message to JSONL', async () => {
      await mailbox.send({ channel: 'general', sender: 'a', recipients: ['*'], body: 'Hi' });
      const filePath = path.join(tmpDir, 'messages.jsonl');
      expect(fs.existsSync(filePath)).toBe(true);
      const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
    });

    it('defaults ttlSeconds to DEFAULT_TTL_SECONDS', async () => {
      const id = await mailbox.send({ channel: 'c', sender: 's', recipients: ['*'], body: 'x' });
      const msg = mailbox.getMessage(id);
      expect(msg?.ttlSeconds).toBe(3600);
    });

    it('clamps ttlSeconds to MAX_TTL_SECONDS', async () => {
      const id = await mailbox.send({
        channel: 'c', sender: 's', recipients: ['*'], body: 'x',
        ttlSeconds: 999999,
      });
      const msg = mailbox.getMessage(id);
      expect(msg?.ttlSeconds).toBe(86400);
    });

    it('sets persistent flag correctly', async () => {
      const id = await mailbox.send({
        channel: 'c', sender: 's', recipients: ['*'], body: 'x',
        persistent: true,
      });
      const msg = mailbox.getMessage(id);
      expect(msg?.persistent).toBe(true);
      expect(msg?.ttlSeconds).toBe(0);
    });

    it('sets origin to PID@instance', async () => {
      const id = await mailbox.send({ channel: 'c', sender: 's', recipients: ['*'], body: 'x' });
      const msg = mailbox.getMessage(id);
      expect(msg?.origin).toMatch(/^\d+@/);
    });
  });

  describe('read()', () => {
    it('returns messages for broadcast recipients', async () => {
      await mailbox.send({ channel: 'general', sender: 'a', recipients: ['*'], body: 'Hi' });
      const result = mailbox.read({ channel: 'general', reader: 'anyone' });
      expect(result).toHaveLength(1);
    });

    it('returns messages for directed recipients', async () => {
      await mailbox.send({ channel: 'general', sender: 'a', recipients: ['agent-b'], body: 'Hi' });
      const result = mailbox.read({ channel: 'general', reader: 'agent-b' });
      expect(result).toHaveLength(1);
    });

    it('hides messages from non-recipients', async () => {
      await mailbox.send({ channel: 'general', sender: 'a', recipients: ['agent-b'], body: 'Hi' });
      const result = mailbox.read({ channel: 'general', reader: 'agent-c' });
      expect(result).toHaveLength(0);
    });

    it('sender can read their own directed messages', async () => {
      await mailbox.send({ channel: 'general', sender: 'a', recipients: ['agent-b'], body: 'Hi' });
      const result = mailbox.read({ channel: 'general', reader: 'a' });
      expect(result).toHaveLength(1);
    });

    it('admin reader (*) can read all messages', async () => {
      await mailbox.send({ channel: 'general', sender: 'a', recipients: ['agent-b'], body: 'Hi' });
      const result = mailbox.read({ channel: 'general', reader: '*' });
      expect(result).toHaveLength(1);
    });

    it('filters by channel', async () => {
      await mailbox.send({ channel: 'ch1', sender: 'a', recipients: ['*'], body: 'msg1' });
      await mailbox.send({ channel: 'ch2', sender: 'a', recipients: ['*'], body: 'msg2' });
      const result = mailbox.read({ channel: 'ch1', reader: '*' });
      expect(result).toHaveLength(1);
      expect(result[0].channel).toBe('ch1');
    });

    it('respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: `msg-${i}` });
      }
      const result = mailbox.read({ channel: 'c', reader: '*', limit: 3 });
      expect(result).toHaveLength(3);
    });

    it('returns messages sorted by createdAt (oldest first)', async () => {
      await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'first' });
      await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'second' });
      const result = mailbox.read({ channel: 'c', reader: '*' });
      expect(result[0].body).toBe('first');
      expect(result[1].body).toBe('second');
    });

    it('marks messages as read when markRead=true', async () => {
      const id = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'x' });
      mailbox.read({ channel: 'c', reader: 'bob', markRead: true });
      const msg = mailbox.getMessage(id);
      expect(msg?.readBy).toContain('bob');
    });

    it('filters unread-only when unreadOnly=true', async () => {
      await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'msg1' });
      await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'msg2' });

      // Read one to mark it
      mailbox.read({ channel: 'c', reader: 'bob', markRead: true, limit: 1 });

      const unread = mailbox.read({ channel: 'c', reader: 'bob', unreadOnly: true });
      expect(unread).toHaveLength(1);
      expect(unread[0].body).toBe('msg2');
    });
  });

  describe('listChannels()', () => {
    it('returns empty array when no messages', () => {
      expect(mailbox.listChannels()).toEqual([]);
    });

    it('lists all channels with counts', async () => {
      await mailbox.send({ channel: 'ch1', sender: 'a', recipients: ['*'], body: 'a' });
      await mailbox.send({ channel: 'ch1', sender: 'a', recipients: ['*'], body: 'b' });
      await mailbox.send({ channel: 'ch2', sender: 'a', recipients: ['*'], body: 'c' });

      const channels = mailbox.listChannels();
      expect(channels).toHaveLength(2);
      const ch1 = channels.find(c => c.channel === 'ch1');
      expect(ch1?.messageCount).toBe(2);
    });
  });

  describe('ack()', () => {
    it('marks messages as read by reader', async () => {
      const id = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'x' });
      const count = mailbox.ack([id], 'bob');
      expect(count).toBe(1);
      expect(mailbox.getMessage(id)?.readBy).toContain('bob');
    });

    it('returns 0 for non-existent message IDs', () => {
      expect(mailbox.ack(['fake-id'], 'bob')).toBe(0);
    });

    it('does not duplicate readBy entries', async () => {
      const id = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'x' });
      mailbox.ack([id], 'bob');
      mailbox.ack([id], 'bob');
      expect(mailbox.getMessage(id)?.readBy?.filter(r => r === 'bob')).toHaveLength(1);
    });
  });

  describe('getStats()', () => {
    it('returns zero stats when empty', () => {
      const stats = mailbox.getStats('anyone');
      expect(stats.total).toBe(0);
      expect(stats.unread).toBe(0);
      expect(stats.channels).toBe(0);
    });

    it('returns correct stats for reader', async () => {
      await mailbox.send({ channel: 'ch1', sender: 'a', recipients: ['*'], body: 'a' });
      await mailbox.send({ channel: 'ch2', sender: 'a', recipients: ['*'], body: 'b' });

      const stats = mailbox.getStats('reader');
      expect(stats.total).toBe(2);
      expect(stats.unread).toBe(2);
      expect(stats.channels).toBe(2);
    });
  });

  describe('getMessage()', () => {
    it('returns message by ID', async () => {
      const id = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'x' });
      const msg = mailbox.getMessage(id);
      expect(msg).toBeDefined();
      expect(msg?.id).toBe(id);
    });

    it('returns undefined for non-existent ID', () => {
      expect(mailbox.getMessage('fake')).toBeUndefined();
    });
  });

  describe('updateMessage()', () => {
    it('updates body', async () => {
      const id = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'old' });
      const updated = mailbox.updateMessage(id, { body: 'new' });
      expect(updated?.body).toBe('new');
    });

    it('updates recipients', async () => {
      const id = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'x' });
      const updated = mailbox.updateMessage(id, { recipients: ['agent-b'] });
      expect(updated?.recipients).toEqual(['agent-b']);
    });

    it('returns undefined for non-existent ID', () => {
      expect(mailbox.updateMessage('fake', { body: 'x' })).toBeUndefined();
    });
  });

  describe('purge()', () => {
    it('purges all messages', async () => {
      await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'a' });
      await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'b' });
      const count = mailbox.purgeAll();
      expect(count).toBe(2);
      expect(mailbox.read({ reader: '*' })).toHaveLength(0);
    });

    it('purges by channel', async () => {
      await mailbox.send({ channel: 'ch1', sender: 'a', recipients: ['*'], body: 'a' });
      await mailbox.send({ channel: 'ch2', sender: 'a', recipients: ['*'], body: 'b' });
      const count = mailbox.purgeChannel('ch1');
      expect(count).toBe(1);
      expect(mailbox.read({ reader: '*' })).toHaveLength(1);
    });

    it('deletes by message IDs', async () => {
      const id1 = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'a' });
      const id2 = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'b' });
      const count = mailbox.deleteMessages([id1]);
      expect(count).toBe(1);
      expect(mailbox.getMessage(id1)).toBeUndefined();
      expect(mailbox.getMessage(id2)).toBeDefined();
    });
  });

  describe('TTL sweep', () => {
    it('removes expired non-persistent messages', async () => {
      const id = await mailbox.send({
        channel: 'c', sender: 'a', recipients: ['*'], body: 'x',
        ttlSeconds: 1,
      });

      // Manually set createdAt to the past
      const msg = mailbox.getMessage(id)!;
      (msg as AgentMessage).createdAt = new Date(Date.now() - 2000).toISOString();

      mailbox.sweepExpired();
      expect(mailbox.getMessage(id)).toBeUndefined();
    });

    it('preserves persistent messages', async () => {
      const id = await mailbox.send({
        channel: 'c', sender: 'a', recipients: ['*'], body: 'x',
        persistent: true,
      });

      mailbox.sweepExpired();
      expect(mailbox.getMessage(id)).toBeDefined();
    });
  });

  describe('reload()', () => {
    it('reloads messages from disk', async () => {
      await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'original' });

      // Create a new mailbox reading same directory
      const mailbox2 = new AgentMailbox({ dir: tmpDir, maxMessages: 1000, sweepIntervalMs: 0 });
      mailbox2.ensureLoaded();
      const msgs = mailbox2.read({ reader: '*' });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].body).toBe('original');
      mailbox2.destroy();
    });
  });
});
