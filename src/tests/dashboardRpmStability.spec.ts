import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetricsCollector } from '../dashboard/server/MetricsCollector';

/**
 * Rolling RPM Stability Tests
 * Verifies the new recentCallTimestamps based rolling 60s window logic:
 *  - RPM reflects only calls within last 60s
 *  - RPM grows with new calls, stays stable during idle periods (within window)
 *  - RPM drops only when calls age out beyond the 60s cutoff
 */
describe('Dashboard Metrics: Rolling RPM Stability (P0)', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    vi.useFakeTimers();
    // Use very large collect interval to avoid background snapshot churn affecting timing
    collector = new MetricsCollector({ collectInterval: 3_600_000 });
  });

  afterEach(() => {
    collector.stop();
    vi.useRealTimers();
  });

  function getRpm(): number {
    return collector.getCurrentSnapshot().performance.requestsPerMinute;
  }

  function recordCalls(n: number, tool = 'toolA') {
    for (let i = 0; i < n; i++) {
      collector.recordToolCall(tool, true, 5);
    }
  }

  it('maintains stable RPM within 60s window and decays when calls expire', () => {
    // t=0ms: burst of 30 calls
    recordCalls(30);
    expect(getRpm()).toBe(30);

    // Advance 10s: calls still inside window, RPM unchanged
    vi.advanceTimersByTime(10_000);
    expect(getRpm()).toBe(30);

    // Second burst at t=10s: +10 calls => RPM 40
    recordCalls(10);
    expect(getRpm()).toBe(40);

    // Idle until just before first batch ages out (advance to t=59s)
    vi.advanceTimersByTime(49_000); // total 59s elapsed
    expect(getRpm()).toBe(40); // Still all 40 calls inside last 60s

    // Advance past 60s boundary (now t=61s): first 30 calls (t=0) drop out -> RPM should be 10
    vi.advanceTimersByTime(2_000); // total 61s elapsed
    expect(getRpm()).toBe(10);

    // Sanity: lifetime total call count remains cumulative (not part of RPM but ensure no reset)
    const snapshot = collector.getCurrentSnapshot();
    const totalCalls = Object.values(snapshot.tools).reduce((s, t) => s + t.callCount, 0);
    expect(totalCalls).toBe(40);
  });

  it('RPM returns to 0 after all calls age out', () => {
    recordCalls(5);
    expect(getRpm()).toBe(5);

    // Advance 61s -> all calls outside 60s window
    vi.advanceTimersByTime(61_000);
    expect(getRpm()).toBe(0);
  });
});
