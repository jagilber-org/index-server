/**
 * Retry helper for localhost test servers.
 *
 * Loopback connects on this platform intermittently fail with ETIMEDOUT /
 * ECONNRESET / "socket hang up" before any request reaches the server: the
 * dynamic port range is configured down to 1024, so `listen(0)` can hand out
 * low registered ports, and a WFP-based network filter can drop the SYN.
 *
 * Only transport-level failures are retried. A completed HTTP exchange — any
 * status code, any body — is returned untouched, so this can never mask a
 * product regression or a failing assertion.
 */

const TRANSIENT = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|fetch failed|timeout/i;

export function isTransientConnectError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { message?: string; code?: string; cause?: unknown; errors?: unknown[] };
  if (typeof e.code === 'string' && TRANSIENT.test(e.code)) return true;
  if (typeof e.message === 'string' && TRANSIENT.test(e.message)) return true;
  // Dual-stack connects reject with an AggregateError whose own message is empty.
  if (Array.isArray(e.errors) && e.errors.some(isTransientConnectError)) return true;
  return e.cause ? isTransientConnectError(e.cause) : false;
}

export async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientConnectError(err)) throw err;
      lastError = err;
      if (attempt < attempts) await new Promise(r => setTimeout(r, 50 * attempt));
    }
  }
  throw lastError;
}
