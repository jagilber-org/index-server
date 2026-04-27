/**
 * Pure JSON-RPC frame builders used by the handshake fallback paths. No I/O,
 * no mutable state — these can be safely unit tested in isolation.
 */

export interface ForcedInitFrame {
  jsonrpc: '2.0';
  id: number;
  result: {
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    instructions: string;
  };
}

export interface SyntheticInitRequest {
  jsonrpc: '2.0';
  id: number;
  method: 'initialize';
  params: Record<string, unknown>;
}

const BASE_INSTRUCTIONS =
  'Use initialize -> tools/list -> tools/call { name, arguments }.';

/**
 * Build a JSON-RPC `initialize` *response* frame used when the handshake
 * detection paths conclude the client sent (or should have sent) initialize
 * but the SDK never produced a result. The label is appended in parens so
 * operators can identify which fallback fabricated the frame.
 */
export function buildForcedInitResultFrame(
  negotiatedVersion: string,
  label: 'forced-init-fallback' | 'unconditional-init-fallback',
  id = 1,
): ForcedInitFrame {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: negotiatedVersion,
      capabilities: {},
      instructions: `${BASE_INSTRUCTIONS} (${label})`,
    },
  };
}

/**
 * Build a synthetic `initialize` *request* used to nudge the SDK request
 * dispatcher when stdin parsing succeeded but framing failed.
 */
export function buildSyntheticInitRequest(id = 1): SyntheticInitRequest {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {},
  };
}
