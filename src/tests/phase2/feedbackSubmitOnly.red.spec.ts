/**
 * RED: feedback_submit-only MCP surface regression tests.
 *
 * Desired end-state (Trinity to implement):
 *   - feedback_list, feedback_get, feedback_update, feedback_stats, feedback_health,
 *     AND feedback_dispatch are ALL REMOVED from the MCP registry entirely
 *     (not in INPUT_SCHEMAS, STABLE, MUTATION, or returned by getToolRegistry at any tier).
 *   - feedback_submit is the sole surviving feedback tool.
 *
 * Currently: all six targeted tools remain in STABLE/MUTATION and appear in the
 * registry. All "absence" tests below will FAIL until Trinity removes them.
 *
 * Spec: 002-tool-consolidation Phase 2b (revised — dispatch also removed)
 */
import { describe, it, expect } from 'vitest';
import { getToolRegistry, STABLE, MUTATION } from '../../services/toolRegistry';

// Trigger handler registration so registry is fully populated
import '../../services/toolHandlers';

/**
 * Tools that must be REMOVED from MCP entirely.
 * feedback_dispatch is now included — it is no longer the "unified endpoint";
 * feedback_submit is the only remaining feedback tool.
 */
const REMOVED_TOOLS = [
  'feedback_list',
  'feedback_get',
  'feedback_update',
  'feedback_stats',
  'feedback_health',
  'feedback_dispatch',
] as const;

/** Subset of REMOVED_TOOLS that were in STABLE (all except feedback_update). */
const STABLE_REMOVED = REMOVED_TOOLS.filter(t => t !== 'feedback_update');

/** Subset of REMOVED_TOOLS that were in MUTATION. */
const MUTATION_REMOVED = ['feedback_update'] as const;

describe('RED: feedback_submit-only MCP surface (002 Phase 2b revised)', () => {

  // ── Absence tests: removed tools must NOT appear in the registry at any tier ──

  describe('removed feedback tools absent from MCP registry (admin tier)', () => {
    const adminRegistry = getToolRegistry({ tier: 'admin' });
    const adminToolNames = new Set(adminRegistry.map(t => t.name));

    for (const tool of REMOVED_TOOLS) {
      it(`${tool} is absent from admin-tier MCP registry`, () => {
        expect(
          adminToolNames.has(tool),
          `${tool} is still exposed in the admin-tier MCP registry — must be removed`
        ).toBe(false);
      });
    }
  });

  describe('feedback_dispatch absent from core-tier MCP registry', () => {
    it('feedback_dispatch is absent from core-tier registry', () => {
      const coreRegistry = getToolRegistry({ tier: 'core' });
      const found = coreRegistry.find(t => t.name === 'feedback_dispatch');
      expect(
        found,
        'feedback_dispatch is still exposed in the core-tier MCP registry — must be removed'
      ).toBeUndefined();
    });
  });

  // ── Set-membership tests: removed tools must NOT be in STABLE or MUTATION ──

  describe('removed feedback tools absent from STABLE set', () => {
    for (const tool of STABLE_REMOVED) {
      it(`${tool} is not in STABLE set`, () => {
        expect(
          STABLE.has(tool),
          `${tool} is still in STABLE — must be removed from STABLE set`
        ).toBe(false);
      });
    }
  });

  describe('removed feedback tools absent from MUTATION set', () => {
    for (const tool of MUTATION_REMOVED) {
      it(`${tool} is not in MUTATION set`, () => {
        expect(
          MUTATION.has(tool),
          `${tool} is still in MUTATION — must be removed from MUTATION set`
        ).toBe(false);
      });
    }
  });

  // ── Submit-only surface: feedback_submit MUST remain as sole feedback tool ──

  it('feedback_submit is present in MCP registry (sole feedback tool retained)', () => {
    const adminRegistry = getToolRegistry({ tier: 'admin' });
    const tool = adminRegistry.find(t => t.name === 'feedback_submit');
    expect(tool, 'feedback_submit must remain in the MCP registry').toBeDefined();
    expect(MUTATION.has('feedback_submit')).toBe(true);
  });

  // ── Combined: ONLY feedback_submit should be a standalone feedback tool ──

  it('only feedback_submit is a standalone feedback tool in admin registry', () => {
    const adminRegistry = getToolRegistry({ tier: 'admin' });
    const standaloneFeedback = adminRegistry
      .filter(t => t.name.startsWith('feedback_'))
      .map(t => t.name)
      .sort();

    expect(
      standaloneFeedback,
      `Expected only [feedback_submit] but found: [${standaloneFeedback.join(', ')}]`
    ).toEqual(['feedback_submit']);
  });
});
