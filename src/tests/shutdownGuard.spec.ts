import { describe, it, expect, beforeEach } from 'vitest';

// RED phase: Tests for gracefulShutdown guard
// Issue #36: Multiple process.exit() calls race during shutdown
// The guard must:
// 1. Only execute cleanup once even if called multiple times
// 2. Call registered cleanup handlers before exiting
// 3. Set process.exitCode instead of calling process.exit() directly where possible

import { createShutdownGuard, ShutdownGuard } from '../server/shutdownGuard.js';

describe('shutdownGuard', () => {
  let guard: ShutdownGuard;

  beforeEach(() => {
    guard = createShutdownGuard();
  });

  it('should only execute shutdown once even when called multiple times', () => {
    let callCount = 0;
    guard.registerCleanup('counter', () => { callCount++; });

    guard.initiateShutdown('SIGINT');
    guard.initiateShutdown('SIGTERM');
    guard.initiateShutdown('uncaughtException');

    expect(callCount).toBe(1);
  });

  it('should report shutting down state after first call', () => {
    expect(guard.isShuttingDown()).toBe(false);
    guard.initiateShutdown('SIGINT');
    expect(guard.isShuttingDown()).toBe(true);
  });

  it('should call all registered cleanup handlers', () => {
    const called: string[] = [];
    guard.registerCleanup('handler-a', () => { called.push('a'); });
    guard.registerCleanup('handler-b', () => { called.push('b'); });

    guard.initiateShutdown('SIGTERM');

    expect(called).toContain('a');
    expect(called).toContain('b');
  });

  it('should not throw if a cleanup handler throws', () => {
    guard.registerCleanup('bad', () => { throw new Error('cleanup failed'); });
    guard.registerCleanup('good', () => { /* ok */ });

    expect(() => guard.initiateShutdown('SIGINT')).not.toThrow();
  });

  it('should return the exit code based on shutdown reason', () => {
    const code = guard.initiateShutdown('uncaughtException');
    expect(code).toBe(1);
  });

  it('should return exit code 0 for signal-based shutdown', () => {
    const code = guard.initiateShutdown('SIGINT');
    expect(code).toBe(0);
  });

  it('should allow deregistering cleanup handlers', () => {
    let called = false;
    guard.registerCleanup('removable', () => { called = true; });
    guard.deregisterCleanup('removable');

    guard.initiateShutdown('SIGINT');
    expect(called).toBe(false);
  });
});
