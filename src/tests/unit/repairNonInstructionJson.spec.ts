import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import { getHandler } from '../../server/registry';
import { invalidate } from '../../services/indexContext';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'repair-nonentity');
const INSTRUCTIONS_DIR = path.join(TMP_ROOT, 'instructions');

function writeJson(filename: string, data: Record<string, unknown>): void {
  fs.writeFileSync(path.join(INSTRUCTIONS_DIR, filename), JSON.stringify(data, null, 2));
}

function resetWorkspace(): void {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(INSTRUCTIONS_DIR, { recursive: true });
  invalidate();
}

type RepairResult = {
  repaired: number;
  updated: string[];
  skippedRepaired: string[];
  errors: { id: string; error: string }[];
  migrationCount: number;
};

describe('index_repair skips non-instruction JSON (#516)', () => {
  let repair: (params?: unknown) => Promise<RepairResult>;

  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = INSTRUCTIONS_DIR;
    reloadRuntimeConfig();
    forceBootstrapConfirmForTests('repair-nonentity');

    await import('../../services/handlers/instructions.groom.js');
    const handler = getHandler('index_repair');
    if (!handler) throw new Error('index_repair handler not registered');
    repair = handler as (params?: unknown) => Promise<RepairResult>;
  });

  beforeEach(() => {
    resetWorkspace();
  });

  afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_MUTATION;
    delete process.env.INDEX_SERVER_DIR;
    reloadRuntimeConfig();
  });

  it('does not error on non-instruction config JSON (gates, knowledge-store, etc.)', async () => {
    writeJson('valid-instruction.json', {
      id: 'valid-instruction', title: 'A real instruction', body: 'Some content',
      categories: ['test'], primaryCategory: 'test', owner: 'test',
      contentType: 'instruction', audience: 'all', requirement: 'optional',
      version: '1.0.0', priority: 50, sourceHash: 'a'.repeat(64),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    writeJson('gates.json', { defaultState: 'open', gates: [] });
    writeJson('knowledge-store.json', { type: 'config', entries: [] });
    writeJson('merged-split-import.json', { mergedFrom: ['a', 'b'], splitDate: '2026-01-01' });
    writeJson('old-split-ids.json', { splitIds: ['x', 'y', 'z'] });
    writeJson('path-updated-items-20260420.json', { items: [{ from: '/a', to: '/b' }] });

    const result = await repair();
    const configIds = ['gates', 'knowledge-store', 'merged-split-import', 'old-split-ids', 'path-updated-items-20260420'];
    const configErrors = result.errors.filter(e => configIds.includes(e.id));
    expect(configErrors).toEqual([]);
  });

  it('still errors on genuinely broken instruction JSON (has id+title+body but is malformed)', async () => {
    writeJson('broken-instruction.json', {
      id: 'broken-instruction', title: 'Broken', body: 'Some content',
      categories: 'not-an-array',
      audience: 12345,
      requirement: 'nonexistent-level',
      priority: -999,
    });

    const result = await repair();
    // broken-instruction looks like an instruction (has id+title+body strings),
    // so repair MUST process it
    const mentioned = result.updated.includes('broken-instruction')
      || result.skippedRepaired.includes('broken-instruction')
      || result.errors.some(e => e.id === 'broken-instruction');
    expect(mentioned).toBe(true);
  });

  it('agrees with loader classification on >= 5 mixed files', async () => {
    writeJson('real-1.json', {
      id: 'real-1', title: 'Real 1', body: 'Content 1',
      categories: ['test'], primaryCategory: 'test', owner: 'test',
      contentType: 'instruction', audience: 'all', requirement: 'optional',
      version: '1.0.0', priority: 50, sourceHash: 'b'.repeat(64),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    writeJson('real-2.json', {
      id: 'real-2', title: 'Real 2', body: 'Content 2',
      categories: ['test'], primaryCategory: 'test', owner: 'test',
      contentType: 'instruction', audience: 'all', requirement: 'optional',
      version: '1.0.0', priority: 50, sourceHash: 'c'.repeat(64),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    writeJson('gates.json', { defaultState: 'open', gates: [] });
    writeJson('config-data.json', { setting: true, count: 42 });
    writeJson('migration-log.json', { migrations: ['v1-v2'] });

    const result = await repair();
    const nonInstructionIds = ['gates', 'config-data', 'migration-log'];
    const falseErrors = result.errors.filter(e => nonInstructionIds.includes(e.id));
    expect(falseErrors).toEqual([]);
  });

  it('excludes _manifest and _skipped prefixed files', async () => {
    writeJson('_manifest.json', { entries: [] });
    writeJson('_skipped.json', { skipped: [] });
    writeJson('real-3.json', {
      id: 'real-3', title: 'Real 3', body: 'Content 3',
      categories: ['test'], primaryCategory: 'test', owner: 'test',
      contentType: 'instruction', audience: 'all', requirement: 'optional',
      version: '1.0.0', priority: 50, sourceHash: 'd'.repeat(64),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });

    const result = await repair();
    const prefixErrors = result.errors.filter(e => e.id.startsWith('_'));
    expect(prefixErrors).toEqual([]);
  });

  it('does not error on a file that has id+title+body (instruction-shaped)', async () => {
    writeJson('instruction-shaped.json', {
      id: 'instruction-shaped', title: 'Looks real', body: 'Has all three fields',
      sourceHash: 'x'.repeat(64),
    });

    const result = await repair();
    // instruction-shaped passes looksLikeInstruction() so the loader accepts it.
    // Repair should NOT error on it — it is either already loaded (skipped at
    // line 126) or repaired successfully.
    const errorOnIt = result.errors.some(e => e.id === 'instruction-shaped');
    expect(errorOnIt).toBe(false);
  });
});
