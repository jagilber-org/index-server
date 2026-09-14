import { describe, it, expect } from 'vitest';
import { getFlagRegistrySnapshot, FLAG_REGISTRY } from '../services/handlers.dashboardConfig';
import { getHandler } from '../server/registry';

describe('dashboardConfigPanel – flag registry snapshot', () => {

  it('returns a non-empty array of flags', () => {
    const flags = getFlagRegistrySnapshot();
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.length).toBe(FLAG_REGISTRY.length);
  });

  it('each flag has required metadata fields', () => {
    const flags = getFlagRegistrySnapshot();
    for (const f of flags) {
      expect(f).toHaveProperty('name');
      expect(f).toHaveProperty('category');
      expect(f).toHaveProperty('description');
      expect(f).toHaveProperty('stability');
      expect(typeof f.name).toBe('string');
      expect(f.name.length).toBeGreaterThan(0);
      expect(typeof f.category).toBe('string');
      expect(f.category.length).toBeGreaterThan(0);
      expect(typeof f.description).toBe('string');
      expect(f.description.length).toBeGreaterThan(0);
    }
  });

  it('flags are sorted by category then name', () => {
    const flags = getFlagRegistrySnapshot();
    for (let i = 1; i < flags.length; i++) {
      const prev = flags[i - 1];
      const curr = flags[i];
      const catCmp = prev.category.localeCompare(curr.category);
      if (catCmp > 0) {
        // previous category sorts after current – violation
        expect.fail(`Flag "${prev.name}" (category="${prev.category}") should come before "${curr.name}" (category="${curr.category}")`);
      }
      if (catCmp === 0) {
        // same category – names must be ascending
        expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0);
      }
    }
  });

  it('each flag has a docAnchor string', () => {
    const flags = getFlagRegistrySnapshot();
    for (const f of flags) {
      expect(f).toHaveProperty('docAnchor');
      expect(typeof (f as any).docAnchor).toBe('string');
      expect((f as any).docAnchor.length).toBeGreaterThan(0);
      // docAnchor should be a URL-friendly slug
      expect((f as any).docAnchor).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it('snapshot includes generatedAt ISO timestamp', async () => {
    const handler = getHandler('dashboard_config');
    expect(handler).toBeDefined();
    const result = await handler!({}) as { generatedAt: string; lastRefreshed: number };
    expect(result).toHaveProperty('generatedAt');
    expect(typeof result.generatedAt).toBe('string');
    // Should parse as a valid ISO date
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });

  it('snapshot includes lastRefreshed epoch ms', async () => {
    const handler = getHandler('dashboard_config');
    const result = await handler!({}) as { lastRefreshed: number };
    expect(result).toHaveProperty('lastRefreshed');
    expect(typeof result.lastRefreshed).toBe('number');
    expect(result.lastRefreshed).toBeGreaterThan(0);
    // Should be a recent timestamp (within last minute)
    expect(Date.now() - result.lastRefreshed).toBeLessThan(60_000);
  });

  it('categories are consistent with known set', () => {
    const knownCategories = new Set([
      'auth', 'bootstrap', 'feedback', 'index', 'core', 'dashboard', 'deprecated', 'diagnostics',
      'instructions', 'lifecycle-hooks', 'manifest', 'messaging', 'metrics', 'multi-instance', 'semantic', 'storage', 'stress',
      'tracing', 'usage', 'validation',
    ]);
    const flags = getFlagRegistrySnapshot();
    for (const f of flags) {
      expect(knownCategories.has(f.category)).toBe(true);
    }
  });

  it('no duplicate flag names', () => {
    const flags = getFlagRegistrySnapshot();
    const names = flags.map(f => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('surfaces lifecycle hook commands as sensitive write-only presence indicators', () => {
    const key = 'INDEX_SERVER_HOOK_ON_CHANGE';
    const previous = process.env[key];
    const command = 'operator-command-must-not-leak';
    try {
      process.env[key] = command;
      const flag = getFlagRegistrySnapshot().find(f => f.name === key);
      expect(flag).toBeDefined();
      expect(flag).toMatchObject({
        category: 'lifecycle-hooks',
        editable: true,
        sensitive: true,
        writeOnly: true,
        reloadBehavior: 'restart-required',
        present: true,
      });
      expect(flag).not.toHaveProperty('value');
      expect(flag).not.toHaveProperty('parsed');
      expect(JSON.stringify(flag)).not.toContain(command);
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it('surfaces lifecycle hook execution controls with validation metadata', () => {
    const byName = new Map(FLAG_REGISTRY.map(flag => [flag.name, flag]));
    expect(byName.get('INDEX_SERVER_HOOK_BLOCKING')).toMatchObject({
      category: 'lifecycle-hooks',
      type: 'boolean',
      reloadBehavior: 'restart-required',
      editable: true,
    });
    expect(byName.get('INDEX_SERVER_HOOK_TIMEOUT_MS')).toMatchObject({
      category: 'lifecycle-hooks',
      type: 'number',
      default: '10000',
      validation: { min: 1, unit: 'ms' },
    });
    expect(byName.get('INDEX_SERVER_HOOK_MAX_CONCURRENT')).toMatchObject({
      category: 'lifecycle-hooks',
      type: 'number',
      default: '4',
      validation: { min: 1 },
    });
  });
});
