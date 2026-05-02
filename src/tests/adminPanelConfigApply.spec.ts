/**
 * Tests for issue #282 fix #4 — Server Configuration form fields actually take
 * effect at runtime via process.env + reloadRuntimeConfig().
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AdminPanelConfig } from '../dashboard/server/AdminPanelConfig';
import { getRuntimeConfig, reloadRuntimeConfig } from '../config/runtimeConfig';

describe('AdminPanelConfig.updateAdminConfig (issue #282 fix #3/#4)', () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = [
    'INDEX_SERVER_VERBOSE_LOGGING',
    'INDEX_SERVER_MUTATION',
    'INDEX_SERVER_MAX_CONNECTIONS',
    'INDEX_SERVER_REQUEST_TIMEOUT',
    'INDEX_SERVER_RATE_LIMIT',
  ];

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    reloadRuntimeConfig();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
    reloadRuntimeConfig();
  });

  it('verbose + mutation toggles propagate to runtime config', () => {
    const ap = new AdminPanelConfig();
    const result = ap.updateAdminConfig({
      serverSettings: {
        maxConnections: 100,
        requestTimeout: 30000,
        enableVerboseLogging: true,
        enableMutation: true,
        rateLimit: { perMinute: 0 },
      },
    });
    expect(result.success).toBe(true);
    expect(result.appliedFields).toEqual(expect.arrayContaining(['verboseLogging', 'mutation']));
    expect(process.env.INDEX_SERVER_VERBOSE_LOGGING).toBe('1');
    expect(process.env.INDEX_SERVER_MUTATION).toBe('1');
    expect(getRuntimeConfig().mutation.enabled).toBe(true);
  });

  it('maxConnections and requestTimeout propagate to runtime', () => {
    const ap = new AdminPanelConfig();
    const result = ap.updateAdminConfig({
      serverSettings: {
        maxConnections: 250,
        requestTimeout: 45000,
        enableVerboseLogging: false,
        enableMutation: false,
        rateLimit: { perMinute: 60 },
      },
    });
    expect(result.success).toBe(true);
    expect(process.env.INDEX_SERVER_MAX_CONNECTIONS).toBe('250');
    expect(process.env.INDEX_SERVER_REQUEST_TIMEOUT).toBe('45000');
    expect(process.env.INDEX_SERVER_RATE_LIMIT).toBe('60');
    const cfg = getRuntimeConfig();
    expect(cfg.dashboard.http?.maxConnections).toBe(250);
    expect(cfg.dashboard.http?.requestTimeoutMs).toBe(45000);
    expect(cfg.dashboard.http?.rateLimitPerMinute).toBe(60);
  });

  it('getAdminConfig reflects current runtime values after update', () => {
    const ap = new AdminPanelConfig();
    ap.updateAdminConfig({
      serverSettings: {
        maxConnections: 77,
        requestTimeout: 12000,
        enableVerboseLogging: false,
        enableMutation: false,
        rateLimit: { perMinute: 0 },
      },
    });
    const view = ap.getAdminConfig();
    expect(view.serverSettings.maxConnections).toBe(77);
    expect(view.serverSettings.requestTimeout).toBe(12000);
  });
});
