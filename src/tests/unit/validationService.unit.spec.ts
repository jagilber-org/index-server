import { describe, it, expect, beforeEach } from 'vitest';
import { validateParams, clearValidationCache } from '../../services/validationService';
import { getToolRegistry } from '../../services/toolRegistry';

// Force registry initialization (side effects may register schemas)
getToolRegistry();

describe('validationService (unit)', () => {
  beforeEach(() => { clearValidationCache(); });

  it('accepts valid feedback_submit params', () => {
    const ok = validateParams('feedback_submit', { type: 'issue', severity: 'low', title: 't', description: 'd' });
    expect(ok).toEqual({ ok: true });
  });

  it('rejects invalid enum in feedback_submit', () => {
    const res = validateParams('feedback_submit', { type: 'wrong', severity: 'low', title: 't', description: 'd' });
    expect(res.ok).toBe(false);
  // Ajv with strict:false may sometimes collapse enum mismatch into generic error list; just assert structure
  if(res.ok === false){ expect(Array.isArray(res.errors)).toBe(true); }
  });

  it('treats unknown tool as ok (no schema)', () => {
    const res = validateParams('nonexistent/tool', { any: 'value' });
    expect(res).toEqual({ ok: true });
  });
});
