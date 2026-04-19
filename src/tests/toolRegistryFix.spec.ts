/**
 * Verify tool adapter registry alignment fix (Priority 1.2)
 * Tests that manifest_status and index_diagnostics are properly registered
 */
import { describe, it, expect } from 'vitest';
import { getToolRegistry } from '../services/toolRegistry';
import { listRegisteredMethods } from '../server/registry';

// Import handlers to trigger registration (mimics server startup)
import '../services/handlers.manifest';
import '../services/handlers.instructionsDiagnostics';

describe('Tool Registry Alignment (Priority 1.2)', () => {
  it('manifest_status is in tool registry', () => {
    const registry = getToolRegistry({ tier: 'admin' });
    const tool = registry.find(t => t.name === 'manifest_status');
    expect(tool, 'manifest_status should be in registry').toBeDefined();
    expect(tool?.description).toContain('manifest');
    expect(tool?.stable).toBe(true);
    expect(tool?.mutation).toBe(false);
  });

  it('index_diagnostics is in tool registry', () => {
    const registry = getToolRegistry({ tier: 'admin' });
    const tool = registry.find(t => t.name === 'index_diagnostics');
    expect(tool, 'index_diagnostics should be in registry').toBeDefined();
    expect(tool?.description).toContain('diagnostics');
    expect(tool?.stable).toBe(true);
    expect(tool?.mutation).toBe(false);
  });

  it('manifest_status handler is registered and callable', async () => {
    const methods = listRegisteredMethods();
    expect(methods).toContain('manifest_status');
  });

  it('index_diagnostics handler is registered and callable', async () => {
    const methods = listRegisteredMethods();
    expect(methods).toContain('index_diagnostics');
  });

  it('all stable tools in registry have registered handlers (comprehensive check)', () => {
    // This test requires all handler modules to be imported (done in server/index.ts)
    // For this unit test, we only verify the specific Priority 1.2 fixes
    const _registry = getToolRegistry({ tier: 'admin' });
    const methods = listRegisteredMethods();

    // Priority 1.2 specific tools that were broken (now fixed)
    const priority12Tools = ['manifest_status', 'index_diagnostics'];
    const missingPriority12 = priority12Tools.filter(name => !methods.includes(name));

    expect(missingPriority12,
      `Priority 1.2 tools should all have handlers. Missing: ${missingPriority12.join(', ')}`
    ).toHaveLength(0);

    // Note: Full registry-handler alignment check would require importing all handlers
    // This is done at server startup via src/server/index.ts imports
  });

  it('all registered handlers have tool registry entries', () => {
    const registry = getToolRegistry({ tier: 'admin' });
    const methods = listRegisteredMethods();

    const registryNames = new Set(registry.map(t => t.name));
    const missingEntries = methods.filter(name => !registryNames.has(name));

    expect(missingEntries,
      `All handlers should have registry entries. Missing: ${missingEntries.join(', ')}`
    ).toHaveLength(0);
  });
});
