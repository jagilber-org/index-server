import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstructionEntry } from '../../models/instruction';

type GovernanceProjection = { id: string; owner?: string };
type GovernanceHandler = () => { count: number; governanceHash: string; items: GovernanceProjection[] };

let registeredHandlers = new Map<string, GovernanceHandler>();
const ensureLoaded = vi.fn();
const invalidate = vi.fn();
const projectGovernance = vi.fn();
const computeGovernanceHash = vi.fn();
const incrementCounter = vi.fn();

vi.mock('../../server/registry', () => ({
  registerHandler: (name: string, handler: GovernanceHandler) => {
    registeredHandlers.set(name, handler);
  },
}));

vi.mock('../../services/indexContext', () => ({
  computeGovernanceHash,
  ensureLoaded,
  invalidate,
  projectGovernance,
  touchIndexVersion: vi.fn(),
  writeEntry: vi.fn(),
}));

vi.mock('../../services/auditLog', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../../services/manifestManager', () => ({
  attemptManifestUpdate: vi.fn(),
}));

vi.mock('../../services/features', () => ({
  incrementCounter,
}));

vi.mock('../../services/handlers/instructions.shared', () => ({
  guard: (_name: string, handler: unknown) => handler,
}));

function makeEntry(id: string, owner = 'team-a'): InstructionEntry {
  return {
    id,
    title: id,
    body: `${id} body`,
    priority: 10,
    audience: 'all',
    requirement: 'optional',
    categories: ['test'],
    contentType: 'instruction',
    sourceHash: `${id}-hash`,
    schemaVersion: '1',
    owner,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

describe('index_governanceHash reliability', () => {
  beforeEach(async () => {
    vi.resetModules();
    registeredHandlers = new Map<string, GovernanceHandler>();
    ensureLoaded.mockReset();
    invalidate.mockReset();
    projectGovernance.mockReset();
    computeGovernanceHash.mockReset();
    incrementCounter.mockReset();
    computeGovernanceHash.mockReturnValue('hash-123');
    projectGovernance.mockImplementation((entry: InstructionEntry) => ({ id: entry.id, owner: entry.owner }));
    await import('../../services/handlers/instructions.patch.js');
  });

  it('throws when freshness reload is required and every reload attempt fails', () => {
    const staleState = {
      loadedAt: new Date(Date.now() - 5_000).toISOString(),
      list: [makeEntry('stale-entry')],
      byId: new Map<string, InstructionEntry>(),
    };
    ensureLoaded
      .mockReturnValueOnce(staleState)
      .mockImplementation(() => { throw new Error('disk read failed'); });

    const handler = registeredHandlers.get('index_governanceHash');
    expect(handler).toBeDefined();

    let error: unknown;
    try {
      handler!();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/could not refresh index state/i);
    expect((error as Error).message).toMatch(/stale-check: disk read failed/i);
  });

  it('returns governance hash when no refresh is required', () => {
    const freshState = {
      loadedAt: new Date().toISOString(),
      list: [makeEntry('fresh-entry')],
      byId: new Map<string, InstructionEntry>(),
    };
    ensureLoaded.mockReturnValue(freshState);

    const handler = registeredHandlers.get('index_governanceHash');
    expect(handler).toBeDefined();

    expect(handler!()).toEqual({
      count: 1,
      governanceHash: 'hash-123',
      items: [{ id: 'fresh-entry', owner: 'team-a' }],
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
});
