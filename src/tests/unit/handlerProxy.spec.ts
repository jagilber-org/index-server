/**
 * Handler Proxy Tests
 *
 * Tests for the proxy mechanism in the handler registry that
 * enables follower instances to forward tool calls to the leader.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getHandler, installHandlerProxy, getHandlerProxy } from '../../server/registry';

describe('Handler Proxy', () => {
  afterEach(() => {
    // Always clean up proxy after each test
    installHandlerProxy(null);
  });

  it('should have no proxy installed by default', () => {
    expect(getHandlerProxy()).toBeNull();
  });

  it('should install and remove proxy', () => {
    const proxy = async (_tool: string, _params: unknown) => ({ proxied: true });
    installHandlerProxy(proxy);
    expect(getHandlerProxy()).toBe(proxy);

    installHandlerProxy(null);
    expect(getHandlerProxy()).toBeNull();
  });

  it('should execute handler locally when no proxy is installed', async () => {
    const handler = getHandler('health_check');
    // health_check is always registered by the server
    if (handler) {
      const result = await handler({});
      expect(result).toBeDefined();
    }
  });

  it('should forward calls through proxy when installed', async () => {
    const proxyResults = { status: 'proxied', version: '1.0.0' };
    const proxyCalls: Array<{ tool: string; params: unknown }> = [];

    installHandlerProxy(async (tool: string, params: unknown) => {
      proxyCalls.push({ tool, params });
      return proxyResults;
    });

    const handler = getHandler('health_check');
    if (handler) {
      const result = await handler({});
      expect(result).toEqual(proxyResults);
      expect(proxyCalls).toHaveLength(1);
      expect(proxyCalls[0].tool).toBe('health_check');
    }
  });

  it('should propagate proxy errors', async () => {
    installHandlerProxy(async () => {
      throw new Error('Leader unreachable');
    });

    const handler = getHandler('health_check');
    if (handler) {
      await expect(handler({})).rejects.toThrow('Leader unreachable');
    }
  });

  it('should resume local execution after proxy removal', async () => {
    const proxy = async () => ({ proxied: true });
    installHandlerProxy(proxy);

    // Remove proxy
    installHandlerProxy(null);

    const handler = getHandler('health_check');
    if (handler) {
      const result = await handler({}) as Record<string, unknown>;
      // Should NOT return proxied result
      expect(result).not.toEqual({ proxied: true });
      expect(result).toBeDefined();
    }
  });
});
