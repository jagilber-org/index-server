/**
 * #125 - index_import summary now exposes explicit verifiedCount and
 * verificationErrorCount so callers can numerically compare write
 * success vs read-back success without re-scanning the errors array.
 */
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logAudit = vi.fn();
const writeEntryAsync = vi.fn();
const invalidate = vi.fn();
const touchIndexVersion = vi.fn();
const ensureLoadedAsync = vi.fn();

const instructionsDir = path.join(process.cwd(), 'tmp', 'bugfix-import-verifycount-tests');
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
    normalize<T>(v: T) { return v; }
    validate() { return []; }
  },
}));
vi.mock('../../services/ownershipService', () => ({ resolveOwner: () => undefined }));
vi.mock('../../services/auditLog', () => ({ logAudit }));
vi.mock('../../config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    index: { bodyWarnLength: 20_000 },
    logging: { level: 'INFO' },
    instructions: { requireCategory: false, agentId: 'a', workspaceId: 'w', manifest: { writeEnabled: false } },
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
    guard: (_n: string, fn: unknown) => fn,
  };
});

function emptyState() {
  return { loadedAt: new Date().toISOString(), hash: 'h', byId: new Map(), list: [], fileCount: 0 };
}

function stateWith(ids: string[]) {
  const byId = new Map<string, unknown>();
  for (const id of ids) byId.set(id, { id });
  return { loadedAt: new Date().toISOString(), hash: 'h', byId, list: ids.map(id => ({ id })), fileCount: ids.length };
}

describe('#125: index_import summary exposes verifiedCount', () => {
  beforeEach(() => {
    vi.resetModules();
    logAudit.mockReset();
    writeEntryAsync.mockReset();
    ensureLoadedAsync.mockReset();
  });

  it('verifiedCount equals written count when reload succeeds', async () => {
    ensureLoadedAsync.mockResolvedValue(stateWith(['ok-1', 'ok-2']));
    writeEntryAsync.mockResolvedValue(undefined);

    await import('../../services/handlers/instructions.import.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_import');

    const result = await handler?.({
      entries: [
        { id: 'ok-1', title: 't', body: 'b', priority: 50, audience: 'all', requirement: 'optional' },
        { id: 'ok-2', title: 't', body: 'b', priority: 50, audience: 'all', requirement: 'optional' },
      ],
      mode: 'overwrite',
    }) as Record<string, unknown>;

    expect(result?.verified).toBe(true);
    expect(result?.verifiedCount).toBe(2);
    expect(result?.verificationErrorCount).toBe(0);
  });

  it('verifiedCount is 0 and verificationErrorCount matches when entries missing after reload', async () => {
    ensureLoadedAsync.mockResolvedValue(emptyState());
    writeEntryAsync.mockResolvedValue(undefined);

    await import('../../services/handlers/instructions.import.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_import');

    const result = await handler?.({
      entries: [
        { id: 'missing-1', title: 't', body: 'b', priority: 50, audience: 'all', requirement: 'optional' },
        { id: 'missing-2', title: 't', body: 'b', priority: 50, audience: 'all', requirement: 'optional' },
      ],
      mode: 'overwrite',
    }) as Record<string, unknown>;

    expect(result?.verified).toBe(false);
    expect(result?.verifiedCount).toBe(0);
    expect(result?.verificationErrorCount).toBe(2);
  });
});
