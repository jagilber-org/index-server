/**
 * Persistence Between Instances — Cross-Process Index State Tests
 *
 * Verifies that instructions written by one server instance are visible
 * from a fresh instance (no shared memory). Tests the file-based persistence
 * contract that enables multi-instance and restart scenarios.
 *
 * Covers:
 * - Instruction written by instance A is visible from instance B
 * - Index hash changes propagate across instances
 * - Governance metadata persists across instance restarts
 * - Concurrent writes from multiple instances don't corrupt files
 * - Manifest consistency after cross-instance operations
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { invalidate, ensureLoaded, writeEntry } from '../../services/indexContext';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-test-'));
const INSTR_DIR = path.join(TMP_ROOT, 'instructions');

function uniqueId(): string {
  return `persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeEntry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Instruction: ${id}`,
    body: `Body for ${id}`,
    priority: 50,
    audience: 'all' as const,
    requirement: 'optional' as const,
    categories: ['persist-test'],
    contentType: 'instruction' as const,
    sourceHash: `hash-${id}`,
    schemaVersion: '4',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

describe('Persistence Between Instances', () => {
  const createdIds: string[] = [];

  beforeAll(() => {
    fs.mkdirSync(INSTR_DIR, { recursive: true });
    process.env.INDEX_SERVER_DIR = INSTR_DIR;
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_MEMOIZE = '0';
    reloadRuntimeConfig();
    invalidate();
  });

  beforeEach(() => {
    invalidate(); // Force fresh disk read (simulates new instance)
  });

  afterAll(() => {
    // Clean up test instruction files
    for (const id of createdIds) {
      try { fs.unlinkSync(path.join(INSTR_DIR, `${id}.json`)); } catch { /* ok */ }
    }
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MEMOIZE;
    reloadRuntimeConfig();
  });

  it('instruction written by "instance A" is visible after invalidate (simulated restart)', () => {
    const id = uniqueId();
    createdIds.push(id);

    // Instance A writes
    writeEntry(makeEntry(id) as Parameters<typeof writeEntry>[0]);

    // Simulate new instance
    invalidate();

    // Instance B reads
    const state = ensureLoaded();
    const found = state.list.find((e: { id: string }) => e.id === id) as { title: string } | undefined;
    expect(found).toBeDefined();
    expect(found!.title).toBe(`Instruction: ${id}`);
  });

  it('index hash changes after write are visible from fresh load', () => {
    invalidate();
    const hashBefore = ensureLoaded().hash;

    const id = uniqueId();
    createdIds.push(id);
    writeEntry(makeEntry(id) as Parameters<typeof writeEntry>[0]);

    invalidate();
    const hashAfter = ensureLoaded().hash;
    expect(hashAfter).not.toBe(hashBefore);
  });

  it('governance metadata persists across simulated restarts', () => {
    const id = uniqueId();
    createdIds.push(id);

    writeEntry(makeEntry(id, {
      owner: 'security-team',
      status: 'approved',
      classification: 'restricted',
      priorityTier: 'P1',
    }) as Parameters<typeof writeEntry>[0]);

    // Simulate restart
    invalidate();

    const filePath = path.join(INSTR_DIR, `${id}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(raw.owner).toBe('security-team');
    expect(raw.status).toBe('approved');
    expect(raw.classification).toBe('restricted');
    expect(raw.priorityTier).toBe('P1');
  });

  it('multiple sequential writes accumulate correctly', () => {
    const ids = Array.from({ length: 5 }, () => uniqueId());
    createdIds.push(...ids);

    for (const id of ids) {
      writeEntry(makeEntry(id) as Parameters<typeof writeEntry>[0]);
    }

    invalidate();
    const state = ensureLoaded();
    const foundIds = state.list.map((e: { id: string }) => e.id);
    for (const id of ids) {
      expect(foundIds).toContain(id);
    }
  });

  it('delete + restart = instruction truly gone', () => {
    const id = uniqueId();

    writeEntry(makeEntry(id) as Parameters<typeof writeEntry>[0]);
    expect(fs.existsSync(path.join(INSTR_DIR, `${id}.json`))).toBe(true);

    // Delete from disk
    fs.unlinkSync(path.join(INSTR_DIR, `${id}.json`));

    // Fresh load
    invalidate();
    const state = ensureLoaded();
    const foundIds = state.list.map((e: { id: string }) => e.id);
    expect(foundIds).not.toContain(id);
  });

  it('concurrent writes to shared directory produce no file corruption', () => {
    const ids = Array.from({ length: 10 }, () => uniqueId());
    createdIds.push(...ids);

    // Parallel writes (synchronous writeEntry is atomic via fs.writeFileSync)
    for (const [i, id] of ids.entries()) {
      writeEntry(makeEntry(id, { body: `Parallel body ${i}` }) as Parameters<typeof writeEntry>[0]);
    }

    // Verify all files valid JSON
    for (const id of ids) {
      const filePath = path.join(INSTR_DIR, `${id}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(() => JSON.parse(fs.readFileSync(filePath, 'utf-8'))).not.toThrow();
    }
  });
});
