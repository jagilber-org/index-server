/**
 * Unit tests for checkModelReadiness() — Issue 3 fix.
 *
 * Validates that LOCAL_ONLY mode is checked against the model cache,
 * and appropriate remediation messages are provided.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const MOCK_LOGGING = { level: 'warn', verbose: false, json: false, sync: false, diagnostics: false, protocol: false, sentinelRequested: false };

describe('checkModelReadiness', () => {
  let checkModelReadiness: typeof import('../../services/embeddingService').checkModelReadiness;
  let tmpDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-readiness-'));

    vi.doMock('../../config/runtimeConfig', () => ({
      getRuntimeConfig: () => ({ logging: MOCK_LOGGING }),
    }));

    const mod = await import('../../services/embeddingService.js');
    checkModelReadiness = mod.checkModelReadiness;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns ready=true when localOnly is false (can download on demand)', () => {
    const result = checkModelReadiness('Xenova/all-MiniLM-L6-v2', tmpDir, false);
    expect(result.ready).toBe(true);
    expect(result.cached).toBe(false);
    // Informational message present when uncached (model will download on first use).
    expect(result.message).toBeDefined();
    expect(result.message).toContain('not yet cached');
  });

  it('returns ready=true with no message when model is cached and localOnly=false', () => {
    const modelDir = path.join(tmpDir, 'models--Xenova--all-MiniLM-L6-v2');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'config.json'), '{}');
    const result = checkModelReadiness('Xenova/all-MiniLM-L6-v2', tmpDir, false);
    expect(result.ready).toBe(true);
    expect(result.cached).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('returns ready=true when localOnly is true and model files exist in cache', () => {
    // Create the expected HuggingFace cache directory structure
    const modelDir = path.join(tmpDir, 'models--Xenova--all-MiniLM-L6-v2');
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(path.join(modelDir, 'config.json'), '{}');

    const result = checkModelReadiness('Xenova/all-MiniLM-L6-v2', tmpDir, true);
    expect(result.ready).toBe(true);
  });

  it('returns ready=false with remediation when localOnly is true and model not cached', () => {
    const result = checkModelReadiness('Xenova/all-MiniLM-L6-v2', tmpDir, true);
    expect(result.ready).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message).toContain('LOCAL_ONLY');
    expect(result.message).toContain('INDEX_SERVER_SEMANTIC_LOCAL_ONLY=0');
  });

  it('returns ready=false when model directory exists but is empty', () => {
    const modelDir = path.join(tmpDir, 'models--Xenova--all-MiniLM-L6-v2');
    fs.mkdirSync(modelDir, { recursive: true });

    const result = checkModelReadiness('Xenova/all-MiniLM-L6-v2', tmpDir, true);
    expect(result.ready).toBe(false);
    expect(result.message).toContain('not found in cache');
  });
});
