import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry';
import { reloadRuntimeConfig } from '../config/runtimeConfig';
import { invalidate } from '../services/indexContext';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'instructions-import-invalid');

describe('index_import invalid instruction rejection', () => {
  let importHandler: ((params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;

  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../services/handlers.instructions.js');
    forceBootstrapConfirmForTests('instructions-import-invalid');
    importHandler = getHandler('index_import') as typeof importHandler;
  });

  beforeEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    invalidate();
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MUTATION;
    invalidate();
  });

  it('rejects path-traversal ids during import and does not write a file', async () => {
    const resp = await Promise.resolve(importHandler?.({
      entries: [{
        id: '..\\evil',
        title: 'Bad import id',
        body: 'body',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
      }],
    }) ?? {}) as { imported?: number; errors?: Array<{ id?: string; error?: string }> };

    expect(resp.imported).toBe(0);
    expect(resp.errors).toEqual([
      expect.objectContaining({
        id: '..\\evil',
        error: expect.stringContaining('invalid_instruction: id:'),
      }),
    ]);
    expect(fs.readdirSync(TMP_DIR).filter((file) => file.endsWith('.json') && !file.startsWith('_'))).toHaveLength(0);
  });
});
