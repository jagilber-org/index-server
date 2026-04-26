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

const instructionsDir = path.join(process.cwd(), 'tmp', 'instructions-add-readback-verification');
fs.mkdirSync(instructionsDir, { recursive: true });

vi.mock('../../server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/registry')>();
  return {
    ...actual,
    registerHandler: actual.registerHandler,
  };
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

vi.mock('../../services/features', () => ({
  incrementCounter: vi.fn(),
}));

vi.mock('../../services/classificationService', () => ({
  ClassificationService: class {
    normalize<T>(value: T) { return value; }
    validate() { return []; }
  },
}));

vi.mock('../../services/ownershipService', () => ({
  resolveOwner: () => undefined,
}));

vi.mock('../../services/auditLog', () => ({
  logAudit,
}));

vi.mock('../../services/toolRegistry', () => ({
  getToolRegistry: () => [{ name: 'index_add', inputSchema: {} }],
}));

vi.mock('../../config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    index: { bodyWarnLength: 20_000 },
    instructions: {
      requireCategory: false,
      canonicalDisable: false,
      agentId: 'agent-test',
      workspaceId: 'workspace-test',
      manifest: { writeEnabled: false },
      strictVisibility: false,
      strictCreate: true,
    },
  }),
}));

vi.mock('../../services/canonical', () => ({
  hashBody: () => 'hash-body',
}));

vi.mock('../../services/manifestManager', () => ({
  writeManifestFromIndex: vi.fn(),
  attemptManifestUpdate: vi.fn(),
}));

vi.mock('../../services/tracing', () => ({
  emitTrace: vi.fn(),
}));

vi.mock('../../services/instructionRecordValidation', () => ({
  INSTRUCTION_INPUT_SCHEMA_REF: 'instruction-input-schema',
  validateInstructionInputSurface: () => ({ validationErrors: [], hints: [] }),
  validateInstructionRecord: () => ({ validationErrors: [], hints: [] }),
  isInstructionValidationError: () => false,
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

describe('index_add read-back verification', () => {
  beforeEach(async () => {
    vi.resetModules();
    logAudit.mockReset();
    writeEntry.mockReset();
    writeEntryAsync.mockReset();
    invalidate.mockReset();
    touchIndexVersion.mockReset();
    ensureLoaded.mockReset();
    ensureLoadedAsync.mockReset();
    ensureLoaded.mockImplementation(() => emptyState());
    ensureLoadedAsync.mockImplementation(async () => emptyState());
    for (const name of fs.readdirSync(instructionsDir)) {
      fs.rmSync(path.join(instructionsDir, name), { force: true, recursive: true });
    }
    await import('../../services/handlers/instructions.add.js');
  });

  it('fails when post-write reload cannot read the new entry back', async () => {
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_add');

    const result = await handler?.({
      entry: {
        id: 'verify-fail-entry',
        title: 'Verify Fail Entry',
        body: 'Body that never becomes visible',
      },
    }) as Record<string, unknown>;

    expect(result?.success).toBe(false);
    expect(result?.error).toBe('read-back verification failed');
    expect(result?.created).toBe(true);
    expect(result?.overwritten).toBe(false);
    expect(result?.verified).toBe(false);
    expect(result?.strictVerified).toBe(false);
    expect(result?.validationErrors).toEqual(expect.arrayContaining(['not-in-index']));
    expect(logAudit).toHaveBeenCalledWith(
      'add',
      'verify-fail-entry',
      expect.objectContaining({
        created: true,
        overwritten: false,
        verified: false,
        strictVerified: false,
      }),
    );
  });
});
