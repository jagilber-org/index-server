import { registerHandler } from '../server/registry';

/**
 * diagnostics_block: Intentionally CPU blocks the event loop for a specified number of milliseconds.
 * Purpose: Reproduce / probe health_check hang or starvation behavior under synchronous handler saturation.
 * NOTE: This is test/instrumentation oriented and not part of stable tool surface.
 */
registerHandler('diagnostics_block', (p: { ms?: number }) => {
  const ms = typeof p.ms === 'number' ? Math.min(Math.max(p.ms, 0), 10_000) : 250; // cap at 10s
  const start = Date.now();
  // Busy-loop (intentional) to simulate CPU starvation in a single-threaded event loop
  // eslint-disable-next-line no-empty
  while (Date.now() - start < ms) { /* block */ }
  return { blockedMs: ms, startedAt: new Date(start).toISOString(), endedAt: new Date().toISOString() };
});

/**
 * diagnostics_microtaskFlood: Schedules a large number of microtasks (Promise.resolve chains)
 * to create event loop turn pressure without pure synchronous blocking.
 * Useful to probe starvation scenarios distinct from a tight busy loop.
 */
registerHandler('diagnostics_microtaskFlood', async (p: { count?: number }) => {
  const count = typeof p.count === 'number' ? Math.min(Math.max(p.count, 0), 200_000) : 25_000;
  let ops = 0;
  // Chain microtasks in batches to avoid blowing the call stack while still flooding.
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
  const mb = typeof p.mb === 'number' ? Math.min(Math.max(p.mb, 1), 512) : 64; // cap to 512MB
  const start = Date.now();
  const blocks: Buffer[] = [];
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

/**
 * diagnostics_handshake: Returns recent handshake events captured by sdkServer (if present).
 * If instrumentation not present (older build), returns empty list with a warning flag.
 */
interface HandshakeEvt { seq: number; ts: string; stage: string; extra?: Record<string,unknown>; }
// Augment global type locally (non-invasive)
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const gRef = global as unknown as { HANDSHAKE_EVENTS_REF?: HandshakeEvt[] };
registerHandler('diagnostics_handshake', () => {
  const buf = gRef.HANDSHAKE_EVENTS_REF;
  if(Array.isArray(buf)) return { events: buf.slice(-50) };
  return { events: [], warning: 'handshake instrumentation unavailable in this build' };
});

export {}; // module scope
