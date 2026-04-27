/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Safety fallback timers and `_oninitialize` SDK patch. Provides last-resort
 * ready emission and unconditional initialize-response fabrication when no
 * other path has produced one within tight deadlines.
 */
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { buildForcedInitResultFrame } from './fallbackFrames';
import {
  isHandshakeFallbacksEnabled,
  negotiateProtocolVersion,
} from './protocol';
import { emitReadyGlobal } from './readyEmitter';
import { handshakeError, handshakeLog } from './tracing';

const SAFETY_TIMEOUT_MS = 100;
const UNCONDITIONAL_FALLBACK_MS = 150;
const FALLBACK_NEGOTIATED_VERSION = '2024-11-05';

export function setupSafetyFallbacks(server: any): void {
  if (isHandshakeFallbacksEnabled()) {
    setTimeout(() => {
      try {
        if (
          server.__sawInitializeRequest &&
          server.__initResponseSent &&
          !server.__readyNotified
        ) {
          handshakeLog('safety_timeout_emit_attempt', {
            label: 'safety-timeout-100ms',
            sawInit: true,
            initRespSent: true,
          });
          emitReadyGlobal(server, 'safety-timeout-100ms');
        }
      } catch (err) {
        handshakeError('safetyFallback:100ms', err);
      }
    }, SAFETY_TIMEOUT_MS).unref?.();
  }
  if (isHandshakeFallbacksEnabled()) {
    setTimeout(() => {
      try {
        const cfg = getRuntimeConfig();
        const INIT_FALLBACK_ENABLED = cfg.initFeatures.has('initFallback');
        if (cfg.trace.has('healthMixed') && !server.__initResponseSent) {
          if (!INIT_FALLBACK_ENABLED) {
            try {
              process.stderr.write(
                `[diag] ${Date.now()} init_unconditional_fallback_skip gating_off\n`,
              );
            } catch (err) {
              handshakeError('safetyFallback:skipLog', err);
            }
            return;
          }
          if (!server.__sawInitializeRequest) {
            if (process.stderr && !server.__diagForcedInitLogged) {
              server.__diagForcedInitLogged = true;
              try {
                process.stderr.write(
                  `[diag] ${Date.now()} init_unconditional_fallback_emit id=1 reason=no_init_seen_150ms\n`,
                );
              } catch (err) {
                handshakeError('safetyFallback:noInitLog', err);
              }
            }
          } else {
            try {
              process.stderr.write(
                `[diag] ${Date.now()} init_unconditional_fallback_emit id=1 reason=init_seen_no_response_150ms\n`,
              );
            } catch (err) {
              handshakeError('safetyFallback:initSeenLog', err);
            }
          }
          const frame = buildForcedInitResultFrame(
            FALLBACK_NEGOTIATED_VERSION,
            'unconditional-init-fallback',
            1,
          );
          const tr = server._transport || server.__transportRef;
          server.__initResponseSent = true;
          if (tr && typeof tr.send === 'function') {
            Promise.resolve(tr.send(frame))
              .then(() => {
                if (!server.__readyNotified)
                  emitReadyGlobal(server, 'unconditional-init-fallback');
              })
              .catch((err: unknown) => {
                handshakeError('unconditionalFallback:transport.send', err);
              });
          } else {
            try {
              process.stdout.write(JSON.stringify(frame) + '\n');
            } catch (err) {
              handshakeError('unconditionalFallback:stdout', err);
            }
            if (!server.__readyNotified)
              emitReadyGlobal(server, 'unconditional-init-fallback-direct');
          }
        }
      } catch (err) {
        handshakeError('safetyFallback:150ms', err);
      }
    }, UNCONDITIONAL_FALLBACK_MS).unref?.();
  }
  // Patch initialize result for instructions (SDK internal property)
  const originalInit = server._oninitialize;
  if (originalInit && !server.__initPatched) {
    server.__initPatched = true;
    server._oninitialize = async function (this: any, request: any) {
      try {
        this.__sawInitializeRequest = true;
        handshakeLog('oninitialize_enter', {
          sawInit: true,
          ready: !!this.__readyNotified,
          initRespSent: !!server.__initResponseSent,
        });
      } catch (err) {
        handshakeError('oninitialize:enter', err);
      }
      const result = await originalInit.call(this, request);
      try {
        const negotiated = negotiateProtocolVersion(request?.params?.protocolVersion);
        result.protocolVersion = negotiated;
        if (result && typeof result === 'object' && !('instructions' in result)) {
          result.instructions =
            'Use initialize -> tools/list -> tools/call { name, arguments }. Health: tools/call health_check. Metrics: tools/call metrics_snapshot. Ping: ping.';
        }
        // Do NOT emit server/ready here; ordering handled strictly by transport send hook.
      } catch (err) {
        handshakeError('oninitialize:negotiation', err);
      }
      return result;
    };
  }
}
