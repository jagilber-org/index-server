/**
 * #131 - index_health surfaces invariant-repair summary so operators can
 * detect silent data reconstruction without having to read raw logs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ensureLoaded = vi.fn();
const computeGovernanceHash = vi.fn(() => 'gov-hash');
const invalidate = vi.fn();
const getInstructionsDir = vi.fn(() => process.cwd());
const getDebugIndexSnapshot = vi.fn(() => ({}));
const getInvariantRepairSummary = vi.fn();

vi.mock('../../server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/registry')>();
  return { ...actual, registerHandler: actual.registerHandler };
});

vi.mock('../../services/indexContext', () => ({
  ensureLoaded,
  computeGovernanceHash,
  invalidate,
  getInstructionsDir,
  getDebugIndexSnapshot,
  getInvariantRepairSummary,
}));

vi.mock('../../services/bootstrapGating', () => ({ BOOTSTRAP_ALLOWLIST: new Set<string>() }));
vi.mock('../../services/classificationService', () => ({ ClassificationService: class { normalize<T>(v: T) { return v; } } }));
vi.mock('../../services/features', () => ({ incrementCounter: vi.fn() }));
vi.mock('../../config/runtimeConfig', () => ({ getRuntimeConfig: () => ({ instructions: {} }) }));
vi.mock('../../services/tracing', () => ({ emitTrace: vi.fn() }));
vi.mock('../../services/handlers.search', () => ({ handleInstructionsSearch: vi.fn() }));
vi.mock('../../services/handlers/instructions.shared', () => ({
  limitResponseSize: <T>(v: T) => v,
  traceEnvSnapshot: vi.fn(),
  traceInstructionVisibility: vi.fn(),
  traceVisibility: vi.fn(),
}));

function emptyState() {
  return {
    loadedAt: new Date().toISOString(),
    hash: 'h',
    byId: new Map(),
    list: [],
    fileCount: 0,
    loadSummary: { scanned: 0, accepted: 0, skipped: 0, reasons: {} },
    loadDebug: { scanned: 0, accepted: 0 },
  };
}

describe('#131: index_health exposes invariant-repair summary', () => {
  beforeEach(() => {
    vi.resetModules();
    ensureLoaded.mockReset();
    getInvariantRepairSummary.mockReset();
  });

  it('includes invariantRepairs in the response', async () => {
    ensureLoaded.mockReturnValue(emptyState());
    getInvariantRepairSummary.mockReturnValue({
      totalRepairs: 3,
      recentRepairs: [
        { ts: '2025-01-01T00:00:00Z', id: 'foo', field: 'usageCount', source: 'authority' },
      ],
    });

    await import('../../services/handlers/instructions.query.js');
    const { getLocalHandler } = await import('../../server/registry.js');
    const handler = getLocalHandler('index_health');
    const result = await handler?.({}) as Record<string, unknown>;

    expect(result?.invariantRepairs).toBeDefined();
    const ir = result.invariantRepairs as { totalRepairs: number; recentRepairs: unknown[] };
    expect(ir.totalRepairs).toBe(3);
    expect(ir.recentRepairs).toHaveLength(1);
    expect(getInvariantRepairSummary).toHaveBeenCalled();
  });
});
