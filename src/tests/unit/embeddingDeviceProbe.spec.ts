/**
 * Unit tests for resolveDevice() — Issue 2 fix.
 *
 * Validates the ONNX Runtime device probe fallback chain:
 * cuda → dml → cpu, with proper warnings logged.
 *
 * Uses injectable OrtModule parameter for testability (avoids dynamicImport mocking).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const MOCK_LOGGING = { level: 'warn', verbose: false, json: false, sync: false, diagnostics: false, protocol: false, sentinelRequested: false };

describe('resolveDevice', () => {
  let resolveDevice: typeof import('../../services/embeddingService').resolveDevice;
  let warnCalls: string[];

  beforeEach(async () => {
    vi.resetModules();
    warnCalls = [];

    vi.doMock('../../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({ logging: MOCK_LOGGING }),
    }));
    vi.doMock('../../services/logger', () => ({
      logInfo: vi.fn(),
      logWarn: vi.fn((...args: unknown[]) => { warnCalls.push(String(args[0])); }),
      logDebug: vi.fn(),
      logError: vi.fn(),
    }));

    const mod = await import('../../services/embeddingService.js');
    resolveDevice = mod.resolveDevice;
  });

  it('returns "cpu" immediately without probing when cpu is requested', async () => {
    const result = await resolveDevice('cpu');
    expect(result).toBe('cpu');
    expect(warnCalls).toHaveLength(0);
  });

  it('returns requested device when ONNX Runtime reports it available', async () => {
    const mockOrt = {
      listSupportedBackends: () => [
        { name: 'cpu', bundled: true },
        { name: 'cuda', bundled: false },
      ],
    };
    const result = await resolveDevice('cuda', mockOrt);
    expect(result).toBe('cuda');
  });

  it('falls back from cuda to dml when CUDA unavailable but DML available', async () => {
    const mockOrt = {
      listSupportedBackends: () => [
        { name: 'cpu', bundled: true },
        { name: 'dml', bundled: true },
      ],
    };
    const result = await resolveDevice('cuda', mockOrt);
    expect(result).toBe('dml');
    expect(warnCalls.some(m => m.includes('CUDA') && m.includes('Falling back to DML'))).toBe(true);
  });

  it('falls back from cuda to cpu when neither CUDA nor DML available', async () => {
    const mockOrt = {
      listSupportedBackends: () => [
        { name: 'cpu', bundled: true },
      ],
    };
    const result = await resolveDevice('cuda', mockOrt);
    expect(result).toBe('cpu');
    expect(warnCalls.some(m => m.includes('Falling back to cpu'))).toBe(true);
  });

  it('falls back from dml to cpu when DML unavailable', async () => {
    const mockOrt = {
      listSupportedBackends: () => [
        { name: 'cpu', bundled: true },
      ],
    };
    const result = await resolveDevice('dml', mockOrt);
    expect(result).toBe('cpu');
    expect(warnCalls.some(m => m.includes('Falling back to cpu'))).toBe(true);
  });

  it('falls back to cpu when onnxruntime-node import fails (no ortModule provided)', async () => {
    // Without an injected ortModule, dynamicImport attempts real import which likely fails
    // in test environment → catch block → return 'cpu'
    const result = await resolveDevice('cuda');
    expect(result).toBe('cpu');
    expect(warnCalls.some(m => m.includes('Falling back to cpu'))).toBe(true);
  });

  it('falls back to cpu when listSupportedBackends is not a function', async () => {
    const mockOrt = {
      // listSupportedBackends intentionally missing
    };
    const result = await resolveDevice('cuda', mockOrt);
    expect(result).toBe('cpu');
    expect(warnCalls.some(m => m.includes('listSupportedBackends'))).toBe(true);
  });
});
