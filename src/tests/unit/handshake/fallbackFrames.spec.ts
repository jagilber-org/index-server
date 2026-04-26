import { describe, it, expect } from 'vitest';
import {
  buildForcedInitResultFrame,
  buildSyntheticInitRequest,
} from '../../../server/handshake/fallbackFrames';

describe('handshake/fallbackFrames buildForcedInitResultFrame', () => {
  it('produces a JSON-RPC 2.0 result frame with id default 1', () => {
    const f = buildForcedInitResultFrame('2024-11-05', 'forced-init-fallback');
    expect(f.jsonrpc).toBe('2.0');
    expect(f.id).toBe(1);
    expect(f.result.protocolVersion).toBe('2024-11-05');
    expect(f.result.capabilities).toEqual({});
  });

  it('embeds the label in the instructions string for operator triage', () => {
    const f = buildForcedInitResultFrame('2025-06-18', 'forced-init-fallback');
    expect(f.result.instructions).toContain('(forced-init-fallback)');
    expect(f.result.instructions).toContain(
      'Use initialize -> tools/list -> tools/call { name, arguments }.',
    );
  });

  it('honors the unconditional-init-fallback label', () => {
    const f = buildForcedInitResultFrame('2024-11-05', 'unconditional-init-fallback');
    expect(f.result.instructions).toContain('(unconditional-init-fallback)');
  });

  it('honors a non-default id', () => {
    const f = buildForcedInitResultFrame('2024-11-05', 'forced-init-fallback', 99);
    expect(f.id).toBe(99);
  });
});

describe('handshake/fallbackFrames buildSyntheticInitRequest', () => {
  it('produces a JSON-RPC 2.0 initialize request with empty params', () => {
    const r = buildSyntheticInitRequest();
    expect(r).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  });

  it('honors a supplied id', () => {
    expect(buildSyntheticInitRequest(5).id).toBe(5);
  });
});
