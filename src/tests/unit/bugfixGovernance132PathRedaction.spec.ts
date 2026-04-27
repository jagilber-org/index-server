/**
 * #132 - index_governanceUpdate must redact filesystem paths from the
 * detail message returned to MCP clients while preserving the full,
 * untouched detail in the audit log for operators.
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
  bumpVersion: (v: string | undefined) => v || '1.0.0',
  createChangeLogEntry: (version: string, summary: string) => ({ version, summary, changedAt: '' }),
}));

function stateWith(entry: Record<string, unknown>) {
  return {
    loadedAt: new Date().toISOString(),
    hash: 'h',
    byId: new Map([[entry.id as string, entry]]),
    list: [entry],
    fileCount: 1,
    versionMTime: 0,
    versionToken: 't',
  };
}

describe('#132 - index_governanceUpdate path redaction', () => {
  beforeEach(() => {
    vi.resetModules();
    logAudit.mockReset();
    writeEntry.mockReset();
    ensureLoaded.mockReset();
  });

  it('redacts windows absolute paths in the response detail but preserves them in audit', async () => {
    const existing = { id: 'gov-x', title: 't', body: 'b', owner: 'old', status: 'draft', version: '1.0.0', categories: ['x'] };
    ensureLoaded.mockReturnValue(stateWith(existing));
    writeEntry.mockImplementation(() => {
      throw new Error("EACCES: permission denied, open 'C:\\internal\\secret\\store\\foo.json'");
    });

    await import('../../services/handlers/instructions.patch.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_governanceUpdate');

    const result = await handler?.({ id: 'gov-x', owner: 'new' }) as Record<string, unknown>;

    expect(result?.error).toBe('write-failed');
    expect(result?.detail).not.toContain('C:\\internal');
    expect(result?.detail).toContain('<redacted-path>');

    expect(logAudit).toHaveBeenCalledWith(
      'governanceUpdate',
      'gov-x',
      expect.objectContaining({
        error: expect.stringContaining('C:\\internal\\secret\\store\\foo.json'),
        writeFailure: true,
      }),
    );
  });

  it('redacts unix absolute paths in the response detail', async () => {
    const existing = { id: 'gov-y', title: 't', body: 'b', owner: 'old', status: 'draft', version: '1.0.0', categories: ['x'] };
    ensureLoaded.mockReturnValue(stateWith(existing));
    writeEntry.mockImplementation(() => {
      throw new Error("ENOENT: no such file '/var/lib/index-server/data/foo.json'");
    });

    await import('../../services/handlers/instructions.patch.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_governanceUpdate');

    const result = await handler?.({ id: 'gov-y', owner: 'new' }) as Record<string, unknown>;

    expect(result?.detail).not.toContain('/var/lib');
    expect(result?.detail).toContain('<redacted-path>');
  });

  it('preserves messages without paths verbatim', async () => {
    const existing = { id: 'gov-z', title: 't', body: 'b', owner: 'old', status: 'draft', version: '1.0.0', categories: ['x'] };
    ensureLoaded.mockReturnValue(stateWith(existing));
    writeEntry.mockImplementation(() => { throw new Error('disk full'); });

    await import('../../services/handlers/instructions.patch.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_governanceUpdate');

    const result = await handler?.({ id: 'gov-z', owner: 'new' }) as Record<string, unknown>;
    expect(result?.detail).toBe('disk full');
  });
});
