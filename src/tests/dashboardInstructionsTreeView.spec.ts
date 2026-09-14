/**
 * #449 — dashboard instructions tree view + master-detail markdown preview.
 *
 * The dashboard client JS is browser IIFE code (no jsdom in this repo), so these
 * are source-inspection assertions in the same style as dashboardV2Phase4.spec.ts.
 * They lock in the tree grouping, default-preview behavior, safe markdown
 * rendering, master-detail layout, and persisted view preferences.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_DIR = path.resolve(__dirname, '..', 'dashboard', 'client');
const instrJs = fs.readFileSync(path.join(CLIENT_DIR, 'js', 'admin.instructions.js'), 'utf8');
const html = fs.readFileSync(path.join(CLIENT_DIR, 'admin.html'), 'utf8');
const css = fs.readFileSync(path.join(CLIENT_DIR, 'css', 'admin.css'), 'utf8');

describe('#449 instructions tree view + preview', () => {
  it('groups instructions into a category tree with counts', () => {
    expect(instrJs).toContain('function buildInstructionTree');
    expect(instrJs).toContain('function instructionCategoryOf');
    // Grouping key prefers primaryCategory, then category, then first categories[].
    expect(instrJs).toMatch(/primaryCategory\s*\|\|\s*instr\.category/);
    expect(instrJs).toContain("'uncategorized'");
    // Each group carries a count.
    expect(instrJs).toMatch(/count:\s*items\.length/);
  });

  it('defaults to the tree view (preview-first) and persists the choice', () => {
    expect(instrJs).toContain('function getInstructionViewMode');
    // Default is 'tree' unless explicitly set to 'flat'.
    expect(instrJs).toMatch(/getItem\(INSTR_VIEW_MODE_KEY\)\s*===\s*'flat'\s*\?\s*'flat'\s*:\s*'tree'/);
    expect(instrJs).toContain("INSTR_VIEW_MODE_KEY = 'instr.viewMode'");
    expect(instrJs).toContain('localStorage.setItem(INSTR_VIEW_MODE_KEY');
    // renderCurrentInstructionView dispatches to the tree renderer.
    expect(instrJs).toMatch(/getInstructionViewMode\(\)\s*===\s*'tree'/);
    expect(instrJs).toContain('renderInstructionTree(globals.allInstructions');
  });

  it('renders a master-detail layout with a collapsible tree and a preview pane', () => {
    expect(instrJs).toContain('function renderInstructionTree');
    expect(instrJs).toContain('instr-master-detail');
    expect(instrJs).toContain('data-tree-toggle');
    expect(instrJs).toContain('data-tree-leaf');
    expect(instrJs).toContain('instruction-detail-body');
    // Collapse state persists per category.
    expect(instrJs).toContain('function getExpandedCategories');
    expect(instrJs).toContain("INSTR_EXPANDED_KEY = 'instr.expandedCats'");
  });

  it('selecting a tree node loads a sanitized markdown preview with a raw toggle', () => {
    expect(instrJs).toContain('async function selectInstructionPreview');
    // Master-detail preview reuses the sanitize pipeline (no raw innerHTML of markdown).
    expect(instrJs).toContain('replaceWithSanitizedHtml(bodyEl, marked.parse(body');
    expect(instrJs).not.toContain('bodyEl.innerHTML = marked.parse');
    // Raw JSON toggle via textContent (never innerHTML).
    expect(instrJs).toContain("INSTR_PREVIEW_RAW_KEY = 'instr.previewRaw'");
    expect(instrJs).toMatch(/pre\.textContent\s*=\s*JSON\.stringify\(content/);
  });

  // The detail pane must always open in rendered-markdown "Preview" mode; a raw
  // preference persisted from an earlier visit used to make it open as JSON.
  it('always opens the detail pane in preview mode (raw is in-session only)', () => {
    expect(instrJs).toMatch(/let instructionDetailRaw = false/);
    expect(instrJs).toContain('function getInstructionDetailRaw');
    expect(instrJs).toContain('function setInstructionDetailRaw');
    expect(instrJs).toContain('const raw = getInstructionDetailRaw();');
    // Legacy persisted preference is cleared and never read back.
    expect(instrJs).toContain('localStorage.removeItem(INSTR_PREVIEW_RAW_KEY)');
    expect(instrJs).not.toContain('localStorage.getItem(INSTR_PREVIEW_RAW_KEY)');
    expect(instrJs).not.toContain('localStorage.setItem(INSTR_PREVIEW_RAW_KEY');
  });

  it('offers a copy button that copies the instruction body to the clipboard', () => {
    expect(instrJs).toContain('id="instruction-detail-copy-btn"');
    expect(instrJs).toContain('async function copySelectedInstructionBody');
    expect(instrJs).toContain('async function writeClipboardText');
    expect(instrJs).toContain('navigator.clipboard.writeText(text)');
    // Copies the markdown body, not the JSON envelope.
    expect(instrJs).toMatch(/globals\.instructionPreviewBody = body;/);
    expect(instrJs).toContain('copySelectedInstructionBody,');
  });

  it('filtering auto-expands so matches stay visible (search works in tree view)', () => {
    expect(instrJs).toContain('const forceExpand = nameFilter.length > 0');
    // Tree view uses the same getFilteredInstructions pipeline as the flat list.
    expect(instrJs).toContain('getFilteredInstructions(instructions');
  });

  it('exposes the view toggle in the toolbar and the functions on window', () => {
    expect(html).toContain('id="instruction-mode-tree"');
    expect(html).toContain('id="instruction-mode-flat"');
    expect(html).toContain("setInstructionViewMode('tree')");
    expect(html).toContain("setInstructionViewMode('flat')");
    expect(instrJs).toContain('setInstructionViewMode');
    expect(instrJs).toContain('buildInstructionTree');
    expect(instrJs).toContain('selectInstructionPreview');
  });

  it('ships master-detail + tree styles', () => {
    expect(css).toContain('.instr-master-detail');
    expect(css).toContain('.instr-tree-leaf');
    expect(css).toContain('.instr-detail-body');
    // Responsive collapse to a single column on narrow screens.
    expect(css).toMatch(/@media[^{]+\{[^}]*\.instr-master-detail\s*\{\s*grid-template-columns:\s*1fr/);
  });

  // #481 — the 30s background auto-refresh (admin.boot.js startAutoRefresh ->
  // refreshInstructionsIfVisible -> loadInstructions({silent, preservePage}))
  // used to always fully re-render the tree, resetting scroll position and
  // interrupting the user every ~30s even when nothing had changed.
  it('skips re-rendering on a silent/preservePage refresh when the instruction list is unchanged (#481)', () => {
    expect(instrJs).toContain('function instructionsSnapshotKey');
    expect(instrJs).toMatch(/const unchanged = silent && preservePage/);
    expect(instrJs).toMatch(/instructionsSnapshotKey\(globals\.allInstructions\) === instructionsSnapshotKey\(nextInstructions\)/);
    expect(instrJs).toMatch(/if \(!unchanged\) \{\s*\n\s*globals\.instructionPage = preservePage \? requestedPage : 1;\s*\n\s*renderCurrentInstructionView\(\);/);
  });

  it('preserves the tree pane scroll position across a re-render (#481)', () => {
    expect(instrJs).toMatch(/const prevTreeEl = document\.getElementById\('instruction-tree'\);/);
    expect(instrJs).toMatch(/const preservedTreeScroll = prevTreeEl \? prevTreeEl\.scrollTop : 0;/);
    expect(instrJs).toMatch(/const newTreeEl = document\.getElementById\('instruction-tree'\);\s*\n\s*if \(newTreeEl && preservedTreeScroll\) newTreeEl\.scrollTop = preservedTreeScroll;/);
  });
});
