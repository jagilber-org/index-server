/**
 * RED: Tool tier filtering — getToolRegistry() should support tier-based filtering.
 * Currently getToolRegistry() returns ALL tools with no filtering — these tests will fail.
 * Spec: 002-tool-consolidation.md Phase 1
 */
import { describe, it, expect } from 'vitest';
import { getToolRegistry } from '../../services/toolRegistry';

// Expected core tools (always visible, essential daily use)
// feedback_dispatch was removed in Phase 2b (002-tool-consolidation); only feedback_submit remains (admin tier)
const CORE_TOOLS = new Set([
  'health_check',
  'index_dispatch',
  'index_search',
  'prompt_review',
  'help_overview',
  'bootstrap',
]);

// Extended = core + extended-tier tools
const EXTENDED_ONLY_TOOLS = new Set([
  'graph_export',
  'usage_track',
  'usage_hotset',
  'index_add',
  'index_import',
  'index_remove',
  'index_reload',
  'index_governanceHash',
  'index_governanceUpdate',
  'gates_evaluate',
  'integrity_verify',
  'metrics_snapshot',
  'promote_from_repo',
  'index_schema',
]);

describe('RED: Tool tier filtering (002-tool-consolidation Phase 1)', () => {

  it('ToolRegistryEntry should have a tier field', () => {
    const registry = getToolRegistry();
    const first = registry[0];
    expect(first).toHaveProperty('tier');
    expect(['core', 'extended', 'admin']).toContain((first as any).tier);
  });

  it('getToolRegistry({ tier: "core" }) returns only core tools', () => {
    const registry = getToolRegistry({ tier: 'core' });
    const names = new Set(registry.map(t => t.name));
    expect(names).toEqual(CORE_TOOLS);
  });

  it('getToolRegistry({ tier: "extended" }) returns core + extended tools', () => {
    const registry = getToolRegistry({ tier: 'extended' });
    const names = new Set(registry.map(t => t.name));
    // Should include all core tools
    for (const core of CORE_TOOLS) {
      expect(names.has(core), `missing core tool: ${core}`).toBe(true);
    }
    // Should include all extended-only tools
    for (const ext of EXTENDED_ONLY_TOOLS) {
      expect(names.has(ext), `missing extended tool: ${ext}`).toBe(true);
    }
    // Should NOT include admin-only tools
    expect(names.has('diagnostics_block')).toBe(false);
    expect(names.has('bootstrap_request')).toBe(false);
    expect(names.has('meta_tools')).toBe(false);
  });

  it('getToolRegistry({ tier: "admin" }) returns all tools', () => {
    const adminFiltered = getToolRegistry({ tier: 'admin' });
    expect(adminFiltered.length).toBeGreaterThanOrEqual(40);
  });

  it('getToolRegistry() with no args defaults to core tier', () => {
    // After Phase 1, the default (no args) should return only core-tier tools
    // to minimize the surface exposed to MCP clients by default.
    const registry = getToolRegistry();
    const names = new Set(registry.map(t => t.name));
    expect(names).toEqual(CORE_TOOLS);
  });

  it('every tool has exactly one tier assigned', () => {
    const allTools = getToolRegistry({ tier: 'admin' });
    for (const tool of allTools) {
      expect(tool.tier, `${tool.name} missing tier`).toBeDefined();
      expect(['core', 'extended', 'admin']).toContain(tool.tier);
    }
  });
});
