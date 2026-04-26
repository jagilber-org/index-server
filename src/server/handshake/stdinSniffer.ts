/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pre-connect stdin sniffer: scans incoming bytes for an MCP `initialize`
 * request even when fragmented across chunks, then drives a layered
 * fallback chain (synthetic dispatch -> forced result -> ready emission)
 * when the SDK request dispatcher fails to make progress on its own.
 */
import { getRuntimeConfig } from '../../config/runtimeConfig';
import {
  detectInitializeMethod,
  extractRequestId,
  type InitializeDetectMode,
} from './initializeDetector';
import { buildForcedInitResultFrame, buildSyntheticInitRequest } from './fallbackFrames';
import { negotiateProtocolVersion, isHandshakeFallbacksEnabled } from './protocol';
import { emitReadyGlobal } from './readyEmitter';
import { handshakeError } from './tracing';

const SNIFF_WINDOW_BYTES = 8000;
const BUFFER_HARD_LIMIT = 10_000;
const BUFFER_TRIM_TAIL = 2048;
const SCHEDULE_DETECT_MS = 60;
const SCHEDULE_SYNTHETIC_MS = 40;
const SCHEDULE_FORCED_RESULT_MS = 140;

export function setupStdinSniffer(server: any): void {
  try {
    const cfg = getRuntimeConfig();
    const disableInitSniff = cfg.initFeatures.has('disableSniff');
    if (!server || disableInitSniff) return;
    const INIT_FALLBACK_ENABLED = cfg.initFeatures.has('initFallback');
    let __sniffBuf = '';
    if (cfg.trace.has('healthMixed')) {
      try {
        if (!server.__diagRQMap) {
          server.__diagRQMap = new Map();
          server.__diagQueueDepthSniff = 0;
        }
      } catch (err) {
        handshakeError('setupStdinSniffer:diagMapInit', err);
      }
    }
    process.stdin.on('data', (chunk: Buffer) => {
      try {
        const healthMixed = cfg.trace.has('healthMixed');
        if (healthMixed && !server.__diagFirstChunkLogged) {
          server.__diagFirstChunkLogged = true;
          const raw = chunk.toString('utf8');
          const snippet = raw.replace(/\r/g, ' ').replace(/\n/g, '\\n').slice(0, 240);
          process.stderr.write(
            `[diag] ${Date.now()} stdin_first_chunk size=${chunk.length} snippet="${snippet}"\n`,
          );
        }
        __sniffBuf += chunk.toString('utf8');
        if (!server.__sniffedInit) {
          const bufForScan = __sniffBuf.slice(-SNIFF_WINDOW_BYTES);
          const detect = detectInitializeMethod(bufForScan, healthMixed);
          if (detect.mode) {
            handleInitializeDetected({
              server,
              bufForScan,
              mode: detect.mode,
              healthMixed,
              initFallbackEnabled: INIT_FALLBACK_ENABLED,
            });
          }
        }
        if (healthMixed && !server.__dispatcherOverrideActive) {
          __sniffBuf = drainDiagFrames(__sniffBuf, server);
        }
        if (__sniffBuf.length > BUFFER_HARD_LIMIT) {
          __sniffBuf = __sniffBuf.slice(-BUFFER_TRIM_TAIL);
        }
      } catch (err) {
        handshakeError('stdinSniff:data', err);
      }
    });
  } catch (err) {
    handshakeError('setupStdinSniffer', err);
  }
}

function handleInitializeDetected(args: {
  server: any;
  bufForScan: string;
  mode: InitializeDetectMode;
  healthMixed: boolean;
  initFallbackEnabled: boolean;
}): void {
  const { server, bufForScan, mode, healthMixed, initFallbackEnabled } = args;
  server.__sniffedInit = true;
  if (healthMixed) {
    try {
      const norm = bufForScan.slice(0, 400).replace(/\r/g, ' ').replace(/\n/g, '\\n');
      process.stderr.write(
        `[diag] ${Date.now()} sniff_init_${mode}_detect buffer_bytes=${bufForScan.length} preview="${norm}"\n`,
      );
    } catch (err) {
      handshakeError('stdinSniff:diagPreview', err);
    }
  }
  setTimeout(() => {
    try {
      if (!server.__sawInitializeRequest) {
        server.__sawInitializeRequest = true;
        if (healthMixed) {
          try {
            process.stderr.write(`[diag] ${Date.now()} sniff_init_mark_sawInit mode=${mode}\n`);
          } catch (err) {
            handshakeError('stdinSniff:sawInitLog', err);
          }
        }
      }
      if (initFallbackEnabled && !server.__initResponseSent) {
        scheduleSyntheticInitDispatch(server, bufForScan, healthMixed);
        scheduleForcedInitResult(server, healthMixed);
      } else if (healthMixed) {
        try {
          process.stderr.write(`[diag] ${Date.now()} sniff_init_forced_result_skip gating_off\n`);
        } catch (err) {
          handshakeError('stdinSniff:forcedResultSkipLog', err);
        }
      }
      if (isHandshakeFallbacksEnabled()) {
        if (server.__initResponseSent && !server.__readyNotified) {
          emitReadyGlobal(server, 'stdin-sniff-fallback');
        }
      }
    } catch (err) {
      handshakeError('stdinSniff:initSchedule', err);
    }
  }, SCHEDULE_DETECT_MS).unref?.();
}

function scheduleSyntheticInitDispatch(
  server: any,
  bufForScan: string,
  healthMixed: boolean,
): void {
  setTimeout(() => {
    try {
      if (server.__initResponseSent || server.__syntheticInitDispatched) return;
      const id = extractRequestId(bufForScan) ?? 1;
      const req = buildSyntheticInitRequest(id);
      server.__syntheticInitDispatched = true;
      const dispatch = server._onRequest || server._onrequest;
      if (typeof dispatch === 'function') {
        if (healthMixed) {
          try {
            process.stderr.write(
              `[diag] ${Date.now()} sniff_init_synthetic_dispatch id=${id}\n`,
            );
          } catch (err) {
            handshakeError('stdinSniff:syntheticDispatchLog', err);
          }
        }
        try {
          dispatch.call(server, req);
        } catch (err) {
          handshakeError('syntheticInitDispatch', err);
        }
      }
    } catch (err) {
      handshakeError('syntheticInitOuter', err);
    }
  }, SCHEDULE_SYNTHETIC_MS).unref?.();
}

function scheduleForcedInitResult(server: any, healthMixed: boolean): void {
  setTimeout(() => {
    try {
      if (server.__initResponseSent) return;
      const tr = server._transport || server.__transportRef;
      if (tr && typeof tr.send === 'function') {
        let negotiated = '2024-11-05';
        try {
          negotiated = negotiateProtocolVersion('2024-11-05') || negotiated;
        } catch (err) {
          handshakeError('stdinSniff:negotiateVersion', err);
        }
        const frame = buildForcedInitResultFrame(negotiated, 'forced-init-fallback', 1);
        server.__initResponseSent = true;
        if (healthMixed) {
          try {
            process.stderr.write(
              `[diag] ${Date.now()} sniff_init_forced_result_emit id=1 negotiated=${negotiated}\n`,
            );
          } catch (err) {
            handshakeError('stdinSniff:forcedResultLog', err);
          }
        }
        Promise.resolve(tr.send(frame))
          .then(() => {
            if (!server.__readyNotified) emitReadyGlobal(server, 'forced-init-fallback');
          })
          .catch((err: unknown) => {
            handshakeError('forcedInitFallback:transport.send', err);
          });
      }
    } catch (err) {
      handshakeError('forcedInitFallback:outer', err);
    }
  }, SCHEDULE_FORCED_RESULT_MS).unref?.();
}

function drainDiagFrames(buf: string, server: any): string {
  try {
    let working = buf;
    let idx: number;
    while ((idx = working.indexOf('\n')) !== -1) {
      const line = working.slice(0, idx).trim();
      working = working.slice(idx + 1);
      if (!line) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        if (/jsonrpc|method/i.test(line)) {
          const frag = line.replace(/\r/g, ' ').replace(/\n/g, ' ').slice(0, 200);
          process.stderr.write(
            `[diag] ${Date.now()} malformed_json_line len=${line.length} frag="${frag}" err=${
              (e as Error).message || e
            }\n`,
          );
        }
        continue;
      }
      if (
        obj &&
        obj.jsonrpc === '2.0' &&
        obj.method &&
        Object.prototype.hasOwnProperty.call(obj, 'id')
      ) {
        const metaName = obj.method === 'tools/call' ? obj?.params?.name : '';
        const category = (() => {
          if (obj.method === 'initialize') return 'init';
          if (obj.method === 'health_check' || metaName === 'health_check') return 'health';
          if (obj.method === 'metrics_snapshot' || metaName === 'metrics_snapshot')
            return 'metrics';
          if (metaName === 'meta_tools') return 'meta';
          return 'other';
        })();
        if (
          category === 'health' ||
          category === 'metrics' ||
          category === 'meta' ||
          category === 'init'
        ) {
          try {
            server.__diagQueueDepthSniff++;
            server.__diagRQMap.set(obj.id, {
              start: Date.now(),
              cat: category,
              method: obj.method,
            });
            process.stderr.write(
              `[diag] ${Date.now()} rq_enqueue method=${obj.method} cat=${category} id=${obj.id} qdepth=${server.__diagQueueDepthSniff} src=sniff\n`,
            );
          } catch (err) {
            handshakeError('stdinSniff:diagEnqueue', err);
          }
        }
      }
    }
    return working;
  } catch (err) {
    handshakeError('stdinSniff:diagEnqueue', err);
    return buf;
  }
}
