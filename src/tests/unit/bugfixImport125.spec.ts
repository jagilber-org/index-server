/**
 * #125 - index_import read-back verification for written entries
 */
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logAudit = vi.fn();
const writeEntryAsync = vi.fn();
const invalidate = vi.fn();
const touchIndexVersion = vi.fn();
const ensureLoadedAsync = vi.fn();

const instructionsDir = path.join(process.cwd(), 'tmp', 'bugfix-import-tests');
fs.mkdirSync(instructionsDir, { recursive: true });

vi.mock('../../server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/registry')>();
  return { ...actual, registerHandler: actual.registerHandler };
});

vi.mock('../../services/indexContext', () => ({
  ensureLoadedAsync,
  getInstructionsDir: () => instructionsDir,
  invalidate,
  touchIndexVersion,
  writeEntryAsync,
}));

vi.mock('../../services/features', () => ({ incrementCounter: vi.fn() }));
vi.mock('../../services/classificationService', () => ({
  ClassificationService: class {
    normalize<T>(value: T) { return value; }
    validate() { return []; }
  },
}));
vi.mock('../../services/ownershipService', () => ({ resolveOwner: () => undefined }));
vi.mock('../../services/auditLog', () => ({ logAudit }));
vi.mock('../../config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    index: { bodyWarnLength: 20_000 },
    logging: { level: 'INFO' },
    instructions: {
      requireCategory: false,
      canonicalDisable: false,
      agentId: 'test-agent',
      workspaceId: 'test-ws',
      manifest: { writeEnabled: false },
    },
  }),
}));
vi.mock('../../services/manifestManager', () => ({ attemptManifestUpdate: vi.fn() }));
vi.mock('../../services/instructionRecordValidation', () => ({
  validateInstructionInputSurface: () => ({ validationErrors: [], hints: [] }),
  validateInstructionRecord: () => ({ validationErrors: [], hints: [] }),
  isInstructionValidationError: () => false,
}));
vi.mock('../../services/handlers/instructions.shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/handlers/instructions.shared')>();
  return {
    ...actual,
    guard: (_name: string, fn: unknown) => fn,
  };
});

function emptyState() {
  return {
    loadedAt: new Date().toISOString(),
    hash: 'hash-empty',
    byId: new Map(),
    list: [],
    fileCount: 0,
    versionMTime: 0,
    versionToken: 'token-empty',
  };
}

describe('#125 - index_import read-back verification', () => {
  beforeEach(async () => {
    vi.resetModules();
    logAudit.mockReset();
    writeEntryAsync.mockReset();
    invalidate.mockReset();
    touchIndexVersion.mockReset();
    ensureLoadedAsync.mockReset();
    for (const name of fs.readdirSync(instructionsDir)) {
      fs.rmSync(path.join(instructionsDir, name), { force: true, recursive: true });
    }
  });

  it('reports verified:false when written entry is missing after reload', async () => {
    ensureLoadedAsync.mockResolvedValue(emptyState());
    writeEntryAsync.mockResolvedValue(undefined);

    await import('../../services/handlers/instructions.import.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_import');

    const result = await handler?.({
      entries: [{
        id: 'import-verify-test',
        title: 'Import Verify',
        body: 'Body content',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
      }],
      mode: 'overwrite',
    }) as Record<string, unknown>;

    expect(result?.verified).toBe(false);
    const errors = result?.errors as Array<{ id: string; error: string }>;
    expect(errors?.some(e => e.id === 'import-verify-test' && e.error === 'not-in-index-after-reload')).toBe(true);
  });

  it('verifies new entries even when mode is skip', async () => {
    ensureLoadedAsync.mockResolvedValue(emptyState());
    writeEntryAsync.mockResolvedValue(undefined);

    await import('../../services/handlers/instructions.import.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_import');

    const result = await handler?.({
      entries: [{
        id: 'new-in-skip-mode',
        title: 'New Entry',
        body: 'Should be verified',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
      }],
      mode: 'skip',
    }) as Record<string, unknown>;

    // Entry was new (not skipped) so written, but not in index after reload
    expect(result?.verified).toBe(false);
    const errors = result?.errors as Array<{ id: string; error: string }>;
    expect(errors?.some(e => e.id === 'new-in-skip-mode' && e.error === 'not-in-index-after-reload')).toBe(true);
  });
});
