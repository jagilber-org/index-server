/**
 * Unit tests for events ring hygiene fixes.
 *
 * Covers:
 *  - tracing.emitTrace() no longer routes through logError() (so trace records
 *    do not appear as ERROR rows in the dashboard events buffer).
 *  - storage.factory.createStore() emits the EXPERIMENTAL SQLite warning at
 *    most once per process (warn-once latch), regardless of how many times it
 *    is called.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('tracing emits as DEBUG (not ERROR) — events ring hygiene', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.INDEX_SERVER_TRACE = '2';
  });

  it('emitTrace pushes via logDebug, leaving WARN/ERROR ring untouched', async () => {
    const { clearEvents, listEvents } = await import('../../services/eventBuffer.js');
    clearEvents();
    const tracing = await import('../../services/tracing.js');
    tracing.emitTrace('[trace:test]', { hello: 'world' }, 1);
    const events = listEvents({});
    // No WARN/ERROR records should have been added by a routine trace.
    expect(events.length).toBe(0);
  });
});

describe('SQLite EXPERIMENTAL warning emitted once', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('repeated createStore("sqlite") only triggers one warn-level event', async () => {
    process.env.INDEX_SERVER_STORAGE_BACKEND = 'sqlite';
    process.env.INDEX_SERVER_SQLITE_PATH = ':memory:';
    const { _resetSqliteExperimentalWarning } = await import('../../services/storage/factory.js');
    _resetSqliteExperimentalWarning();
    const eventBuf = await import('../../services/eventBuffer.js');
    eventBuf.clearEvents();
    const factory = await import('../../services/storage/factory.js');
    // Three calls should produce only one warning record in the events buffer.
    try { factory.createStore('sqlite', undefined, ':memory:'); } catch { /* node version may not support node:sqlite in test env */ }
    try { factory.createStore('sqlite', undefined, ':memory:'); } catch { /* ignore */ }
    try { factory.createStore('sqlite', undefined, ':memory:'); } catch { /* ignore */ }
    const events = eventBuf.listEvents({}).filter((e: { msg: string }) => e.msg.includes('EXPERIMENTAL: SQLite'));
    expect(events.length).toBeLessThanOrEqual(1);
  });
});
