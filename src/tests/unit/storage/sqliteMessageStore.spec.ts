/**
 * SqliteMessageStore contract tests.
 * TDD RED phase: tests first.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteMessageStore } from '../../../services/storage/sqliteMessageStore.js';
import type { StoredMessage } from '../../../services/storage/sqliteMessageStore.js';

function makeMsg(overrides: Partial<StoredMessage> & { id: string; channel: string; sender: string }): StoredMessage {
  const now = new Date().toISOString();
  return {
    body: `Message ${overrides.id}`,
    recipients: [],
    priority: 'normal',
    tags: [],
    parentId: null,
    persistent: false,
    ttlSeconds: null,
    requiresAck: false,
    ackBySeconds: null,
    readBy: [],
    payload: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SqliteMessageStore', () => {
  let store: SqliteMessageStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msg-store-'));
    store = new SqliteMessageStore(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('CRUD', () => {
    it('writes and reads a message', () => {
      const msg = makeMsg({ id: 'msg-1', channel: 'general', sender: 'alice' });
      store.write(msg);
      const loaded = store.get('msg-1');
      expect(loaded).not.toBeNull();
      expect(loaded!.sender).toBe('alice');
      expect(loaded!.channel).toBe('general');
    });

    it('returns null for missing message', () => {
      expect(store.get('nope')).toBeNull();
    });

    it('removes a message', () => {
      store.write(makeMsg({ id: 'rm-1', channel: 'ch', sender: 's' }));
      store.remove('rm-1');
      expect(store.get('rm-1')).toBeNull();
    });

    it('preserves JSON array fields', () => {
      const msg = makeMsg({
        id: 'json-1', channel: 'ch', sender: 's',
        recipients: ['bob', 'carol'],
        tags: ['urgent', 'review'],
        readBy: ['bob'],
      });
      store.write(msg);
      const loaded = store.get('json-1');
      expect(loaded!.recipients).toEqual(['bob', 'carol']);
      expect(loaded!.tags).toEqual(['urgent', 'review']);
      expect(loaded!.readBy).toEqual(['bob']);
    });
  });

  describe('query', () => {
    beforeEach(() => {
      store.write(makeMsg({ id: 'q1', channel: 'dev', sender: 'alice', tags: ['bug'] }));
      store.write(makeMsg({ id: 'q2', channel: 'dev', sender: 'bob', tags: ['feature'] }));
      store.write(makeMsg({ id: 'q3', channel: 'ops', sender: 'alice', tags: ['bug', 'urgent'] }));
    });

    it('filters by channel', () => {
      const results = store.query({ channel: 'dev' });
      expect(results.length).toBe(2);
    });

    it('filters by sender', () => {
      const results = store.query({ sender: 'alice' });
      expect(results.length).toBe(2);
    });

    it('filters by tags', () => {
      const results = store.query({ tags: ['bug'] });
      expect(results.length).toBe(2);
    });

    it('combines filters', () => {
      const results = store.query({ channel: 'dev', sender: 'alice' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('q1');
    });

    it('supports limit', () => {
      const results = store.query({ limit: 1 });
      expect(results.length).toBe(1);
    });
  });

  describe('threads', () => {
    it('returns parent and children', () => {
      store.write(makeMsg({ id: 'parent', channel: 'ch', sender: 'a' }));
      store.write(makeMsg({ id: 'child-1', channel: 'ch', sender: 'b', parentId: 'parent' }));
      store.write(makeMsg({ id: 'child-2', channel: 'ch', sender: 'c', parentId: 'parent' }));

      const thread = store.getThread('parent');
      expect(thread.length).toBe(3);
      expect(thread[0].id).toBe('parent');
    });

    it('returns empty for missing parent', () => {
      const thread = store.getThread('nope');
      expect(thread.length).toBe(0);
    });
  });

  describe('channels', () => {
    it('lists distinct channels', () => {
      store.write(makeMsg({ id: 'm1', channel: 'alpha', sender: 's' }));
      store.write(makeMsg({ id: 'm2', channel: 'beta', sender: 's' }));
      store.write(makeMsg({ id: 'm3', channel: 'alpha', sender: 's' }));
      const chs = store.channels();
      expect(chs).toEqual(['alpha', 'beta']);
    });
  });

  describe('purge', () => {
    it('purges a channel', () => {
      store.write(makeMsg({ id: 'p1', channel: 'trash', sender: 's' }));
      store.write(makeMsg({ id: 'p2', channel: 'trash', sender: 's' }));
      store.write(makeMsg({ id: 'p3', channel: 'keep', sender: 's' }));
      const purged = store.purgeChannel('trash');
      expect(purged).toBe(2);
      expect(store.count('trash')).toBe(0);
      expect(store.count('keep')).toBe(1);
    });
  });

  describe('count', () => {
    it('returns 0 for empty store', () => {
      expect(store.count()).toBe(0);
    });

    it('counts by channel', () => {
      store.write(makeMsg({ id: 'c1', channel: 'a', sender: 's' }));
      store.write(makeMsg({ id: 'c2', channel: 'a', sender: 's' }));
      store.write(makeMsg({ id: 'c3', channel: 'b', sender: 's' }));
      expect(store.count('a')).toBe(2);
      expect(store.count()).toBe(3);
    });
  });
});
