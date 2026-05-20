import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getHandler } from '../../server/registry';
import { invalidate } from '../../services/indexContext';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import '../../services/handlers.gates';

function makeTempDir(): string {
  const base = path.join(process.cwd(), 'tmp', 'test-runs');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, 'gates-evaluate-'));
}

describe('gates_evaluate', () => {
  const originalIndexDir = process.env.INDEX_SERVER_DIR;

  beforeEach(() => {
    process.env.INDEX_SERVER_DIR = makeTempDir();
    reloadRuntimeConfig();
    invalidate();
  });

  afterEach(() => {
    if (originalIndexDir === undefined) delete process.env.INDEX_SERVER_DIR;
    else process.env.INDEX_SERVER_DIR = originalIndexDir;
    reloadRuntimeConfig();
    invalidate();
  });

  it('returns notConfigured when no gates.json policy file is provisioned', async () => {
    const handler = getHandler('gates_evaluate') as (() => Promise<unknown>) | undefined;
    expect(handler).toBeDefined();
    await expect(handler!()).resolves.toEqual({ notConfigured: true });
  });
});
