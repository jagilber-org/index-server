/**
 * RED: Tool tier flag gating — env vars and flags.json control tool visibility.
 * Currently sdkServer tools/list returns all tools unfiltered — these tests will fail.
 * Spec: 002-tool-consolidation.md Phase 1
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getToolRegistry } from '../../services/toolRegistry';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';

describe('RED: Tool tier flags (002-tool-consolidation Phase 1)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save env state
    savedEnv['INDEX_SERVER_FLAG_TOOLS_EXTENDED'] = process.env.INDEX_SERVER_FLAG_TOOLS_EXTENDED;
    savedEnv['INDEX_SERVER_FLAG_TOOLS_ADMIN'] = process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN;
  });

  afterEach(() => {
    // Restore env state
    if (savedEnv['INDEX_SERVER_FLAG_TOOLS_EXTENDED'] === undefined) delete process.env.INDEX_SERVER_FLAG_TOOLS_EXTENDED;
    else process.env.INDEX_SERVER_FLAG_TOOLS_EXTENDED = savedEnv['INDEX_SERVER_FLAG_TOOLS_EXTENDED'];
    if (savedEnv['INDEX_SERVER_FLAG_TOOLS_ADMIN'] === undefined) delete process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN;
    else process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN = savedEnv['INDEX_SERVER_FLAG_TOOLS_ADMIN'];
    reloadRuntimeConfig();
  });

  it('default (no flags) returns only core-tier tools', () => {
    delete process.env.INDEX_SERVER_FLAG_TOOLS_EXTENDED;
    delete process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN;
    reloadRuntimeConfig();

    const registry = getToolRegistry();
    const names = registry.map(t => t.name);
    // Should have exactly 6 core tools (feedback_dispatch removed in Phase 2b — feedback_submit is admin-tier only)
    expect(names.length).toBe(6);
    expect(names).toContain('health_check');
    expect(names).toContain('index_dispatch');
    expect(names).toContain('index_search');
    expect(names).toContain('prompt_review');
    expect(names).toContain('help_overview');
    expect(names).not.toContain('feedback_dispatch');
    expect(names).toContain('bootstrap');
  });

  it('INDEX_SERVER_FLAG_TOOLS_EXTENDED=1 includes extended-tier tools', () => {
    process.env.INDEX_SERVER_FLAG_TOOLS_EXTENDED = '1';
    delete process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN;
    reloadRuntimeConfig();

    const registry = getToolRegistry();
    const names = new Set(registry.map(t => t.name));
    // Core tools present
    expect(names.has('health_check')).toBe(true);
    // Extended tools present
    expect(names.has('graph_export')).toBe(true);
    expect(names.has('usage_track')).toBe(true);
    // Admin tools absent
    expect(names.has('diagnostics_block')).toBe(false);
    expect(names.has('bootstrap_request')).toBe(false);
  });

  it('INDEX_SERVER_FLAG_TOOLS_ADMIN=1 includes all tools', () => {
    process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN = '1';
    reloadRuntimeConfig();

    const registry = getToolRegistry();
    const names = new Set(registry.map(t => t.name));
    // Admin-only tools present
    expect(names.has('diagnostics_block')).toBe(true);
    expect(names.has('bootstrap_request')).toBe(true);
    expect(names.has('meta_tools')).toBe(true);
    // All tools present (should be 44)
    expect(registry.length).toBeGreaterThanOrEqual(40);
  });

  it('INDEX_SERVER_FLAG_TOOLS_EXTENDED=1 without admin still hides admin tools', () => {
    process.env.INDEX_SERVER_FLAG_TOOLS_EXTENDED = '1';
    delete process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN;
    reloadRuntimeConfig();

    const registry = getToolRegistry();
    const names = new Set(registry.map(t => t.name));
    expect(names.has('diagnostics_block')).toBe(false);
    expect(names.has('diagnostics_microtaskFlood')).toBe(false);
    expect(names.has('diagnostics_memoryPressure')).toBe(false);
  });
});
