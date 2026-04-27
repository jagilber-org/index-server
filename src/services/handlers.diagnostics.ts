import { registerHandler } from '../server/registry';
import { logAudit } from './auditLog';
import { dangerousDiagnosticsEnabled } from '../utils/envUtils';

const MAX_BLOCK_MS = 1_000;
const DEFAULT_BLOCK_MS = 100;
const MAX_MICROTASK_COUNT = 25_000;
const DEFAULT_MICROTASK_COUNT = 5_000;
const MAX_MEMORY_MB = 64;
const DEFAULT_MEMORY_MB = 16;

function diagnosticsDisabled(tool: string) {
  return {
    error: 'diagnostics_disabled',
    tool,
    message: 'Dangerous diagnostics tools require INDEX_SERVER_DEBUG=1 or INDEX_SERVER_STRESS_DIAG=1.',
  };
}

if (dangerousDiagnosticsEnabled()) {
  /**
   * diagnostics_block: Intentionally CPU blocks the event loop for a specified number of milliseconds.
   * Purpose: Reproduce / probe health_check hang or starvation behavior under synchronous handler saturation.
   * NOTE: This is test/instrumentation oriented and not part of stable tool surface.
   */
  registerHandler('diagnostics_block', (p: { ms?: number }) => {
    if (!dangerousDiagnosticsEnabled()) return diagnosticsDisabled('diagnostics_block');
    const ms = typeof p.ms === 'number' ? Math.min(Math.max(p.ms, 0), MAX_BLOCK_MS) : DEFAULT_BLOCK_MS;
    const start = Date.now();
    logAudit('diagnostics_block', undefined, { phase: 'start', requestedMs: p.ms, effectiveMs: ms }, 'mutation');
    while (Date.now() - start < ms) { /* intentionally blocking */ }
    return { blockedMs: ms, startedAt: new Date(start).toISOString(), endedAt: new Date().toISOString() };
  });

  /**
   * diagnostics_microtaskFlood: Schedules a large number of microtasks (Promise.resolve chains)
   * to create event loop turn pressure without pure synchronous blocking.
   * Useful to probe starvation scenarios distinct from a tight busy loop.
   */
  registerHandler('diagnostics_microtaskFlood', async (p: { count?: number }) => {
    if (!dangerousDiagnosticsEnabled()) return diagnosticsDisabled('diagnostics_microtaskFlood');
    const count = typeof p.count === 'number' ? Math.min(Math.max(p.count, 0), MAX_MICROTASK_COUNT) : DEFAULT_MICROTASK_COUNT;
    let ops = 0;
    logAudit('diagnostics_microtaskFlood', undefined, { phase: 'start', requestedCount: p.count, effectiveCount: count }, 'mutation');
    function batch(n: number): Promise<void> {
      if (n <= 0) return Promise.resolve();
      return Promise.resolve().then(() => { ops++; }).then(() => batch(n - 1));
    }
    const start = Date.now();
    await batch(count);
    return { scheduled: count, executed: ops, ms: Date.now() - start };
  });

  /**
   * diagnostics_memoryPressure: Allocates transient buffers to induce GC / memory pressure.
   * Allocation is bounded & immediately released (locally scoped) before returning.
   */
  registerHandler('diagnostics_memoryPressure', (p: { mb?: number }) => {
    if (!dangerousDiagnosticsEnabled()) return diagnosticsDisabled('diagnostics_memoryPressure');
    const mb = typeof p.mb === 'number' ? Math.min(Math.max(p.mb, 1), MAX_MEMORY_MB) : DEFAULT_MEMORY_MB;
    const start = Date.now();
    const blocks: Buffer[] = [];
    logAudit('diagnostics_memoryPressure', undefined, { phase: 'start', requestedMB: p.mb, effectiveMB: mb }, 'mutation');
    const PER = 4 * 1024 * 1024; // 4MB per block
    const needed = Math.ceil((mb * 1024 * 1024) / PER);
    for (let i = 0; i < needed; i++) {
      const b = Buffer.allocUnsafe(PER);
      // touch a few bytes to ensure physical commit
      b[0] = 1; b[PER - 1] = 1;
      blocks.push(b);
    }
    const allocMs = Date.now() - start;
    // Release references so GC can reclaim
    return { requestedMB: mb, blocks: blocks.length, perBlockBytes: PER, allocMs };
  });
}

/**
 * diagnostics_handshake: Returns recent handshake events captured by sdkServer (if present).
 * If instrumentation not present (older build), returns empty list with a warning flag.
 */
interface HandshakeEvt { seq: number; ts: string; stage: string; extra?: Record<string,unknown>; }
const gRef = global as unknown as { HANDSHAKE_EVENTS_REF?: HandshakeEvt[] };
registerHandler('diagnostics_handshake', () => {
  const buf = gRef.HANDSHAKE_EVENTS_REF;
  if(Array.isArray(buf)) return { events: buf.slice(-50) };
  return { events: [], warning: 'handshake instrumentation unavailable in this build' };
});

export {}; // module scope
