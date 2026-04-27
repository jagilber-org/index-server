/**
 * Handshake/protocol negotiation facade for the MCP server.
 *
 * The historical implementation lived in this single file (~500 lines, ~20
 * silent catch blocks — see issue #138). It has been decomposed into focused
 * modules under `./handshake/` so each concern can be unit-tested in isolation:
 *
 *   - `handshake/tracing.ts`            stderr-safe logging + ring buffer
 *   - `handshake/protocol.ts`           pure version negotiation
 *   - `handshake/initializeDetector.ts` pure stdin scanning
 *   - `handshake/fallbackFrames.ts`     pure JSON-RPC frame builders
 *   - `handshake/readyEmitter.ts`       server/ready dispatch
 *   - `handshake/stdinSniffer.ts`       stdin sniff + synthetic dispatch
 *   - `handshake/safetyFallbacks.ts`    timer-driven last-resort fallbacks
 *
 * This file remains the public import surface for the rest of the server
 * (`sdkServer.ts`, `mcpLogBridge.ts`, mocks in unit tests) and re-exports the
 * full legacy API.
 */
export {
  isHandshakeTraceEnabled,
  handshakeLog,
  record,
  initFrameLog,
  isInitFrameDiagEnabled,
  exposeGlobalEventsRef,
  getHandshakeEvents,
} from './handshake/tracing';
export type { HandshakeEvent } from './handshake/tracing';

export {
  SUPPORTED_PROTOCOL_VERSIONS,
  negotiateProtocolVersion,
  isHandshakeFallbacksEnabled,
} from './handshake/protocol';

export { emitReadyGlobal } from './handshake/readyEmitter';
export { setupStdinSniffer } from './handshake/stdinSniffer';
export { setupSafetyFallbacks } from './handshake/safetyFallbacks';
