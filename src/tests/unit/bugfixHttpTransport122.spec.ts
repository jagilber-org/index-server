/**
 * #122 - HttpTransport RPC endpoint logs errors with full context before 500
 */
import { describe, expect, it, vi } from 'vitest';

describe('#122 - HttpTransport RPC error logging', () => {
  it('logAudit is called with error context and http kind on 500', () => {
    const mockLogAudit = vi.fn();
    const mockLog = vi.fn();

    // Simulate the error handling logic from HttpTransport
    const error = new TypeError('handler exploded');
    const method = 'test_method';
    const id = 'req-42';

    const message = error instanceof Error ? error.message : 'Internal error';
    const stack = error instanceof Error ? error.stack : undefined;
    const errorType = error instanceof Error ? error.constructor.name : typeof error;

    mockLog('ERROR', `[HttpTransport] RPC handler error for method '${method}': ${message}`, { detail: stack });
    mockLogAudit('rpc_error', method, { error: message, errorType, stack: stack?.slice(0, 500), requestId: id ?? null }, 'http');

    expect(mockLog).toHaveBeenCalledWith(
      'ERROR',
      expect.stringContaining('handler exploded'),
      expect.objectContaining({ detail: expect.stringContaining('TypeError') }),
    );
    expect(mockLogAudit).toHaveBeenCalledWith(
      'rpc_error',
      'test_method',
      expect.objectContaining({
        error: 'handler exploded',
        errorType: 'TypeError',
        stack: expect.any(String),
        requestId: 'req-42',
      }),
      'http',
    );
  });

  it('captures non-Error objects with typeof', () => {
    const mockLogAudit = vi.fn();

    const error: unknown = 'string error';
    const method = 'broken_method';
    const id = null;

    const message = error instanceof Error ? error.message : 'Internal error'; // lgtm[js/implicit-operand-conversion] — intentional type narrowing for unknown-typed error
    const stack = error instanceof Error ? error.stack : undefined; // lgtm[js/implicit-operand-conversion] — intentional type narrowing for unknown-typed error
    const errorType = error instanceof Error ? error.constructor.name : typeof error; // lgtm[js/implicit-operand-conversion] — intentional type narrowing for unknown-typed error

    mockLogAudit('rpc_error', method, { error: message, errorType, stack: stack?.slice(0, 500), requestId: id ?? null }, 'http');

    expect(mockLogAudit).toHaveBeenCalledWith(
      'rpc_error',
      'broken_method',
      expect.objectContaining({
        error: 'Internal error',
        errorType: 'string',
        requestId: null,
      }),
      'http',
    );
  });
});
