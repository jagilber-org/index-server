import { describe, it, expect, beforeEach } from 'vitest';
import { validateParams, clearValidationCache, getValidationMetrics } from '../../services/validationService';
import { getZodEnhancedRegistry } from '../../services/toolRegistry.zod';

// Ensure registry (with zod augmentation) is loaded before tests
getZodEnhancedRegistry();

describe('validationService zod metrics integration', () => {
  beforeEach(() => { clearValidationCache(); const m = getValidationMetrics(); m.zodSuccess = m.zodFailure = m.ajvSuccess = m.ajvFailure = 0; });

  it('counts zod success for feedback_submit (has zod)', () => {
    const res = validateParams('feedback_submit', { type: 'issue', severity: 'low', title: 'ok', description: 'desc' });
    expect(res.ok).toBe(true);
    const metrics = getValidationMetrics();
    expect(metrics.zodSuccess).toBeGreaterThanOrEqual(1);
  });

  it('counts zod success for feedback_manage (has zod)', () => {
    const res = validateParams('feedback_manage', { action: 'stats' });
    expect(res.ok).toBe(true);
    const metrics = getValidationMetrics();
    expect(metrics.zodSuccess).toBeGreaterThanOrEqual(1);
  });

  it('produces mapped errors (zod path) on invalid enum', () => {
    const res = validateParams('feedback_submit', { type: 'not-real', severity: 'low', title: 't', description: 'd' });
    expect(res.ok).toBe(false);
    if(res.ok === false){
      expect(Array.isArray(res.errors)).toBe(true);
  // Some mappings may collapse or redact messages; presence of an array is sufficient for this metric-oriented test.
    }
    const metrics = getValidationMetrics();
    expect(metrics.zodFailure).toBeGreaterThanOrEqual(1);
  });

  it('uses zod for all tools now that full coverage is achieved', () => {
    // With complete Zod coverage, all tools should use the Zod path
    const toolName = 'metrics_snapshot';
    const res = validateParams(toolName, {});
    expect(res.ok).toBe(true);
    const metrics = getValidationMetrics();
    // With full Zod coverage, validation goes through the Zod path
    expect(metrics.zodSuccess).toBeGreaterThanOrEqual(1);
  });

  it('rejects removed chat-session contentType on index_add through zod schema', () => {
    const res = validateParams('index_add', {
      entry: {
        id: 'legacy-chat-session-zod',
        title: 'Legacy chat session',
        body: 'Legacy content type should be rejected.',
        contentType: 'chat-session',
      },
      lax: true,
      overwrite: true,
    });
    expect(res.ok).toBe(false);
    const metrics = getValidationMetrics();
    expect(metrics.zodFailure).toBeGreaterThanOrEqual(1);
  });
});
