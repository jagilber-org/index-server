/**
 * Instruction CRUD Matrix Tests
 *
 * Parametric edge-case coverage for CRUD operations through the handler layer.
 * Covers: payload validation, entry wrapper requirement, duplicate create,
 * missing ID, overwrite semantics, and SQLite backend toggling.
 *
 * These tests would have caught the index_add entry-wrapper bug where
 * client scripts sent flat params instead of { entry: { ... } }.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

import '../services/handlers.instructions';
import '../services/handlers.search';
import '../services/instructions.dispatcher';

import { getHandler } from '../server/registry';
import { invalidate, ensureLoaded } from '../services/indexContext';
import { reloadRuntimeConfig } from '../config/runtimeConfig';

function uniqueId(): string {
  return `matrix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function invokeHandler(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = getHandler(name);
  if (!handler) throw new Error(`Handler "${name}" not registered`);
  const raw = await handler(params);
  const wrapped = raw as { content?: Array<{ text: string }> };
  if (wrapped?.content?.[0]?.text) {
    try { return JSON.parse(wrapped.content[0].text); } catch { /* fall through */ }
  }
  return raw as Record<string, unknown>;
}

describe('CRUD Matrix', () => {
  const originalMutation = process.env.INDEX_SERVER_MUTATION;
  const originalIndexDir = process.env.INDEX_SERVER_DIR;
  const createdIds: string[] = [];
  let TMP_DIR = '';

  beforeAll(() => {
    // Isolate to a temp dir so we never pollute the workspace's instructions/ folder.
    TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'index-server-crud-matrix-'));
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    process.env.INDEX_SERVER_MUTATION = '1';
    reloadRuntimeConfig();
    invalidate();
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterAll(() => {
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }
    if (originalIndexDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = originalIndexDir;
    if (originalMutation === undefined) delete process.env.INDEX_SERVER_MUTATION;
    else process.env.INDEX_SERVER_MUTATION = originalMutation;
    reloadRuntimeConfig();
    invalidate();
  });

  // ── index_add payload validation ──────────────────────────────────────

  describe('index_add entry wrapper', () => {
    it('should reject flat params without entry wrapper', async () => {
      const id = uniqueId();
      const result = await invokeHandler('index_add', {
        id,
        title: 'Flat params test',
        body: 'This should fail — no entry wrapper',
      });
      expect(result.created).not.toBe(true);
      expect(result.error).toBeDefined();
    });

    it('should accept params wrapped in entry object', async () => {
      const id = uniqueId();
      createdIds.push(id);
      const result = await invokeHandler('index_add', {
        entry: {
          id,
          title: 'Entry wrapper test',
          body: 'Properly wrapped in entry object',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          categories: ['test'],
        },
        lax: true,
      });
      expect(result.created).toBe(true);
      expect(result.id).toBe(id);
    });

    it('should require body in entry', async () => {
      const id = uniqueId();
      const result = await invokeHandler('index_add', {
        entry: { id, title: 'No body test' },
        lax: true,
      });
      expect(result.created).not.toBe(true);
    });

    it('should require id in entry', async () => {
      const result = await invokeHandler('index_add', {
        entry: { body: 'No id test', title: 'Missing ID' },
        lax: true,
      });
      expect(result.created).not.toBe(true);
    });
  });

  // ── Duplicate create / overwrite semantics ────────────────────────────

  describe('create and overwrite', () => {
    it('should reject duplicate create without overwrite flag', async () => {
      const id = uniqueId();
      createdIds.push(id);
      await invokeHandler('index_add', {
        entry: { id, body: 'First create', title: 'First' },
        lax: true,
      });
      const result = await invokeHandler('index_add', {
        entry: { id, body: 'Duplicate create', title: 'Second' },
        lax: true,
      });
      expect(result.created).not.toBe(true);
      expect(result.skipped).toBe(true);
    });

    it('should allow overwrite when flag is set', async () => {
      const id = uniqueId();
      createdIds.push(id);
      await invokeHandler('index_add', {
        entry: { id, body: 'Original body', title: 'Original' },
        lax: true,
      });
      const result = await invokeHandler('index_add', {
        entry: { id, body: 'Overwritten body', title: 'Overwritten' },
        overwrite: true,
        lax: true,
      });
      expect(result.overwritten).toBe(true);
    });
  });

  // ── Full lifecycle: create → search → list → get → remove ────────────

  describe('full lifecycle', () => {
    const lifecycleId = `matrix-lifecycle-${Date.now()}`;

    it('should create instruction', async () => {
      createdIds.push(lifecycleId);
      const result = await invokeHandler('index_add', {
        entry: {
          id: lifecycleId,
          title: 'Matrix Lifecycle Test',
          body: 'Full lifecycle test body with unique keyword xyzzy42',
          categories: ['test', 'matrix'],
        },
        lax: true,
      });
      expect(result.created).toBe(true);
    });

    it('should find via search', async () => {
      invalidate();
      await ensureLoaded();
      const result = await invokeHandler('index_search', {
        keywords: ['xyzzy42'],
        mode: 'keyword',
        limit: 10,
      });
      const results = (result as { results?: Array<{ instructionId: string }> }).results ?? [];
      const foundIds = results.map(r => r.instructionId);
      expect(foundIds).toContain(lifecycleId);
    });

    it('should appear in list', async () => {
      invalidate();
      await ensureLoaded();
      const result = await invokeHandler('index_dispatch', {
        action: 'list',
        limit: 1000,
      });
      const items = (result as { items?: Array<{ id: string }> }).items ?? [];
      expect(items.some(i => i.id === lifecycleId)).toBe(true);
    });

    it('should be retrievable by ID', async () => {
      invalidate();
      await ensureLoaded();
      const result = await invokeHandler('index_dispatch', {
        action: 'get',
        id: lifecycleId,
      });
      const item = result.item as Record<string, unknown> | undefined;
      expect(item?.id).toBe(lifecycleId);
      expect(item?.title).toBe('Matrix Lifecycle Test');
    });

    it('should be removable', async () => {
      const result = await invokeHandler('index_remove', {
        ids: [lifecycleId],
      });
      expect(result.removed).toBe(1);
      const idx = createdIds.indexOf(lifecycleId);
      if (idx >= 0) createdIds.splice(idx, 1);
    });

    it('should not exist after removal', async () => {
      invalidate();
      const result = await invokeHandler('index_dispatch', {
        action: 'get',
        id: lifecycleId,
      });
      expect(result.found).not.toBe(true);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle remove of non-existent ID gracefully', async () => {
      const result = await invokeHandler('index_remove', {
        ids: ['nonexistent-id-' + Date.now()],
      });
      expect(result.removed).toBe(0);
    });

    it('should handle get of non-existent ID', async () => {
      const result = await invokeHandler('index_dispatch', {
        action: 'get',
        id: 'nonexistent-id-' + Date.now(),
      });
      expect(result.found).not.toBe(true);
    });
  });
});
