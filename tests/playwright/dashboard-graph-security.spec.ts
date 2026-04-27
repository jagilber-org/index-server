import path from 'node:path';
import { test, expect } from '@playwright/test';

test('admin.graph.js strips script, event handlers, unsafe URLs, and foreignObject nodes from Mermaid SVG output', async ({
  page,
}) => {
  await page.setContent(`
    <div id="graph-section"></div>
    <div id="graph-render-card"></div>
    <div id="graph-mermaid-rendered"></div>
    <div id="graph-mermaid-svg"></div>
    <pre id="graph-mermaid"></pre>
    <div id="graph-meta"></div>
    <select id="drill-categories" multiple></select>
    <select id="drill-instructions" multiple></select>
    <input id="graph-enrich" type="checkbox" checked />
    <input id="graph-categories" type="checkbox" checked />
    <input id="graph-usage" type="checkbox" />
    <input id="graph-edgeTypes" value="" />
    <select id="graph-layout"><option value="elk" selected>elk</option></select>
  `);

  await page.evaluate(() => {
    const api = window as unknown as Record<string, unknown>;
    api.adminAuth = {
      adminFetch: async () => ({
        ok: true,
        async json() {
          return {
            success: true,
            mermaid: 'graph TD\n  A[Safe] --> B[Still safe]',
            meta: { graphSchemaVersion: 1, nodeCount: 2, edgeCount: 1 },
          };
        },
      }),
    };
    api.mermaid = {
      initialize() {},
      registerLayoutLoaders() {},
      async parse() {
        return true;
      },
      async render() {
        return { svg: '' };
      },
    };
    api.__MERMAID_LARGE_GRAPH_FLAG = false;
  });

  await page.addScriptTag({
    path: path.join(process.cwd(), 'src', 'dashboard', 'client', 'js', 'admin.graph.js'),
  });

  const sanitized = await page.evaluate(async () => {
    const maliciousSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="window.__svgRootExecuted = true">
        <script>window.__svgScriptExecuted = true</script>
        <foreignObject width="40" height="20">
          <div xmlns="http://www.w3.org/1999/xhtml" onclick="window.__svgForeignExecuted = true">blocked</div>
        </foreignObject>
        <a href="javascript:window.__svgHrefExecuted = true" xlink:href="javascript:window.__svgHrefExecuted = true">
          <text onclick="window.__svgClickExecuted = true" style="fill:#000; background:url(javascript:window.__svgStyleExecuted = true)">Unsafe link</text>
        </a>
        <g>
          <text onmouseover="window.__svgHoverExecuted = true">Safe label</text>
        </g>
      </svg>
    `;

    (
      window as unknown as {
        mermaid: { render: () => Promise<{ svg: string }> };
        reloadGraphMermaid: () => Promise<void>;
      }
    ).mermaid.render = async () => ({ svg: maliciousSvg });

    await (window as unknown as { reloadGraphMermaid: () => Promise<void> }).reloadGraphMermaid();

    const host = document.getElementById('graph-mermaid-svg');
    const svg = host?.querySelector('svg');
    const nodes = svg ? [svg, ...Array.from(svg.querySelectorAll('*'))] : [];
    const hrefs = nodes
      .map((node) => node.getAttribute('href') || node.getAttributeNS('http://www.w3.org/1999/xlink', 'href'))
      .filter(Boolean);
    const styles = nodes.map((node) => node.getAttribute('style')).filter(Boolean);

    return {
      hasSvg: !!svg,
      scriptCount: host?.querySelectorAll('script').length ?? 0,
      foreignObjectCount: host?.querySelectorAll('foreignObject').length ?? 0,
      inlineHandlerNames: nodes.flatMap((node) => node.getAttributeNames().filter((name) => name.startsWith('on'))),
      unsafeHrefs: hrefs.filter((value) => /\b(?:javascript|vbscript|data)\s*:/i.test(String(value))),
      unsafeStyles: styles.filter((value) => /\b(?:javascript|vbscript|data)\s*:|url\(/i.test(String(value))),
      textContent: svg?.textContent || '',
    };
  });

  expect(sanitized.hasSvg).toBe(true);
  expect(sanitized.scriptCount).toBe(0);
  expect(sanitized.foreignObjectCount).toBe(0);
  expect(sanitized.inlineHandlerNames).toHaveLength(0);
  expect(sanitized.unsafeHrefs).toHaveLength(0);
  expect(sanitized.unsafeStyles).toHaveLength(0);
  expect(sanitized.textContent).toContain('Safe label');
});
