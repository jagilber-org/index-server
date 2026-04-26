/**
 * Handshake tracing primitives — module-scoped sequence counter, ring buffer,
 * stderr-safe loggers, and the `handshakeError` helper used everywhere a
 * handshake-adjacent catch block would otherwise silently swallow an error.
 */
import { getRuntimeConfig } from '../../config/runtimeConfig';

export function isHandshakeTraceEnabled(): boolean {
  return getRuntimeConfig().trace.has('handshake');
}

let HANDSHAKE_SEQ = 0;

export interface HandshakeEvent {
  seq: number;
  ts: string;
  stage: string;
  extra?: Record<string, unknown>;
}

const HANDSHAKE_EVENTS: HandshakeEvent[] = [];

export function getHandshakeEvents(): readonly HandshakeEvent[] {
  return HANDSHAKE_EVENTS;
}

/** Write a single handshake-error breadcrumb to stderr without throwing. */
export function handshakeError(context: string, err: unknown): void {
  try {
    process.stderr.write(
      `[handshake-error] ${context}: ${(err as Error).message || String(err)}\n`,
    );
  } catch {
    /* stderr write failed — truly nothing we can do */
  }
}

export function handshakeLog(stage: string, data?: Record<string, unknown>): void {
  if (!isHandshakeTraceEnabled()) return;
  try {
    const payload = {
      handshake: true,
      seq: ++HANDSHAKE_SEQ,
      ts: new Date().toISOString(),
      stage,
      ...(data || {}),
    };
    process.stderr.write(`[handshake] ${JSON.stringify(payload)}\n`);
  } catch (err) {
    handshakeError('handshakeLog', err);
  }
}

export function record(stage: string, extra?: Record<string, unknown>): void {
  const evt: HandshakeEvent = {
    seq: ++HANDSHAKE_SEQ,
    ts: new Date().toISOString(),
    stage,
    extra,
  };
  HANDSHAKE_EVENTS.push(evt);
  if (HANDSHAKE_EVENTS.length > 50) HANDSHAKE_EVENTS.shift();
  if (isHandshakeTraceEnabled()) {
    try {
      process.stderr.write(`[handshake] ${JSON.stringify(evt)}\n`);
    } catch (err) {
      handshakeError('record:trace', err);
    }
  }
}

export function isInitFrameDiagEnabled(): boolean {
  return getRuntimeConfig().trace.has('initFrame');
}

export function initFrameLog(stage: string, extra?: Record<string, unknown>): void {
  if (!isInitFrameDiagEnabled()) return;
  try {
    const payload = { stage, t: Date.now(), ...(extra || {}) };
    process.stderr.write(`[init-frame] ${JSON.stringify(payload)}\n`);
  } catch (err) {
    handshakeError('initFrameLog', err);
  }
}

/** Expose the events ring on globalThis for the diagnostics_handshake tool. */
export function exposeGlobalEventsRef(): void {
  try {
    (global as unknown as { HANDSHAKE_EVENTS_REF?: HandshakeEvent[] }).HANDSHAKE_EVENTS_REF =
      HANDSHAKE_EVENTS;
  } catch (err) {
    handshakeError('globalEventsRef', err);
  }
}

// Eager side effect preserved from legacy handshakeManager.ts module-load behavior.
exposeGlobalEventsRef();
