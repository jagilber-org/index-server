/**
 * Coverage for `INDEX_SERVER_VALIDATION_MODE=ajv`.
 *
 * The flag is documented and supported (`docs/configuration.md`,
 * `docs/mcp_configuration.md`) and `parseValidationConfig` defaults it to
 * `'zod'`. Under `ajv` it forces EVERY tool down the Ajv-only arm of
 * `buildValidator`, changing the behaviour of all registered tools at once —
 * and until this spec there was no test that set it. The only two test
 * references anywhere in the repo set it to `'zod'`.
 *
 * That matters because the Ajv-only arm is where #601's defect lived: the arm
 * returned a bare arrow wrapper carrying neither `ajvFn` nor its own `.errors`,
 * so `validateParams` fell through to `[]` and callers got a contentless
 * `-32602`. A regression there is invisible to any test that asserts only on
 * the rejection, so these cases assert on error CONTENT.
 *
 * Constitution: TS-6 (a supported flag must be exercised).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ErrorObject } from 'ajv';

type ValidateResult = { ok: true } | { ok: false; errors: ErrorObject[] };

let validateParams: (method: string, params: unknown) => ValidateResult;
let clearValidationCache: () => void;
let reloadRuntimeConfig: () => unknown;

const PRIOR = process.env.INDEX_SERVER_VALIDATION_MODE;

/** Re-resolve the cached runtime config and drop compiled validators. */
function applyMode(mode: string | undefined) {
  if (mode === undefined) delete process.env.INDEX_SERVER_VALIDATION_MODE;
  else process.env.INDEX_SERVER_VALIDATION_MODE = mode;
  reloadRuntimeConfig();
  clearValidationCache();
}

describe('INDEX_SERVER_VALIDATION_MODE=ajv', () => {
  beforeAll(async () => {
    // @ts-expect-error dynamic side-effect import — registers the tool registry
    await import('../../services/toolHandlers');
    ({ validateParams, clearValidationCache } = await import('../../services/validationService.js'));
    ({ reloadRuntimeConfig } = await import('../../config/runtimeConfig.js'));
  });

  afterAll(() => { applyMode(PRIOR); });

  it('forces the Ajv arm even for a tool that has a Zod schema', () => {
    applyMode('ajv');
    const res = validateParams('index_search', { query: 'test', limit: 'fifty' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // The defect this guards: under `ajv` the Zod arm is bypassed for ALL
    // tools, so an empty array here means every tool reports a contentless
    // -32602 -- the worst-case blast radius of the #601 defect.
    expect(res.errors).not.toHaveLength(0);
    expect(JSON.stringify(res.errors)).toContain('limit');
  });

  it('names the field for a tool that has no Zod schema', () => {
    applyMode('ajv');
    const res = validateParams('messaging_read', { channel: 123 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors).not.toHaveLength(0);
    expect(JSON.stringify(res.errors)).toContain('channel');
  });

  it('reports a missing required property under ajv mode', () => {
    applyMode('ajv');
    const res = validateParams('messaging_ack', {});
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors).not.toHaveLength(0);
    expect(JSON.stringify(res.errors)).toMatch(/messageIds|reader/);
  });

  it('still accepts valid params under ajv mode', () => {
    applyMode('ajv');
    expect(validateParams('index_search', { query: 'test' }).ok).toBe(true);
    expect(validateParams('messaging_read', { channel: 'general' }).ok).toBe(true);
  });

  it('default mode is zod and still produces field-naming errors', () => {
    applyMode(undefined);
    const res = validateParams('index_search', { query: 'test', limit: 'fifty' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors).not.toHaveLength(0);
    expect(JSON.stringify(res.errors)).toContain('limit');
  });
});
