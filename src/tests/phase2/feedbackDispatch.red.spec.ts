/**
 * RED: Feedback dispatch consolidation — 6 feedback tools → 1 feedback_dispatch.
 * Currently no feedback_dispatch handler exists — these tests will fail.
 * Spec: 002-tool-consolidation.md Phase 2a
 */
import { describe, it, expect } from 'vitest';
import { getHandler, listRegisteredMethods } from '../../server/registry';
import { getToolRegistry } from '../../services/toolRegistry';

// Trigger handler registration
import '../../services/handlers.feedback';

describe('RED: Feedback dispatch consolidation (002 Phase 2a)', () => {

  it('feedback_dispatch handler is registered', () => {
    const methods = listRegisteredMethods();
    expect(methods).toContain('feedback_dispatch');
  });

  it('feedback_dispatch is in tool registry', () => {
    const registry = getToolRegistry();
    const tool = registry.find(t => t.name === 'feedback_dispatch');
    expect(tool).toBeDefined();
    expect(tool?.description).toContain('feedback');
  });

  it('feedback_dispatch action=list returns entries array', async () => {
    const handler = getHandler('feedback_dispatch');
    expect(handler).toBeDefined();
    const result = await handler!({ action: 'list' }) as Record<string, unknown>;
    expect(result).toHaveProperty('entries');
    expect(Array.isArray(result.entries)).toBe(true);
  });

  it('feedback_dispatch action=stats returns statistics', async () => {
    const handler = getHandler('feedback_dispatch');
    expect(handler).toBeDefined();
    const result = await handler!({ action: 'stats' });
    expect(result).toHaveProperty('total');
  });

  it('feedback_dispatch action=health returns health status', async () => {
    const handler = getHandler('feedback_dispatch');
    expect(handler).toBeDefined();
    const result = await handler!({ action: 'health' });
    expect(result).toHaveProperty('status');
  });

  it('feedback_dispatch action=submit creates an entry (mutation)', async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    const handler = getHandler('feedback_dispatch');
    expect(handler).toBeDefined();
    const result = await handler!({
      action: 'submit',
      type: 'feature-request',
      severity: 'low',
      title: 'Test feedback dispatch',
      description: 'Red test for consolidation',
    }) as Record<string, unknown>;
    expect(result).toHaveProperty('id');
    expect(result.status).toBe('new');
  });

  it('feedback_dispatch schema has action enum', () => {
    const registry = getToolRegistry();
    const tool = registry.find(t => t.name === 'feedback_dispatch');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as any;
    expect(schema.required).toContain('action');
    expect(schema.properties.action.enum).toEqual(
      expect.arrayContaining(['submit', 'list', 'get', 'update', 'stats', 'health'])
    );
  });

  it('standalone feedback_* tools are removed from non-admin tiers', () => {
    // After consolidation, standalone feedback tools should only appear in admin tier
    const registry = getToolRegistry(); // default = core tier
    const feedbackStandalone = registry.filter(t =>
      t.name.startsWith('feedback_') && t.name !== 'feedback_dispatch'
    );
    expect(feedbackStandalone.length).toBe(0);
  });
});
