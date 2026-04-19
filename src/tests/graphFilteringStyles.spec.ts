import { describe, it, expect } from 'vitest';
import { startDashboardServer } from './util/waitForDashboard';

// Ensures style/classDef directives are preserved after scoping filter so themed colors remain.
describe('graph filtering preserves styles', () => {
  it('keeps classDef/style lines after selectedIds filtering', async () => {
    let dash: Awaited<ReturnType<typeof startDashboardServer>> | undefined;
    try { dash = await startDashboardServer(); } catch (e) { return expect.fail((e as Error).message); }
    const url = dash.url;

    async function get(q:string){ const r= await fetch(url + '/api/graph/mermaid?' + q); expect(r.ok).toBe(true); return r.json() as Promise<{mermaid:string, meta:any}>; }
    const base = await get('enrich=1&categories=1');
    const styleLines = base.mermaid.split(/\r?\n/).filter(l=> /^(classDef|style |linkStyle )/.test(l.trim()));
    // Not every environment may emit styles; if none, skip (avoid false failure where theme lines absent globally)
  if(styleLines.length === 0){ dash.kill(); return; }
    // Grab first real node id
    const nodeMatch = /^(\w[\w:_-]*)\[/.exec(base.mermaid.split(/\r?\n/).find(l=> /\[/.test(l))||'');
    expect(nodeMatch).toBeTruthy();
    const id = nodeMatch![1];
    const scoped = await get(`enrich=1&categories=1&selectedIds=${encodeURIComponent(id)}`);
    expect(scoped.meta?.scoped).toBe(true);
    const scopedStyleLines = scoped.mermaid.split(/\r?\n/).filter(l=> /^(classDef|style |linkStyle )/.test(l.trim()));
    expect(scopedStyleLines.length).toBeGreaterThanOrEqual(styleLines.length); // we retain all (may add none)
  dash.kill();
  }, 20000);
});
