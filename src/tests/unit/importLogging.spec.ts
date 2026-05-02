/**
 * Regression: import failures must be observable in the main log.
 *
 * Pre-fix symptom (RCA 2026-05-01, dev port 8687):
 *   index_import returned { error: ... } or pushed per-entry errors and
 *   called logAudit (separate audit channel), but emitted ZERO entries to
 *   mcp-server.log. Operators tailing the main log saw nothing.
 *
 * Implementation note (CI hygiene gate):
 *   logWarn() auto-attaches a V8 call-site stack to detail and the
 *   STACK_TRACE_IN_WARN crawler check (max-stack-warn=5) treats that as
 *   a budget violation. The import handler therefore uses log('WARN', msg,
 *   { detail }) directly via a small `warnStruct` helper. Tests mock the
 *   raw `log` export and inspect calls keyed on the first argument.
 *
 * Constitution alignment:
 *   - OB-5: error/fallback paths must log at WARN/ERROR.
 *   - TS-12: ≥5 scenarios.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

interface Handler { (params: Record<string, unknown>): Promise<Record<string, unknown>>; }

interface Spies {
  logInfo: ReturnType<typeof vi.fn>;
  logError: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
}

async function loadHandler(spies: Spies) {
  vi.resetModules();
  vi.doMock('../../services/logger.js', async () => {
    const actual = await vi.importActual<typeof import('../../services/logger')>('../../services/logger.js');
    return { ...actual, logInfo: spies.logInfo, logError: spies.logError, log: spies.log, logDebug: vi.fn() };
  });
  await import('../../services/handlers/instructions.import.js');
  const { getHandler } = await import('../../server/registry.js');
  return getHandler('index_import') as unknown as Handler;
}

function makeSpies(): Spies {
  return { logInfo: vi.fn(), logError: vi.fn(), log: vi.fn() };
}

function warnCalls(spies: Spies) {
  return spies.log.mock.calls.filter(c => c[0] === 'WARN');
}

beforeEach(() => {
  vi.resetModules();
});

describe('[import] structured logging on success and failure', () => {
  it('1) emits logInfo "[import] start" with mode/sourceType breadcrumb', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-log-'));
    process.env.INDEX_SERVER_DIR = tmpDir;
    const spies = makeSpies();
    const handler = await loadHandler(spies);
    await handler({ entries: [{ id: 'log-test-1', title: 'T', body: 'B', priority: 4, audience: 'all', requirement: 'optional', priorityTier: 'P4', status: 'draft', contentType: 'instruction' }], mode: 'skip' });
    const startCalls = spies.logInfo.mock.calls.filter(c => typeof c[0] === 'string' && (c[0] as string).includes('[import] start'));
    expect(startCalls.length).toBeGreaterThanOrEqual(1);
    expect(startCalls[0][1]).toMatchObject({ mode: 'skip', sourceType: 'inline-array', inlineCount: 1 });
    delete process.env.INDEX_SERVER_DIR;
  });

  it('2) emits WARN "[import] rejected" with reason=no-entries when entries array is empty', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-log-'));
    process.env.INDEX_SERVER_DIR = tmpDir;
    const spies = makeSpies();
    const handler = await loadHandler(spies);
    const resp = await handler({ entries: [], mode: 'skip' });
    expect(resp).toMatchObject({ error: 'no entries' });
    const rejected = warnCalls(spies).filter(c => typeof c[1] === 'string' && (c[1] as string).includes('[import] rejected'));
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    const details = rejected.map(c => (c[2] as { detail?: string })?.detail || '');
    expect(details.some(d => d.includes('no-entries'))).toBe(true);
    delete process.env.INDEX_SERVER_DIR;
  });

  it('3) emits WARN "[import] entry rejected" for each invalid entry', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-log-'));
    process.env.INDEX_SERVER_DIR = tmpDir;
    const spies = makeSpies();
    const handler = await loadHandler(spies);
    const resp = await handler({ entries: [{ id: 'broken-entry-1' }, { id: 'broken-entry-2' }], mode: 'skip' });
    expect((resp as { errors?: unknown[] }).errors?.length).toBeGreaterThanOrEqual(2);
    const entryRejected = warnCalls(spies).filter(c => typeof c[1] === 'string' && (c[1] as string).includes('[import] entry rejected'));
    expect(entryRejected.length).toBeGreaterThanOrEqual(2);
    const details = entryRejected.map(c => (c[2] as { detail?: string })?.detail || '');
    expect(details.some(d => d.includes('broken-entry-1'))).toBe(true);
    expect(details.some(d => d.includes('broken-entry-2'))).toBe(true);
  });

  it('4) emits WARN "[import] complete with errors" final summary when any entry fails', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-log-'));
    process.env.INDEX_SERVER_DIR = tmpDir;
    const spies = makeSpies();
    const handler = await loadHandler(spies);
    await handler({ entries: [
      { id: 'good-summary', title: 'T', body: 'B', priority: 4, audience: 'all', requirement: 'optional', priorityTier: 'P4', status: 'draft', contentType: 'instruction' },
      { id: 'bad-summary' },
    ], mode: 'skip' });
    const summary = warnCalls(spies).filter(c => typeof c[1] === 'string' && (c[1] as string).includes('[import] complete with errors'));
    expect(summary.length).toBe(1);
    const detail = (summary[0][2] as { detail?: string })?.detail || '';
    expect(detail).toContain('"errorCount":1');
    expect(detail).toContain('bad-summary');
  });

  it('5) emits logInfo "[import] complete" (no warn) when all entries succeed', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-log-'));
    process.env.INDEX_SERVER_DIR = tmpDir;
    const spies = makeSpies();
    const handler = await loadHandler(spies);
    await handler({ entries: [
      { id: 'ok-clean-1', title: 'T', body: 'B', priority: 4, audience: 'all', requirement: 'optional', priorityTier: 'P4', status: 'draft', contentType: 'instruction' },
      { id: 'ok-clean-2', title: 'T', body: 'B', priority: 4, audience: 'all', requirement: 'optional', priorityTier: 'P4', status: 'draft', contentType: 'instruction' },
    ], mode: 'skip' });
    const completeOk = spies.logInfo.mock.calls.filter(c => typeof c[0] === 'string' && (c[0] as string).includes('[import] complete') && !(c[0] as string).includes('errors'));
    expect(completeOk.length).toBe(1);
    const completeErr = warnCalls(spies).filter(c => typeof c[1] === 'string' && (c[1] as string).includes('[import] complete with errors'));
    expect(completeErr.length).toBe(0);
  });
});
