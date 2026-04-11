/**
 * Integration tests for messaging send/read round-trip and lifecycle.
 *
 * Tests the full pipeline: send → persist → read → ack → sweep → purge
 * using real mailbox instances with temp directories.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentMailbox } from '../../services/messaging/agentMailbox';
import { _resetDedupState, loadMessages } from '../../services/messaging/messagingPersistence';
import type { AgentMessage } from '../../services/messaging/messagingTypes';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'msg-integ-'));
}

describe('Messaging Integration — Send/Read Round-Trip', () => {
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

  it('send → persist → read → verify round-trip', async () => {
    const id = await mailbox.send({
      channel: 'integration',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'Integration test message',
      priority: 'high',
      tags: ['test'],
    });

    // Verify persistence
    const persisted = loadMessages(tmpDir);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(id);

    // Read back
    const msgs = mailbox.read({ channel: 'integration', reader: 'agent-b' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe('Integration test message');
    expect(msgs[0].priority).toBe('high');
    expect(msgs[0].tags).toEqual(['test']);
  });

  it('broadcast message visible to all readers', async () => {
    await mailbox.send({
      channel: 'broadcast',
      sender: 'system',
      recipients: ['*'],
      body: 'Broadcast to all',
    });

    for (const reader of ['agent-a', 'agent-b', 'agent-c']) {
      const msgs = mailbox.read({ channel: 'broadcast', reader });
      expect(msgs).toHaveLength(1);
    }
  });

  it('directed message visible only to recipients and sender', async () => {
    await mailbox.send({
      channel: 'private',
      sender: 'alice',
      recipients: ['bob'],
      body: 'Private message',
    });

    expect(mailbox.read({ channel: 'private', reader: 'alice' })).toHaveLength(1);
    expect(mailbox.read({ channel: 'private', reader: 'bob' })).toHaveLength(1);
    expect(mailbox.read({ channel: 'private', reader: 'eve' })).toHaveLength(0);
  });

  it('ack → unreadOnly filtering', async () => {
    const id1 = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['b'], body: 'msg1' });
    const id2 = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['b'], body: 'msg2' });

    mailbox.ack([id1], 'b');

    const unread = mailbox.read({ channel: 'c', reader: 'b', unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0].id).toBe(id2);
  });

  it('update message body and verify persistence', async () => {
    const id = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'original' });
    mailbox.updateMessage(id, { body: 'updated' });

    // Verify in-memory
    expect(mailbox.getMessage(id)?.body).toBe('updated');

    // Verify persisted
    const persisted = loadMessages(tmpDir);
    expect(persisted.find(m => m.id === id)?.body).toBe('updated');
  });

  it('stats reflect correct counts', async () => {
    await mailbox.send({ channel: 'ch1', sender: 'a', recipients: ['reader'], body: 'a' });
    await mailbox.send({ channel: 'ch2', sender: 'a', recipients: ['reader'], body: 'b' });
    await mailbox.send({ channel: 'ch1', sender: 'a', recipients: ['other'], body: 'c' });

    const stats = mailbox.getStats('reader');
    expect(stats.total).toBe(2);
    expect(stats.unread).toBe(2);
    expect(stats.channels).toBe(2);
  });
});

describe('Messaging Integration — Lifecycle', () => {
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

  it('TTL sweep removes expired messages', async () => {
    const id = await mailbox.send({
      channel: 'c', sender: 'a', recipients: ['*'], body: 'expires',
      ttlSeconds: 1,
    });

    // Manually age the message
    const msg = mailbox.getMessage(id)!;
    (msg as AgentMessage).createdAt = new Date(Date.now() - 2000).toISOString();

    const swept = mailbox.sweepExpired();
    expect(swept).toBe(1);
    expect(mailbox.getMessage(id)).toBeUndefined();

    // Verify persistence updated
    const persisted = loadMessages(tmpDir);
    expect(persisted.find(m => m.id === id)).toBeUndefined();
  });

  it('persistent messages survive sweep', async () => {
    const id = await mailbox.send({
      channel: 'c', sender: 'a', recipients: ['*'], body: 'persists',
      persistent: true,
    });

    mailbox.sweepExpired();
    expect(mailbox.getMessage(id)).toBeDefined();
  });

  it('purge channel removes only that channel', async () => {
    await mailbox.send({ channel: 'keep', sender: 'a', recipients: ['*'], body: 'keep' });
    await mailbox.send({ channel: 'remove', sender: 'a', recipients: ['*'], body: 'remove1' });
    await mailbox.send({ channel: 'remove', sender: 'a', recipients: ['*'], body: 'remove2' });

    const removed = mailbox.purgeChannel('remove');
    expect(removed).toBe(2);
    expect(mailbox.read({ reader: '*' })).toHaveLength(1);
    expect(mailbox.listChannels()).toHaveLength(1);
  });

  it('deleteMessages removes specific IDs', async () => {
    const id1 = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'a' });
    const id2 = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'b' });
    const id3 = await mailbox.send({ channel: 'c', sender: 'a', recipients: ['*'], body: 'c' });

    mailbox.deleteMessages([id1, id3]);
    const remaining = mailbox.read({ reader: '*' });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(id2);
  });

  it('purgeAll clears everything', async () => {
    for (let i = 0; i < 10; i++) {
      await mailbox.send({ channel: `ch-${i % 3}`, sender: 'a', recipients: ['*'], body: `msg-${i}` });
    }

    const removed = mailbox.purgeAll();
    expect(removed).toBe(10);
    expect(mailbox.read({ reader: '*' })).toHaveLength(0);
    expect(mailbox.listChannels()).toHaveLength(0);

    // Verify persistence cleared
    const persisted = loadMessages(tmpDir);
    expect(persisted).toHaveLength(0);
  });

  it('cross-instance reload picks up messages from disk', async () => {
    await mailbox.send({ channel: 'shared', sender: 'instance-1', recipients: ['*'], body: 'from first' });

    // Create a second mailbox reading same directory
    _resetDedupState();
    const mailbox2 = new AgentMailbox({ dir: tmpDir, maxMessages: 1000, sweepIntervalMs: 0 });
    mailbox2.ensureLoaded();

    const msgs = mailbox2.read({ reader: '*' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe('from first');
    mailbox2.destroy();
  });

  it('threading via parentId', async () => {
    const parentId = await mailbox.send({
      channel: 'thread', sender: 'a', recipients: ['*'], body: 'parent',
    });
    await mailbox.send({
      channel: 'thread', sender: 'b', recipients: ['*'], body: 'reply',
      parentId,
    });

    const msgs = mailbox.read({ channel: 'thread', reader: '*' });
    expect(msgs).toHaveLength(2);
    expect(msgs[1].parentId).toBe(parentId);
  });
});
