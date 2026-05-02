/**
 * Tests for in-process WARN/ERROR ring buffer (issue #282 fix #6).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { recordEvent, listEvents, eventCounts, clearEvents, _eventBufferSize } from '../services/eventBuffer';
import { logWarn, logError, logInfo } from '../services/logger';

describe('eventBuffer', () => {
  beforeEach(() => {
    clearEvents();
  });

  it('captures only WARN and ERROR records via direct recordEvent', () => {
    recordEvent('WARN', 'first warning');
    recordEvent('ERROR', 'something failed', 'stack frame');
    const events = listEvents();
    expect(events).toHaveLength(2);
    expect(events[0].level).toBe('WARN');
    expect(events[1].level).toBe('ERROR');
    expect(events[1].detail).toBe('stack frame');
  });

  it('counts WARN and ERROR separately', () => {
    recordEvent('WARN', 'a');
    recordEvent('WARN', 'b');
    recordEvent('ERROR', 'c');
    const c = eventCounts();
    expect(c.warn).toBe(2);
    expect(c.error).toBe(1);
    expect(c.total).toBe(3);
    expect(c.latestId).toBeGreaterThan(0);
  });

  it('counts respect sinceId for unread polling', () => {
    recordEvent('WARN', 'old1');
    recordEvent('WARN', 'old2');
    const baseline = eventCounts();
    recordEvent('ERROR', 'new');
    const delta = eventCounts(baseline.latestId);
    expect(delta.total).toBe(1);
    expect(delta.error).toBe(1);
    expect(delta.warn).toBe(0);
  });

  it('list filters by level and limit', () => {
    recordEvent('WARN', 'w1');
    recordEvent('ERROR', 'e1');
    recordEvent('WARN', 'w2');
    recordEvent('ERROR', 'e2');
    const errs = listEvents({ level: 'ERROR' });
    expect(errs.map(e => e.msg)).toEqual(['e1', 'e2']);
    const limited = listEvents({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('clear empties the buffer', () => {
    recordEvent('WARN', 'a');
    recordEvent('ERROR', 'b');
    expect(_eventBufferSize()).toBeGreaterThan(0);
    clearEvents();
    expect(_eventBufferSize()).toBe(0);
    expect(listEvents()).toEqual([]);
  });

  it('logger.logWarn and logError surface in the buffer; logInfo does not', () => {
    logWarn('[test] surface-warn');
    logError('[test] surface-error');
    logInfo('[test] info-not-surfaced');
    const events = listEvents();
    const msgs = events.map(e => e.msg);
    expect(msgs.some(m => m.includes('surface-warn'))).toBe(true);
    expect(msgs.some(m => m.includes('surface-error'))).toBe(true);
    expect(msgs.some(m => m.includes('info-not-surfaced'))).toBe(false);
  });
});
