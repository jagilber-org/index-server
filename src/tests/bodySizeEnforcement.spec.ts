/**
 * TDD Red Tests: Body size enforcement for index_add, index_import, and index_dispatch.
 * Constitution: Q-7 (schema-contract), Q-8 (agent-perspective via dispatch), A-6 (body size governance).
 *
 * These tests verify:
 * 1. Oversized body rejected at write-time with structured error + actionable guidance
 * 2. Exact boundary enforcement (bodyWarnLength + 1 rejected, bodyWarnLength accepted)
 * 3. Agent-perspective: dispatch action='add' also enforces limits
 * 4. Import: per-entry rejection (not silent truncation) for oversized bodies
 * 5. Success responses include bodyLength for client integrity verification
 * 6. Read (get) always returns full body — no truncation on read path
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../server/registry';
import { getRuntimeConfig, reloadRuntimeConfig } from '../config/runtimeConfig';

const TMP_DIR = path.join(process.cwd(), 'tmp', 'body-size-enforcement');

describe('body size enforcement', () => {
  let add: any;
  let dispatch: (action: string, params: Record<string, any>) => any;
  let importHandler: any;
  let bodyWarnLength: number;

  beforeAll(async () => {
    process.env.INDEX_SERVER_MUTATION = '1';
    process.env.INDEX_SERVER_DIR = TMP_DIR;
    reloadRuntimeConfig();
    bodyWarnLength = getRuntimeConfig().index.bodyWarnLength;
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    // Side-effect imports to register handlers
    // @ts-expect-error side effect
    await import('../services/handlers.instructions');
    // @ts-expect-error side effect
    await import('../services/instructions.dispatcher');
    add = getHandler('index_add');
    dispatch = (action, params) => (getHandler('index_dispatch') as any)({ action, ...params });
    importHandler = getHandler('index_import');
  });

  // --- index_add: rejection ---

  it('rejects body exceeding bodyWarnLength with body_too_large error', async () => {
    const oversizedBody = 'x'.repeat(bodyWarnLength + 1);
    const resp = await add({
      entry: { id: 'size-reject-1', title: 'Oversized', body: oversizedBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    expect(resp.created).toBe(false);
    expect(resp.error).toBe('body_too_large');
  });

  it('includes bodyLength and maxLength in rejection response', async () => {
    const oversizedBody = 'y'.repeat(bodyWarnLength + 500);
    const resp = await add({
      entry: { id: 'size-reject-2', title: 'Oversized', body: oversizedBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    expect(resp.error).toBe('body_too_large');
    expect(resp.bodyLength).toBe(bodyWarnLength + 500);
    expect(resp.maxLength).toBe(bodyWarnLength);
  });

  it('includes actionable guidance in rejection response', async () => {
    const oversizedBody = 'z'.repeat(bodyWarnLength + 100);
    const resp = await add({
      entry: { id: 'size-reject-3', title: 'Oversized', body: oversizedBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    expect(resp.error).toBe('body_too_large');
    expect(resp.guidance).toBeDefined();
    expect(typeof resp.guidance).toBe('string');
    // Guidance should mention splitting and cross-linking
    expect(resp.guidance).toMatch(/split/i);
    expect(resp.guidance).toMatch(/cross-link|cross-reference/i);
  });

  it('rejects body at exactly bodyWarnLength + 1', async () => {
    const justOverBody = 'a'.repeat(bodyWarnLength + 1);
    const resp = await add({
      entry: { id: 'size-boundary-over', title: 'Boundary', body: justOverBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    expect(resp.error).toBe('body_too_large');
    expect(resp.created).toBe(false);
  });

  // --- index_add: acceptance ---

  it('accepts body at exactly bodyWarnLength', async () => {
    const exactBody = 'b'.repeat(bodyWarnLength);
    const resp = await add({
      entry: { id: 'size-boundary-exact', title: 'Exact Limit', body: exactBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    expect(resp.error).toBeUndefined();
    expect(resp.created).toBe(true);
  });

  it('accepts body under bodyWarnLength', async () => {
    const smallBody = 'c'.repeat(1000);
    const resp = await add({
      entry: { id: 'size-under-limit', title: 'Small', body: smallBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    expect(resp.error).toBeUndefined();
    expect(resp.created).toBe(true);
  });

  // --- index_add: bodyLength in success response ---

  it('returns bodyLength in success response', async () => {
    const body = 'content for length check';
    const resp = await add({
      entry: { id: 'size-length-field', title: 'Length Field', body, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    expect(resp.created).toBe(true);
    expect(resp.bodyLength).toBe(body.length);
  });

  // --- index_dispatch action='add': agent-perspective (Q-8) ---

  it('rejects oversized body via dispatch add action', async () => {
    const oversizedBody = 'q'.repeat(bodyWarnLength + 200);
    const resp = await dispatch('add', {
      entry: { id: 'size-dispatch-reject', title: 'Dispatch Oversized', body: oversizedBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    expect(resp.error).toBe('body_too_large');
    expect(resp.created).toBe(false);
    expect(resp.guidance).toBeDefined();
  });

  it('accepts normal body via dispatch add action with bodyLength', async () => {
    const body = 'dispatch normal body';
    const resp = await dispatch('add', {
      entry: { id: 'size-dispatch-ok', title: 'Dispatch OK', body, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    expect(resp.error).toBeUndefined();
    expect(resp.created).toBe(true);
    expect(resp.bodyLength).toBe(body.length);
  });

  // --- index_import: per-entry rejection ---

  it('rejects oversized entries in import without silent truncation', async () => {
    const oversizedBody = 'w'.repeat(bodyWarnLength + 300);
    const normalBody = 'normal sized body for import';
    const resp = await importHandler({
      entries: [
        { id: 'import-oversize', title: 'Too Big', body: oversizedBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
        { id: 'import-normal', title: 'Normal', body: normalBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] }
      ],
      mode: 'overwrite'
    });
    // Normal entry should be imported, oversized should be in errors
    expect(resp.imported + resp.overwritten).toBeGreaterThanOrEqual(1);
    expect(resp.errors).toBeDefined();
    expect(resp.errors.length).toBeGreaterThanOrEqual(1);
    const sizeError = resp.errors.find((e: any) => e.id === 'import-oversize');
    expect(sizeError).toBeDefined();
    expect(sizeError.error).toMatch(/body_too_large/);
  });

  it('import does not silently truncate oversized bodies', async () => {
    const oversizedBody = 'v'.repeat(bodyWarnLength + 100);
    const resp = await importHandler({
      entries: [
        { id: 'import-no-truncate', title: 'No Truncate', body: oversizedBody, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] }
      ],
      mode: 'overwrite'
    });
    // Should NOT be imported (should be rejected)
    expect(resp.imported).toBe(0);
    expect(resp.overwritten).toBe(0);
    expect(resp.errors.length).toBe(1);
    // Verify file was NOT written to disk
    const file = path.join(TMP_DIR, 'import-no-truncate.json');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('accepts stringified JSON arrays in entries', async () => {
    const entry = {
      id: 'import-inline-json',
      title: 'Inline JSON Import',
      body: 'import via stringified JSON array',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test']
    };
    const resp = await importHandler({
      entries: JSON.stringify([entry]),
      mode: 'overwrite'
    });

    expect(resp.error).toBeUndefined();
    expect(resp.total).toBe(1);
    expect(resp.imported + resp.overwritten).toBe(1);
    expect(fs.existsSync(path.join(TMP_DIR, 'import-inline-json.json'))).toBe(true);
  });

  // --- Read path: no truncation ---

  it('get returns full body without truncation', async () => {
    // Write an entry near the limit
    const body = 'd'.repeat(bodyWarnLength - 100);
    await add({
      entry: { id: 'size-read-full', title: 'Read Full', body, priority: 50, audience: 'all', requirement: 'optional', categories: ['test'] },
      lax: true
    });
    const resp = await dispatch('get', { id: 'size-read-full' });
    expect(resp.item).toBeDefined();
    expect(resp.item.body.length).toBe(body.length);
    expect(resp.item.body).toBe(body);
  });
});
