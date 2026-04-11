import { describe, it, expect } from 'vitest';
import { getMemoryMonitor, memStatus, memReport, checkListeners } from '../utils/memoryMonitor';

// Focused micro test to exercise memoryMonitor exported helpers without long intervals.
describe('memoryMonitor quick coverage', () => {
  it('captures snapshots and reports trends without leak', () => {
    const mm = getMemoryMonitor();
    // Take a few snapshots manually instead of starting interval to avoid timing flake.
    mm.takeSnapshot?.();
    mm.takeSnapshot?.();
    const report = mm.getDetailedReport?.();
    expect(report).toContain('MEMORY MONITOR REPORT');
    // Exercise helper exports (they log to console; ensure they don't throw)
    memStatus();
    memReport();
    checkListeners();
  });
});
