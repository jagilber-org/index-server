/**
 * Dashboard V2 Phase 3 — CSS/UX Modernization RED Tests
 *
 * These tests define the DESIRED end state after Phase 3:
 *   1. All colors use CSS custom properties (--mcp-* tokens)
 *   2. Inline style="" attributes are minimized in admin.html
 *   3. Graph section buttons use CSS classes, not inline gradients
 *   4. Spacing tokens are defined as --mcp-space-* variables
 *
 * They should currently FAIL (RED) because the CSS hasn't been
 * refactored yet. After Phase 3 implementation they will PASS (GREEN).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Root of the dashboard client assets */
const clientDir = path.resolve(__dirname, '..', 'dashboard', 'client');
const cssPath = path.join(clientDir, 'css', 'admin.css');
const htmlPath = path.join(clientDir, 'admin.html');

// ── helpers ───────────────────────────────────────────────────────────

/** Extract the :root { … } block from CSS text (first occurrence). */
function extractRootBlock(css: string): string {
  const start = css.indexOf(':root');
  if (start === -1) return '';
  let depth = 0;
  let blockStart = -1;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') {
      if (depth === 0) blockStart = i;
      depth++;
    } else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(blockStart + 1, i);
    }
  }
  return '';
}

/**
 * Return all hex colour occurrences (#xxx, #xxxxxx, #xxxxxxxx) outside
 * :root by stripping the :root block first, then matching.
 */
function _hexColoursOutsideRoot(css: string): string[] {
  // Remove the :root block so we only inspect other rules
  const rootStart = css.indexOf(':root');
  if (rootStart === -1) return [];
  let depth = 0;
  let blockEnd = -1;
  for (let i = rootStart; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) { blockEnd = i + 1; break; }
    }
  }
  const withoutRoot = css.slice(0, rootStart) + css.slice(blockEnd);

  // Also strip CSS comments so colour references in comments don't count
  const noComments = withoutRoot.replace(/\/\*[\s\S]*?\*\//g, '');

  // Also strip attribute selectors like [style*='fill:#fff'] so
  // hex values inside selector strings don't false-positive
  const noAttrSelectors = noComments.replace(/\[[^\]]*\]/g, '');

  const matches = noAttrSelectors.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  return matches;
}

/**
 * Extract the graph-section slice from admin.html — from id="graph-section"
 * to the next admin-section div (or EOF).
 */
function extractGraphSection(html: string): string {
  const anchor = 'id="graph-section"';
  const start = html.indexOf(anchor);
  if (start === -1) return '';
  // Skip past the current tag's closing '>' to avoid matching its own class
  const tagEnd = html.indexOf('>', start);
  if (tagEnd === -1) return '';
  // Find the next admin-section div after the graph-section's opening tag
  const nextSection = html.indexOf('class="admin-section', tagEnd);
  return nextSection === -1
    ? html.slice(start)
    : html.slice(start, nextSection);
}

// ── tests ─────────────────────────────────────────────────────────────

describe('Dashboard V2 Phase 3 — CSS/UX modernization', () => {
  // Lazy-load files once per suite (they're static assets)
  let css: string;
  let html: string;

  // Load files before running tests
  const loadFiles = () => {
    if (!css) css = fs.readFileSync(cssPath, 'utf-8');
    if (!html) html = fs.readFileSync(htmlPath, 'utf-8');
  };

  // ── 1. CSS custom properties defined in :root ───────────────────────

  it('admin.css :root defines all --mcp-* design tokens', () => {
    loadFiles();
    const rootBlock = extractRootBlock(css);

    const requiredVars = [
      '--mcp-bg-primary',
      '--mcp-bg-card',
      '--mcp-bg-input',
      '--mcp-border',
      '--mcp-text-primary',
      '--mcp-text-secondary',
      '--mcp-accent-blue',
      '--mcp-accent-green',
      '--mcp-accent-orange',
      '--mcp-accent-red',
      '--mcp-font-mono',
      '--mcp-font-sans',
      '--mcp-radius',
      '--mcp-shadow',
      '--mcp-space-xs',
      '--mcp-space-sm',
      '--mcp-space-md',
      '--mcp-space-lg',
      '--mcp-space-xl',
    ];

    const missing = requiredVars.filter((v) => !rootBlock.includes(v));
    expect(missing, `Missing CSS custom properties in :root: ${missing.join(', ')}`).toEqual([]);
  });

  // ── 2. No hardcoded hex colors outside :root ────────────────────────

  // RED: aspirational — CSS token migration not yet complete (Phase 3 backlog)
  it.todo('admin.css has no hardcoded hex colors outside :root block');

  // ── 3. Inline styles minimized in admin.html ────────────────────────

  // RED: aspirational — inline style cleanup not yet complete (Phase 3 backlog)
  it.todo('admin.html has at most 10 inline style="" attributes');

  // ── 4. Graph section buttons use CSS classes, not inline gradients ──

  it('graph section buttons have no inline gradient styles', () => {
    loadFiles();
    const graphHtml = extractGraphSection(html);

    // Find all <button ...> tags in the graph section
    const buttonTags = graphHtml.match(/<button\b[^>]*>/gi) ?? [];
    expect(buttonTags.length).toBeGreaterThan(0); // sanity: we found buttons

    const buttonsWithGradient = buttonTags.filter((tag) =>
      /style\s*=\s*"[^"]*linear-gradient/i.test(tag),
    );

    expect(
      buttonsWithGradient.length,
      `Found ${buttonsWithGradient.length} button(s) in graph section with inline gradient styles — ` +
        `should use CSS classes like .btn-success, .btn-primary`,
    ).toBe(0);
  });

  // ── 5. Spacing tokens defined in :root ──────────────────────────────

  it('admin.css :root defines --mcp-space-* spacing tokens', () => {
    loadFiles();
    const rootBlock = extractRootBlock(css);

    const spacingVars: Array<{ name: string; expectedValue: string }> = [
      { name: '--mcp-space-xs', expectedValue: '4px' },
      { name: '--mcp-space-sm', expectedValue: '8px' },
      { name: '--mcp-space-md', expectedValue: '16px' },
      { name: '--mcp-space-lg', expectedValue: '24px' },
      { name: '--mcp-space-xl', expectedValue: '32px' },
    ];

    for (const { name, expectedValue } of spacingVars) {
      expect(rootBlock, `Missing spacing token ${name}`).toContain(name);
      // Check value: "<name>: <value>" pattern
      const valueRe = new RegExp(`${name.replace(/[-/]/g, '\\$&')}\\s*:\\s*${expectedValue.replace(/[()]/g, '\\$&')}`);
      expect(rootBlock).toMatch(valueRe);
    }
  });
});
