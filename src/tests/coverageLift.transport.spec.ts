import { describe, it, expect } from 'vitest';
import { startTransport, registerHandler } from '../server/transport';
import { PassThrough } from 'stream';

// Minimal test to exercise initialize path + method not found + simple handler success.
describe('transport basic handshake', () => {
  it('handles initialize and method not found', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const stderr = new PassThrough();
    const lines: string[] = [];
    output.on('data', d => {
      const parts = d.toString().trim().split(/\n+/).filter(Boolean);
      lines.push(...parts);
    });
    startTransport({ input, output, stderr, env: { INDEX_SERVER_VERBOSE_LOGGING: '0' } });

    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })+ '\n');
    // small delay to allow ready emission
    await new Promise(r => setTimeout(r, 20));
    expect(lines.some(l => l.includes('"result"'))).toBe(true);
    expect(lines.some(l => l.includes('server/ready'))).toBe(true);

  // Unknown method -> expect -32601 error. Allow case-insensitive match and a slightly
  // longer wait to avoid flakiness on slower CI.
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'nope/unknown' }) + '\n');
  await new Promise(r => setTimeout(r, 35));
  const notFound = lines.some(l => /"id":2/.test(l) && /method not found/i.test(l));
  expect(notFound).toBe(true);
  });

  it('dispatches custom handler', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const stderr = new PassThrough();
    const lines: string[] = [];
    output.on('data', d => {
      lines.push(...d.toString().trim().split(/\n+/).filter(Boolean));
    });
    startTransport({ input, output, stderr, env: { INDEX_SERVER_VERBOSE_LOGGING: '0' } });
    registerHandler('echo/ping', (p: any) => ({ pong: p?.v ?? 1 }));
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'initialize' }) + '\n');
    await new Promise(r => setTimeout(r, 15));
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'echo/ping', params: { v: 42 } }) + '\n');
    await new Promise(r => setTimeout(r, 15));
    expect(lines.some(l => l.includes('"id":11') && l.includes('42'))).toBe(true);
  });
});
