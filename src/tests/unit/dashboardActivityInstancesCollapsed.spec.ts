/**
 * The "By instance" table under Catalog Activity must start COLLAPSED.
 *
 * Instances are ephemeral — one per server process — so the row count grows
 * without bound rather than tracking catalog size. Measured on a real
 * deployment: 1,068 distinct instances over seven days (307-442 per day), which
 * rendered a 1,068-row table directly beneath the chart and pushed the chart
 * itself off-screen.
 *
 * This asserts the rendered DOM rather than the source text. A grep for
 * `createElement('details')` would pass just as happily if the element were
 * created with `open` set, which is the exact regression worth catching.
 */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

const SRC = path.join(__dirname, '..', '..', 'dashboard', 'client', 'js', 'admin.activity.js');

type ActivityHook = {
  _renderInstances(instances: Array<Record<string, unknown>>): void;
};

function instance(name: string, added = 1): Record<string, unknown> {
  return { instance: name, added, modified: 0, archived: 0, restored: 0, removed: 0, signaled: 0, signals: {} };
}

let dom: JSDOM;

function load(): ActivityHook {
  dom = new JSDOM(
    `<!doctype html><html><body>
       <select id="activity-bucket"></select>
       <select id="activity-window"></select>
       <div id="activity-instances" class="activity-instances"></div>
     </body></html>`,
    { runScripts: 'outside-only' },
  );
  // The module calls refresh() on load, which fetches. Stub it so the module
  // initialises without a network layer; the table render is driven directly.
  (dom.window as unknown as { fetch: unknown }).fetch = () =>
    Promise.reject(new Error('fetch disabled in this spec'));
  dom.window.eval(fs.readFileSync(SRC, 'utf8'));
  const hook = (dom.window as unknown as { __adminActivity?: ActivityHook }).__adminActivity;
  if (!hook) throw new Error('admin.activity.js did not expose __adminActivity');
  return hook;
}

describe('Catalog Activity — By instance table', () => {
  beforeEach(() => { /* dom created per test via load() */ });
  afterEach(() => { dom?.window?.close(); });

  it('renders the instance list inside a <details> that is CLOSED by default', () => {
    const hook = load();
    hook._renderInstances([instance('111@index-server'), instance('222@index-server')]);

    const host = dom.window.document.getElementById('activity-instances')!;
    const details = host.querySelector('details');

    expect(details, 'instance list should be wrapped in <details>').not.toBeNull();
    // The whole point: present but not expanded.
    expect(details!.hasAttribute('open')).toBe(false);
    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it('keeps the instance count visible in the summary while collapsed', () => {
    const hook = load();
    hook._renderInstances(Array.from({ length: 1068 }, (_, i) => instance(`${i}@index-server`)));

    const summary = dom.window.document.querySelector('#activity-instances summary')!;
    expect(summary).not.toBeNull();
    // A collapsed panel that hides its own magnitude is worse than no panel:
    // 1068 instances is the signal that something is spawning servers.
    // Unseparated, matching num() and the chart legend ("added 3700").
    expect(summary.textContent).toContain('1068');
    expect(summary.textContent).toContain('By instance');
  });

  it('still renders one row per instance inside the collapsed panel', () => {
    const hook = load();
    hook._renderInstances([instance('a'), instance('b'), instance('c')]);

    const rows = dom.window.document.querySelectorAll('#activity-instances tbody tr');
    expect(rows.length).toBe(3);
  });

  it('renders nothing at all when there are no instances', () => {
    const hook = load();
    hook._renderInstances([]);

    const host = dom.window.document.getElementById('activity-instances')!;
    expect(host.children.length).toBe(0);
  });
});
