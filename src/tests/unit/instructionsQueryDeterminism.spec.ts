import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstructionEntry } from '../../models/instruction';

const registerHandler = vi.fn();
const ensureLoaded = vi.fn();

vi.mock('../../server/registry', () => ({
  registerHandler,
}));

vi.mock('../../services/indexContext', () => ({
  computeGovernanceHash: vi.fn(),
  ensureLoaded,
  getDebugIndexSnapshot: vi.fn(),
  getInstructionsDir: vi.fn(() => 'C:\\mock-index'),
  invalidate: vi.fn(),
}));

vi.mock('../../services/bootstrapGating', () => ({
  BOOTSTRAP_ALLOWLIST: new Set<string>(),
}));

vi.mock('../../services/classificationService', () => ({
  ClassificationService: class {},
}));

vi.mock('../../services/features', () => ({
  incrementCounter: vi.fn(),
}));

vi.mock('../../config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    instructions: {
      traceQueryDiag: false,
      strictVisibility: false,
    },
  }),
}));

vi.mock('../../services/tracing', () => ({
  emitTrace: vi.fn(),
}));

vi.mock('../../services/handlers.search', () => ({
  handleInstructionsSearch: vi.fn(),
}));

vi.mock('../../services/handlers/instructions.shared', () => ({
  limitResponseSize: <T>(value: T) => value,
  traceEnvSnapshot: vi.fn(),
  traceInstructionVisibility: vi.fn(),
  traceVisibility: () => false,
}));

function makeEntry(id: string, categories: string[]): InstructionEntry {
  return {
    id,
    title: id,
    body: `${id} body`,
    priority: 10,
    audience: 'all',
    requirement: 'optional',
    categories,
    contentType: 'instruction',
    sourceHash: `${id}-hash`,
    schemaVersion: '1',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

describe('instructionActions.query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores undocumented recent-add cache entries when building query results', async () => {
    const persisted = makeEntry('persisted-entry', ['persisted']);
    const cachedOnly = makeEntry('cached-only-entry', ['ephemeral']);
    const state = {
      hash: 'test-hash',
      list: [persisted],
      byId: new Map<string, InstructionEntry>([
        [persisted.id, persisted],
        [cachedOnly.id, cachedOnly],
      ]),
      _recentAdds: {
        [cachedOnly.id]: { ts: Date.now(), categories: ['ephemeral'] },
      },
    };
    ensureLoaded.mockReturnValue(state);

    const { instructionActions } = await import('../../services/handlers/instructions.query.js');
    const result = instructionActions.query({ categoriesAny: ['ephemeral'], limit: 1000 });

    expect(result.total).toBe(0);
    expect(result.count).toBe(0);
    expect(result.items).toEqual([]);
  });
});
