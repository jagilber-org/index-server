/**
 * Dashboard V2 Phase 3 — CSS/UX Modernization Tests
 *
 * These tests cover the Phase 3 dashboard modernization surface:
 *   1. All colors use CSS custom properties (--mcp-* tokens)
 *   2. Inline style="" attributes are minimized in admin.html
 *   3. Graph section buttons use CSS classes, not inline gradients
 *   4. Spacing tokens are defined as --mcp-space-* variables
 *
 * Where the full migration is still unfinished, these tests lock down the
 * current approved exception budget so new debt cannot be introduced
 * silently.
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
function hexColoursOutsideRoot(css: string): string[] {
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

function hexDeclarationLinesOutsideRoot(css: string): string[] {
  const rootBlock = extractRootBlock(css);
  const cssWithoutRoot = css.replace(`:root {${rootBlock}}`, '');
  const noComments = cssWithoutRoot.replace(/\/\*[\s\S]*?\*\//g, '');
  return noComments
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => /#[0-9a-fA-F]{3,8}\b/.test(line))
    .filter((line) => !/\[[^\]]*#[0-9a-fA-F]{3,8}\b/.test(line));
}

function normalizeInlineStyle(styleValue: string): string {
  return styleValue
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(';');
}

function countBy(values: string[]): Record<string, number> {
  return Object.fromEntries(
    values
      .reduce<Map<string, number>>((counts, value) => {
        counts.set(value, (counts.get(value) ?? 0) + 1);
        return counts;
      }, new Map())
      .entries(),
  );
}

function inlineStyleValues(html: string): string[] {
  return Array.from(html.matchAll(/style\s*=\s*"([^"]*)"/g), (match) =>
    normalizeInlineStyle(match[1] ?? ''),
  );
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

  it('admin.css confines remaining hardcoded hex colors outside :root to the known migration hot spots', () => {
    loadFiles();

    const hexLines = hexDeclarationLinesOutsideRoot(css);
    expect(hexLines).toEqual([
      '.search-highlight { background: rgba(255, 213, 79, 0.35); color: #ffd54f; border-radius: 2px; padding: 0 1px; }',
      '.cfg-stab-diagnostic { color: #3b82f6; font-size: 11px; }',
      '.cfg-stab-experimental { color: #8b5cf6; font-size: 11px; }',
      '.cfg-stab-deprecated { color: #ff9830; font-size: 11px; }',
      '.cfg-stab-reserved { color: #6b7280; font-size: 11px; font-style: italic; }',
      '.instr-view-toggle .btn-active { background: var(--admin-accent, #3b82f6); color: #fff; }',
      '.archive-badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; background: #2c3038; color: #d0d6de; border: 1px solid #404756; margin-right: 4px; }',
      '.archive-badge.locked { background: #4a1f1f; color: #f2495c; border-color: #6a2c2c; }',
      '.instr-preview-content code { background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 3px; font-family: var(--mcp-font-mono); font-size: 0.9em; color: #e8ab6a; }',
      '.instr-preview-content strong { color: #fff; }',
      '.btn-green { background: rgba(115,191,105,0.15); color: #73bf69; border-color: #73bf6944; }',
      'color: #fff;',
      'background: var(--admin-accent); color: #fff; font-size: 11px;',
      'color: #fff; z-index: 1; position: relative;',
    ]);

    expect(countBy(hexColoursOutsideRoot(css))).toEqual({
      '#2c3038': 1,
      '#3b82f6': 2,
      '#404756': 1,
      '#4a1f1f': 1,
      '#6a2c2c': 1,
      '#6b7280': 1,
      '#73bf69': 1,
      '#73bf6944': 1,
      '#8b5cf6': 1,
      '#d0d6de': 1,
      '#e8ab6a': 1,
      '#f2495c': 1,
      '#ff9830': 1,
      '#ffd54f': 1,
      '#fff': 5,
    });
  });

  // ── 3. Inline styles minimized in admin.html ────────────────────────

  it('admin.html confines inline styles to the current approved migration budget', () => {
    loadFiles();

    const inlineStyles = inlineStyleValues(html);
    expect(inlineStyles).toHaveLength(38);
    expect(countBy(inlineStyles)).toEqual({
      'accent-color:var(--admin-accent)': 1,
      'background:#7f1d1d;border-color:#ef4444': 1,
      'color:var(--admin-text-dim)': 1,
      'display:flex;align-items:center;gap:4px;font-size:12px;color:var(--admin-text-dim);cursor:pointer;white-space:nowrap': 1,
      'display:flex;gap:8px;flex-wrap:wrap;padding:8px 0': 3,
      'display:flex;gap:8px;margin-top:8px;align-items:center': 1,
      'display:none': 7,
      'display:none;margin-left:8px;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.5px': 1,
      'font-size:12px': 1,
      'font-size:12px;color:var(--admin-text-dim)': 1,
      'font-size:13px;color:var(--admin-text-dim,#94a3b8)': 1,
      'font-weight:400;font-size:12px;color:var(--admin-text-dim)': 1,
      'font-weight:600;font-size:13px;color:var(--admin-text,#e2e8f0);margin-bottom:6px': 1,
      'margin-top:12px': 2,
      'margin-top:16px': 2,
      'margin-top:8px': 2,
      'margin-top:8px;font-size:13px': 3,
      'margin-top:8px;overflow-x:auto': 1,
      'max-width:140px': 1,
      'padding:0 12px 8px;font-size:14px;font-weight:600;color:var(--admin-text)': 1,
      'padding:0;overflow:hidden': 1,
      'padding:8px 0': 1,
      'padding:8px 0;font-size:12px;opacity:.7': 1,
      'width:100%;font-family:monospace;font-size:13px;resize:vertical': 1,
      'width:100%;resize:vertical': 1,
    });
  });

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
      const valueRe = new RegExp(`${name.replace(/[-/]/g, '\\$&')}\\s*:\\s*${expectedValue.replace(/[()]/g, '\\$&')}`); // lgtm[js/incomplete-sanitization] — regex special char escaping in test
      expect(rootBlock).toMatch(valueRe);
    }
  });
});
