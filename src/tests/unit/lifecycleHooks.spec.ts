/**
 * Tests for the optional lifecycle hooks feature (#447).
 *
 * Exercises the pure operation-derivation mapping and the real dispatch path
 * (spawning a Node process as the hook) covering create/update/remove/change,
 * failure isolation, the disabled-by-default no-op, and context delivery.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { reloadRuntimeConfig } from '../../config/runtimeConfig';
import {
  deriveLifecycleOperation,
  notifyLifecycleHooks,
  _getLifecycleHookInFlight,
  _resetLifecycleHookState,
} from '../../services/lifecycleHooks';
import { logAudit } from '../../services/auditLog';

const HOOK_ENV_KEYS = [
  'INDEX_SERVER_HOOK_ON_CREATE',
  'INDEX_SERVER_HOOK_ON_UPDATE',
  'INDEX_SERVER_HOOK_ON_REMOVE',
  'INDEX_SERVER_HOOK_ON_CHANGE',
  'INDEX_SERVER_HOOK_BLOCKING',
  'INDEX_SERVER_HOOK_TIMEOUT_MS',
  'INDEX_SERVER_HOOK_MAX_CONCURRENT',
  'INDEX_SERVER_AUDIT_LOG',
  'LCH_TEST_OUT',
  'LCH_TEST_DELAY_MS',
];

/** A Node hook command that records the delivered context JSON to LCH_TEST_OUT. */
const RECORD_HOOK = `node -e "require('fs').writeFileSync(process.env.LCH_TEST_OUT, process.env.INDEX_SERVER_HOOK_CONTEXT || '')"`;
const APPEND_HOOK = `node -e "require('fs').appendFileSync(process.env.LCH_TEST_OUT, process.argv[1] + '\\n')"`;
const DELAYED_HOOK = `node -e "setTimeout(() => require('fs').writeFileSync(process.env.LCH_TEST_OUT, 'done'), Number(process.env.LCH_TEST_DELAY_MS || 100))"`;

describe('lifecycleHooks.deriveLifecycleOperation', () => {
  it('maps add+created=true to create', () => {
    expect(deriveLifecycleOperation('add', { created: true })).toBe('create');
  });
  it('maps add+created=false to update', () => {
    expect(deriveLifecycleOperation('add', { created: false })).toBe('update');
  });
  it('does not fire for skipped/duplicate/failed add', () => {
    expect(deriveLifecycleOperation('add', { created: true, skipped: true })).toBeUndefined();
    expect(deriveLifecycleOperation('add', { created: false, duplicateAtWrite: true })).toBeUndefined();
    expect(deriveLifecycleOperation('add', { created: true, mutation_persist_failed: true })).toBeUndefined();
  });
  it('maps remove with removed>0 to remove; skips 0-removed', () => {
    expect(deriveLifecycleOperation('remove', { removed: 2 })).toBe('remove');
    expect(deriveLifecycleOperation('remove', { removed: 0 })).toBeUndefined();
  });
  it('maps import/promote to change (only when something imported)', () => {
    expect(deriveLifecycleOperation('import', { imported: 3 })).toBe('change');
    expect(deriveLifecycleOperation('import', { imported: 0, overwritten: 0 })).toBeUndefined();
    expect(deriveLifecycleOperation('promote_from_repo', {})).toBe('change');
  });
  it('returns undefined for non-CRUD / error / read actions', () => {
    expect(deriveLifecycleOperation('add_hydration_error', {})).toBeUndefined();
    expect(deriveLifecycleOperation('index_search', {})).toBeUndefined();
    expect(deriveLifecycleOperation('feedback_submit', {})).toBeUndefined();
  });
});

describe('lifecycleHooks dispatch', () => {
  let saved: Record<string, string | undefined>;
  let outFile: string;

  beforeEach(() => {
    saved = {};
    for (const k of HOOK_ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    outFile = path.join(os.tmpdir(), `lch-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    process.env.LCH_TEST_OUT = outFile;
    _resetLifecycleHookState();
  });

  afterEach(() => {
    for (const k of HOOK_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    try { fs.rmSync(outFile, { force: true }); } catch { /* ok */ }
    reloadRuntimeConfig();
  });

  it('is a no-op when no hooks are configured (disabled by default)', async () => {
    reloadRuntimeConfig();
    const r = notifyLifecycleHooks('add', ['x'], { created: true });
    // Disabled => synchronous void return, nothing spawned, no output file.
    expect(r).toBeUndefined();
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('runs onCreate and delivers structured context synchronously (blocking)', () => {
    process.env.INDEX_SERVER_HOOK_ON_CREATE = RECORD_HOOK;
    process.env.INDEX_SERVER_HOOK_BLOCKING = '1';
    reloadRuntimeConfig();

    const result = notifyLifecycleHooks('add', ['inst-1'], { created: true }, 'corr-123');

    expect(result).toBeUndefined();
    expect(fs.existsSync(outFile)).toBe(true);
    const ctx = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    expect(ctx.operation).toBe('create');
    expect(ctx.action).toBe('add');
    expect(ctx.ids).toEqual(['inst-1']);
    expect(ctx.correlationId).toBe('corr-123');
    expect(ctx.meta.created).toBe(true);
  });

  it('blocking mode completes before the real logAudit dispatch point returns', () => {
    process.env.INDEX_SERVER_HOOK_ON_CREATE = RECORD_HOOK;
    process.env.INDEX_SERVER_HOOK_BLOCKING = '1';
    reloadRuntimeConfig();

    logAudit('add', ['inst-audit'], { created: true }, 'mutation');

    expect(fs.existsSync(outFile)).toBe(true);
    const ctx = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    expect(ctx.operation).toBe('create');
    expect(ctx.ids).toEqual(['inst-audit']);
  });

  it('runs operation-specific then onChange commands in blocking mode', () => {
    process.env.INDEX_SERVER_HOOK_ON_CREATE = `${APPEND_HOOK} specific`;
    process.env.INDEX_SERVER_HOOK_ON_CHANGE = `${APPEND_HOOK} change`;
    process.env.INDEX_SERVER_HOOK_BLOCKING = '1';
    reloadRuntimeConfig();

    notifyLifecycleHooks('add', ['inst-ordered'], { created: true });

    expect(fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/)).toEqual(['specific', 'change']);
  });

  it('deduplicates identical operation-specific and onChange commands', () => {
    const command = `${APPEND_HOOK} once`;
    process.env.INDEX_SERVER_HOOK_ON_CREATE = command;
    process.env.INDEX_SERVER_HOOK_ON_CHANGE = command;
    process.env.INDEX_SERVER_HOOK_BLOCKING = '1';
    reloadRuntimeConfig();

    notifyLifecycleHooks('add', ['inst-dedupe'], { created: true });

    expect(fs.readFileSync(outFile, 'utf8').trim().split(/\r?\n/)).toEqual(['once']);
  });

  it('treats whitespace-only hook commands as unconfigured', () => {
    process.env.INDEX_SERVER_HOOK_ON_CREATE = '   ';
    reloadRuntimeConfig();

    expect(notifyLifecycleHooks('add', ['inst-empty'], { created: true })).toBeUndefined();
    expect(fs.existsSync(outFile)).toBe(false);
  });

  it('drops excess non-blocking hooks at the concurrency limit and resets after completion', async () => {
    process.env.INDEX_SERVER_HOOK_ON_CREATE = DELAYED_HOOK;
    process.env.INDEX_SERVER_HOOK_MAX_CONCURRENT = '1';
    process.env.LCH_TEST_DELAY_MS = '150';
    reloadRuntimeConfig();

    notifyLifecycleHooks('add', ['inst-first'], { created: true });
    expect(_getLifecycleHookInFlight()).toBe(1);
    notifyLifecycleHooks('add', ['inst-dropped'], { created: true });
    expect(_getLifecycleHookInFlight()).toBe(1);

    const deadline = Date.now() + 5000;
    while (_getLifecycleHookInFlight() !== 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(_getLifecycleHookInFlight()).toBe(0);
    expect(fs.readFileSync(outFile, 'utf8')).toBe('done');
  });

  it('runs onChange for an import (blocking)', () => {
    process.env.INDEX_SERVER_HOOK_ON_CHANGE = RECORD_HOOK;
    process.env.INDEX_SERVER_HOOK_BLOCKING = '1';
    reloadRuntimeConfig();

    notifyLifecycleHooks('import', ['a', 'b'], { imported: 2 });

    expect(fs.existsSync(outFile)).toBe(true);
    const ctx = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    expect(ctx.operation).toBe('change');
    expect(ctx.ids).toEqual(['a', 'b']);
  });

  it('isolates hook failures — a non-zero exit does not throw', () => {
    process.env.INDEX_SERVER_HOOK_ON_REMOVE = 'node -e "process.exit(3)"';
    process.env.INDEX_SERVER_HOOK_BLOCKING = '1';
    reloadRuntimeConfig();

    expect(() => notifyLifecycleHooks('remove', ['gone'], { removed: 1 })).not.toThrow();
  });

  it('does not fire for a non-CRUD mutation action', async () => {
    process.env.INDEX_SERVER_HOOK_ON_CHANGE = RECORD_HOOK;
    process.env.INDEX_SERVER_HOOK_BLOCKING = '1';
    reloadRuntimeConfig();

    const r = notifyLifecycleHooks('reload', undefined, { count: 5 });
    expect(r).toBeUndefined();
    expect(fs.existsSync(outFile)).toBe(false);
  });
});
