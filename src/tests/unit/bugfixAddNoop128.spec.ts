/**
 * #119 - index_add noop must not lie about verification (now: actually verifies)
 * #128 - index_add overwrite hydration surfaces read failures
 */
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logAudit = vi.fn();
const writeEntry = vi.fn();
const writeEntryAsync = vi.fn();
const invalidate = vi.fn();
const touchIndexVersion = vi.fn();
const ensureLoaded = vi.fn();
const ensureLoadedAsync = vi.fn();

const instructionsDir = path.join(process.cwd(), 'tmp', 'bugfix-add-tests');
fs.mkdirSync(instructionsDir, { recursive: true });

vi.mock('../../server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/registry')>();
  return { ...actual, registerHandler: actual.registerHandler };
});

vi.mock('../../services/indexContext', () => ({
  ensureLoaded,
  ensureLoadedAsync,
  getInstructionsDir: () => instructionsDir,
  invalidate,
  isDuplicateInstructionWriteError: () => false,
  touchIndexVersion,
  writeEntry,
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
vi.mock('../../services/toolRegistry', () => ({ getToolRegistry: () => [{ name: 'index_add', inputSchema: {} }] }));
vi.mock('../../config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    index: { bodyWarnLength: 20_000 },
    instructions: {
      requireCategory: false,
      canonicalDisable: false,
      agentId: 'test-agent',
      workspaceId: 'test-ws',
      manifest: { writeEnabled: false },
      strictVisibility: false,
      strictCreate: true,
    },
  }),
}));
vi.mock('../../services/canonical', () => ({ hashBody: (b: string) => 'hash-' + b.slice(0, 8) }));
vi.mock('../../services/manifestManager', () => ({ writeManifestFromIndex: vi.fn(), attemptManifestUpdate: vi.fn() }));
vi.mock('../../services/tracing', () => ({ emitTrace: vi.fn(), traceEnabled: () => false }));
vi.mock('../../services/instructionRecordValidation', () => ({
  INSTRUCTION_INPUT_SCHEMA_REF: 'ref',
  validateInstructionInputSurface: () => ({ validationErrors: [], hints: [] }),
  validateInstructionRecord: () => ({ validationErrors: [], hints: [] }),
  isInstructionValidationError: () => false,
  sanitizeLoadError: (err: unknown, kind: string = 'load_failed') => ({
    code: kind,
    detail: err instanceof Error ? err.message : String(err),
    raw: err instanceof Error ? err.message : String(err),
  }),
  sanitizeErrorDetail: (m: string) => m,
}));
vi.mock('../../services/handlers/instructions.shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/handlers/instructions.shared')>();
  return {
    ...actual,
    guard: (_name: string, fn: unknown) => fn,
    traceVisibility: () => false,
    traceInstructionVisibility: vi.fn(),
    traceEnvSnapshot: vi.fn(),
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

function stateWith(entries: Array<Record<string, unknown>>) {
  const byId = new Map(entries.map(e => [e.id as string, e]));
  return {
    loadedAt: new Date().toISOString(),
    hash: 'hash-with-entries',
    byId,
    list: entries,
    fileCount: entries.length,
    versionMTime: Date.now(),
    versionToken: 'token-entries',
  };
}

describe('#119 - index_add noop verifies persisted state truthfully', () => {
  beforeEach(async () => {
    vi.resetModules();
    logAudit.mockReset();
    writeEntry.mockReset();
    writeEntryAsync.mockReset();
    invalidate.mockReset();
    touchIndexVersion.mockReset();
    ensureLoaded.mockReset();
    ensureLoadedAsync.mockReset();
    for (const name of fs.readdirSync(instructionsDir)) {
      fs.rmSync(path.join(instructionsDir, name), { force: true, recursive: true });
    }
  });

  it('noop overwrite verifies persisted state and returns verified:true when state matches', async () => {
    const existingEntry = {
      id: 'noop-test',
      title: 'Noop Test',
      body: 'Existing body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['uncategorized'],
      primaryCategory: 'uncategorized',
      version: '1.0.0',
      owner: 'test',
      status: 'approved',
      sourceHash: 'hash-Existing',
      schemaVersion: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      changeLog: [{ version: '1.0.0', changedAt: new Date().toISOString(), summary: 'init' }],
    };

    fs.writeFileSync(path.join(instructionsDir, 'noop-test.json'), JSON.stringify(existingEntry));
    const st = stateWith([existingEntry]);
    ensureLoadedAsync.mockResolvedValue(st);
    ensureLoaded.mockReturnValue(st);

    await import('../../services/handlers/instructions.add.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_add');

    const result = await handler?.({
      entry: {
        id: 'noop-test',
        title: 'Noop Test',
        body: 'Existing body',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['uncategorized'],
      },
      overwrite: true,
    }) as Record<string, unknown>;

    expect(result?.verified).toBe(true);
    expect(result?.skipped).toBe(true);
    expect(result?.note).toBe('noop_verified');
    expect(writeEntryAsync).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      'add',
      'noop-test',
      expect.objectContaining({
        verified: true,
        noop: true,
        note: 'noop_verified',
      }),
    );
  });
});

describe('#128 - index_add hydration surfaces read failures', () => {
  beforeEach(async () => {
    vi.resetModules();
    logAudit.mockReset();
    writeEntryAsync.mockReset();
    ensureLoadedAsync.mockReset();
    ensureLoaded.mockReset();
    for (const name of fs.readdirSync(instructionsDir)) {
      fs.rmSync(path.join(instructionsDir, name), { force: true, recursive: true });
    }
  });

  it('returns error when hydration fails with load error + missing-existing-entry', async () => {
    // First call: loadExistingEntry — ensureLoadedAsync throws
    ensureLoadedAsync.mockRejectedValueOnce(new Error('boom'));
    // Subsequent calls for overwrite check
    ensureLoadedAsync.mockResolvedValue(emptyState());

    await import('../../services/handlers/instructions.add.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_add');

    const result = await handler?.({
      entry: {
        id: 'hydration-fail-test',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
      },
      overwrite: true,
    }) as Record<string, unknown>;

    expect(result?.error).toBe('existing_instruction_unreadable');
    expect(logAudit).toHaveBeenCalledWith(
      'add_hydration_error',
      'hydration-fail-test',
      expect.objectContaining({ errorCode: 'load_failed', overwrite: true }),
    );
  });
});
