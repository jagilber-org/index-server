/**
 * Issue #353: INDEX_SERVER_MESSAGING_ENABLED runtime flag.
 *
 * Verifies that:
 *  - the flag parses correctly (default true; "0"/"false" → false)
 *  - getToolRegistry omits the messaging_* tools when disabled
 *  - getToolRegistry includes them when enabled (default)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MESSAGING_TOOL_NAMES = [
  'messaging_send',
  'messaging_read',
  'messaging_list_channels',
  'messaging_ack',
  'messaging_stats',
  'messaging_get',
  'messaging_update',
  'messaging_purge',
  'messaging_reply',
  'messaging_thread',
];

describe('INDEX_SERVER_MESSAGING_ENABLED flag (#353)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('defaults messaging.enabled to true when unset', async () => {
    delete process.env.INDEX_SERVER_MESSAGING_ENABLED;
    const { parseMessagingConfig } = await import('../../config/featureConfig.js');
    expect(parseMessagingConfig().enabled).toBe(true);
  });

  it('parses "0" as disabled', async () => {
    process.env.INDEX_SERVER_MESSAGING_ENABLED = '0';
    const { parseMessagingConfig } = await import('../../config/featureConfig.js');
    expect(parseMessagingConfig().enabled).toBe(false);
  });

  it('parses "false" as disabled', async () => {
    process.env.INDEX_SERVER_MESSAGING_ENABLED = 'false';
    const { parseMessagingConfig } = await import('../../config/featureConfig.js');
    expect(parseMessagingConfig().enabled).toBe(false);
  });

  it('parses "1" as enabled', async () => {
    process.env.INDEX_SERVER_MESSAGING_ENABLED = '1';
    const { parseMessagingConfig } = await import('../../config/featureConfig.js');
    expect(parseMessagingConfig().enabled).toBe(true);
  });

  it('getToolRegistry includes messaging tools when enabled', async () => {
    delete process.env.INDEX_SERVER_MESSAGING_ENABLED;
    // Ensure admin-tier visibility so messaging (extended) is reachable
    process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN = '1';
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
    const { getToolRegistry } = await import('../../services/toolRegistry.js');
    const names = new Set(getToolRegistry({ tier: 'admin' }).map(t => t.name));
    for (const tool of MESSAGING_TOOL_NAMES) {
      expect(names.has(tool), `${tool} should be present when messaging enabled`).toBe(true);
    }
  });

  it('getToolRegistry omits messaging tools when disabled', async () => {
    process.env.INDEX_SERVER_MESSAGING_ENABLED = '0';
    process.env.INDEX_SERVER_FLAG_TOOLS_ADMIN = '1';
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
    const { getToolRegistry } = await import('../../services/toolRegistry.js');
    const names = new Set(getToolRegistry({ tier: 'admin' }).map(t => t.name));
    for (const tool of MESSAGING_TOOL_NAMES) {
      expect(names.has(tool), `${tool} should be absent when messaging disabled`).toBe(false);
    }
    // Non-messaging tools still present
    expect(names.has('health_check')).toBe(true);
    expect(names.has('index_search')).toBe(true);
  });
});
