/**
 * Regression test for groom tool category normalization (feedback ID: 938a092a330834dc).
 * The groom tool must detect and remove junk categories:
 * - Purely numeric or starts-with-number: 100-percent-confidence, 35-tools
 * - Single characters: a, b
 * - Case/ticket IDs: case-2506250040010257
 * - Near-duplicate plural variants: agent-workflow vs agent-workflows (keep singular)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../server/registry.js';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'groom-junk-categories');

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

describe('index_groom — junk category normalization', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../../services/handlers.instructions.js');
    await import('../../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('groom-junk-categories-test');
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
  });

  it('dryRun reports junk categories without modifying files', async () => {
    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');

    writeInstruction('junk-cats-dry-run', {
      categories: ['100-percent-confidence', 'a', 'case-2506250040010257', 'valid-category'],
    });

    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom', mode: { dryRun: true } }) as Record<string, unknown>;

    expect(result.dryRun).toBe(true);
    // normalizedCategories should reflect that at least one entry needs updating
    expect(typeof result.normalizedCategories).toBe('number');
    expect(result.normalizedCategories as number).toBeGreaterThan(0);

    // In dryRun, file must NOT be modified — junk categories still present
    const disk = readInstruction('junk-cats-dry-run');
    const cats = disk.categories as string[];
    expect(cats).toContain('100-percent-confidence');
  });

  it('removes numeric-prefix categories (35-tools, 100-percent-confidence)', async () => {
    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    writeInstruction('numeric-prefix-test', {
      categories: ['35-tools', '100-percent-confidence', 'valid-category'],
    });

    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom', mode: { dryRun: false } }) as Record<string, unknown>;

    expect(result.normalizedCategories as number).toBeGreaterThan(0);

    const disk = readInstruction('numeric-prefix-test');
    const cats = disk.categories as string[];
    expect(cats).not.toContain('35-tools');
    expect(cats).not.toContain('100-percent-confidence');
    expect(cats).toContain('valid-category');
  });

  it('removes single-character categories (a, b)', async () => {
    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    writeInstruction('single-char-test', {
      categories: ['a', 'b', 'ok'],
    });

    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    await dispatch({ action: 'groom', mode: { dryRun: false } });

    const disk = readInstruction('single-char-test');
    const cats = disk.categories as string[];
    expect(cats).not.toContain('a');
    expect(cats).not.toContain('b');
    expect(cats).toContain('ok');
  });

  it('removes case/ticket ID categories (case-2506250040010257)', async () => {
    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    writeInstruction('case-id-test', {
      categories: ['case-2506250040010257', 'real-category'],
    });

    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    await dispatch({ action: 'groom', mode: { dryRun: false } });

    const disk = readInstruction('case-id-test');
    const cats = disk.categories as string[];
    expect(cats).not.toContain('case-2506250040010257');
    expect(cats).toContain('real-category');
  });

  it('deduplicates plural variants (agent-workflows → agent-workflow)', async () => {
    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    writeInstruction('plural-dedup-test', {
      categories: ['agent-workflow', 'agent-workflows', 'tool'],
    });

    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom', mode: { dryRun: false } }) as Record<string, unknown>;
    expect(result.normalizedCategories as number).toBeGreaterThan(0);

    const disk = readInstruction('plural-dedup-test');
    const cats = disk.categories as string[];
    // Plural form should be removed, singular kept
    expect(cats).not.toContain('agent-workflows');
    expect(cats).toContain('agent-workflow');
    expect(cats).toContain('tool');
  });

  it('normalizedCategories count > 0 when entries have junk categories', async () => {
    const { invalidate, ensureLoaded } = await import('../../services/indexContext.js');
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });

    writeInstruction('junk-count-a', { categories: ['132-functions', 'real'] });
    writeInstruction('junk-count-b', { categories: ['x', 'valid-tag'] });
    writeInstruction('clean-entry',  { categories: ['clean', 'good'] });

    invalidate();
    ensureLoaded();

    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({ action: 'groom', mode: { dryRun: false } }) as Record<string, unknown>;

    // At least 2 entries had junk categories
    expect(result.normalizedCategories as number).toBeGreaterThanOrEqual(2);
  });
});
