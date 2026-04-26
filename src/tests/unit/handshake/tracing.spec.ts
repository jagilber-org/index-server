import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  handshakeError,
  handshakeLog,
  isHandshakeTraceEnabled,
} from '../../../server/handshake/tracing';

describe('handshake/tracing handshakeError', () => {
  let writeSpy: any;
  beforeEach(() => {
    writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((() => true) as never);
  });
  afterEach(() => {
    writeSpy?.mockRestore();
  });

  it('writes a [handshake-error] breadcrumb to stderr', () => {
    handshakeError('test_ctx', new Error('boom'));
    expect(writeSpy!).toHaveBeenCalledTimes(1);
    const arg = String((writeSpy!).mock.calls[0][0]);
    expect(arg).toContain('[handshake-error]');
    expect(arg).toContain('test_ctx');
    expect(arg).toContain('boom');
  });

  it('coerces non-Error throwables to a string', () => {
    handshakeError('ctx2', 'string-error');
    const arg = String((writeSpy!).mock.calls[0][0]);
    expect(arg).toContain('string-error');
  });

  it('does not throw if stderr.write itself throws', () => {
    writeSpy!.mockImplementation((() => {
      throw new Error('stderr broken');
    }) as never);
    expect(() => handshakeError('ctx3', new Error('x'))).not.toThrow();
  });
});

describe('handshake/tracing handshakeLog gating', () => {
  it('respects the runtime trace flag (no-op when disabled)', () => {
    if (isHandshakeTraceEnabled()) return;
    const writeSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((() => true) as never);
    handshakeLog('any_stage', { k: 'v' });
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
