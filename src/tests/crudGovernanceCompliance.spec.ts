import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry';
import { reloadRuntimeConfig } from '../config/runtimeConfig';
import { invalidate } from '../services/indexContext';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'crud-governance-compliance');

describe('crud governance compliance', () => {
  let dispatch: ((params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;

  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../services/handlers.instructions.js');
    await import('../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('crud-governance-compliance');
    dispatch = getHandler('index_dispatch') as typeof dispatch;
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

  it('persists valid governance fields through add and get', async () => {
    const id = `gov-valid-${Date.now()}`;
    const addResp = await Promise.resolve(dispatch?.({
      action: 'add',
      entry: {
        id,
        title: 'Governance compliant add',
        body: 'body',
        priority: 40,
        audience: 'all',
        requirement: 'recommended',
        categories: ['governance', 'test'],
        owner: 'platform-team',
        status: 'review',
        priorityTier: 'P2',
        classification: 'internal',
        contentType: 'instruction',
        semanticSummary: 'Governance-compliant instruction payload.',
      },
      overwrite: true,
      lax: true,
    }) ?? {}) as Record<string, unknown>;

    expect(addResp.error).toBeUndefined();
    expect(addResp.created).toBe(true);

    const getResp = await Promise.resolve(dispatch?.({ action: 'get', id }) ?? {}) as Record<string, unknown>;
    const item = getResp.item as Record<string, unknown>;
    expect(item.status).toBe('review');
    expect(item.priorityTier).toBe('P2');
    expect(item.classification).toBe('internal');
    expect(item.contentType).toBe('instruction');
    expect(item.semanticSummary).toBe('Governance-compliant instruction payload.');
  });

  it('rejects invalid governance enum and leaves no file behind', async () => {
    const id = `gov-invalid-${Date.now()}`;
    const file = path.join(TMP_DIR, `${id}.json`);
    const addResp = await Promise.resolve(dispatch?.({
      action: 'add',
      entry: {
        id,
        title: 'Invalid governance add',
        body: 'body',
        priority: 40,
        audience: 'all',
        requirement: 'recommended',
        categories: ['governance', 'test'],
        owner: 'platform-team',
        classification: 'secret',
      },
      overwrite: true,
      lax: true,
    }) ?? {}) as Record<string, unknown>;

    expect(addResp.error).toBe('invalid_instruction');
    expect((addResp.validationErrors as string[]).some((issue) => issue.includes('classification'))).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });
});
