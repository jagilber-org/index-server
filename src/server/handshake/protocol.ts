/**
 * Pure protocol-version negotiation utilities for the MCP handshake.
 * No I/O, no module-level mutable state.
 */
import { getRuntimeConfig } from '../../config/runtimeConfig';

/** Supported protocol versions, ordered most-preferred-first. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  '2025-06-18',
  '2024-11-05',
  '2024-10-07',
];

/**
 * Negotiate a protocol version with graceful fallback.
 * Returns the requested version when supported, otherwise the most preferred
 * supported version.
 */
export function negotiateProtocolVersion(requested?: string): string {
  if (!requested) return SUPPORTED_PROTOCOL_VERSIONS[0];
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
  return SUPPORTED_PROTOCOL_VERSIONS[0];
}

/**
 * By default ALL non-primary ready fallbacks (watchdogs, safety timeouts,
 * stdin sniff synthetic initialize, unconditional init fallbacks, etc.) are
 * disabled. Enable via INDEX_SERVER_INIT_FEATURES=handshakeFallbacks to
 * re-enable the safety nets.
 */
export function isHandshakeFallbacksEnabled(): boolean {
  return getRuntimeConfig().initFeatures.has('handshakeFallbacks');
}
