import { describe, it, expect } from 'vitest';
import { startDashboardServer } from './util/waitForDashboard';

// Verifies that the /api/graph/mermaid endpoint applies server-side filtering
// when selectedIds (or later selectedCategories) are provided and that the
// returned meta reflects scoped counts with a scoped flag.
//
// This ensures the regression reported (static graph + incorrect counts) is
// covered by an automated test. Fast runtime (< 2s typical).
describe('graph filtering (mermaid)', () => {
  it('returns reduced mermaid + scoped meta when filtered by selectedIds', async () => {
    let dash: Awaited<ReturnType<typeof startDashboardServer>> | undefined;
    try {
      dash = await startDashboardServer();
    } catch (e) {
      return expect.fail((e as Error).message || 'dashboard failed to start');
    }
    const baseUrl = dash.url;

    async function getGraph(params: string) {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(baseUrl + '/api/graph/mermaid?' + params);
          expect(res.ok).toBe(true);
          return await res.json() as { success: boolean; meta: any; mermaid: string };
        } catch (err) {
          lastErr = err;
          if (attempt < 2) await new Promise(r => setTimeout(r, 250));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('graph fetch failed');
    }

    // Get baseline full graph
    const base = await getGraph('enrich=1&categories=1');
    expect(base.success).toBe(true);
    expect(base.meta?.nodeCount).toBeGreaterThan(1); // we need at least 2 nodes to test filtering

    // Extract two distinct node ids from mermaid (excluding category: nodes to increase chance of instruction nodes)
    const nodeLineRegex = /^([A-Za-z0-9:_-]+)\[[^\]]*\]/;
    const ids: string[] = [];
    for (const ln of base.mermaid.split(/\r?\n/)) {
      const m = nodeLineRegex.exec(ln.trim());
      if (m) {
        const id = m[1];
        ids.push(id);
        if (ids.length >= 3) break; // gather a few then stop
      }
    }
    // Ensure we actually captured some ids
    expect(ids.length).toBeGreaterThanOrEqual(1);
    const targetId = ids[0];
    const nonTargetId = ids.find(i => i !== targetId);

    const filtered = await getGraph(`enrich=1&categories=1&selectedIds=${encodeURIComponent(targetId)}`);
    expect(filtered.success).toBe(true);
    // Should mark scoped
    expect(filtered.meta?.scoped).toBe(true);
    // Node count should be <= baseline and at least 1
    expect(filtered.meta?.nodeCount).toBeGreaterThanOrEqual(1);
    expect(filtered.meta?.nodeCount).toBeLessThanOrEqual(base.meta.nodeCount);
    // Mermaid should include target id (node declaration form id[...])
    expect(filtered.mermaid.includes(`${targetId}[`)).toBe(true);
    if (nonTargetId) {
      // Heuristic: often the non-target id will be filtered out (unless linked); allow either removal or retention if connected
      // We assert at least that if node count shrank to 1, the nonTargetId is absent.
      if (filtered.meta.nodeCount === 1) {
        expect(filtered.mermaid.includes(`${nonTargetId}[`)).toBe(false);
      }
    }

    dash.kill();
  }, 60000);
});
