/**
 * @vitest-environment jsdom
 *
 * Behavioral coverage for the instructions detail "Copy" path.
 *
 * The pre-existing dashboard specs assert on source text
 * (`expect(instrJs).toContain('async function copySelectedInstructionBody')`),
 * which cannot observe ordering, timer, or cleanup defects. These tests load the
 * REAL `admin.instructions.js` into a DOM and drive the exported entry points, so
 * they exercise production code rather than a reimplementation (TS-10).
 *
 * Covers normal, concurrent, boundary, error, and cleanup scenarios (TS-12).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_JS = path.resolve(__dirname, '..', 'dashboard', 'client', 'js', 'admin.instructions.js');
const source = fs.readFileSync(CLIENT_JS, 'utf8');

interface Deferred<T> { promise: Promise<T>; resolve: (v: T) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

/** Build a Response-like object matching what adminFetch yields. */
function bodyResponse(body: string) {
  return { ok: true, status: 200, json: async () => ({ content: { body } }) };
}

type W = Window & typeof globalThis & Record<string, any>;

/** Fetch calls captured per instruction name so tests can control resolution order. */
let pending: Map<string, Deferred<unknown>>;
let clipboardWrites: string[];
let errors: string[];

function loadModule(): W {
  const w = window as unknown as W;
  document.body.innerHTML = `
    <div id="instruction-tree"></div>
    <div id="instruction-detail-title"></div>
    <div id="instruction-detail-body"></div>
    <button id="instruction-detail-preview-btn"></button>
    <button id="instruction-detail-raw-btn"></button>
    <button id="instruction-detail-copy-btn">📋 Copy</button>
    <button id="instruction-detail-edit-btn"></button>
    <div id="instructions-list"></div>`;

  w.adminUtils = { escapeHtml: (s: string) => String(s ?? '') };
  w.showError = (m: string) => { errors.push(m); };
  w.showSuccess = () => {};
  w.allInstructions = [];
  w.adminAuth = {
    adminFetch: (url: string) => {
      const name = decodeURIComponent(String(url).split('/api/instructions/')[1] || '');
      const d = deferred<unknown>();
      pending.set(name, d);
      return d.promise;
    },
  };
  Object.defineProperty(w.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (t: string) => { clipboardWrites.push(t); } },
  });

  // Evaluate the real production IIFE against this DOM.
  w.eval(source);
  return w;
}

/** Resolve a captured fetch for `name` with `body`, then flush microtasks. */
async function settle(name: string, body: string) {
  const d = pending.get(name);
  if (!d) throw new Error(`no pending fetch for ${name}`);
  d.resolve(bodyResponse(body));
  await d.promise;
  await Promise.resolve();
  await Promise.resolve();
}

describe('instructions detail copy path (behavioral)', () => {
  beforeEach(() => {
    pending = new Map();
    clipboardWrites = [];
    errors = [];
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('copies the body of the selected instruction (normal path)', async () => {
    const w = loadModule();
    const p = w.selectInstructionPreview('alpha');
    await settle('alpha', 'ALPHA BODY');
    await p;

    await w.copySelectedInstructionBody();

    expect(clipboardWrites).toEqual(['ALPHA BODY']);
  });

  // HIGH: `instructionPreviewBody` is a single unkeyed global written whenever a
  // fetch resolves. If the user selects alpha then beta and alpha's response is
  // the one that lands last, the cache holds alpha's body while beta is the
  // selected/rendered entry — Copy then silently emits the wrong instruction.
  it('never copies a stale body when an earlier request resolves last (concurrent)', async () => {
    const w = loadModule();
    const pAlpha = w.selectInstructionPreview('alpha');
    const pBeta = w.selectInstructionPreview('beta');

    // beta (the selected entry) lands first, alpha's in-flight response lands after.
    await settle('beta', 'BETA BODY');
    await settle('alpha', 'ALPHA BODY');
    await Promise.allSettled([pAlpha, pBeta]);

    expect(w.instructionPreviewSelected).toBe('beta');

    await w.copySelectedInstructionBody();

    expect(clipboardWrites).not.toContain('ALPHA BODY');
    expect(clipboardWrites).toEqual(['BETA BODY']);
  });

  // HIGH (same root cause, different trigger): a late response must not overwrite
  // the rendered detail pane of a different, newer selection.
  it('does not let a late response overwrite the newer selection body cache', async () => {
    const w = loadModule();
    w.selectInstructionPreview('alpha');
    w.selectInstructionPreview('beta');
    await settle('beta', 'BETA BODY');
    await settle('alpha', 'ALPHA BODY');

    expect(w.instructionPreviewBody).toBe('BETA BODY');
  });

  // MEDIUM: the handler captures `btn.textContent` as the "original" label. A
  // second click while "✓ Copied" is showing captures that as the original, so
  // the button never returns to its real label.
  it('restores the copy button label after rapid repeat clicks (boundary)', async () => {
    vi.useFakeTimers();
    const w = loadModule();
    const p = w.selectInstructionPreview('alpha');
    await settle('alpha', 'ALPHA BODY');
    await p;

    const btn = document.getElementById('instruction-detail-copy-btn') as HTMLButtonElement;

    await w.copySelectedInstructionBody();
    await vi.advanceTimersByTimeAsync(500);
    await w.copySelectedInstructionBody();
    await vi.advanceTimersByTimeAsync(5000);

    expect(btn.textContent).toBe('📋 Copy');
  });

  // LOW: the legacy clipboard fallback appends a hidden textarea and only removes
  // it on the success path, so a throw from select()/execCommand leaks a node.
  it('removes the fallback textarea even when the legacy copy throws (cleanup)', async () => {
    const w = loadModule();
    Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: undefined });
    (w.document as Document & { execCommand: () => boolean }).execCommand = () => {
      throw new Error('execCommand unavailable');
    };

    const p = w.selectInstructionPreview('alpha');
    await settle('alpha', 'ALPHA BODY');
    await p;

    await w.copySelectedInstructionBody();

    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  // LOW: a failed fetch is swallowed and falls through to the empty-body branch,
  // so the operator is told there is nothing to copy rather than that it failed.
  it('reports a load failure distinctly from an empty body (error path)', async () => {
    const w = loadModule();
    w.instructionPreviewSelected = 'gamma';
    w.instructionPreviewBody = '';
    w.adminAuth.adminFetch = async () => { throw new Error('network down'); };

    await w.copySelectedInstructionBody();

    expect(clipboardWrites).toEqual([]);
    expect(errors.join(' ')).toMatch(/failed to load/i);
  });
});

/**
 * #552 — the flat-view preview pane gained its own Copy button. It copies the
 * body that pane rendered (no refetch), so these tests assert the pane-local
 * binding and the per-button label timer that lets two panes coexist.
 */
describe('flat view preview copy path (#552)', () => {
  beforeEach(() => {
    pending = new Map();
    clipboardWrites = [];
    errors = [];
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Append a flat-list row for `name` and return its Preview toggle button. */
  function addFlatItem(name: string): HTMLButtonElement {
    const list = document.getElementById('instructions-list') as HTMLElement;
    const item = document.createElement('div');
    item.className = 'instruction-item';
    item.setAttribute('data-instruction', name);
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = '👁 Preview';
    item.appendChild(btn);
    list.appendChild(item);
    return btn;
  }

  /** Open the flat preview for `name`, resolving its fetch with `body`. */
  async function openFlatPreview(w: W, name: string, body: string) {
    const toggle = addFlatItem(name);
    const p = w.toggleFlatPreview(name, toggle);
    await settle(name, body);
    await p;
    const item = document.querySelector(`.instruction-item[data-instruction="${name}"]`) as HTMLElement;
    return {
      toggle,
      pane: item.querySelector('.flat-preview-pane') as HTMLElement,
      copyBtn: item.querySelector('[data-flat-copy]') as HTMLButtonElement,
    };
  }

  it('renders a copy button in the pane and copies the previewed body (normal)', async () => {
    const w = loadModule();
    const { pane, copyBtn } = await openFlatPreview(w, 'alpha', 'ALPHA BODY');

    expect(pane).toBeTruthy();
    expect(copyBtn).toBeTruthy();
    expect(copyBtn.textContent).toBe('📋 Copy');
    expect(pane.querySelector('.flat-preview-body')?.textContent).toContain('ALPHA BODY');

    copyBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(clipboardWrites).toEqual(['ALPHA BODY']);
    expect(copyBtn.textContent).toBe('✓ Copied');
  });

  // Each pane's button is bound to that pane's own body — copying from the
  // second pane opened must not emit the first pane's content.
  it('copies each pane\'s own body when several panes are open (concurrent)', async () => {
    const w = loadModule();
    const alpha = await openFlatPreview(w, 'alpha', 'ALPHA BODY');
    const beta = await openFlatPreview(w, 'beta', 'BETA BODY');

    beta.copyBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    alpha.copyBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(clipboardWrites).toEqual(['BETA BODY', 'ALPHA BODY']);
  });

  // The label-reset handle must live on the button. With one shared module-level
  // timer, copying in beta cancels alpha's pending reset and alpha is stranded
  // showing "✓ Copied" forever.
  it('restores each pane\'s label independently (boundary)', async () => {
    vi.useFakeTimers();
    const w = loadModule();
    const alpha = await openFlatPreview(w, 'alpha', 'ALPHA BODY');
    const beta = await openFlatPreview(w, 'beta', 'BETA BODY');

    alpha.copyBtn.click();
    await vi.advanceTimersByTimeAsync(500);
    beta.copyBtn.click();
    await vi.advanceTimersByTimeAsync(1200);

    expect(alpha.copyBtn.textContent).toBe('📋 Copy'); // 1700ms since its own click
    expect(beta.copyBtn.textContent).toBe('✓ Copied'); // only 1200ms since its own

    await vi.advanceTimersByTimeAsync(1000);
    expect(beta.copyBtn.textContent).toBe('📋 Copy');
  });

  it('reports an empty body instead of copying nothing (error path)', async () => {
    const w = loadModule();
    const { copyBtn } = await openFlatPreview(w, 'empty', '');

    copyBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(clipboardWrites).toEqual([]);
    expect(errors.join(' ')).toMatch(/no instruction body/i);
  });

  it('surfaces a clipboard failure on the button and via showError (error path)', async () => {
    const w = loadModule();
    const { copyBtn } = await openFlatPreview(w, 'alpha', 'ALPHA BODY');

    // Neither clipboard path available -> writeClipboardText resolves false.
    Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: undefined });
    (w.document as Document & { execCommand: () => boolean }).execCommand = () => false;

    copyBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(clipboardWrites).toEqual([]);
    expect(copyBtn.textContent).toBe('✗ Copy failed');
    expect(errors.join(' ')).toMatch(/clipboard copy failed/i);
  });

  it('drops the copy button when the preview is toggled closed (cleanup)', async () => {
    const w = loadModule();
    const { toggle } = await openFlatPreview(w, 'alpha', 'ALPHA BODY');

    await w.toggleFlatPreview('alpha', toggle);

    expect(document.querySelector('.flat-preview-pane')).toBeNull();
    expect(document.querySelector('[data-flat-copy]')).toBeNull();
    expect(toggle.textContent).toBe('👁 Preview');
  });
});
