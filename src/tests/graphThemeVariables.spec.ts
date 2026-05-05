import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startDashboardServer } from './util/waitForDashboard';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('graph frontmatter themeVariables', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-theme-test-'));
    // Seed two fixture instructions (not on governance denylist)
    const fixture1 = { id: 'test-graph-a', title: 'Graph A', body: 'body', priority: 50, audience: 'all', requirement: 'optional', categories: ['testing', 'graph'] };
    const fixture2 = { id: 'test-graph-b', title: 'Graph B', body: 'body', priority: 50, audience: 'all', requirement: 'optional', categories: ['testing', 'visualization'] };
    fs.writeFileSync(path.join(fixtureDir, 'test-graph-a.json'), JSON.stringify(fixture1));
    fs.writeFileSync(path.join(fixtureDir, 'test-graph-b.json'), JSON.stringify(fixture2));
  });

  afterAll(() => {
    try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('injects single themeVariables block and preserves after filtering', async () => {
  let dash: Awaited<ReturnType<typeof startDashboardServer>> | undefined;
  try { dash = await startDashboardServer({ INDEX_SERVER_DIR: fixtureDir }); } catch(e){ return expect.fail((e as Error).message); }
  const url = dash.url;
  async function get(q:string){ const r = await fetch(url + '/api/graph/mermaid?' + q); expect(r.ok).toBe(true); return r.json() as Promise<{mermaid:string, meta:any}>; }
    const base = await get('enrich=1&categories=1');
    const trimmed = base.mermaid.replace(/^\uFEFF?/, '');
  // Allow optional leading whitespace/BOM before frontmatter; assert structured frontmatter exists
  expect(/^-{3}\nconfig:\n\s+theme:/m.test(trimmed)).toBe(true);
    const themeVarsCountBase = (base.mermaid.match(/\bthemeVariables:/g)||[]).length;
    expect(themeVarsCountBase).toBe(1);
    // pick first node id
    const nodeId = (base.mermaid.match(/^([A-Za-z0-9:._-]+)\[/m)||[])[1];
    expect(nodeId).toBeTruthy();
    const scoped = await get(`enrich=1&categories=1&selectedIds=${encodeURIComponent(nodeId!)}`);
    expect(scoped.meta?.scoped).toBe(true);
    const themeVarsCountScoped = (scoped.mermaid.match(/\bthemeVariables:/g)||[]).length;
    expect(themeVarsCountScoped).toBe(1);
    dash.kill();
  },20000);
});
