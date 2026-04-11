/**
 * RED: Manifest actions folded into index_dispatch.
 * Currently manifest_status/manifest_refresh/manifest_repair are standalone tools.
 * Spec: 002-tool-consolidation.md Phase 2b
 */
import { describe, it, expect } from 'vitest';
import { getHandler } from '../../server/registry';
import { getToolRegistry } from '../../services/toolRegistry';

// Trigger handler registration
import '../../services/handlers.manifest';
import '../../services/instructions.dispatcher';

describe('RED: Manifest dispatch actions (002 Phase 2b)', () => {

  it('index_dispatch action=manifestStatus returns manifest info', async () => {
    const handler = getHandler('index_dispatch');
    expect(handler).toBeDefined();
    const result = await handler!({ action: 'manifestStatus' });
    expect(result).toHaveProperty('present');
  });

  it('index_dispatch action=manifestRefresh rewrites manifest (mutation)', async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    const handler = getHandler('index_dispatch');
    expect(handler).toBeDefined();
    const result = await handler!({ action: 'manifestRefresh' });
    expect(result).toHaveProperty('refreshed');
  });

  it('index_dispatch action=manifestRepair reconciles drift (mutation)', async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    const handler = getHandler('index_dispatch');
    expect(handler).toBeDefined();
    const result = await handler!({ action: 'manifestRepair' });
    expect(result).toHaveProperty('repaired');
  });

  it('index_dispatch action enum includes manifest actions', () => {
    const registry = getToolRegistry();
    const tool = registry.find(t => t.name === 'index_dispatch');
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as any;
    const actionEnum: string[] = schema.properties.action.enum;
    expect(actionEnum).toContain('manifestStatus');
    expect(actionEnum).toContain('manifestRefresh');
    expect(actionEnum).toContain('manifestRepair');
  });

  it('standalone manifest_* tools removed from core/extended tiers', () => {
    const registry = getToolRegistry(); // default tier
    const manifestStandalone = registry.filter(t => t.name.startsWith('manifest_'));
    expect(manifestStandalone.length).toBe(0);
  });
});
