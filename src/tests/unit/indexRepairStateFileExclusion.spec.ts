/**
 * Regression: index_repair must not surface bootstrap gating state files
 * (bootstrap.confirmed.json, bootstrap.pending.json) as schema-invalid
 * "skipped" instructions. These files are runtime bookkeeping owned by
 * bootstrapGating.ts; they co-reside with instruction JSON in the
 * instructions dir but are NOT instructions.
 *
 * Pre-fix symptom (RCA 2026-05-07): every clean install reported these
 * two files as "missing required fields (id or body)" in the index_repair
 * skipped-errors list, even though there was nothing wrong.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { reloadRuntimeConfig } from '../../config/runtimeConfig.js';
import { invalidate, ensureLoaded } from '../../services/indexContext.js';
import { getHandler } from '../../server/registry.js';
import { forceBootstrapConfirmForTests } from '../../services/bootstrapGating.js';

interface RepairResp {
  repaired: number;
  updated: string[];
  skippedRepaired: string[];
  errors: { id: string; error: string }[];
}

function call(name: string, params: unknown): unknown {
  const handler = getHandler(name);
  if (!handler) throw new Error(`Handler ${name} not registered`);
  return handler(params);
}

describe('index_repair excludes bootstrap gating state files', () => {
  const TMP = path.join(os.tmpdir(), `repair-state-${Date.now()}`);
  const INST_DIR = path.join(TMP, 'instructions');

  beforeAll(async () => {
    fs.mkdirSync(INST_DIR, { recursive: true });
    process.env.INDEX_SERVER_DIR = INST_DIR;
    process.env.INDEX_SERVER_MUTATION = '1';
    delete process.env.INDEX_SERVER_STORAGE_BACKEND;
    reloadRuntimeConfig();
    await import('../../services/handlers/instructions.groom.js');
    forceBootstrapConfirmForTests('repair-state-exclusion');
  });

  beforeEach(() => { invalidate(); });

  afterAll(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env.INDEX_SERVER_DIR;
    delete process.env.INDEX_SERVER_MUTATION;
  });

  it('does not report bootstrap.confirmed.json or bootstrap.pending.json as errors', async () => {
    fs.writeFileSync(path.join(INST_DIR, 'bootstrap.confirmed.json'),
      JSON.stringify({ confirmedAt: new Date().toISOString(), reason: 'test' }, null, 2));
    fs.writeFileSync(path.join(INST_DIR, 'bootstrap.pending.json'),
      JSON.stringify({ pendingSince: new Date().toISOString() }, null, 2));

    invalidate();
    ensureLoaded();
    const resp = await call('index_repair', {}) as RepairResp;

    const offending = (resp.errors || []).filter(e =>
      e.id === 'bootstrap.confirmed' || e.id === 'bootstrap.pending'
    );
    expect(offending).toEqual([]);
  });
});
