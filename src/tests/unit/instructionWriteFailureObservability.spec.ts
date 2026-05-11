import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logAudit = vi.fn();
const logError = vi.fn();
const logInfo = vi.fn();
const log = vi.fn();
const writeEntryAsync = vi.fn();
const invalidate = vi.fn();
const touchIndexVersion = vi.fn();
const ensureLoadedAsync = vi.fn();

const instructionsDir = path.join(process.cwd(), 'tmp', 'instruction-write-failure-observability');
fs.mkdirSync(instructionsDir, { recursive: true });

vi.mock('../../server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/registry')>();
  return { ...actual, registerHandler: actual.registerHandler };
});

vi.mock('../../services/indexContext', () => ({
  ensureLoadedAsync,
  getInstructionsDir: () => instructionsDir,
  invalidate,
  isDuplicateInstructionWriteError: () => false,
  touchIndexVersion,
  writeEntry: vi.fn(),
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
vi.mock('../../services/logger', () => ({ log, logError, logInfo }));
vi.mock('../../services/toolRegistry', () => ({ getToolRegistry: () => [{ name: 'index_add', inputSchema: {} }] }));
vi.mock('../../config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    index: { bodyWarnLength: 20_000 },
    logging: { level: 'INFO' },
    instructions: {
      requireCategory: false,
      canonicalDisable: false,
      agentId: 'test-agent',
      workspaceId: 'test-workspace',
      manifest: { writeEnabled: false },
      strictVisibility: false,
      strictCreate: true,
    },
  }),
}));
vi.mock('../../services/canonical', () => ({ hashBody: () => 'hash-body' }));
vi.mock('../../services/manifestManager', () => ({ writeManifestFromIndex: vi.fn(), attemptManifestUpdate: vi.fn() }));
vi.mock('../../services/tracing', () => ({ emitTrace: vi.fn() }));
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

function entry(id: string) {
  return {
    id,
    title: 'Write Failure',
    body: 'Body',
    priority: 50,
    audience: 'all',
    requirement: 'optional',
  };
}

describe('instruction write failure observability', () => {
  beforeEach(() => {
    vi.resetModules();
    logAudit.mockReset();
    logError.mockReset();
    logInfo.mockReset();
    log.mockReset();
    writeEntryAsync.mockReset();
    invalidate.mockReset();
    touchIndexVersion.mockReset();
    ensureLoadedAsync.mockReset();
    ensureLoadedAsync.mockResolvedValue(emptyState());
    for (const name of fs.readdirSync(instructionsDir)) {
      fs.rmSync(path.join(instructionsDir, name), { force: true, recursive: true });
    }
  });

  it('index_add logs and audits catch-all write_failed without exposing raw errors to clients', async () => {
    const rawError = new Error("ENOENT: no such file or directory, open 'C:\\secret\\entry.json'");
    writeEntryAsync.mockRejectedValue(rawError);

    await import('../../services/handlers/instructions.add.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_add');

    const result = await handler?.({ entry: entry('add-write-failed') }) as Record<string, unknown>;

    expect(result?.success).toBe(false);
    expect(result?.error).toBe('write_failed');
    expect(String(result?.message)).toContain('The error details are not exposed to clients.');
    expect(String(result?.message)).not.toContain('C:\\secret');
    expect(logError).toHaveBeenCalledWith(
      '[add] instruction write failed',
      expect.objectContaining({ id: 'add-write-failed', error: rawError.message }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      'add_write_failed',
      'add-write-failed',
      expect.objectContaining({ error: rawError.message, errorName: 'Error', overwrite: false }),
    );
  });

  it('index_import logs and audits per-entry write failures while returning generic errors', async () => {
    const rawError = new Error("EACCES: permission denied, open 'C:\\secret\\entry.json'");
    writeEntryAsync.mockRejectedValue(rawError);

    await import('../../services/handlers/instructions.import.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_import');

    const result = await handler?.({ entries: [entry('import-write-failed')], mode: 'overwrite' }) as Record<string, unknown>;
    const errors = result?.errors as Array<{ id: string; error: string }>;

    expect(errors).toEqual([
      {
        id: 'import-write-failed',
        error: 'write_failed: Instruction write failed due to an internal error. The error details are not exposed to clients.',
      },
    ]);
    expect(errors[0].error).not.toContain('C:\\secret');
    expect(logError).toHaveBeenCalledWith(
      '[import] entry write failed',
      expect.objectContaining({ id: 'import-write-failed', error: rawError.message }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      'import_write_failed',
      'import-write-failed',
      expect.objectContaining({ error: rawError.message, errorName: 'Error', mode: 'overwrite' }),
    );
  });
});
