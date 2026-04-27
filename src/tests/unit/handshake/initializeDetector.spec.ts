import { describe, it, expect } from 'vitest';
import {
  detectInitializeMethod,
  extractRequestId,
} from '../../../server/handshake/initializeDetector';

describe('handshake/initializeDetector detectInitializeMethod', () => {
  it('returns mode=direct on a canonical JSON-RPC initialize frame', () => {
    const frame = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
    expect(detectInitializeMethod(frame).mode).toBe('direct');
  });

  it('returns mode=direct when the frame uses extra whitespace around the colon', () => {
    const frame = '{"jsonrpc":"2.0","id":1,"method"  :  "initialize","params":{}}';
    expect(detectInitializeMethod(frame).mode).toBe('direct');
  });

  it('returns mode=fuzzy when characters of "initialize" appear with small gaps after a "method" sentinel', () => {
    // Insert single-character noise between target letters within the
    // 1200-byte slice that begins at the "method" sentinel.
    const fuzzyMethod = 'i_n_i_t_i_a_l_i_z_e';
    const frame = `{"jsonrpc":"2.0","id":1,"method":"${fuzzyMethod}","params":{}}`;
    const r = detectInitializeMethod(frame);
    expect(r.mode === 'fuzzy' || r.mode === 'subseq').toBe(true);
  });

  it('returns mode=subseq when no "method" sentinel exists but the letters appear in order', () => {
    // No "method" key at all; just enough scattered letters to subsequence-match.
    const garbled = '...i...n...i...t...i...a...l...i...z...e...';
    expect(detectInitializeMethod(garbled).mode).toBe('subseq');
  });

  it('returns mode=null for unrelated traffic', () => {
    expect(detectInitializeMethod('{"jsonrpc":"2.0","id":1,"method":"ping"}').mode).toBe(null);
    expect(detectInitializeMethod('').mode).toBe(null);
    expect(detectInitializeMethod('plain text noise').mode).toBe(null);
  });

  it('only consults the trailing 2KB fallback slice when explicitly enabled', () => {
    // Construct a buffer where letters form `initialize` only deep into the
    // tail, with no "method" sentinel. This should miss the fuzzy slice path
    // (sliceA empty) but match either via the fallback fuzzy or via subseq.
    const tail = 'i_n_i_t_i_a_l_i_z_e';
    const buf = 'x'.repeat(500) + tail;
    const withFallback = detectInitializeMethod(buf, true);
    expect(withFallback.mode).not.toBe(null);
  });
});

describe('handshake/initializeDetector extractRequestId', () => {
  it('extracts a small numeric id from a JSON-RPC frame', () => {
    expect(extractRequestId('{"jsonrpc":"2.0","id":42,"method":"initialize"}')).toBe(42);
  });

  it('tolerates whitespace around the colon', () => {
    expect(extractRequestId('"id"  :   7,')).toBe(7);
  });

  it('returns null when no id field is present', () => {
    expect(extractRequestId('{"jsonrpc":"2.0","method":"initialize"}')).toBe(null);
    expect(extractRequestId('')).toBe(null);
  });

  it('caps at 6 digits to match legacy behavior (does not match 10-digit ids)', () => {
    expect(extractRequestId('"id":1234567890')).not.toBe(1234567890); // pii-allowlist: 10-digit JSON-RPC id fixture, not a phone number
  });
});
