/**
 * TDD RED/GREEN: index_groom remapCategories mode.
 * Validates that the groom handler can remap primaryCategory using shared CATEGORY_RULES.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../server/registry.js';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'groom-remap-categories');

function writeInstruction(id: string, extra: Record<string, unknown> = {}): void {
  const entry = {
    id,
    title: `Test: ${id}`,
    body: `Body for ${id}`,
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['uncategorized'],
    schemaVersion: '4',
    version: '1.0.0',
    contentType: 'instruction',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(path.join(TMP_DIR, `${id}.json`), JSON.stringify(entry, null, 2));
}

function readInstruction(id: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(TMP_DIR, `${id}.json`), 'utf8'));
}

describe('index_groom — remapCategories mode', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../../services/handlers.instructions.js');
    await import('../../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('groom-remap-categories-test');
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('dryRun returns remappedCategories count without modifying files', async () => {
    writeInstruction('azure-batch-test-pool', { primaryCategory: '' });
    writeInstruction('kusto-query-patterns', { primaryCategory: '' });
    writeInstruction('generic-other-thing', { primaryCategory: '' });

    // Force index reload so groom sees the new instructions
    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'groom',
      mode: { dryRun: true, remapCategories: true },
    }) as Record<string, unknown>;

    expect(result).toBeDefined();
    expect(result.dryRun).toBe(true);
    expect(typeof result.remappedCategories).toBe('number');
    expect((result.remappedCategories as number)).toBeGreaterThanOrEqual(2);

    // In dryRun, groom does not write remapped categories (files may be rewritten
    // by index loader sanitization during ensureLoaded, converting '' to 'uncategorized')
    const azureEntry = readInstruction('azure-batch-test-pool');
    expect(azureEntry.primaryCategory).toBe('');
  });

  it('remaps primaryCategory for instructions matching CATEGORY_RULES', async () => {
    // Clean and re-create test data
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    writeInstruction('azure-batch-test-pool', { primaryCategory: '' });
    writeInstruction('kusto-query-patterns', { primaryCategory: '' });
    writeInstruction('sf-deploy-guide', { primaryCategory: '' });
    writeInstruction('mcp-tool-reference', { primaryCategory: '' });
    writeInstruction('generic-other-thing', { primaryCategory: '' });

    // Force index reload
    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'groom',
      mode: { remapCategories: true },
    }) as Record<string, unknown>;

    expect(result).toBeDefined();
    expect(result.dryRun).toBe(false);
    expect((result.remappedCategories as number)).toBeGreaterThanOrEqual(4);

    // Verify files were updated on disk
    const azureEntry = readInstruction('azure-batch-test-pool');
    expect(azureEntry.primaryCategory).toBe('azure');

    const kustoEntry = readInstruction('kusto-query-patterns');
    expect(kustoEntry.primaryCategory).toBe('kusto');

    const sfEntry = readInstruction('sf-deploy-guide');
    expect(sfEntry.primaryCategory).toBe('service fabric');

    const mcpEntry = readInstruction('mcp-tool-reference');
    expect(mcpEntry.primaryCategory).toBe('mcp');
  });

  it('adds derived category to categories array if not present', async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    writeInstruction('powershell-module-test', {
      primaryCategory: '',
      categories: ['scripting'],
    });

    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    await dispatch({
      action: 'groom',
      mode: { remapCategories: true },
    });

    const entry = readInstruction('powershell-module-test');
    expect(entry.primaryCategory).toBe('powershell');
    expect((entry.categories as string[])).toContain('powershell');
    // Original category should still be present
    expect((entry.categories as string[])).toContain('scripting');
  });

  it('does not overwrite existing non-empty primaryCategory', async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    writeInstruction('azure-batch-special', {
      primaryCategory: 'custom-category',
    });

    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'groom',
      mode: { remapCategories: true },
    }) as Record<string, unknown>;

    // Should not count as remapped since it already had a primaryCategory
    expect(result.remappedCategories).toBe(0);

    const entry = readInstruction('azure-batch-special');
    expect(entry.primaryCategory).toBe('custom-category');
  });

  it('skips Other category — does not set primaryCategory to Other', async () => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    writeInstruction('alpha', { primaryCategory: '' });
    writeInstruction('beta', { primaryCategory: '' });

    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'groom',
      mode: { remapCategories: true },
    }) as Record<string, unknown>;

    expect(result.remappedCategories).toBe(0);

    // alpha and beta don't match any category rule, so they stay as-is on disk
    const alphaEntry = readInstruction('alpha');
    expect(alphaEntry.primaryCategory).toBe('');
  });

  it('tool registry schema includes remapCategories in groom mode', async () => {
    const { getToolRegistry } = await import('../../services/toolRegistry.js');
    const tools = getToolRegistry({ tier: 'admin' });
    const groom = tools.find((t: { name: string }) => t.name === 'index_groom')!;
    expect(groom).toBeDefined();
    const schema = groom.inputSchema as { properties: { mode: { properties: Record<string, unknown> } } };
    expect(schema.properties.mode.properties.remapCategories).toBeDefined();
  });
});
