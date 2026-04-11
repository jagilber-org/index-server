/**
 * Multi-Instance Config Wiring Tests
 *
 * Verifies that INDEX_SERVER_MODE and related env vars are correctly parsed
 * into runtimeConfig, and that the thin-client entry point compiles.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { reloadRuntimeConfig, getRuntimeConfig } from '../../config/runtimeConfig';

describe('Multi-Instance Config Wiring', () => {
  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(vars: Record<string, string>) {
    for (const [k, v] of Object.entries(vars)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    reloadRuntimeConfig();
  });

  it('should default instanceMode to standalone', () => {
    delete process.env.INDEX_SERVER_MODE;
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.server.instanceMode).toBe('standalone');
  });

  it('should parse INDEX_SERVER_MODE=leader', () => {
    setEnv({ INDEX_SERVER_MODE: 'leader' });
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.server.instanceMode).toBe('leader');
  });

  it('should parse INDEX_SERVER_MODE=follower', () => {
    setEnv({ INDEX_SERVER_MODE: 'follower' });
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.server.instanceMode).toBe('follower');
  });

  it('should parse INDEX_SERVER_MODE=auto', () => {
    setEnv({ INDEX_SERVER_MODE: 'auto' });
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.server.instanceMode).toBe('auto');
  });

  it('should fallback to standalone for invalid INDEX_SERVER_MODE', () => {
    setEnv({ INDEX_SERVER_MODE: 'invalid_value' });
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.server.instanceMode).toBe('standalone');
  });

  it('should parse INDEX_SERVER_LEADER_PORT', () => {
    setEnv({ INDEX_SERVER_LEADER_PORT: '8888' });
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.server.leaderPort).toBe(8888);
  });

  it('should default INDEX_SERVER_LEADER_PORT to 9090', () => {
    delete process.env.INDEX_SERVER_LEADER_PORT;
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.server.leaderPort).toBe(9090);
  });

  it('should parse heartbeat and stale threshold', () => {
    setEnv({ INDEX_SERVER_HEARTBEAT_MS: '3000', INDEX_SERVER_STALE_THRESHOLD_MS: '10000' });
    reloadRuntimeConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.server.heartbeatIntervalMs).toBe(3000);
    expect(cfg.server.staleThresholdMs).toBe(10000);
  });

  it('thin-client.ts should compile to dist', () => {
    const distPath = path.resolve(process.cwd(), 'dist', 'server', 'thin-client.js');
    expect(fs.existsSync(distPath)).toBe(true);
  });

  it('LeaderElection should be importable from dist', () => {
    const distPath = path.resolve(process.cwd(), 'dist', 'dashboard', 'server', 'LeaderElection.js');
    expect(fs.existsSync(distPath)).toBe(true);
  });

  it('HttpTransport should be importable from dist', () => {
    const distPath = path.resolve(process.cwd(), 'dist', 'dashboard', 'server', 'HttpTransport.js');
    expect(fs.existsSync(distPath)).toBe(true);
  });
});
