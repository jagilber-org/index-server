/**
 * Issue #384 (observation 1) — health_check should expose active feature
 * flags via a top-level `features` map keyed by flag name (boolean state).
 *
 * Per the TDD plan:
 *   - With INDEX_SERVER_FEATURES=usage   -> result.features.usage === true
 *   - With FEATURES unset                -> result.features.usage === false
 *
 * RED test: currently FAILS because health_check returns no `features` key
 * (see src/services/handlers.metrics.ts health_check handler).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getIndexStateAsync = vi.fn(async () => ({ loadSummary: undefined }));
const getActiveInstances = vi.fn(() => []);
const getAuditLogHealth = vi.fn(() => ({ ok: true }));

vi.mock('../../services/indexContext', () => ({ getIndexStateAsync }));
vi.mock('../../dashboard/server/InstanceManager', () => ({ getActiveInstances }));
vi.mock('../../services/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/auditLog')>();
  return { ...actual, getAuditLogHealth };
});
vi.mock('../../services/validationService', () => ({ getValidationMetrics: () => ({}) }));

async function loadHandlerWithFeatures(envValue: string | undefined): Promise<(p: unknown) => Promise<unknown>> {
  if (envValue === undefined) delete process.env.INDEX_SERVER_FEATURES;
  else process.env.INDEX_SERVER_FEATURES = envValue;
  vi.resetModules();
  await import('../../services/handlers.metrics.js');
  const { getLocalHandler } = await import('../../server/registry.js');
  const handler = getLocalHandler('health_check');
  if (!handler) throw new Error('health_check handler not registered');
  return handler as (p: unknown) => Promise<unknown>;
}

describe('#384 obs1: health_check exposes features state', () => {
  const originalFeatures = process.env.INDEX_SERVER_FEATURES;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalFeatures === undefined) delete process.env.INDEX_SERVER_FEATURES;
    else process.env.INDEX_SERVER_FEATURES = originalFeatures;
  });

  it('returns features.usage === true when INDEX_SERVER_FEATURES=usage is set', async () => {
    const handler = await loadHandlerWithFeatures('usage');
    const result = await handler({}) as Record<string, unknown>;
    expect(result.features).toBeDefined();
    const features = result.features as Record<string, unknown>;
    expect(features.usage).toBe(true);
  });

  it('returns features.usage === false when INDEX_SERVER_FEATURES is unset', async () => {
    const handler = await loadHandlerWithFeatures(undefined);
    const result = await handler({}) as Record<string, unknown>;
    expect(result.features).toBeDefined();
    const features = result.features as Record<string, unknown>;
    expect(features.usage).toBe(false);
  });
});
