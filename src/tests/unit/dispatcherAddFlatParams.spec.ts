/**
 * RED/GREEN: Dispatcher schema completeness & flat-param support.
 * Reproduces feedback #0d4d73a6fec1674b — agents cannot pass nested 'entry' objects
 * through the MCP tool schema; they send flat params like { action: 'add', id: '...', body: '...' }.
 *
 * Also covers similar gaps for import, governanceUpdate, groom, and remove actions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../server/registry';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'dispatcher-flat-params');

describe('dispatcher: flat params & schema completeness (feedback #0d4d73a6)', () => {
  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    // @ts-expect-error dynamic side-effect import
    await import('../../services/handlers.instructions');
    // @ts-expect-error dynamic side-effect import
    await import('../../services/instructions.dispatcher');
    forceBootstrapConfirmForTests('dispatcher-flat-params-test');
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  // ── add: flat params ──────────────────────────────────────────────────────

  it('add: accepts flat params (id, body, title as top-level) without entry wrapper', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'add',
      id: 'flat-add-test-001',
      body: 'Test body for flat add',
      title: 'Flat Add Test',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      lax: true,
    }) as Record<string, unknown>;

    expect(result.created).toBe(true);
    expect(result.id).toBe('flat-add-test-001');
    expect(result.error).toBeUndefined();
  });

  it('add: accepts flat params with overwrite flag', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'add',
      id: 'flat-add-test-001',
      body: 'Updated body via flat add',
      title: 'Flat Add Test Updated',
      overwrite: true,
      lax: true,
    }) as Record<string, unknown>;

    expect(result.overwritten).toBe(true);
    expect(result.id).toBe('flat-add-test-001');
  });

  it('add: still works with nested entry param (backward compat)', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'add',
      entry: {
        id: 'nested-entry-test-002',
        body: 'Nested entry body',
        title: 'Nested Entry Test',
      },
      lax: true,
    }) as Record<string, unknown>;

    expect(result.created).toBe(true);
    expect(result.id).toBe('nested-entry-test-002');
  });

  // ── import: flat entries param ────────────────────────────────────────────

  it('import: accepts entries and mode through dispatch', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'import',
      entries: [{
        id: 'import-flat-001',
        title: 'Imported via dispatch',
        body: 'Import body',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
      }],
      mode: 'skip',
    }) as Record<string, unknown>;

    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([]);
  });

  // ── governanceUpdate: flat governance fields ──────────────────────────────

  it('governanceUpdate: accepts owner, status, bump through dispatch', async () => {
    const dispatch = getHandler('index_dispatch')!;
    // Use entry created by backward compat test above
    const result = await dispatch({
      action: 'governanceUpdate',
      id: 'nested-entry-test-002',
      owner: 'test-team',
      status: 'approved',
      bump: 'patch',
    }) as Record<string, unknown>;

    expect(result.id).toBe('nested-entry-test-002');
    expect(result.changed).toBe(true);
  });

  // ── groom: mode param ────────────────────────────────────────────────────

  it('groom: accepts mode with dryRun through dispatch', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'groom',
      mode: { dryRun: true },
    }) as Record<string, unknown>;

    // dryRun should not remove anything
    expect(result).toBeDefined();
  });

  // ── remove: missingOk param ──────────────────────────────────────────────

  it('remove: accepts missingOk through dispatch', async () => {
    const dispatch = getHandler('index_dispatch')!;
    const result = await dispatch({
      action: 'remove',
      id: 'nonexistent-instruction-xyz',
      missingOk: true,
    }) as Record<string, unknown>;

    // Should not throw when missingOk is true
    expect(result).toBeDefined();
  });

  // ── Schema contract: dispatch schema exposes mutation params ──────────────

  it('schema: dispatch exposes entry, overwrite, lax for add action', async () => {
    const { getToolRegistry } = await import('../../services/toolRegistry.js');
    const tools = getToolRegistry();
    const dispatch = tools.find((t: { name: string }) => t.name === 'index_dispatch')!;
    expect(dispatch).toBeDefined();
    const props = (dispatch.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.entry).toBeDefined();
    expect(props.overwrite).toBeDefined();
    expect(props.lax).toBeDefined();
  });

  it('schema: dispatch exposes entries, mode for import action', async () => {
    const { getToolRegistry } = await import('../../services/toolRegistry.js');
    const tools = getToolRegistry();
    const dispatch = tools.find((t: { name: string }) => t.name === 'index_dispatch')!;
    const props = (dispatch.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.entries).toBeDefined();
    expect(props.mode).toBeDefined();
  });

  it('schema: dispatch exposes governance fields for governanceUpdate action', async () => {
    const { getToolRegistry } = await import('../../services/toolRegistry.js');
    const tools = getToolRegistry();
    const dispatch = tools.find((t: { name: string }) => t.name === 'index_dispatch')!;
    const props = (dispatch.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.owner).toBeDefined();
    expect(props.status).toBeDefined();
    expect(props.bump).toBeDefined();
  });

  it('schema: dispatch exposes missingOk for remove action', async () => {
    const { getToolRegistry } = await import('../../services/toolRegistry.js');
    const tools = getToolRegistry();
    const dispatch = tools.find((t: { name: string }) => t.name === 'index_dispatch')!;
    const props = (dispatch.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.missingOk).toBeDefined();
  });

  // ── Feedback dispatch: body→description alias ─────────────────────────────

  it('feedback: submit accepts "body" as alias for "description"', async () => {
    // Side-effect import to register feedback handlers
    // @ts-expect-error dynamic side-effect import
    await import('../../services/handlers.feedback');
    const FEEDBACK_TMP = path.join(process.cwd(), 'tmp', 'feedback-alias-test');
    const origDir = process.env.INDEX_SERVER_FEEDBACK_DIR;
    process.env.INDEX_SERVER_FEEDBACK_DIR = FEEDBACK_TMP;
    fs.mkdirSync(FEEDBACK_TMP, { recursive: true });
    try {
      const dispatch = getHandler('feedback_dispatch')!;
      expect(dispatch).toBeDefined();
      const result = await dispatch({
        action: 'submit',
        type: 'bug-report',
        severity: 'medium',
        title: 'Body alias test',
        body: 'Agent sends body instead of description',
      }) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.feedbackId).toBeDefined();
    } finally {
      if (origDir) process.env.INDEX_SERVER_FEEDBACK_DIR = origDir;
      else delete process.env.INDEX_SERVER_FEEDBACK_DIR;
      fs.rmSync(FEEDBACK_TMP, { recursive: true, force: true });
    }
  });

  it('feedback: submit still accepts "description" directly', async () => {
    const FEEDBACK_TMP = path.join(process.cwd(), 'tmp', 'feedback-desc-test');
    const origDir = process.env.INDEX_SERVER_FEEDBACK_DIR;
    process.env.INDEX_SERVER_FEEDBACK_DIR = FEEDBACK_TMP;
    fs.mkdirSync(FEEDBACK_TMP, { recursive: true });
    try {
      const dispatch = getHandler('feedback_dispatch')!;
      const result = await dispatch({
        action: 'submit',
        type: 'issue',
        severity: 'low',
        title: 'Description direct test',
        description: 'Agent sends description directly',
      }) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.feedbackId).toBeDefined();
    } finally {
      if (origDir) process.env.INDEX_SERVER_FEEDBACK_DIR = origDir;
      else delete process.env.INDEX_SERVER_FEEDBACK_DIR;
      fs.rmSync(FEEDBACK_TMP, { recursive: true, force: true });
    }
  });

  it('schema: feedback_dispatch exposes body alias', async () => {
    const { getToolRegistry } = await import('../../services/toolRegistry.js');
    const tools = getToolRegistry();
    const fbDispatch = tools.find((t: { name: string }) => t.name === 'feedback_dispatch')!;
    expect(fbDispatch).toBeDefined();
    const props = (fbDispatch.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.body).toBeDefined();
    expect(props.description).toBeDefined();
  });
});
