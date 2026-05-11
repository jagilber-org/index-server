/**
 * Round-trip regression for server-managed metadata fields on
 * export → import (overwrite). Reviewer Q3 (PR #326): the source-of-truth
 * refactor introduces splitEntry / SERVER_MANAGED_KEYS and a `stripped`
 * counter, but does not assert that usageCount / firstSeenTs / lastUsedAt /
 * archivedAt actually round-trip when an exported entry is re-imported in
 * overwrite mode (the canonical "restore from backup" path).
 *
 * Contract under test:
 *   1. SERVER_MANAGED_KEYS includes the four carry-forward keys.
 *   2. splitEntry partitions all eight server-managed keys out of caller input.
 *   3. The import handler preserves caller-supplied carry-forward values when
 *      overwriting an existing entry — the live-store value does NOT win.
 *   4. The import response reports the stripped counts for every server-managed
 *      key the caller supplied.
 *   5. Server re-derived fields (sourceHash, schemaVersion, createdAt,
 *      updatedAt) are rewritten by the server on import and never trusted from
 *      the payload.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry.js';
import { reloadRuntimeConfig } from '../config/runtimeConfig.js';
import { invalidate } from '../services/indexContext.js';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating.js';
import {
  SERVER_MANAGED_KEYS,
  splitEntry,
} from '../schemas/instructionSchema.js';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'import-roundtrip-server-managed');

function configure() {
  const root = path.join(TMP_ROOT, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const instructionsDir = path.join(root, 'instructions');
  invalidate();
  fs.mkdirSync(instructionsDir, { recursive: true });
  process.env.INDEX_SERVER_MUTATION = '1';
  process.env.INDEX_SERVER_DIR = instructionsDir;
  process.env.INDEX_SERVER_WORKSPACE = 'roundtrip-test-workspace';
  delete process.env.INDEX_SERVER_STORAGE_BACKEND;
  delete process.env.INDEX_SERVER_SQLITE_PATH;
  reloadRuntimeConfig();
  invalidate();
  return { instructionsDir };
}

describe('import round-trip — server-managed metadata carry-forward', () => {
  beforeAll(async () => {
    await import('../services/handlers.instructions.js');
    await import('../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('import-roundtrip-server-managed');
  });

  afterAll(() => {
    invalidate();
    try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* best-effort */ }
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MUTATION;
    delete process.env.INDEX_SERVER_WORKSPACE;
  });

  beforeEach(() => {
    configure();
  });

  it('SERVER_MANAGED_KEYS contains the four carry-forward observables', () => {
    for (const key of ['usageCount', 'firstSeenTs', 'lastUsedAt', 'archivedAt']) {
      expect(SERVER_MANAGED_KEYS.has(key)).toBe(true);
    }
  });

  it('splitEntry partitions all eight server-managed keys out of caller input', () => {
    const partition = splitEntry({
      id: 'split-probe',
      title: 't',
      body: 'b',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['x'],
      // server-managed (should all land in serverManaged, none in input)
      schemaVersion: '6',
      sourceHash: 'a'.repeat(64),
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z',
      usageCount: 7,
      firstSeenTs: '2024-12-01T00:00:00.000Z',
      lastUsedAt: '2025-01-15T00:00:00.000Z',
      archivedAt: '2025-02-01T00:00:00.000Z',
    });
    expect(Object.keys(partition.serverManaged).sort()).toEqual([
      'archivedAt',
      'createdAt',
      'firstSeenTs',
      'lastUsedAt',
      'schemaVersion',
      'sourceHash',
      'updatedAt',
      'usageCount',
    ]);
    // Caller-supplied server-managed fields must never leak back into the
    // validated input partition — that would defeat the source-of-truth
    // boundary (clients would be able to forge timestamps/hashes).
    for (const key of Object.keys(partition.serverManaged)) {
      expect((partition.input as Record<string, unknown>)[key]).toBeUndefined();
    }
  });

  it('preserves caller-supplied carry-forward fields on overwrite import (restore semantics)', async () => {
    const importHandler = getHandler('index_import');
    const dispatch = getHandler('index_dispatch');
    expect(importHandler).toBeTruthy();
    expect(dispatch).toBeTruthy();

    const id = `roundtrip-${Date.now()}`;
    const baseEntry = {
      id,
      title: 'Round-trip restore',
      body: 'Initial body for round-trip.',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['roundtrip'],
    };

    // 1. Seed the live store with an initial import (no usage history yet).
    const seed = await Promise.resolve(importHandler!({
      entries: [baseEntry],
      mode: 'overwrite',
    })) as Record<string, unknown>;
    expect(seed.error, JSON.stringify(seed)).toBeFalsy();

    // 2. Read live state and confirm the live store has no carry-forward
    //    values that could "win" against the export payload.
    const before = await Promise.resolve(dispatch!({ action: 'get', id })) as Record<string, unknown>;
    const liveBefore = before.item as Record<string, unknown>;
    expect(liveBefore).toBeTruthy();
    // usageCount may be 0/undefined in the live store at this point.
    const liveUsageBefore = (liveBefore.usageCount as number | undefined) ?? 0;
    expect(liveUsageBefore).toBe(0);

    // 3. Simulate restoring a previously exported snapshot with rich history.
    //    The exported entry carries server-managed history fields; on overwrite
    //    these MUST win over the live store.
    const exportedSnapshot = {
      ...baseEntry,
      body: 'Restored body content.',
      usageCount: 42,
      firstSeenTs: '2024-06-01T00:00:00.000Z',
      lastUsedAt: '2025-01-15T12:00:00.000Z',
      archivedAt: '2025-02-01T00:00:00.000Z',
      // Forged integrity fields the server MUST re-derive / ignore:
      sourceHash: 'f'.repeat(64),
      schemaVersion: '999',
      createdAt: '1999-01-01T00:00:00.000Z',
      updatedAt: '1999-01-01T00:00:00.000Z',
    };
    const restore = await Promise.resolve(importHandler!({
      entries: [exportedSnapshot],
      mode: 'overwrite',
    })) as Record<string, unknown>;
    expect(restore.error, JSON.stringify(restore)).toBeFalsy();
    expect(restore.overwritten).toBe(1);

    // 4. The handler reports per-key stripped counts for every server-managed
    //    field the caller supplied.
    const stripped = restore.stripped as Record<string, number>;
    expect(stripped).toBeTruthy();
    for (const key of [
      'usageCount', 'firstSeenTs', 'lastUsedAt', 'archivedAt',
      'sourceHash', 'schemaVersion', 'createdAt', 'updatedAt',
    ]) {
      expect(stripped[key], `stripped count for ${key}`).toBe(1);
    }

    // 5. Carry-forward fields from the export overwrite the live store.
    const after = await Promise.resolve(dispatch!({ action: 'get', id })) as Record<string, unknown>;
    const liveAfter = after.item as Record<string, unknown>;
    expect(liveAfter).toBeTruthy();
    expect(liveAfter.usageCount).toBe(42);
    expect(liveAfter.firstSeenTs).toBe('2024-06-01T00:00:00.000Z');
    expect(liveAfter.lastUsedAt).toBe('2025-01-15T12:00:00.000Z');
    expect(liveAfter.archivedAt).toBe('2025-02-01T00:00:00.000Z');

    // 6. Server-derived integrity fields are recomputed; the forged values are
    //    NOT trusted from the payload.
    expect(liveAfter.sourceHash).not.toBe('f'.repeat(64));
    expect(typeof liveAfter.sourceHash).toBe('string');
    expect((liveAfter.sourceHash as string).length).toBe(64);
    expect(liveAfter.schemaVersion).not.toBe('999');
    expect(liveAfter.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(liveAfter.updatedAt).not.toBe('1999-01-01T00:00:00.000Z');
  });

  it('omits stripped keys when the caller supplies no server-managed fields', async () => {
    const importHandler = getHandler('index_import');
    const id = `clean-${Date.now()}`;
    const result = await Promise.resolve(importHandler!({
      entries: [{
        id,
        title: 'Clean import',
        body: 'No server-managed fields supplied.',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['clean'],
      }],
      mode: 'overwrite',
    })) as Record<string, unknown>;
    expect(result.error, JSON.stringify(result)).toBeFalsy();
    const stripped = result.stripped as Record<string, number>;
    // A clean payload produces an empty stripped map (or one with all zeros).
    for (const key of Object.keys(stripped || {})) {
      expect(stripped[key]).toBe(0);
    }
  });
});
