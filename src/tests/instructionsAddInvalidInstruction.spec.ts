import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry';
import { reloadRuntimeConfig } from '../config/runtimeConfig';
import { invalidate } from '../services/indexContext';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'instructions-add-invalid');

function expectStructuredFailure(resp: Record<string, unknown>, error: string) {
  expect(resp.error).toBe(error);
  expect(resp.success).toBe(false);
  expect(resp.created).toBe(false);
  expect(resp.message).toBe('Instruction not added.');
  expect(resp.schemaRef).toBe('index_add#input');
  expect(resp.inputSchema).toMatchObject({
    type: 'object',
    properties: {
      entry: {
        type: 'object',
      },
    },
  });
  expect(Array.isArray(resp.validationErrors)).toBe(true);
  expect((resp.validationErrors as unknown[]).length).toBeGreaterThan(0);
  expect(Array.isArray(resp.hints)).toBe(true);
}

describe('index_add invalid instruction rejection', () => {
  let add: ((params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
  let dispatch: ((params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;
  let importHandler: ((params: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined;

  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../services/handlers.instructions.js');
    await import('../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('instructions-add-invalid');
    add = getHandler('index_add') as typeof add;
    dispatch = getHandler('index_dispatch') as typeof dispatch;
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

  async function expectRejected(
    id: string,
    entry: Record<string, unknown>,
    opts: { useDispatch?: boolean; expectedField: string },
  ) {
    const file = path.join(TMP_DIR, `${id}.json`);
    const resp: Record<string, unknown> = opts.useDispatch
      ? await Promise.resolve(dispatch?.({ action: 'add', entry, overwrite: true, lax: true }) ?? {})
      : await Promise.resolve(add?.({ entry, overwrite: true, lax: true }) ?? {});

    expect(resp.created).toBe(false);
    expect(resp.overwritten).toBe(false);
    expect(resp.error).toBe('invalid_instruction');
    expect(resp.validationErrors).toBeDefined();
    expect(Array.isArray(resp.validationErrors)).toBe(true);
    expect((resp.validationErrors as string[]).some((issue) => issue.includes(opts.expectedField))).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  }

  it('rejects invalid classification via index_add and does not write a file', async () => {
    const id = `bad-classification-${Date.now()}`;
    await expectRejected(id, {
      id,
      title: 'Bad classification',
      body: 'body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      classification: 'secret',
    }, { expectedField: 'classification' });
  });

  it('rejects invalid classification via index_dispatch add and does not write a file', async () => {
    const id = `bad-dispatch-classification-${Date.now()}`;
    await expectRejected(id, {
      id,
      title: 'Bad dispatch classification',
      body: 'body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      classification: 'secret',
    }, { useDispatch: true, expectedField: 'classification' });
  });

  it('rejects invalid status and does not write a file', async () => {
    const id = `bad-status-${Date.now()}`;
    await expectRejected(id, {
      id,
      title: 'Bad status',
      body: 'body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      status: 'activeish',
    }, { expectedField: 'status' });
  });

  it('rejects invalid priorityTier and does not write a file', async () => {
    const id = `bad-priority-tier-${Date.now()}`;
    await expectRejected(id, {
      id,
      title: 'Bad priority tier',
      body: 'body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      priorityTier: 'P0',
    }, { expectedField: 'priorityTier' });
  });

  it('rejects invalid contentType and does not write a file', async () => {
    const id = `bad-content-type-${Date.now()}`;
    await expectRejected(id, {
      id,
      title: 'Bad content type',
      body: 'body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      contentType: 'agent-session',
    }, { expectedField: 'contentType' });
  });

  it('rejects missing required properties with schema hints', async () => {
    const resp = await Promise.resolve(add?.({
      entry: { id: 'missing-title', body: 'body only' },
      overwrite: true,
      lax: false,
    }) ?? {}) as Record<string, unknown>;

    expectStructuredFailure(resp, 'missing required fields');
    expect(resp.validationErrors).toContain('title: missing required field');
  });

  it('rejects invalid requirement values with specific validation details', async () => {
    const resp = await Promise.resolve(add?.({
      entry: {
        id: 'bad-requirement',
        title: 'Bad requirement',
        body: 'body',
        priority: 50,
        audience: 'all',
        requirement: 'required',
        categories: ['test'],
      },
      overwrite: true,
    }) ?? {}) as Record<string, unknown>;

    expectStructuredFailure(resp, 'invalid_instruction');
    expect(resp.validationErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('/requirement')]),
    );
  });

  it('rejects extra instruction properties on add input', async () => {
    const resp = await Promise.resolve(add?.({
      entry: {
        id: 'unexpected-prop',
        title: 'Unexpected',
        body: 'body',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
        unexpected: 'nope',
      },
      overwrite: true,
    }) ?? {}) as Record<string, unknown>;

    expectStructuredFailure(resp, 'invalid_instruction');
    expect(resp.validationErrors).toContain('/: unexpected property "unexpected"');
  });

  it('rejects null properties instead of treating them as successful adds', async () => {
    const resp = await Promise.resolve(add?.({
      entry: {
        id: 'null-title',
        title: null,
        body: 'body',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
      },
      overwrite: true,
    }) ?? {}) as Record<string, unknown>;

    expectStructuredFailure(resp, 'invalid_instruction');
    expect(resp.validationErrors).toContain('/title: null is not allowed');
  });

  it('rejects invalid extensions values with nested path details', async () => {
    const resp = await Promise.resolve(add?.({
      entry: {
        id: 'bad-extensions',
        title: 'Bad extensions',
        body: 'body',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
        extensions: {
          vendor: {
            enabled: true,
            note: null,
          },
        },
      },
      overwrite: true,
    }) ?? {}) as Record<string, unknown>;

    expectStructuredFailure(resp, 'invalid_instruction');
    expect(resp.validationErrors).toEqual(
      expect.arrayContaining([expect.stringContaining('/extensions/vendor/note')]),
    );
  });

  it('applies the same invalid extensions validation during import while preserving valid entries', async () => {
    const resp = await Promise.resolve(importHandler?.({
      entries: [
        {
          id: 'import-bad-extensions',
          title: 'Import bad extensions',
          body: 'body',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          categories: ['test'],
          extensions: { vendor: { note: null } },
        },
        {
          id: 'import-valid-extensions',
          title: 'Import valid extensions',
          body: 'body',
          priority: 50,
          audience: 'all',
          requirement: 'optional',
          categories: ['test'],
          extensions: { vendor: { note: 'ok', flags: [true, 1, 'x'] } },
        },
      ],
      mode: 'overwrite',
    }) ?? {}) as { imported?: number; overwritten?: number; errors?: Array<{ id: string; error: string }> };

    expect((resp.imported ?? 0) + (resp.overwritten ?? 0)).toBe(1);
    expect(resp.errors).toEqual([
      expect.objectContaining({
        id: 'import-bad-extensions',
        error: expect.stringContaining('/extensions/vendor/note'),
      }),
    ]);
    expect(fs.existsSync(path.join(TMP_DIR, 'import-valid-extensions.json'))).toBe(true);
  });
});
