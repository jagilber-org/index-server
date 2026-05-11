/**
 * Bootstrap request/confirm cycle — unit-level tests.
 *
 * Tests the bootstrap gating functions directly (no MCP server spawn).
 * Covers: token issuance, confirmation, expiry, reference mode, and state transitions.
 *
 * Uses dynamic import with vi.resetModules() to get fresh module state per test,
 * since bootstrapGating.ts uses module-level singletons.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';

// We need a temp directory for each test to isolate file system state
let tempDir: string;

beforeEach(() => {
  const base = path.join(process.cwd(), 'tmp', 'test-runs');
  fs.mkdirSync(base, { recursive: true });
  tempDir = fs.mkdtempSync(path.join(base, 'bootstrap-flow-'));
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore cleanup failures */ }
});

/**
 * Dynamically import bootstrapGating with mocked dependencies so module-level
 * state is fresh per test.
 */
async function loadModule(overrides?: {
  referenceMode?: boolean;
  tokenTtlSec?: number;
  instructionsDir?: string;
  IndexList?: Array<{ id: string }>;
}) {
  const dir = overrides?.instructionsDir ?? tempDir;

  // Mock indexContext before importing bootstrapGating
  vi.doMock('../../services/indexContext', () => ({
    getInstructionsDir: () => dir,
    ensureLoaded: () => ({
      list: overrides?.IndexList ?? [],
      byId: new Map(),
    }),
  }));

  // Mock runtimeConfig
  vi.doMock('../../config/runtimeConfig', () => ({
    getRuntimeConfig: () => ({
      server: {
        bootstrap: {
          referenceMode: overrides?.referenceMode ?? false,
          tokenTtlSec: overrides?.tokenTtlSec ?? 300,
        },
      },
    }),
  }));

  const mod = await import('../../services/bootstrapGating.js');
  return mod;
}

describe('bootstrap flow — request/confirm cycle', () => {

  it('requestBootstrapToken returns a hex token', async () => {
    const mod = await loadModule();
    const result = mod.requestBootstrapToken('test rationale');
    expect(result).toHaveProperty('token');
    expect(typeof (result as any).token).toBe('string');
    expect((result as any).token).toMatch(/^[0-9a-f]{12}$/);
  });

  it('finalizeBootstrapToken confirms with correct token', async () => {
    const mod = await loadModule();
    const req = mod.requestBootstrapToken('test') as { token: string };
    const result = mod.finalizeBootstrapToken(req.token);
    expect(result).toHaveProperty('confirmed', true);
  });

  it('isBootstrapConfirmed is true after finalize', async () => {
    const mod = await loadModule();
    expect(mod.isBootstrapConfirmed()).toBe(false);
    const req = mod.requestBootstrapToken() as { token: string };
    mod.finalizeBootstrapToken(req.token);
    expect(mod.isBootstrapConfirmed()).toBe(true);
  });

  it('finalizeBootstrapToken rejects wrong token', async () => {
    const mod = await loadModule();
    mod.requestBootstrapToken();
    const result = mod.finalizeBootstrapToken('deadbeefcafe');
    expect(result).toHaveProperty('error', 'invalid_token');
  });

  it('finalizeBootstrapToken rejects when no pending token', async () => {
    const mod = await loadModule();
    const result = mod.finalizeBootstrapToken('anything');
    expect(result).toHaveProperty('error', 'no_pending_token');
  });

  it('second request reuses pending token (returns reissued)', async () => {
    const mod = await loadModule();
    const _first = mod.requestBootstrapToken('first');
    const second = mod.requestBootstrapToken('second');
    expect(second).toHaveProperty('pending', true);
    expect((second as any).token).toBe('(reissued)');
  });
});

describe('bootstrap flow — token expiry', () => {

  it('expired token is rejected', async () => {
    const mod = await loadModule({ tokenTtlSec: 0 });
    const req = mod.requestBootstrapToken() as { token: string };
    // With TTL of 0 (clamped to 1 second in impl), wait for expiry
    await new Promise(r => setTimeout(r, 1200));
    const result = mod.finalizeBootstrapToken(req.token);
    expect(result).toHaveProperty('error', 'token_expired');
  });
});

describe('bootstrap flow — reference mode', () => {

  it('requestBootstrapToken in reference mode returns referenceMode flag', async () => {
    const mod = await loadModule({ referenceMode: true });
    const result = mod.requestBootstrapToken();
    expect(result).toHaveProperty('referenceMode', true);
    expect(result).toHaveProperty('mutation', false);
  });

  it('finalizeBootstrapToken in reference mode returns referenceMode flag', async () => {
    const mod = await loadModule({ referenceMode: true });
    const result = mod.finalizeBootstrapToken('anything');
    expect(result).toHaveProperty('referenceMode', true);
  });

  it('mutationGatedReason returns reference_mode_read_only', async () => {
    const mod = await loadModule({ referenceMode: true });
    expect(mod.mutationGatedReason()).toBe('reference_mode_read_only');
  });
});

describe('bootstrap flow — gating state transitions', () => {

  it('shouldRequireConfirmation true when only bootstrap seeds present', async () => {
    const mod = await loadModule({
      IndexList: [
        { id: '000-bootstrapper' },
        { id: '001-lifecycle-bootstrap' },
        { id: '002-content-model' },
        { id: '003-content-types' },
      ],
    });
    expect(mod.shouldRequireConfirmation()).toBe(true);
    expect(mod.mutationGatedReason()).toBe('bootstrap_confirmation_required');
  });

  it('shouldRequireConfirmation false when non-bootstrap instructions present', async () => {
    const mod = await loadModule({
      IndexList: [
        { id: '000-bootstrapper' },
        { id: 'user-custom-instruction' },
      ],
    });
    expect(mod.shouldRequireConfirmation()).toBe(false);
    expect(mod.mutationGatedReason()).toBeNull();
  });

  it('shouldRequireConfirmation false after confirmation', async () => {
    const mod = await loadModule({
      IndexList: [
        { id: '000-bootstrapper' },
        { id: '001-lifecycle-bootstrap' },
        { id: '002-content-model' },
        { id: '003-content-types' },
      ],
    });
    expect(mod.shouldRequireConfirmation()).toBe(true);
    const req = mod.requestBootstrapToken() as { token: string };
    mod.finalizeBootstrapToken(req.token);
    expect(mod.shouldRequireConfirmation()).toBe(false);
  });

  it('getBootstrapStatus returns complete status object', async () => {
    const mod = await loadModule();
    const status = mod.getBootstrapStatus();
    expect(status).toHaveProperty('referenceMode', false);
    expect(status).toHaveProperty('confirmed');
    expect(status).toHaveProperty('requireConfirmation');
    expect(status).toHaveProperty('nonBootstrapInstructions');
    expect(typeof status.confirmed).toBe('boolean');
    expect(typeof status.requireConfirmation).toBe('boolean');
  });

  it('confirmation persists to filesystem', async () => {
    const mod = await loadModule();
    const req = mod.requestBootstrapToken() as { token: string };
    mod.finalizeBootstrapToken(req.token);
    // Check that bootstrap.confirmed.json was written
    const confirmFile = path.join(tempDir, 'bootstrap.confirmed.json');
    expect(fs.existsSync(confirmFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(confirmFile, 'utf8'));
    expect(content).toHaveProperty('confirmedAt');
    expect(content).toHaveProperty('tokenHint');
  });

  it('pending token metadata persisted to filesystem', async () => {
    const mod = await loadModule();
    mod.requestBootstrapToken('test persist');
    const pendingFile = path.join(tempDir, 'bootstrap.pending.json');
    expect(fs.existsSync(pendingFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    expect(content).toHaveProperty('issuedAt');
    expect(content).toHaveProperty('expiresAt');
  });
});

describe('bootstrap flow — already confirmed', () => {

  it('requestBootstrapToken returns alreadyConfirmed after finalize', async () => {
    const mod = await loadModule();
    const req = mod.requestBootstrapToken() as { token: string };
    mod.finalizeBootstrapToken(req.token);
    const result = mod.requestBootstrapToken();
    expect(result).toHaveProperty('alreadyConfirmed', true);
  });

  it('finalizeBootstrapToken returns alreadyConfirmed when already done', async () => {
    const mod = await loadModule();
    const req = mod.requestBootstrapToken() as { token: string };
    mod.finalizeBootstrapToken(req.token);
    const result = mod.finalizeBootstrapToken('anything');
    expect(result).toHaveProperty('alreadyConfirmed', true);
  });
});
