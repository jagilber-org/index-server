/**
 * #126 - parity: index_groom must call logAudit per-entry on write/delete
 * failures, matching the behaviour of index_enrich and index_repair.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logAudit = vi.fn();
const writeEntry = vi.fn();
const removeEntry = vi.fn();
const ensureLoaded = vi.fn();
const invalidate = vi.fn();
const touchIndexVersion = vi.fn();
const loadUsageSnapshot = vi.fn(() => ({}));
const getInstructionsDir = vi.fn(() => process.cwd());

vi.mock('../../server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/registry')>();
  return { ...actual, registerHandler: actual.registerHandler };
});

vi.mock('../../services/indexContext', () => ({
  ensureLoaded,
  getInstructionsDir,
  invalidate,
  loadUsageSnapshot,
  touchIndexVersion,
  writeEntry,
  removeEntry,
}));

vi.mock('../../services/auditLog', () => ({ logAudit }));
vi.mock('../../services/manifestManager', () => ({ attemptManifestUpdate: vi.fn() }));
vi.mock('../../config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({ instructions: {}, index: {} }),
}));
vi.mock('../../versioning/schemaVersion', () => ({
  migrateInstructionRecord: () => ({ changed: false }),
  SCHEMA_VERSION: 1,
}));
vi.mock('../../services/categoryRules', () => ({ deriveCategory: () => 'Other' }));
vi.mock('../../services/canonical', () => ({ hashBody: (b: string) => b }));
vi.mock('../../services/handlers/instructions.shared', () => ({
  guard: (_n: string, fn: unknown) => fn,
  computeSourceHash: (s: string) => `hash-${s}`,
  normalizeCategories: (c: string[]) => c,
  isJunkCategory: () => false,
}));

function stateWith(entries: Array<Record<string, unknown>>) {
  const byId = new Map(entries.map(e => [e.id as string, e]));
  return {
    loadedAt: new Date().toISOString(),
    hash: 'h',
    byId,
    list: entries,
    fileCount: entries.length,
  };
}

describe('#126: index_groom logs audit per-entry on write/delete failure', () => {
  beforeEach(() => {
    vi.resetModules();
    logAudit.mockReset();
    writeEntry.mockReset();
    removeEntry.mockReset();
    ensureLoaded.mockReset();
  });

  it('calls logAudit("groom_entry_error", ...) when writeEntry fails for an entry', async () => {
    const entry = { id: 'groom-write-fail', title: 't', body: 'b', priority: 50, audience: 'all', requirement: 'optional', categories: ['x'], sourceHash: 'wrong-hash', updatedAt: '' };
    ensureLoaded.mockReturnValue(stateWith([entry]));
    writeEntry.mockImplementation(() => { throw new Error('disk error'); });

    await import('../../services/handlers/instructions.groom.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_groom');

    const result = await handler?.({ mode: { dryRun: false } }) as Record<string, unknown>;

    const errors = result?.errors as Array<{ id: string; error: string }>;
    expect(errors).toBeDefined();
    expect(errors.some(e => e.id === 'groom-write-fail' && e.error.includes('disk error'))).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      'groom_entry_error',
      'groom-write-fail',
      expect.objectContaining({ error: 'disk error', operation: 'write' }),
    );
  });
});
