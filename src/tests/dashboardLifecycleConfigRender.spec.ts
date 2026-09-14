/**
 * Regression coverage for lifecycle-hook visibility in the existing dashboard
 * Configuration tab. The pure renderer exports CommonJS helpers specifically
 * so these assertions can execute without a browser DOM.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const render = require('../dashboard/client/js/admin.config.render.js') as {
  buildFlagControl(flag: Record<string, unknown>): string;
  buildFlagRow(flag: Record<string, unknown>): string;
  lifecycleHookSummary(flags: Array<Record<string, unknown>>): string;
  lifecycleHookManager(flags: Array<Record<string, unknown>>): string;
};

describe('dashboard lifecycle-hook configuration rendering', () => {
  it('renders configured sensitive commands as status, never as an input value', () => {
    const command = 'operator-command-must-not-render';
    const html = render.buildFlagRow({
      name: 'INDEX_SERVER_HOOK_ON_CHANGE',
      category: 'lifecycle-hooks',
      description: 'Catch-all lifecycle hook command.',
      stability: 'stable',
      default: '(unset)',
      type: 'string',
      reloadBehavior: 'restart-required',
      editable: true,
      sensitive: true,
      writeOnly: true,
      present: true,
      value: command,
      overlayShadowsEnv: false,
    });

    expect(html).toContain('Configured');
    expect(html).toContain('cfg-sensitive-status');
    expect(html).not.toContain(command);
    expect(html).not.toContain('cfg-flag-input');
  });

  it('renders an explicit not-configured state for unset hook commands', () => {
    const html = render.buildFlagControl({
      name: 'INDEX_SERVER_HOOK_ON_CREATE',
      type: 'string',
      editable: true,
      sensitive: true,
      writeOnly: true,
      present: false,
    });

    expect(html).toContain('Not configured');
    expect(html).toContain('cfg-sensitive-status--unset');
    expect(html).not.toContain('<input');
  });

  it('summarizes activation and execution controls without command text', () => {
    const command = 'summary-command-must-not-render';
    const html = render.lifecycleHookSummary([
      { name: 'INDEX_SERVER_HOOK_ON_CREATE', present: true, value: command },
      { name: 'INDEX_SERVER_HOOK_ON_UPDATE', present: false },
      { name: 'INDEX_SERVER_HOOK_ON_REMOVE', present: false },
      { name: 'INDEX_SERVER_HOOK_ON_CHANGE', present: true, value: command },
      { name: 'INDEX_SERVER_HOOK_BLOCKING', value: '1', default: 'off' },
      { name: 'INDEX_SERVER_HOOK_TIMEOUT_MS', value: '2500', default: '10000' },
      { name: 'INDEX_SERVER_HOOK_MAX_CONCURRENT', default: '4' },
    ]);

    expect(html).toContain('Lifecycle hooks');
    expect(html).toContain('Enabled');
    expect(html).toContain('<strong>2 of 4</strong>');
    expect(html).toContain('<span>commands configured</span>');
    expect(html).toContain('Blocking');
    expect(html).toContain('2,500 ms');
    expect(html).toContain('4');
    expect(html).not.toContain(command);
  });

  it('renders a discoverable write-only hook manager with all commands and execution controls', () => {
    const command = 'existing-command-must-never-render';
    const html = render.lifecycleHookManager([
      { name: 'INDEX_SERVER_HOOK_ON_CREATE', present: true, value: command, sensitive: true, writeOnly: true },
      { name: 'INDEX_SERVER_HOOK_ON_UPDATE', present: false, sensitive: true, writeOnly: true },
      { name: 'INDEX_SERVER_HOOK_ON_REMOVE', present: false, sensitive: true, writeOnly: true },
      { name: 'INDEX_SERVER_HOOK_ON_CHANGE', present: true, value: command, sensitive: true, writeOnly: true },
      { name: 'INDEX_SERVER_HOOK_BLOCKING', value: '1', default: 'off' },
      { name: 'INDEX_SERVER_HOOK_TIMEOUT_MS', value: '2500', default: '10000' },
      { name: 'INDEX_SERVER_HOOK_MAX_CONCURRENT', value: '2', default: '4' },
    ]);

    expect(html).toContain('Manage lifecycle hooks');
    expect(html.match(/type="password"/g)).toHaveLength(4);
    expect(html).toContain('data-hook-key="INDEX_SERVER_HOOK_ON_CREATE"');
    expect(html).toContain('data-hook-key="INDEX_SERVER_HOOK_ON_UPDATE"');
    expect(html).toContain('data-hook-key="INDEX_SERVER_HOOK_ON_REMOVE"');
    expect(html).toContain('data-hook-key="INDEX_SERVER_HOOK_ON_CHANGE"');
    expect(html).toContain('id="cfg-hook-blocking"');
    expect(html).toContain('id="cfg-hook-timeout"');
    expect(html).toContain('id="cfg-hook-max-concurrent"');
    expect(html).toContain('id="cfg-hook-save-btn"');
    expect(html).toContain('Configured — enter a replacement');
    expect(html).not.toContain(command);
  });
});
