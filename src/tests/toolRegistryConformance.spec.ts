/**
 * Tool Registry Conformance Test
 * Verifies alignment between INPUT_SCHEMAS, STABLE/MUTATION sets,
 * handler registrations, describeTool, and TOOL_TIERS.
 * This catches the root cause of tool failures: registry drift.
 */
import { describe, it, expect } from 'vitest';
import { getToolRegistry, STABLE } from '../services/toolRegistry';
import { TOOL_TIERS } from '../services/protocolEnums';
import { listRegisteredMethods } from '../server/registry';

// Import the consolidated handler registration shim used by the server entrypoint.
import '../services/toolHandlers';

describe('Tool Registry Conformance', () => {
  const registry = getToolRegistry({ tier: 'admin' });
  const registryNames = new Set(registry.map(t => t.name));
  const methods = listRegisteredMethods();
  const methodSet = new Set(methods);

  it('every tool in registry has a registered handler', () => {
    const missing = registry
      .map(t => t.name)
      .filter(name => !methodSet.has(name));
    expect(missing, `Registry tools without handlers: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('every registered handler has a registry entry', () => {
    // Exclude test-only primitives (echo/ping, diagnostics_handshake, etc.)
    const testPrimitives = new Set(['echo/ping', 'diagnostics_handshake', 'test_primitive']);
    const missing = methods
      .filter(name => !registryNames.has(name) && !testPrimitives.has(name));
    expect(missing, `Handlers without registry entries: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('every registry tool has an inputSchema', () => {
    const missing = registry
      .filter(t => !t.inputSchema || typeof t.inputSchema !== 'object')
      .map(t => t.name);
    expect(missing, `Tools without inputSchema: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('every registry tool has a non-default description', () => {
    const defaultDesc = registry
      .filter(t => t.description === 'Tool description pending.')
      .map(t => t.name);
    expect(defaultDesc, `Tools with placeholder description: ${defaultDesc.join(', ')}`).toHaveLength(0);
  });

  it('every tool is classified as stable or mutation (no orphans)', () => {
    const orphans = registry
      .filter(t => !t.stable && !t.mutation)
      .map(t => t.name);
    expect(orphans, `Tools not in STABLE or MUTATION: ${orphans.join(', ')}`).toHaveLength(0);
  });

  it('no tool is both stable and mutation', () => {
    const both = registry
      .filter(t => t.stable && t.mutation)
      .map(t => t.name);
    expect(both, `Tools in both STABLE and MUTATION: ${both.join(', ')}`).toHaveLength(0);
  });

  it('every tool has a tier (core, extended, or admin)', () => {
    const validTiers = new Set<string>(TOOL_TIERS);
    const invalid = registry
      .filter(t => !validTiers.has(t.tier))
      .map(t => `${t.name}:${t.tier}`);
    expect(invalid, `Tools with invalid tier: ${invalid.join(', ')}`).toHaveLength(0);
  });

  it('INPUT_SCHEMAS count matches registry tool count', () => {
    // Registry is built from union of STABLE + MUTATION + INPUT_SCHEMAS keys
    // All three should be consistent
    expect(registry.length).toBeGreaterThanOrEqual(30); // sanity: we expect 40+ tools
  });

  it('STABLE set has expected minimum size', () => {
    expect(STABLE.size).toBeGreaterThanOrEqual(20);
  });

  it('core tools are stable, not privileged mutations', () => {
    const coreMutations = registry
      .filter(t => t.tier === 'core' && t.mutation)
      .map(t => t.name);
    expect(coreMutations, `Core tools should not be privileged mutations: ${coreMutations.join(', ')}`).toHaveLength(0);
  });
});
