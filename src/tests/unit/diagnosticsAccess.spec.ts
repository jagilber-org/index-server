import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'diagnostics-access');
const AUDIT_FILE = path.join(TMP_DIR, 'audit.log.jsonl');
const TRACKED_ENV = [
  'INDEX_SERVER_DEBUG',
  'INDEX_SERVER_STRESS_DIAG',
  'INDEX_SERVER_FLAG_TOOLS_ADMIN',
  'INDEX_SERVER_AUDIT_LOG',
] as const;

describe('dangerous diagnostics access control', () => {
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of TRACKED_ENV) savedEnv.set(key, process.env[key]);
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(async () => {
    for (const key of TRACKED_ENV) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
    const runtimeConfig = await import('../../config/runtimeConfig.js');
    runtimeConfig.reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('keeps dangerous diagnostics out of the registered tool surface by default', async () => {
    delete process.env.INDEX_SERVER_DEBUG;
    delete process.env.INDEX_SERVER_STRESS_DIAG;
    process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN = '1';

    vi.resetModules();
    const runtimeConfig = await import('../../config/runtimeConfig.js');
    runtimeConfig.reloadRuntimeConfig();
    await import('../../services/toolHandlers.js');
    const { getHandler } = await import('../../server/registry.js');
    const { getToolRegistry } = await import('../../services/toolRegistry.js');

    const toolNames = new Set(getToolRegistry({ tier: 'admin' }).map((tool: { name: string }) => tool.name));
    expect(toolNames.has('diagnostics_block')).toBe(false);
    expect(toolNames.has('diagnostics_microtaskFlood')).toBe(false);
    expect(toolNames.has('diagnostics_memoryPressure')).toBe(false);
    expect(getHandler('diagnostics_block')).toBeUndefined();

    const activationGuide = await getHandler('meta_activation_guide')!({});
    expect((activationGuide as { categories?: Record<string, unknown> }).categories?.diagnostics).toBeUndefined();
  });

  it('only exposes dangerous diagnostics when debug mode is explicitly enabled', async () => {
    process.env.INDEX_SERVER_DEBUG = '1';
    process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN = '1';

    vi.resetModules();
    const runtimeConfig = await import('../../config/runtimeConfig.js');
    runtimeConfig.reloadRuntimeConfig();
    await import('../../services/toolHandlers.js');
    const { getHandler } = await import('../../server/registry.js');
    const { getToolRegistry } = await import('../../services/toolRegistry.js');

    const tools = getToolRegistry({ tier: 'admin' });
    const toolNames = new Set(tools.map((tool: { name: string }) => tool.name));
    expect(toolNames.has('diagnostics_block')).toBe(true);
    expect(toolNames.has('diagnostics_microtaskFlood')).toBe(true);
    expect(toolNames.has('diagnostics_memoryPressure')).toBe(true);
    expect(getHandler('diagnostics_block')).toBeDefined();

    const blockSchema = tools.find((tool: { name: string }) => tool.name === 'diagnostics_block')?.inputSchema as { properties?: { ms?: { maximum?: number } } };
    const floodSchema = tools.find((tool: { name: string }) => tool.name === 'diagnostics_microtaskFlood')?.inputSchema as { properties?: { count?: { maximum?: number } } };
    const memorySchema = tools.find((tool: { name: string }) => tool.name === 'diagnostics_memoryPressure')?.inputSchema as { properties?: { mb?: { maximum?: number } } };
    expect(blockSchema.properties?.ms?.maximum).toBe(1000);
    expect(floodSchema.properties?.count?.maximum).toBe(25000);
    expect(memorySchema.properties?.mb?.maximum).toBe(64);
  });

  it('writes a start audit entry before running a dangerous diagnostics tool', async () => {
    process.env.INDEX_SERVER_DEBUG = '1';
    process.env.INDEX_SERVER_AUDIT_LOG = AUDIT_FILE;

    vi.resetModules();
    const runtimeConfig = await import('../../config/runtimeConfig.js');
    runtimeConfig.reloadRuntimeConfig();
    const auditLog = await import('../../services/auditLog.js');
    auditLog.resetAuditLogCache();
    await import('../../services/toolHandlers.js');
    const { getHandler } = await import('../../server/registry.js');

    const handler = getHandler('diagnostics_block');
    expect(handler).toBeDefined();
    await handler!({ ms: 0 });

    const result = auditLog.readAuditEntries();
    const startEntry = result.entries.find((entry: { action: string; kind: string; meta?: Record<string, unknown> }) =>
      entry.action === 'diagnostics_block' &&
      entry.kind === 'mutation' &&
      entry.meta?.phase === 'start'
    );

    expect(startEntry).toBeDefined();
    expect(startEntry?.meta?.effectiveMs).toBe(0);
  });
});
