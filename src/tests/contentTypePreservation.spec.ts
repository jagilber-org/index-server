/**
 * Regression test for contentType coercion bug (feedback IDs: 06ccadf2d64735e8, cc4d7d0a435f163f).
 * When adding an entry with contentType: "agent", the stored entry must come back with contentType === "agent".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry.js';
import { reloadRuntimeConfig } from '../config/runtimeConfig.js';
import { forceBootstrapConfirmForTests } from '../services/bootstrapGating.js';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'content-type-preservation');

describe('contentType preservation on add/import', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    await import('../services/handlers.instructions.js');
    await import('../services/instructions.dispatcher.js');
    forceBootstrapConfirmForTests('content-type-preservation-test');
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.INDEX_SERVER_DIR;
  });

  it('preserves contentType: "agent" through add → get round-trip', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const id = 'test-agent-content-type';

    // Add entry with contentType: "agent"
    const addResult = await dispatch({
      action: 'add',
      entry: {
        id,
        title: 'Test Agent Skill',
        body: 'This is an agent-type entry for testing contentType preservation.',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['agents'],
        contentType: 'agent',
      },
      lax: true,
      overwrite: true,
    }) as Record<string, unknown>;

    expect(addResult.error).toBeFalsy();
    expect(addResult.created).toBe(true);

    // Read back the entry
    const getResult = await dispatch({ action: 'get', id }) as Record<string, unknown>;
    expect(getResult.item).toBeTruthy();
    const item = getResult.item as Record<string, unknown>;
    expect(item.contentType).toBe('agent');

    // Also verify the on-disk file has the correct contentType
    const diskEntry = JSON.parse(fs.readFileSync(path.join(TMP_DIR, `${id}.json`), 'utf8'));
    expect(diskEntry.contentType).toBe('agent');
  });

  it('preserves contentType: "template" through add → get round-trip', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const id = 'test-template-content-type';

    const addResult = await dispatch({
      action: 'add',
      entry: {
        id,
        title: 'Test Template',
        body: 'This is a template-type entry.',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['templates'],
        contentType: 'template',
      },
      lax: true,
      overwrite: true,
    }) as Record<string, unknown>;

    expect(addResult.error).toBeFalsy();

    const getResult = await dispatch({ action: 'get', id }) as Record<string, unknown>;
    const item = getResult.item as Record<string, unknown>;
    expect(item.contentType).toBe('template');

    const diskEntry = JSON.parse(fs.readFileSync(path.join(TMP_DIR, `${id}.json`), 'utf8'));
    expect(diskEntry.contentType).toBe('template');
  });

  it('preserves contentType: "workflow" through add → get round-trip', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const id = 'test-workflow-content-type';

    const addResult = await dispatch({
      action: 'add',
      entry: {
        id,
        title: 'Test Workflow',
        body: 'This is a workflow-type entry.',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['workflows'],
        contentType: 'workflow',
      },
      lax: true,
      overwrite: true,
    }) as Record<string, unknown>;

    expect(addResult.error).toBeFalsy();

    const getResult = await dispatch({ action: 'get', id }) as Record<string, unknown>;
    const item = getResult.item as Record<string, unknown>;
    expect(item.contentType).toBe('workflow');

    const diskEntry = JSON.parse(fs.readFileSync(path.join(TMP_DIR, `${id}.json`), 'utf8'));
    expect(diskEntry.contentType).toBe('workflow');
  });

  it('normalizes legacy contentType: "chat-session" writes to "workflow"', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const id = 'test-chat-session-content-type';

    const addResult = await dispatch({
      action: 'add',
      entry: {
        id,
        title: 'Test Legacy Chat Session',
        body: 'This legacy chat-session entry should persist as workflow.',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['workflows'],
        contentType: 'chat-session',
      },
      lax: true,
      overwrite: true,
    }) as Record<string, unknown>;

    expect(addResult.error).toBeFalsy();

    const getResult = await dispatch({ action: 'get', id }) as Record<string, unknown>;
    const item = getResult.item as Record<string, unknown>;
    expect(item.contentType).toBe('workflow');

    const diskEntry = JSON.parse(fs.readFileSync(path.join(TMP_DIR, `${id}.json`), 'utf8'));
    expect(diskEntry.contentType).toBe('workflow');
    expect(diskEntry.schemaVersion).toBe('5');
  });

  it('overwrites contentType when updating an existing entry', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const id = 'test-overwrite-content-type';

    // First add as instruction
    await dispatch({
      action: 'add',
      entry: { id, title: 'Overwrite Test', body: 'Initial body.', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true,
      overwrite: true,
    });

    // Overwrite with contentType: "reference"
    const updateResult = await dispatch({
      action: 'add',
      entry: { id, title: 'Overwrite Test', body: 'Updated body for version bump.', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'], contentType: 'reference' },
      lax: true,
      overwrite: true,
    }) as Record<string, unknown>;

    expect(updateResult.error).toBeFalsy();

    const getResult = await dispatch({ action: 'get', id }) as Record<string, unknown>;
    const item = getResult.item as Record<string, unknown>;
    expect(item.contentType).toBe('reference');
  });

  it('defaults contentType to "instruction" when not provided', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const id = 'test-default-content-type';

    await dispatch({
      action: 'add',
      entry: { id, title: 'Default ContentType', body: 'No contentType provided.', priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true,
      overwrite: true,
    });

    const getResult = await dispatch({ action: 'get', id }) as Record<string, unknown>;
    const item = getResult.item as Record<string, unknown>;
    expect(item.contentType).toBe('instruction');
  });
});
