/**
 * Regression: ensureLoaded() simple-reload spam when no .index-version file exists.
 *
 * Symptom (live, observed 2026-05-01 on dev port 8787 against
 *   C:\github-dev\jagilber-pr\Internal-…):
 *   The dashboard's polling loop hammered ensureLoaded() against an instructions
 *   directory that has no .index-version file. readVersionMTime() returns 0,
 *   which is falsy, which defeats the cache-hit short-circuit:
 *     if (currentVersionMTime && currentVersionMTime === state.versionMTime ...)
 *   So every poll did a full disk reload + emitted [trace:ensureLoaded:simple-reload].
 *   Logs filled with hundreds of identical traces per second, dashboard import
 *   button effectively dead because the event loop was saturated.
 *
 * Why PR #285 missed it:
 *   The new regression suites (autoMigrationLoopGuard, firstSeenExhaustedDedup)
 *   only assert on the migration latch and the firstSeen-exhausted dedup.
 *   None of them call ensureLoaded() twice on a fixture without a version file.
 *
 * Constitution alignment:
 *   - TS-9: failing test BEFORE fix (this file is red on main without the
 *     readVersionMTime() directory-mtime fallback).
 *   - OB-6: idempotent reads must not flood logs; fix is at source rather than
 *     allowlisting another simple-reload signature.
 *   - TS-12: ≥5 scenarios.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface IndexCtxModule {
  ensureLoaded: () => unknown;
  ensureLoadedAsync: () => Promise<unknown>;
  _resetIndexContextProcessLatches?: () => void;
  _resetIndexContextStateForTests?: () => void;
}

let tmpDir: string;
const ORIG_ENV = process.env.INDEX_SERVER_DIR;

function makeFixture(withVersionFile: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idxctx-novf-'));
  // Two minimal .json instructions so IndexLoader has work to dedup.
  for (const id of ['alpha', 'bravo']) {
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify({
        id,
        title: `Test ${id}`,
        body: 'body',
        priority: 4,
        priorityTier: 'P4',
        audience: 'all',
        requirement: 'optional',
        contentType: 'instruction',
        status: 'draft',
      }),
      'utf8',
    );
  }
  if (withVersionFile) fs.writeFileSync(path.join(dir, '.index-version'), 'v1', 'utf8');
  return dir;
}

beforeEach(() => {
  vi.resetModules();
  tmpDir = makeFixture(false);
  process.env.INDEX_SERVER_DIR = tmpDir;
});

afterEach(() => {
  if (ORIG_ENV === undefined) delete process.env.INDEX_SERVER_DIR;
  else process.env.INDEX_SERVER_DIR = ORIG_ENV;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('ensureLoaded: cache short-circuit for dirs without .index-version', () => {
  it('1) returns the SAME state object reference across two consecutive sync calls', async () => {
    const ctx = (await import('../../services/indexContext.js')) as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    ctx._resetIndexContextStateForTests?.();
    const a = ctx.ensureLoaded();
    const b = ctx.ensureLoaded();
    // The cached state is identity-stable when no source change has occurred.
    expect(b).toBe(a);
  });

  it('2) emits [trace:ensureLoaded:simple-reload] at most once across N idempotent calls', async () => {
    const traceSpy = vi.fn();
    vi.doMock('../../services/tracing.js', () => ({
      emitTrace: traceSpy,
      traceEnabled: () => true,
      bumpStdioWarnCount: vi.fn(),
      getStdioWarnCount: () => 0,
    }));
    const ctx = (await import('../../services/indexContext.js')) as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    ctx._resetIndexContextStateForTests?.();
    for (let i = 0; i < 25; i++) ctx.ensureLoaded();
    const reloads = traceSpy.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string) === '[trace:ensureLoaded:simple-reload]',
    );
    expect(reloads.length).toBeLessThanOrEqual(1);
  });

  it('3) async path also returns identity-stable cached state without a version file', async () => {
    const ctx = (await import('../../services/indexContext.js')) as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    ctx._resetIndexContextStateForTests?.();
    const a = await ctx.ensureLoadedAsync();
    const b = await ctx.ensureLoadedAsync();
    expect(b).toBe(a);
  });

  it('4) cache invalidates when an instruction file is added (directory mtime changes)', async () => {
    const ctx = (await import('../../services/indexContext.js')) as unknown as IndexCtxModule;
    ctx._resetIndexContextProcessLatches?.();
    ctx._resetIndexContextStateForTests?.();
    const a = ctx.ensureLoaded();
    // Mutate the directory; bump mtime explicitly to defeat <1s filesystem precision.
    const newFile = path.join(tmpDir, 'charlie.json');
    fs.writeFileSync(newFile, JSON.stringify({
      id: 'charlie', title: 't', body: 'b', priority: 4, priorityTier: 'P4',
      audience: 'all', requirement: 'optional', contentType: 'instruction', status: 'draft',
    }), 'utf8');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(tmpDir, future, future);
    const b = ctx.ensureLoaded();
    expect(b).not.toBe(a);
  });

  it('5) sanity: with a .index-version file present, two calls still return the same cached state', async () => {
    process.env.INDEX_SERVER_DIR = makeFixture(true);
    const dirWithVf = process.env.INDEX_SERVER_DIR;
    try {
      const ctx = (await import('../../services/indexContext.js')) as unknown as IndexCtxModule;
      ctx._resetIndexContextProcessLatches?.();
      ctx._resetIndexContextStateForTests?.();
      const a = ctx.ensureLoaded();
      const b = ctx.ensureLoaded();
      expect(b).toBe(a);
    } finally {
      try { fs.rmSync(dirWithVf, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
