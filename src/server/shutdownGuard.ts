/**
 * Shutdown Guard — Consolidates all process exit handling into a single
 * re-entrance-guarded shutdown path.
 *
 * Fixes: GitHub Issue #36 — Multiple process.exit() race in shutdown paths
 *
 * Instead of SIGINT/SIGTERM/uncaughtException each independently calling
 * process.exit(), all paths funnel through initiateShutdown() which:
 * 1. Sets a guard flag to prevent re-entrance
 * 2. Runs all registered cleanup handlers (with error isolation)
 * 3. Returns the appropriate exit code
 */

export interface ShutdownGuard {
  /**
   * Register a named cleanup handler to run during shutdown.
   * @param name - Unique identifier for this cleanup handler
   * @param handler - Function to invoke during shutdown; errors are caught and logged
   */
  registerCleanup(name: string, handler: () => void): void;
  /**
   * Remove a previously registered cleanup handler.
   * @param name - Identifier of the handler to remove
   */
  deregisterCleanup(name: string): void;
  /**
   * Initiate shutdown — only executes cleanup once (re-entrant calls return early).
   * @param reason - Reason string; `'uncaughtException'` maps to exit code 1, all others to 0
   * @returns The process exit code that callers should pass to `process.exit()`
   */
  initiateShutdown(reason: string): number;
  /**
   * Check if shutdown has been initiated.
   * @returns `true` once {@link initiateShutdown} has been called
   */
  isShuttingDown(): boolean;
}

/**
 * Create a new shutdown guard that consolidates all process exit paths into a single re-entrance-safe flow.
 * @returns A {@link ShutdownGuard} instance with `registerCleanup`, `deregisterCleanup`, `initiateShutdown`, and `isShuttingDown` methods
 */
export function createShutdownGuard(): ShutdownGuard {
  let shuttingDown = false;
  const cleanupHandlers = new Map<string, () => void>();

  return {
    registerCleanup(name: string, handler: () => void): void {
      cleanupHandlers.set(name, handler);
    },

    deregisterCleanup(name: string): void {
      cleanupHandlers.delete(name);
    },

    initiateShutdown(reason: string): number {
      const exitCode = reason === 'uncaughtException' ? 1 : 0;
      if (shuttingDown) return exitCode;
      shuttingDown = true;

      for (const [name, handler] of cleanupHandlers) {
        try {
          handler();
        } catch (err) {
          try {
            process.stderr.write(`[shutdown] cleanup handler "${name}" failed: ${err}\n`);
          } catch { /* ignore */ }
        }
      }

      return exitCode;
    },

    isShuttingDown(): boolean {
      return shuttingDown;
    }
  };
}
