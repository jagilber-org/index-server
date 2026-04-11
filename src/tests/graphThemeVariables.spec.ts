import { describe, it, expect } from 'vitest';
import { startDashboardServer } from './util/waitForDashboard';

describe('graph frontmatter themeVariables', () => {
  it('injects single themeVariables block and preserves after filtering', async () => {
  let dash: Awaited<ReturnType<typeof startDashboardServer>> | undefined;
  try { dash = await startDashboardServer(); } catch(e){ return expect.fail((e as Error).message); }
  const url = dash.url;
  async function get(q:string){ const r = await fetch(url + '/api/graph/mermaid?' + q); expect(r.ok).toBe(true); return r.json() as Promise<{mermaid:string, meta:any}>; }
    const base = await get('enrich=1&categories=1');
    const trimmed = base.mermaid.replace(/^\uFEFF?/, '');
  // Allow optional leading whitespace/BOM before frontmatter; assert structured frontmatter exists
  expect(/^-{3}\nconfig:\n\s+theme:/m.test(trimmed)).toBe(true);
    const themeVarsCountBase = (base.mermaid.match(/\bthemeVariables:/g)||[]).length;
    expect(themeVarsCountBase).toBe(1);
    // pick first node id
    const nodeId = (base.mermaid.match(/^([A-Za-z0-9:_-]+)\[/m)||[])[1];
    expect(nodeId).toBeTruthy();
    const scoped = await get(`enrich=1&categories=1&selectedIds=${encodeURIComponent(nodeId!)}`);
    expect(scoped.meta?.scoped).toBe(true);
    const themeVarsCountScoped = (scoped.mermaid.match(/\bthemeVariables:/g)||[]).length;
    expect(themeVarsCountScoped).toBe(1);
    dash.kill();
  },20000);
});
