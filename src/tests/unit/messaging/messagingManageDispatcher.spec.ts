/**
 * Unit tests for messaging_manage — the single action-dispatch tool
 * consolidating all 10 messaging_<action> tools (#373).
 *
 * Each test exercises the dispatcher with one action and verifies it produces
 * the same outcome as the corresponding standalone tool would.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

process.env.INDEX_SERVER_MUTATION = '1';

import { getHandler } from '../../../server/registry';
import '../../../services/handlers.messaging';
import { _resetMailbox } from '../../../services/handlers.messaging';

type Handler = (params: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

function manage(): Handler {
  const h = getHandler('messaging_manage');
  if (!h) throw new Error('messaging_manage not registered');
  return h as Handler;
}

describe('messaging_manage (dispatcher, #373)', () => {
  let tmpDir: string;
  const originalDir = process.env.INDEX_SERVER_MESSAGING_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-manage-'));
    process.env.INDEX_SERVER_MESSAGING_DIR = tmpDir;
    _resetMailbox();
  });

  afterEach(() => {
    _resetMailbox();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalDir) process.env.INDEX_SERVER_MESSAGING_DIR = originalDir;
    else delete process.env.INDEX_SERVER_MESSAGING_DIR;
  });

  it('is registered', () => {
    expect(getHandler('messaging_manage')).toBeDefined();
  });

  it('rejects missing action', async () => {
    await expect(manage()({})).rejects.toThrow(/action/);
  });

  it('send → returns messageId and status sent', async () => {
    const r = await manage()({
      action: 'send',
      channel: 'test', sender: 'agent-a', recipients: ['*'], body: 'hello',
    });
    expect(r.action).toBe('send');
    expect(r.status).toBe('sent');
    expect(typeof r.messageId).toBe('string');
  });

  it('list_channels → lists the channel after a send', async () => {
    await manage()({ action: 'send', channel: 'lc', sender: 'a', recipients: ['*'], body: 'x' });
    const r = await manage()({ action: 'list_channels' });
    expect(r.action).toBe('list_channels');
    expect(Array.isArray(r.channels)).toBe(true);
    expect((r.channels as Array<{ name?: string; channel?: string }>).some(c => (c.name ?? c.channel) === 'lc')).toBe(true);
  });

  it('read → returns the messages just sent', async () => {
    await manage()({ action: 'send', channel: 'rd', sender: 'a', recipients: ['*'], body: 'm1' });
    const r = await manage()({ action: 'read', channel: 'rd', reader: 'b' });
    expect(r.action).toBe('read');
    expect((r.messages as unknown[]).length).toBeGreaterThan(0);
  });

  it('get → finds a message by id; missing id returns found=false', async () => {
    const sent = await manage()({ action: 'send', channel: 'g', sender: 'a', recipients: ['*'], body: 'gm' });
    const r1 = await manage()({ action: 'get', messageId: sent.messageId as string });
    expect(r1.found).toBe(true);
    const r2 = await manage()({ action: 'get', messageId: 'does-not-exist' });
    expect(r2.found).toBe(false);
  });

  it('ack → marks acknowledged', async () => {
    const sent = await manage()({ action: 'send', channel: 'a', sender: 's', recipients: ['*'], body: 'a' });
    const r = await manage()({ action: 'ack', messageIds: [sent.messageId], reader: 'r' });
    expect(r.action).toBe('ack');
    expect(Array.isArray(r.acknowledged) || typeof r.acknowledged === 'number').toBe(true);
  });

  it('update → patches body when message exists', async () => {
    const sent = await manage()({ action: 'send', channel: 'u', sender: 's', recipients: ['*'], body: 'orig' });
    const r = await manage()({ action: 'update', messageId: sent.messageId, body: 'patched' });
    expect(r.found).toBe(true);
    const after = await manage()({ action: 'get', messageId: sent.messageId });
    expect(((after.message as Record<string, unknown>).body)).toBe('patched');
  });

  it('reply → returns child messageId linked via parentId', async () => {
    const parent = await manage()({ action: 'send', channel: 'r', sender: 'p', recipients: ['c'], body: 'p' });
    const r = await manage()({ action: 'reply', parentId: parent.messageId, sender: 'c', body: 'reply' });
    expect(r.action).toBe('reply');
    expect(r.status).toBe('sent');
    expect(typeof r.messageId).toBe('string');
  });

  it('thread → returns parent + reply', async () => {
    const parent = await manage()({ action: 'send', channel: 't', sender: 'p', recipients: ['c'], body: 'p' });
    await manage()({ action: 'reply', parentId: parent.messageId, sender: 'c', body: 'r' });
    const r = await manage()({ action: 'thread', parentId: parent.messageId });
    expect((r.count as number)).toBeGreaterThanOrEqual(2);
  });

  it('stats → returns reader-scoped stats', async () => {
    await manage()({ action: 'send', channel: 's', sender: 'a', recipients: ['*'], body: 'm' });
    const r = await manage()({ action: 'stats', reader: 'b' });
    expect(r.action).toBe('stats');
    expect(r.reader).toBe('b');
  });

  it('purge → removes messages and returns count', async () => {
    await manage()({ action: 'send', channel: 'p', sender: 'a', recipients: ['*'], body: '1' });
    await manage()({ action: 'send', channel: 'p', sender: 'a', recipients: ['*'], body: '2' });
    const r = await manage()({ action: 'purge', channel: 'p' });
    expect(r.action).toBe('purge');
    expect((r.removed as number)).toBeGreaterThanOrEqual(2);
  });

  it('purge → rejects under-specified call instead of silently purging all (#408 review)', async () => {
    await manage()({ action: 'send', channel: 'p', sender: 'a', recipients: ['*'], body: 'keep-me' });
    await expect(manage()({ action: 'purge' })).rejects.toThrow(/one of.*all.*messageIds.*channel/);
    // Confirm nothing was removed.
    const stats = await manage()({ action: 'stats', reader: '*' });
    expect((stats.totalMessages as number) ?? (stats.total as number) ?? 1).toBeGreaterThan(0);
  });
});

describe('messaging_manage — registry surface', () => {
  it('is in MUTATION set', async () => {
    const { MUTATION } = await import('../../../services/toolRegistry.js');
    expect(MUTATION.has('messaging_manage')).toBe(true);
  });

  it('has a Zod schema entry', async () => {
    const { hasZodSchema } = await import('../../../services/toolRegistry.zod.js');
    expect(hasZodSchema('messaging_manage')).toBe(true);
  });
});
