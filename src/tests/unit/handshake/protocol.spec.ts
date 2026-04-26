import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_PROTOCOL_VERSIONS,
  negotiateProtocolVersion,
} from '../../../server/handshake/protocol';

describe('handshake/protocol negotiateProtocolVersion', () => {
  it('returns most-preferred version when no version requested', () => {
    expect(negotiateProtocolVersion()).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
    expect(negotiateProtocolVersion(undefined)).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  it('returns most-preferred version when requested version is unsupported', () => {
    expect(negotiateProtocolVersion('1999-01-01')).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  it('echoes the request when it is in the supported set', () => {
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
      expect(negotiateProtocolVersion(v)).toBe(v);
    }
  });

  it('exposes the supported set in preferred-first order', () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS[0]).toBe('2025-06-18');
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('2024-11-05');
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('2024-10-07');
  });
});
