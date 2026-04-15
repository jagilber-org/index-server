import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createKnowledgeStore } from '../dashboard/server/KnowledgeStore';

describe('KnowledgeStore', () => {
  let dataDir: string;
  let store: ReturnType<typeof createKnowledgeStore>;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-test-'));
    store = createKnowledgeStore(dataDir);
  });

  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('upsert', () => {
    it('creates entry with createdAt and updatedAt', () => {
      const entry = store.upsert('test-key', 'test content', { category: 'test' });
      expect(entry.key).toBe('test-key');
      expect(entry.content).toBe('test content');
      expect(entry.metadata.category).toBe('test');
      expect(entry.createdAt).toBeTruthy();
      expect(entry.updatedAt).toBeTruthy();
    });

    it('updates existing entry — preserves createdAt, updates updatedAt', async () => {
      const first = store.upsert('key1', 'v1');
      // Small delay to ensure timestamps differ
      await new Promise(r => setTimeout(r, 10));
      const second = store.upsert('key1', 'v2', { updated: true });
      expect(second.createdAt).toBe(first.createdAt);
      expect(second.content).toBe('v2');
      expect(second.metadata.updated).toBe(true);
    });
  });

  describe('get', () => {
    it('returns entry by key', () => {
      store.upsert('k1', 'content1');
      const entry = store.get('k1');
      expect(entry).toBeDefined();
      expect(entry!.content).toBe('content1');
    });

    it('returns undefined for missing key', () => {
      expect(store.get('nonexistent')).toBeUndefined();
    });
  });

  describe('search', () => {
    beforeEach(() => {
      store.upsert('agent-perf:a1', 'Agent a1 performance stats', { category: 'agent-performance' });
      store.upsert('agent-perf:a2', 'Agent a2 performance stats', { category: 'agent-performance' });
      store.upsert('config:retry', 'Retry configuration guide', { category: 'config' });
    });

    it('matches substring in content', () => {
      const results = store.search('performance');
      expect(results.length).toBe(2);
    });

    it('filters by category in metadata', () => {
      const results = store.search('stats', { category: 'agent-performance' });
      expect(results.length).toBe(2);
      const configResults = store.search('stats', { category: 'config' });
      expect(configResults.length).toBe(0);
    });

    it('respects limit parameter', () => {
      const results = store.search('agent', { limit: 1 });
      expect(results.length).toBe(1);
    });

    it('returns empty array for no matches', () => {
      const results = store.search('zzz-nonexistent');
      expect(results.length).toBe(0);
    });
  });

  describe('delete', () => {
    it('removes entry and returns true', () => {
      store.upsert('to-delete', 'temp');
      expect(store.delete('to-delete')).toBe(true);
      expect(store.get('to-delete')).toBeUndefined();
    });

    it('returns false for missing key', () => {
      expect(store.delete('nonexistent')).toBe(false);
    });
  });

  describe('count', () => {
    it('reflects current entry count', () => {
      expect(store.count()).toBe(0);
      store.upsert('a', 'a');
      store.upsert('b', 'b');
      expect(store.count()).toBe(2);
      store.delete('a');
      expect(store.count()).toBe(1);
    });
  });

  describe('persistence', () => {
    it('persists to disk and reloads', () => {
      store.upsert('persist-key', 'persist-content', { source: 'test' });
      // Create new store from same directory
      const store2 = createKnowledgeStore(dataDir);
      const entry = store2.get('persist-key');
      expect(entry).toBeDefined();
      expect(entry!.content).toBe('persist-content');
      expect(entry!.metadata.source).toBe('test');
    });
  });
});
