import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

process.env.INDEX_SERVER_MUTATION = '1';

import { getHandler } from '../../../server/registry';
import { _resetMailbox } from '../../../services/handlers.messaging';
import '../../../services/handlers.messaging';
import { reloadRuntimeConfig } from '../../../config/runtimeConfig';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ack-filter-'));
}

describe('requiresAck / unacked filter (#523)', () => {
  let tmpDir: string;
  const originalDir = process.env.INDEX_SERVER_MESSAGING_DIR;

  beforeEach(() => {
    tmpDir = makeTempDir();
    process.env.INDEX_SERVER_MESSAGING_DIR = tmpDir;
    reloadRuntimeConfig();
    _resetMailbox();
  });

  afterEach(() => {
    _resetMailbox();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalDir) {
      process.env.INDEX_SERVER_MESSAGING_DIR = originalDir;
    } else {
      delete process.env.INDEX_SERVER_MESSAGING_DIR;
    }
    reloadRuntimeConfig();
  });

  async function sendMsg(overrides: Record<string, unknown> = {}) {
    const handler = getHandler('messaging_send')!;
    const result = await handler({
      channel: 'test',
      sender: 'agent-a',
      recipients: ['agent-b'],
      body: 'test message',
      ...overrides,
    });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const content = parsed.content?.[0]?.text ? JSON.parse(parsed.content[0].text) : parsed;
    return content.messageId || content.id;
  }

  async function readMsgs(overrides: Record<string, unknown> = {}) {
    const handler = getHandler('messaging_read')!;
    const result = await handler({ channel: 'test', reader: 'agent-b', ...overrides });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const content = parsed.content?.[0]?.text ? JSON.parse(parsed.content[0].text) : parsed;
    return content.messages as any[];
  }

  it('filters messages by requiresAck=true', async () => {
    await sendMsg({ requiresAck: true });
    await sendMsg({ requiresAck: false });
    await sendMsg({});

    const ackOnly = await readMsgs({ requiresAck: true });
    expect(ackOnly).toHaveLength(1);
    expect(ackOnly[0].requiresAck).toBe(true);

    const noAck = await readMsgs({ requiresAck: false });
    expect(noAck).toHaveLength(2);
  });

  it('filters unacked messages for a reader', async () => {
    const id1 = await sendMsg({ requiresAck: true });
    await sendMsg({ requiresAck: true });
    await sendMsg({ requiresAck: false });

    // Ack the first message
    const ackHandler = getHandler('messaging_ack')!;
    await ackHandler({ messageIds: [id1], reader: 'agent-b' });

    const unacked = await readMsgs({ unacked: true });
    expect(unacked).toHaveLength(1);
    expect(unacked[0].id).not.toBe(id1);
    expect(unacked[0].requiresAck).toBe(true);
  });

  it('unacked filter without reader returns all requiresAck messages', async () => {
    await sendMsg({ requiresAck: true });
    await sendMsg({ requiresAck: false });

    // Without reader, unacked shouldn't filter (no reader to check readBy against)
    const handler = getHandler('messaging_read')!;
    const result = await handler({ channel: 'test', unacked: true });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const content = parsed.content?.[0]?.text ? JSON.parse(parsed.content[0].text) : parsed;
    // Without reader, the unacked filter gate (opts.unacked && opts.reader) is false,
    // so all messages come through
    expect(content.messages.length).toBe(2);
  });

  it('works via messaging_manage dispatcher', async () => {
    await sendMsg({ requiresAck: true });
    await sendMsg({ requiresAck: false });

    const handler = getHandler('messaging_manage')!;
    const result = await handler({ action: 'read', channel: 'test', reader: 'agent-b', requiresAck: true });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const content = parsed.content?.[0]?.text ? JSON.parse(parsed.content[0].text) : parsed;
    expect(content.messages).toHaveLength(1);
    expect(content.messages[0].requiresAck).toBe(true);
  });
});
