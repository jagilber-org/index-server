/**
 * Dashboard V2 Phase 4.1 — SVG Drilldown Removal RED Tests
 *
 * These tests define the DESIRED end state after drilldown code removal.
 * They should currently FAIL (RED) because the drilldown file, script tags,
 * HTML sections, CSS rules, and wrapper functions still exist.
 *
 * After removal the tests will pass (GREEN).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Resolve a path relative to the project root (two levels above src/tests/) */
const projectRoot = path.resolve(__dirname, '..', '..');

const clientDir = path.resolve(projectRoot, 'src', 'dashboard', 'client');
const adminHtml = fs.readFileSync(path.resolve(clientDir, 'admin.html'), 'utf-8');
const adminCss = fs.readFileSync(path.resolve(clientDir, 'css', 'admin.css'), 'utf-8');
const graphJs = fs.readFileSync(path.resolve(clientDir, 'js', 'admin.graph.js'), 'utf-8');

describe('Dashboard V2 Phase 4.1 — SVG drilldown removal', () => {
  // ── 1. admin.drilldown.js file does NOT exist ──────────────────────

  it('admin.drilldown.js file does not exist', () => {
    const drilldownPath = path.resolve(clientDir, 'js', 'admin.drilldown.js');
    expect(
      fs.existsSync(drilldownPath),
      'admin.drilldown.js should have been removed',
    ).toBe(false);
  });

  // ── 2. admin.html does NOT reference admin.drilldown.js script ─────

  it('admin.html does not contain admin.drilldown.js script tag', () => {
    expect(adminHtml).not.toContain('admin.drilldown.js');
  });

  // ── 3. admin.html does NOT contain the drilldown experimental section

  it('admin.html does not contain "Layered Drilldown SVG (Experimental)" section', () => {
    expect(adminHtml).not.toContain('Layered Drilldown SVG (Experimental)');
  });

  // ── 4. admin.html does NOT contain drill-svg-wrapper or drill-svg ids

  it('admin.html does not contain drill-svg-wrapper element', () => {
    expect(adminHtml).not.toMatch(/id=["']drill-svg-wrapper["']/);
  });

  it('admin.html does not contain drill-svg element', () => {
    expect(adminHtml).not.toMatch(/id=["']drill-svg["']/);
  });

  // ── 5. admin.graph.js has its own refreshDrillCategories (not a wrapper)

  it('admin.graph.js contains a real refreshDrillCategories implementation, not a delegation wrapper', () => {
    // The function must exist in graph.js
    expect(graphJs).toContain('refreshDrillCategories');

    // It must NOT simply delegate to window.refreshDrillCategories
    // A wrapper pattern looks like: window.refreshDrillCategories(...)
    const fnMatch = graphJs.match(
      /function\s+refreshDrillCategories\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/,
    );
    // If the function exists, its body must not just call window.refreshDrillCategories
    if (fnMatch) {
      const body = fnMatch[1];
      expect(
        body,
        'refreshDrillCategories should not simply delegate to window.refreshDrillCategories',
      ).not.toMatch(/window\.refreshDrillCategories\s*\(/);
    }
    // If no named function exists, check it's not just an alias assignment
    expect(graphJs).not.toMatch(
      /refreshDrillCategories\s*=\s*window\.refreshDrillCategories/,
    );
  });

  // ── 6. admin.css does NOT contain drilldown-specific styles ────────

  it('admin.css does not contain .drill-toolbar styles', () => {
    expect(adminCss).not.toContain('.drill-toolbar');
  });

  it('admin.css does not contain .drill-svg-wrapper styles', () => {
    expect(adminCss).not.toContain('.drill-svg-wrapper');
  });

  it('admin.css does not contain #drill-legend styles', () => {
    expect(adminCss).not.toContain('#drill-legend');
  });

  // ── 7. No duplicate class="" attributes in admin.html ──────────────

  it('admin.html has no duplicate class="" attributes on any element', () => {
    // Match patterns like class="..." class="..." on the same tag
    const duplicateClassPattern = /class=["'][^"']*["']\s+class=["'][^"']*["']/g;
    const matches = adminHtml.match(duplicateClassPattern);
    expect(
      matches,
      `Found duplicate class="" attributes: ${JSON.stringify(matches)}`,
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 4.2 — Graph Tab Redesign (RED tests — must fail until redesign)
// ═══════════════════════════════════════════════════════════════════════

describe('Dashboard V2 Phase 4.2 — Graph tab redesign', () => {
  // ── 1. Diagram-first layout ────────────────────────────────────────

  it('rendered diagram card appears BEFORE source wrapper in HTML', () => {
    const renderCardPos = adminHtml.indexOf('id="graph-render-card"');
    const sourceWrapperPos = adminHtml.indexOf('id="graph-mermaid-wrapper"');
    expect(renderCardPos).toBeGreaterThan(-1);
    expect(sourceWrapperPos).toBeGreaterThan(-1);
    expect(
      renderCardPos,
      'graph-render-card should appear before graph-mermaid-wrapper (diagram-first layout)',
    ).toBeLessThan(sourceWrapperPos);
  });

  // ── 2. Collapsible advanced options ────────────────────────────────

  it('advanced controls are wrapped in a <details> element with id="graph-advanced-options"', () => {
    expect(adminHtml).toMatch(/<details[^>]*id=["']graph-advanced-options["']/);
    // The advanced controls (enrich, categories, usage checkboxes) should be inside it
    const detailsMatch = adminHtml.match(
      /<details[^>]*id=["']graph-advanced-options["'][\s\S]*?<\/details>/,
    );
    expect(detailsMatch, 'graph-advanced-options <details> must exist').not.toBeNull();
    expect(detailsMatch![0]).toContain('graph-enrich');
    expect(detailsMatch![0]).toContain('graph-categories');
    expect(detailsMatch![0]).toContain('graph-usage');
  });

  // ── 3. Collapsible source section ──────────────────────────────────

  it('source section is wrapped in a <details> element with id="graph-source-details"', () => {
    expect(adminHtml).toMatch(/<details[^>]*id=["']graph-source-details["']/);
    const detailsMatch = adminHtml.match(
      /<details[^>]*id=["']graph-source-details["'][\s\S]*?<\/details>/,
    );
    expect(detailsMatch, 'graph-source-details <details> must exist').not.toBeNull();
    expect(detailsMatch![0]).toContain('graph-mermaid-wrapper');
  });

  // ── 4. Loading skeleton ────────────────────────────────────────────

  it('rendered diagram area contains a loading skeleton element', () => {
    expect(
      adminHtml,
      'graph-loading-skeleton class should exist inside the rendered diagram area',
    ).toMatch(/class=["'][^"']*graph-loading-skeleton[^"']*["']/);
    // It should be inside the render card
    const renderCard = adminHtml.match(
      /id=["']graph-render-card["'][\s\S]*?<\/div>\s*<\/div>/,
    );
    expect(renderCard).not.toBeNull();
    expect(renderCard![0]).toContain('graph-loading-skeleton');
  });

  // ── 5. Primary toolbar simplified ──────────────────────────────────

  it('main toolbar direct children do not include flags/checkboxes at primary positions', () => {
    // The flags div (containing enrich/categories/usage checkboxes) should NOT
    // be a direct child of the graph toolbar with order-0..order-2 classes.
    // Currently the flags div has order-3 in the main toolbar; after redesign
    // it moves into the advanced options <details>.
    const graphToolbar = adminHtml.match(
      /id=["']graph-toolbar["'][\s\S]*?<\/div>\s*(?=<div\s+id=["']graph-meta["'])/,
    );
    expect(graphToolbar, 'graph-toolbar section must exist').not.toBeNull();
    const toolbarContent = graphToolbar![0];

    // After redesign: the flags div should NOT be in the main toolbar at all
    expect(
      toolbarContent,
      'Enrich/Categories/Usage checkboxes should be in advanced options, not main toolbar',
    ).not.toContain('id="graph-enrich"');
    expect(toolbarContent).not.toContain('id="graph-categories"');
    expect(toolbarContent).not.toContain('id="graph-usage"');
  });

  // ── 6. Source section has action buttons ────────────────────────────

  it('copy and edit buttons are inside the source details section, not the main toolbar', () => {
    // After redesign: copy/edit buttons move near the source <pre>
    const sourceSection = adminHtml.match(
      /id=["']graph-source-details["'][\s\S]*?<\/details>/,
    );
    expect(sourceSection, 'graph-source-details must exist').not.toBeNull();
    expect(sourceSection![0]).toContain('graph-copy-btn');
    expect(sourceSection![0]).toContain('graph-edit-btn');

    // And they should NOT be in the main toolbar anymore
    const graphToolbar = adminHtml.match(
      /id=["']graph-toolbar["'][\s\S]*?<\/div>\s*(?=<div\s+id=["']graph-meta["'])/,
    );
    expect(graphToolbar).not.toBeNull();
    expect(
      graphToolbar![0],
      'Copy button should not be in main toolbar after redesign',
    ).not.toContain('graph-copy-btn');
    expect(
      graphToolbar![0],
      'Edit button should not be in main toolbar after redesign',
    ).not.toContain('graph-edit-btn');
  });

  // ── 7. Auto-load wiring ────────────────────────────────────────────

  it('admin.graph.js contains an observer or hook to auto-load when graph section becomes visible', () => {
    // After redesign: graph.js should use IntersectionObserver, MutationObserver,
    // or a showSection hook to trigger auto-load when the graph tab is shown.
    const hasIntersectionObserver = graphJs.includes('IntersectionObserver');
    const hasMutationObserver = graphJs.includes('MutationObserver');
    const hasShowSectionHook = /addEventListener\s*\([^)]*['"]graph-section['"]/.test(graphJs);
    const hasSectionVisibilityHook = /showSection.*graph|graph.*showSection|onSectionVisible/.test(graphJs);

    expect(
      hasIntersectionObserver || hasMutationObserver || hasShowSectionHook || hasSectionVisibilityHook,
      'admin.graph.js should contain an observer or visibility hook for auto-loading the graph tab',
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Phase 4.3 — Zoom Controls and Fullscreen Mode (RED tests — must fail)
// ═══════════════════════════════════════════════════════════════════════

describe('Dashboard V2 Phase 4.3 — Zoom controls and fullscreen', () => {
  // ── 1. Zoom controls container exists ──────────────────────────────

  it('graph-render-card contains a div with class graph-zoom-controls', () => {
    const renderCard = adminHtml.match(
      /id=["']graph-render-card["'][\s\S]*?<\/div>\s*<\/div>/,
    );
    expect(renderCard, 'graph-render-card must exist').not.toBeNull();
    expect(
      renderCard![0],
      'graph-render-card should contain a .graph-zoom-controls element',
    ).toContain('graph-zoom-controls');
  });

  // ── 2. Zoom in button ─────────────────────────────────────────────

  it('zoom controls contain a graph-zoom-in button', () => {
    expect(
      adminHtml,
      'graph-zoom-in element should exist in the HTML',
    ).toMatch(/id=["']graph-zoom-in["']/);
  });

  // ── 3. Zoom out button ────────────────────────────────────────────

  it('zoom controls contain a graph-zoom-out button', () => {
    expect(
      adminHtml,
      'graph-zoom-out element should exist in the HTML',
    ).toMatch(/id=["']graph-zoom-out["']/);
  });

  // ── 4. Zoom reset button ──────────────────────────────────────────

  it('zoom controls contain a graph-zoom-reset button', () => {
    expect(
      adminHtml,
      'graph-zoom-reset element should exist in the HTML',
    ).toMatch(/id=["']graph-zoom-reset["']/);
  });

  // ── 5. Fullscreen button ──────────────────────────────────────────

  it('graph-render-card contains a graph-fullscreen-btn button', () => {
    const renderCard = adminHtml.match(
      /id=["']graph-render-card["'][\s\S]*?<\/div>\s*<\/div>/,
    );
    expect(renderCard, 'graph-render-card must exist').not.toBeNull();
    expect(
      renderCard![0],
      'graph-render-card should contain a graph-fullscreen-btn element',
    ).toContain('graph-fullscreen-btn');
  });

  // ── 6. Zoom CSS styles ────────────────────────────────────────────

  it('admin.css contains .graph-zoom-controls styles', () => {
    expect(
      adminCss,
      'admin.css should define .graph-zoom-controls styles',
    ).toContain('.graph-zoom-controls');
  });

  // ── 7. Fullscreen CSS styles ──────────────────────────────────────

  it('admin.css contains .graph-fullscreen styles for fullscreen mode', () => {
    expect(
      adminCss,
      'admin.css should define .graph-fullscreen styles',
    ).toContain('.graph-fullscreen');
  });

  // ── 8. Zoom JS implementation ────────────────────────────────────

  it('admin.graph.js contains zoom-related code', () => {
    const hasZoomLevel = graphJs.includes('zoomLevel');
    const hasZoomInId = graphJs.includes('graph-zoom-in');
    const hasGraphZoomIn = graphJs.includes('graphZoomIn');

    expect(
      hasZoomLevel || hasZoomInId || hasGraphZoomIn,
      'admin.graph.js should contain zoom implementation (zoomLevel, graph-zoom-in, or graphZoomIn)',
    ).toBe(true);
  });

  // ── 9. Mousewheel zoom ────────────────────────────────────────────

  it('admin.graph.js contains a wheel event listener for zoom', () => {
    expect(
      graphJs,
      'admin.graph.js should bind a wheel event for mousewheel zoom',
    ).toContain('wheel');
  });
});
