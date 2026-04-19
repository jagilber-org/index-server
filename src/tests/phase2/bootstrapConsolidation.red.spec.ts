/**
 * RED: Bootstrap tools consolidated into single bootstrap tool.
 * Currently 3 separate tools: bootstrap_request, bootstrap_confirmFinalize, bootstrap_status.
 * Spec: 002-tool-consolidation.md Phase 2c
 */
import { describe, it, expect } from 'vitest';
import { getHandler, listRegisteredMethods } from '../../server/registry';
import { getToolRegistry } from '../../services/toolRegistry';

// Trigger handler registration
import '../../services/handlers.bootstrap';

describe('RED: Bootstrap consolidation (002 Phase 2c)', () => {

  it('bootstrap handler is registered', () => {
    const methods = listRegisteredMethods();
    expect(methods).toContain('bootstrap');
  });

  it('bootstrap is in tool registry with action schema', () => {
    const registry = getToolRegistry();
    // Look for unified 'bootstrap' tool (not bootstrap_request etc.)
    const tool = registry.find(t => t.name === 'bootstrap');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as any;
    expect(schema.required).toContain('action');
    expect(schema.properties.action.enum).toEqual(
      expect.arrayContaining(['request', 'confirm', 'status'])
    );
  });

  it('bootstrap action=status returns gating status', async () => {
    const handler = getHandler('bootstrap');
    expect(handler).toBeDefined();
    const result = await handler!({ action: 'status' });
    expect(result).toHaveProperty('referenceMode');
  });

  it('standalone bootstrap_* tools not in default registry', () => {
    const registry = getToolRegistry(); // default tier
    const standaloneBootstrap = registry.filter(t =>
      t.name.startsWith('bootstrap_')
    );
    expect(standaloneBootstrap.length).toBe(0);
  });
});
