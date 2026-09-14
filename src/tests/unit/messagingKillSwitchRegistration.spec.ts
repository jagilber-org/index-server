/**
 * Issue #353 kill switch, hardened after the #592 review.
 *
 * WHY THIS EXISTS. A security review of PR #592 blocked it with a HIGH finding:
 * that `messaging_manage` is absent from `MESSAGING_TOOLS`, therefore under
 * `INDEX_SERVER_MESSAGING_ENABLED=0` the ten `messaging_*` tools refuse while
 * `messaging_manage {action:'send'}` still sends — an operator kill switch with
 * a hole in it.
 *
 * It does not reproduce. `handlers.messaging.ts` shadows the registry import
 * with a LOCAL gated wrapper (`if (!MESSAGING_ENABLED) return;`), and ALL
 * eleven registrations — `messaging_manage` included — go through it. With the
 * flag off, zero messaging handlers are registered, so `tools/call` refuses at
 * the `getHandler` step. The review had grepped for `messagingEnabled`; the
 * constant is spelled `MESSAGING_ENABLED`, and an empty result for the wrong
 * token was read as "no gate exists".
 *
 * Nothing in the suite asserted this, which is why the question had to be
 * settled by hand in review instead of by CI. That is the gap this file closes:
 * the claim is now falsifiable on every run, in both directions.
 *
 * The review's underlying observation was still correct and is fixed
 * separately — the `MESSAGING_TOOLS` omission meant the registry ADVERTISED
 * `messaging_manage` in `tools/list` while its handler could never exist. Case
 * 3 pins that, so the two facts can never drift apart again.
 *
 * Constitution: TS-9 (regression test for a defect), TS-10 (drives the real
 * registration path), S-3-adjacent (an operator switch must actually switch).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const MESSAGING_TOOL_NAMES = [
  'messaging_send', 'messaging_read', 'messaging_list_channels', 'messaging_ack',
  'messaging_stats', 'messaging_get', 'messaging_update', 'messaging_purge',
  'messaging_reply', 'messaging_thread', 'messaging_manage',
];

describe('#353 messaging kill switch actually de-registers (#592 review)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...ORIGINAL }; vi.resetModules(); });

  // The registration gate is evaluated at MODULE LOAD, so the env must be set
  // before the dynamic import. vi.resetModules() in beforeEach is what makes
  // that possible; without it this file would silently test one config twice.

  it('registers zero messaging handlers when disabled — including messaging_manage', async () => {
    process.env.INDEX_SERVER_MESSAGING_ENABLED = '0';
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
    // @ts-expect-error dynamic side-effect import
    await import('../../services/handlers.messaging');
    const { getHandler } = await import('../../server/registry.js');

    const registered = MESSAGING_TOOL_NAMES.filter(n => getHandler(n));
    expect(registered, `expected no messaging handlers, got: ${registered.join(', ')}`).toHaveLength(0);

    // Named explicitly: this is the tool the review claimed was the hole.
    expect(getHandler('messaging_manage')).toBeUndefined();
  });

  it('registers all eleven messaging handlers when enabled', async () => {
    process.env.INDEX_SERVER_MESSAGING_ENABLED = '1';
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
    // @ts-expect-error dynamic side-effect import
    await import('../../services/handlers.messaging');
    const { getHandler } = await import('../../server/registry.js');

    const missing = MESSAGING_TOOL_NAMES.filter(n => !getHandler(n));
    expect(missing, `missing messaging handlers: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('never advertises a messaging tool whose handler cannot exist', async () => {
    process.env.INDEX_SERVER_MESSAGING_ENABLED = '0';
    const { reloadRuntimeConfig } = await import('../../config/runtimeConfig.js');
    reloadRuntimeConfig();
    const { getToolRegistry } = await import('../../services/toolRegistry.js');

    // The declared surface must not contain anything the kill switch removed.
    // Before #592 this failed on messaging_manage: absent from MESSAGING_TOOLS,
    // so still emitted at extended/admin tier while guaranteed to -32601.
    const declared = getToolRegistry({ tier: 'admin' }).map(t => t.name);
    const advertised = MESSAGING_TOOL_NAMES.filter(n => declared.includes(n));
    expect(advertised, `advertised but unregisterable: ${advertised.join(', ')}`).toHaveLength(0);
  });
});
