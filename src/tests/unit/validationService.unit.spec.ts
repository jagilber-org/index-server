import { describe, it, expect, beforeEach } from 'vitest';
import { validateParams, clearValidationCache } from '../../services/validationService';
import { getToolRegistry } from '../../services/toolRegistry';
import { getRuntimeConfig, reloadRuntimeConfig } from '../../config/runtimeConfig';

// Force registry initialization (side effects may register schemas)
getToolRegistry();

describe('validationService (unit)', () => {
  beforeEach(() => {
    process.env.INDEX_SERVER_VALIDATION_MODE = 'zod';
    reloadRuntimeConfig();
    clearValidationCache();
  });

  it('accepts valid feedback_submit params', () => {
    const ok = validateParams('feedback_submit', { type: 'issue', severity: 'low', title: 't', description: 'd' });
    expect(ok).toEqual({ ok: true });
  });

  it('accepts valid feedback_manage params', () => {
    const ok = validateParams('feedback_manage', { action: 'list', limit: 25, offset: 0 });
    expect(ok).toEqual({ ok: true });
  });

  it('rejects invalid enum in feedback_submit', () => {
    const res = validateParams('feedback_submit', { type: 'wrong', severity: 'low', title: 't', description: 'd' });
    expect(res.ok).toBe(false);
  // Ajv with strict:false may sometimes collapse enum mismatch into generic error list; just assert structure
  if(res.ok === false){ expect(Array.isArray(res.errors)).toBe(true); }
  });

  it('rejects invalid action in feedback_manage', () => {
    const res = validateParams('feedback_manage', { action: 'health' });
    expect(res.ok).toBe(false);
  });

  it('treats unknown tool as ok (no schema)', () => {
    const res = validateParams('nonexistent/tool', { any: 'value' });
    expect(res).toEqual({ ok: true });
  });

  it('rejects extra index_add entry properties', () => {
    const res = validateParams('index_add', {
      entry: {
        id: 'extra-prop',
        title: 'Extra prop',
        body: 'body',
        unexpected: true,
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(Array.isArray(res.errors)).toBe(true);
  });

  it('rejects invalid extensions values in index_add params', () => {
    const res = validateParams('index_add', {
      entry: {
        id: 'bad-extensions',
        title: 'Bad extensions',
        body: 'body',
        extensions: { vendor: { note: null } },
      },
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(Array.isArray(res.errors)).toBe(true);
  });

  it('rejects invalid governance enum in index_add entry', () => {
    const res = validateParams('index_add', {
      entry: {
        id: 'invalid-classification',
        title: 'Invalid classification',
        body: 'body',
        priority: 50,
        audience: 'all',
        requirement: 'optional',
        categories: ['test'],
        classification: 'secret',
      },
      overwrite: true,
      lax: true,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects index_add body above configured limit via zod validation', () => {
    const limit = getRuntimeConfig().index.bodyWarnLength;
    const res = validateParams('index_add', {
      entry: {
        id: 'oversized-body',
        title: 'Oversized body',
        body: 'x'.repeat(limit + 1),
      },
    });
    expect(res.ok).toBe(false);
  });

  it('rejects invalid add enum through index_dispatch flat params', () => {
    const res = validateParams('index_dispatch', {
      action: 'add',
      id: 'invalid-dispatch-classification',
      title: 'Invalid dispatch classification',
      body: 'body',
      priority: 50,
      audience: 'all',
      requirement: 'optional',
      categories: ['test'],
      classification: 'secret',
      overwrite: true,
      lax: true,
    });
    expect(res.ok).toBe(false);
  });
});
