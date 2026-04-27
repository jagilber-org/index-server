/**
 * #132 - index_governanceUpdate preserves error details and always audits
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logAudit = vi.fn();
const writeEntry = vi.fn();
const ensureLoaded = vi.fn();
const invalidate = vi.fn();
const touchIndexVersion = vi.fn();

vi.mock('../../server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/registry')>();
  return { ...actual, registerHandler: actual.registerHandler };
});

vi.mock('../../services/indexContext', () => ({
  ensureLoaded,
  computeGovernanceHash: () => 'gov-hash',
  invalidate,
  projectGovernance: (e: unknown) => e,
  touchIndexVersion,
  writeEntry,
}));

vi.mock('../../services/auditLog', () => ({ logAudit }));
vi.mock('../../services/manifestManager', () => ({ attemptManifestUpdate: vi.fn() }));
vi.mock('../../services/features', () => ({ incrementCounter: vi.fn() }));
vi.mock('../../services/handlers/instructions.shared', () => ({
  guard: (_name: string, fn: unknown) => fn,
  bumpVersion: (v: string | undefined, bump: string) => {
    const parts = (v || '1.0.0').split('.').map(Number);
    if (bump === 'patch') parts[2]++;
    if (bump === 'minor') { parts[1]++; parts[2] = 0; }
    if (bump === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
    return parts.join('.');
  },
  createChangeLogEntry: (version: string, summary: string) => ({
    version,
    changedAt: new Date().toISOString(),
    summary,
  }),
}));

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

describe('#132 - index_governanceUpdate error handling', () => {
  beforeEach(async () => {
    vi.resetModules();
    logAudit.mockReset();
    writeEntry.mockReset();
    ensureLoaded.mockReset();
    invalidate.mockReset();
    touchIndexVersion.mockReset();
  });

  it('logs audit with full error details on write failure', async () => {
    const existing = {
      id: 'gov-test',
      title: 'Test',
      body: 'body',
      owner: 'old-owner',
      status: 'draft',
      version: '1.0.0',
      categories: ['test'],
    };
    ensureLoaded.mockReturnValue(stateWith([existing]));
    writeEntry.mockImplementation(() => { throw new TypeError('disk full'); });

    await import('../../services/handlers/instructions.patch.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_governanceUpdate');

    const result = await handler?.({ id: 'gov-test', owner: 'new-owner' }) as Record<string, unknown>;

    expect(result?.error).toBe('write-failed');
    expect(result?.detail).toBe('disk full');
    expect(result?.errorType).toBe('TypeError');
    expect(logAudit).toHaveBeenCalledWith(
      'governanceUpdate',
      'gov-test',
      expect.objectContaining({
        error: 'disk full',
        errorType: 'TypeError',
        writeFailure: true,
        stack: expect.any(String),
      }),
    );
  });

  it('logs audit on notFound', async () => {
    ensureLoaded.mockReturnValue(emptyState());

    await import('../../services/handlers/instructions.patch.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_governanceUpdate');

    const result = await handler?.({ id: 'missing-id' }) as Record<string, unknown>;

    expect(result?.notFound).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      'governanceUpdate',
      'missing-id',
      expect.objectContaining({ notFound: true }),
    );
  });

  it('logs audit on invalid status', async () => {
    const existing = {
      id: 'status-test',
      title: 'Test',
      body: 'body',
      owner: 'owner',
      status: 'draft',
      version: '1.0.0',
      categories: ['test'],
    };
    ensureLoaded.mockReturnValue(stateWith([existing]));

    await import('../../services/handlers/instructions.patch.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_governanceUpdate');

    const result = await handler?.({ id: 'status-test', status: 'bogus' }) as Record<string, unknown>;

    expect(result?.error).toBe('invalid status');
    expect(logAudit).toHaveBeenCalledWith(
      'governanceUpdate',
      'status-test',
      expect.objectContaining({ error: 'invalid status', provided: 'bogus' }),
    );
  });

  it('logs full governance details on success', async () => {
    const existing = {
      id: 'success-test',
      title: 'Test',
      body: 'body',
      owner: 'old-owner',
      status: 'draft',
      version: '1.0.0',
      categories: ['test'],
    };
    ensureLoaded.mockReturnValue(stateWith([existing]));
    writeEntry.mockImplementation(() => {});

    await import('../../services/handlers/instructions.patch.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_governanceUpdate');

    const result = await handler?.({ id: 'success-test', owner: 'new-owner' }) as Record<string, unknown>;

    expect(result?.changed).toBe(true);
    expect(logAudit).toHaveBeenCalledWith(
      'governanceUpdate',
      'success-test',
      expect.objectContaining({
        changed: true,
        owner: 'new-owner',
      }),
    );
  });
});
