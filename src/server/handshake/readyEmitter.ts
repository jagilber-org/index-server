/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `server/ready` notification dispatcher. Owns the unique ordering and
 * fallback logic for emitting the ready signal exactly once.
 */
import { activateMcpLogBridge } from '../../services/mcpLogBridge';
import { isHandshakeFallbacksEnabled } from './protocol';
import { handshakeError, record } from './tracing';

const FALLBACK_REASONS_ALLOWED_BEFORE_INIT_RESPONSE = new Set<string>([
  'unconditional-init-fallback',
  'unconditional-init-fallback-direct',
  'forced-init-fallback',
]);

/**
 * Idempotent emission of `server/ready`. Invoked ONLY after the initialize
 * response has been (or is about to be) flushed unless the caller is one of
 * the explicit fallback paths AND fallback safety nets are enabled.
 */
export function emitReadyGlobal(server: any, reason: string): void {
  try {
    if (!server) return;
    if (server.__readyNotified) return;
    if (!server.__initResponseSent) {
      if (!isHandshakeFallbacksEnabled()) return; // strict mode: never emit early
      if (!FALLBACK_REASONS_ALLOWED_BEFORE_INIT_RESPONSE.has(reason)) return;
    }
    const v = server.__declaredVersion || server.version || '0.0.0';
    server.__readyNotified = true;
    activateMcpLogBridge();
    record('ready_emitted', { reason, version: v });
    try {
      process.stderr.write(`[ready] emit reason=${reason} version=${v}\n`);
    } catch (err) {
      handshakeError('emitReadyGlobal:log', err);
    }
    const msg = { jsonrpc: '2.0', method: 'server/ready', params: { version: v } };
    let dispatched = false;
    try {
      const t = server._transport;
      if (t?.send) {
        t.send(msg)?.catch?.((err: unknown) => {
          handshakeError('transport.send(ready)', err);
        });
        dispatched = true;
      }
    } catch (err) {
      handshakeError('emitReadyGlobal:transport', err);
    }
    if (!dispatched) {
      try {
        server.sendNotification?.({ method: 'server/ready', params: { version: v } });
        dispatched = true;
      } catch (err) {
        handshakeError('emitReadyGlobal:sendNotification', err);
      }
    }
    if (!dispatched) {
      try {
        process.stdout.write(JSON.stringify(msg) + '\n');
      } catch (err) {
        handshakeError('emitReadyGlobal:stdout', err);
      }
    }
    try {
      if (typeof server.sendToolListChanged === 'function') {
        server.sendToolListChanged();
        record('list_changed_after_ready');
      }
    } catch (err) {
      handshakeError('emitReadyGlobal:sendToolListChanged', err);
    }
  } catch (err) {
    handshakeError('emitReadyGlobal:outer', err);
  }
}
