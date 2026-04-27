/**
 * Messaging handler negative-path coverage — Issue #150.
 *
 * Before this file the messaging tools (8 MCP handlers) had only
 * registration smoke tests. None verified validation, missing-field
 * rejection, or oversized-input rejection. Each of these tests fails if
 * the handler stops validating input or starts crashing on bad data.
 *
 * The handlers throw on bad input (Zod safeParse / explicit guards).
 * We invoke them directly via getHandler() to assert that behaviour.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

process.env.INDEX_SERVER_MUTATION = '1';

import { getHandler } from '../../server/registry';
import '../../services/handlers.messaging';
import { _resetMailbox } from '../../services/handlers.messaging';
import { MAX_TTL_SECONDS, MAX_BODY_LENGTH, MAX_READ_LIMIT } from '../../services/messaging/messagingTypes';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'msg-neg-'));
}

async function expectThrow(fn: () => unknown | Promise<unknown>, contains?: string): Promise<Error> {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, 'expected handler to throw').toBeInstanceOf(Error);
  const err = caught as Error;
  if (contains) {
    expect(err.message.toLowerCase()).toContain(contains.toLowerCase());
  }
  return err;
}

describe('Messaging handler negative tests (#150)', () => {
  let tmpDir: string;
  const originalDir = process.env.INDEX_SERVER_MESSAGING_DIR;

  beforeEach(() => {
    tmpDir = makeTempDir();
    process.env.INDEX_SERVER_MESSAGING_DIR = tmpDir;
    _resetMailbox();
  });

  afterEach(() => {
    _resetMailbox();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
    if (originalDir) process.env.INDEX_SERVER_MESSAGING_DIR = originalDir;
    else delete process.env.INDEX_SERVER_MESSAGING_DIR;
  });

  // ── messaging_send ─────────────────────────────────────────────────────────

  describe('messaging_send', () => {
    it('rejects send with missing channel', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(() => h({ sender: 'a', recipients: ['*'], body: 'hi' }), 'invalid send');
    });

    it('rejects send with missing sender', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(() => h({ channel: 'c', recipients: ['*'], body: 'hi' }), 'invalid send');
    });

    it('rejects send with missing body', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(() => h({ channel: 'c', sender: 'a', recipients: ['*'] }), 'invalid send');
    });

    it('rejects send with empty body string', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(() => h({ channel: 'c', sender: 'a', recipients: ['*'], body: '' }), 'invalid send');
    });

    it('rejects send with empty recipients array', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(() => h({ channel: 'c', sender: 'a', recipients: [], body: 'hi' }), 'invalid send');
    });

    it('rejects send with non-array recipients', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(
        () => h({ channel: 'c', sender: 'a', recipients: 'all' as unknown as string[], body: 'hi' }),
        'invalid send',
      );
    });

    it('rejects send with body exceeding MAX_BODY_LENGTH', async () => {
      const h = getHandler('messaging_send')!;
      const oversize = 'x'.repeat(MAX_BODY_LENGTH + 1);
      await expectThrow(
        () => h({ channel: 'c', sender: 'a', recipients: ['*'], body: oversize }),
        'invalid send',
      );
    });

    it('rejects send with invalid priority enum', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(
        () => h({ channel: 'c', sender: 'a', recipients: ['*'], body: 'hi', priority: 'URGENT' }),
        'invalid send',
      );
    });

    it('rejects send with ttlSeconds = 0 (must be >= 1)', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(
        () => h({ channel: 'c', sender: 'a', recipients: ['*'], body: 'hi', ttlSeconds: 0 }),
        'invalid send',
      );
    });

    it('rejects send with ttlSeconds beyond MAX_TTL_SECONDS', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(
        () => h({ channel: 'c', sender: 'a', recipients: ['*'], body: 'hi', ttlSeconds: MAX_TTL_SECONDS + 1 }),
        'invalid send',
      );
    });

    it('rejects send with empty channel string', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(
        () => h({ channel: '', sender: 'a', recipients: ['*'], body: 'hi' }),
        'invalid send',
      );
    });

    it('rejects send with empty-string recipient entry', async () => {
      const h = getHandler('messaging_send')!;
      await expectThrow(
        () => h({ channel: 'c', sender: 'a', recipients: [''], body: 'hi' }),
        'invalid send',
      );
    });
  });

  // ── messaging_read ─────────────────────────────────────────────────────────

  describe('messaging_read', () => {
    it('rejects read with limit beyond MAX_READ_LIMIT', async () => {
      const h = getHandler('messaging_read')!;
      await expectThrow(() => h({ limit: MAX_READ_LIMIT + 1 }), 'invalid read');
    });

    it('rejects read with limit = 0 (must be >= 1)', async () => {
      const h = getHandler('messaging_read')!;
      await expectThrow(() => h({ limit: 0 }), 'invalid read');
    });

    it('rejects read with empty channel string', async () => {
      const h = getHandler('messaging_read')!;
      await expectThrow(() => h({ channel: '' }), 'invalid read');
    });

    it('rejects read with empty reader string', async () => {
      const h = getHandler('messaging_read')!;
      await expectThrow(() => h({ reader: '' }), 'invalid read');
    });
  });

  // ── messaging_ack ──────────────────────────────────────────────────────────

  describe('messaging_ack', () => {
    it('rejects ack with missing messageIds', async () => {
      const h = getHandler('messaging_ack')!;
      await expectThrow(() => h({ reader: 'r' }), 'missing required');
    });

    it('rejects ack with empty messageIds array', async () => {
      const h = getHandler('messaging_ack')!;
      await expectThrow(() => h({ messageIds: [], reader: 'r' }), 'missing required');
    });

    it('rejects ack with missing reader', async () => {
      const h = getHandler('messaging_ack')!;
      await expectThrow(() => h({ messageIds: ['m1'] }), 'missing required');
    });

    it('returns 0 acknowledged when ack of non-existent IDs', async () => {
      const h = getHandler('messaging_ack')!;
      const result = (await h({ messageIds: ['nope-1', 'nope-2'], reader: 'r' })) as {
        acknowledged: number;
      };
      expect(result.acknowledged).toBe(0);
    });
  });

  // ── messaging_get ──────────────────────────────────────────────────────────

  describe('messaging_get', () => {
    it('rejects get with missing messageId', async () => {
      const h = getHandler('messaging_get')!;
      await expectThrow(() => h({}), 'missing required');
    });

    it('returns found:false for non-existent messageId', async () => {
      const h = getHandler('messaging_get')!;
      const result = (await h({ messageId: 'does-not-exist' })) as { found: boolean };
      expect(result.found).toBe(false);
    });
  });

  // ── messaging_update ───────────────────────────────────────────────────────

  describe('messaging_update', () => {
    it('rejects update with missing messageId', async () => {
      const h = getHandler('messaging_update')!;
      await expectThrow(() => h({ body: 'new' }), 'missing required');
    });

    it('returns found:false when updating non-existent message', async () => {
      const h = getHandler('messaging_update')!;
      const result = (await h({ messageId: 'no-such-msg', body: 'new' })) as { found: boolean };
      expect(result.found).toBe(false);
    });
  });

  // ── messaging_reply ────────────────────────────────────────────────────────

  describe('messaging_reply', () => {
    it('rejects reply with missing parentId', async () => {
      const h = getHandler('messaging_reply')!;
      await expectThrow(() => h({ sender: 'a', body: 'hi' }), 'missing required');
    });

    it('rejects reply with missing sender', async () => {
      const h = getHandler('messaging_reply')!;
      await expectThrow(() => h({ parentId: 'p', body: 'hi' }), 'missing required');
    });

    it('rejects reply with missing body', async () => {
      const h = getHandler('messaging_reply')!;
      await expectThrow(() => h({ parentId: 'p', sender: 'a' }), 'missing required');
    });

    it('throws when replying to non-existent parent message', async () => {
      const h = getHandler('messaging_reply')!;
      await expectThrow(
        () => h({ parentId: 'no-such-parent', sender: 'a', body: 'hi' }),
        'parent message not found',
      );
    });
  });

  // ── messaging_thread ───────────────────────────────────────────────────────

  describe('messaging_thread', () => {
    it('rejects thread with missing parentId', async () => {
      const h = getHandler('messaging_thread')!;
      await expectThrow(() => h({}), 'missing required');
    });

    it('returns count:0 for non-existent parent thread (no crash)', async () => {
      const h = getHandler('messaging_thread')!;
      const result = (await h({ parentId: 'no-such-parent' })) as {
        count: number;
        messages: unknown[];
      };
      expect(result.count).toBe(0);
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  // ── messaging_purge ────────────────────────────────────────────────────────

  describe('messaging_purge', () => {
    // Purge tests do not pin a removed-count assertion: the mailbox singleton
    // resolves its directory from runtimeConfig at first load (env cached
    // before this spec runs). The contract we verify is "no crash + correct
    // action label + numeric removed count >= 0" for malformed/empty inputs.

    it('handles purge by non-existent IDs without crashing', async () => {
      const h = getHandler('messaging_purge')!;
      const result = (await h({ messageIds: ['no-such-1', 'no-such-2'] })) as {
        action: string;
        removed: number;
      };
      expect(result.action).toBe('delete_by_ids');
      expect(result.removed).toBe(0);
    });

    it('handles purge of non-existent channel without crashing', async () => {
      const h = getHandler('messaging_purge')!;
      const result = (await h({ channel: 'never-existed-channel-' + Date.now() })) as {
        action: string;
        removed: number;
      };
      expect(result.action).toBe('purge_channel');
      expect(result.removed).toBe(0);
    });

    it('routes purge-with-empty-messageIds-array to purge_all (no crash)', async () => {
      const h = getHandler('messaging_purge')!;
      const result = (await h({ messageIds: [] })) as {
        action: string;
        removed: number;
      };
      // Empty array falls through to the all=true / default branch
      expect(result.action).toBe('purge_all');
      expect(typeof result.removed).toBe('number');
      expect(result.removed).toBeGreaterThanOrEqual(0);
    });
  });
});
