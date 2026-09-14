/**
 * @vitest-environment jsdom
 *
 * Performance chart client tests — issue #525.
 *
 * Tests the themeVar() helper (admin.utils.js) and the index growth
 * timeline chart renderer (admin.performance.chart.js).
 *
 * Follows the eval-into-jsdom pattern from dashboardNavBubbles.spec.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const UTILS_JS = path.resolve(__dirname, '..', 'dashboard', 'client', 'js', 'admin.utils.js');
const CHART_JS = path.resolve(__dirname, '..', 'dashboard', 'client', 'js', 'admin.performance.chart.js');

const utilsSource = fs.readFileSync(UTILS_JS, 'utf8');

let chartSource: string | null = null;
try {
  chartSource = fs.readFileSync(CHART_JS, 'utf8');
} catch {
  // file does not exist yet
}

type W = Window & typeof globalThis & Record<string, any>;

function buildPerformanceDom(): W {
  const w = window as unknown as W;
  document.body.innerHTML = `
    <div class="admin-container">
      <div class="admin-card">
        <div id="performance-stats" class="metrics-list">
          <div class="stat-row"><span class="stat-label">Total Connections</span><span class="stat-value">2</span></div>
          <div class="stat-row"><span class="stat-label">Error Rate</span><span class="stat-value">0.00%</span></div>
          <div class="stat-row"><span class="stat-label">Response Time</span><span class="stat-value">1.1ms</span></div>
        </div>
        <div id="catalog-history">
          <canvas id="catalog-history-chart" width="400" height="120"></canvas>
        </div>
      </div>
    </div>
  `;
  w.adminAuth = {
    adminFetch: async () => ({ ok: true, json: async () => ({ success: true, data: { samples: [] }, catalogHistory: [] }) }),
  };
  return w;
}

function loadUtils(): W {
  const w = buildPerformanceDom();
  w.eval(utilsSource);
  return w;
}

function loadChart(w: W): W {
  if (!chartSource) throw new Error('admin.performance.chart.js does not exist yet');
  w.eval(chartSource);
  return w;
}

/**
 * Current-shape catalog samples, as CatalogSampler now emits them: real
 * wall-clock timestamps with coverage and per-signal buckets.
 */
function makeTimeline(count: number) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const indexCount = i + 1;
    const signalCount = Math.floor(i / 10);
    const sigApplied = Math.ceil(signalCount / 2);
    const sigHelpful = signalCount - sigApplied;
    const retrievedOnly = Math.min(indexCount - signalCount, Math.floor(i / 2));
    return {
      timestamp: now - (count - i) * 86400_000,
      indexCount,
      usageTotal: Math.floor(i * 2.5),
      signalCount,
      sigApplied,
      sigHelpful,
      sigNotRelevant: 0,
      sigOutdated: 0,
      retrievedOnly,
      neverUsed: indexCount - signalCount - retrievedOnly,
    };
  });
}

/**
 * Minimal recording 2D context.
 *
 * jsdom ships no canvas backend, so `canvas.getContext('2d')` returns null and
 * the renderer's guard makes every draw a no-op. That silently reduces the
 * chart specs to "the module loaded" — a paint defect cannot fail them. This
 * stub records what would have been painted so drawing can be asserted.
 *
 * `painted` collects filled regions: `fillRect` calls directly, and for path
 * fills the bounding box of the points since the last `beginPath()`.
 */
function makeRecordingContext() {
  const painted: Array<{ w: number; h: number; color: string }> = [];
  let pts: Array<{ x: number; y: number }> = [];

  const ctx = {
    canvas: null as unknown,
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    textAlign: '', textBaseline: '', globalAlpha: 1, lineJoin: '', lineCap: '',
    setTransform() { /* noop */ },
    save() { /* noop */ }, restore() { /* noop */ },
    clearRect() { /* noop */ },
    fillRect(_x: number, _y: number, w: number, h: number) {
      painted.push({ w: Math.abs(w), h: Math.abs(h), color: String(ctx.fillStyle) });
    },
    strokeRect() { /* noop */ },
    beginPath() { pts = []; },
    closePath() { /* noop */ },
    moveTo(x: number, y: number) { pts.push({ x, y }); },
    lineTo(x: number, y: number) { pts.push({ x, y }); },
    quadraticCurveTo(_cx: number, _cy: number, x: number, y: number) { pts.push({ x, y }); },
    fill() {
      if (!pts.length) return;
      const xs = pts.map(p => p.x); const ys = pts.map(p => p.y);
      painted.push({
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
        color: String(ctx.fillStyle),
      });
    },
    stroke() { /* strokes are separators/axes, not filled area */ },
    fillText() { /* noop */ },
    measureText() { return { width: 0 }; },
  };
  return { ctx, painted };
}

/** Legacy shape: pre-bucket servers sent only count/usageTotal/signalCount. */
function makeLegacyTimeline(count: number) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: now - (count - i) * 86400_000,
    count: i + 1,
    usageTotal: Math.floor(i * 2.5),
    signalCount: Math.floor(i / 10),
  }));
}

// ====================================================================
// themeVar(name, fallback) — admin.utils.js
// ====================================================================

describe('themeVar(name, fallback) helper', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    const w = window as unknown as W;
    delete w.adminUtils;
  });

  it('themeVar is exposed on window.adminUtils', () => {
    const w = loadUtils();
    expect(w.adminUtils).toBeDefined();
    expect(typeof w.adminUtils.themeVar).toBe('function');
  });

  it('returns the resolved CSS custom property value (trimmed)', () => {
    const w = loadUtils();
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) => {
        if (name === '--admin-accent') return ' #3b82f6';
        return '';
      },
    } as any);
    const result = w.adminUtils.themeVar('--admin-accent', '#fallback');
    expect(result).toBe('#3b82f6');
    vi.mocked(window.getComputedStyle).mockRestore();
  });

  it('returns fallback when getPropertyValue returns empty string', () => {
    const w = loadUtils();
    const result = w.adminUtils.themeVar('--admin-accent', '#3b82f6');
    expect(result).toBe('#3b82f6');
  });

  it('.trim() is applied', () => {
    const w = loadUtils();
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '   #ff9830   ',
    } as any);
    const result = w.adminUtils.themeVar('--admin-warn', '#000');
    expect(result).toBe('#ff9830');
    vi.mocked(window.getComputedStyle).mockRestore();
  });
});

// ====================================================================
// Index growth timeline chart
// ====================================================================

describe('Index growth timeline chart', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    const w = window as unknown as W;
    delete w.adminUtils;
    delete w.__catalogChartInstance;
  });

  it('renders without throwing on empty timeline', () => {
    const w = loadUtils();
    loadChart(w);
    const canvas = document.getElementById('catalog-history-chart') as HTMLCanvasElement;
    expect(typeof w.renderCatalogChart).toBe('function');
    expect(() => w.renderCatalogChart(canvas, [])).not.toThrow();
  });

  it('renders without throwing on single entry', () => {
    const w = loadUtils();
    loadChart(w);
    const canvas = document.getElementById('catalog-history-chart') as HTMLCanvasElement;
    expect(() => w.renderCatalogChart(canvas, makeTimeline(1))).not.toThrow();
  });

  it('paints a visible band for a lone sample instead of a zero-width sliver', () => {
    const w = loadUtils();
    loadChart(w);
    const canvas = document.getElementById('catalog-history-chart') as HTMLCanvasElement;

    // "Does not throw" passed while the panel rendered as bare axes: a single
    // observation has no width, so the stacked-area path collapsed and filled
    // nothing while the legend showed real numbers. Every fresh deploy and
    // every restart shows exactly this for the first sampling interval, so
    // assert that a fill is actually reached with a non-zero width.
    //
    // jsdom has no canvas backend and returns null from getContext, which the
    // renderer treats as "nothing to draw" — so without this recording stub
    // NONE of the drawing code runs and no chart test can observe a paint bug.
    const { ctx, painted } = makeRecordingContext();
    (canvas as unknown as { getContext: () => unknown }).getContext = () => ctx;

    // One sample: 1 entry, retrieved, unsignalled -> exactly one visible band.
    w.renderCatalogChart(canvas, [{
      timestamp: Date.now(),
      indexCount: 1, usageTotal: 3, signalCount: 0,
      sigApplied: 0, sigHelpful: 0, sigNotRelevant: 0, sigOutdated: 0,
      retrievedOnly: 1, neverUsed: 0,
    }]);

    // Assert on the "retrieved" band's own colour, not on "something was
    // painted": the full-canvas background wash is also a fillRect with real
    // width and height, so a colour-blind assertion here passes even with the
    // renderer reverted — a check that cannot fail.
    // Fill colour, not the legend swatch. The bands are painted at 70% alpha
    // (`B3`) so the chart sits at the same visual weight as the resource-trend
    // canvases; `swatch` carries the opaque hex for the legend. Hardcoded on
    // purpose — deriving it from the module under test would stop this case
    // noticing a palette change, and noticing one is why it exists.
    const RETRIEVED = '#1baf7ab3';
    const band = painted.filter(p => p.color.toLowerCase() === RETRIEVED && p.w > 1 && p.h > 1);
    expect(band.length).toBeGreaterThan(0);
  });

  it('renders without throwing on 136 entries', () => {
    const w = loadUtils();
    loadChart(w);
    const canvas = document.getElementById('catalog-history-chart') as HTMLCanvasElement;
    expect(() => w.renderCatalogChart(canvas, makeTimeline(136))).not.toThrow();
  });

  it('summary reports absolute counts and the sampled span, not ratios', () => {
    const w = loadUtils();
    loadChart(w);
    const canvas = document.getElementById('catalog-history-chart') as HTMLCanvasElement;
    w.renderCatalogChart(canvas, makeTimeline(50));
    const text = canvas.parentElement!.textContent ?? '';

    expect(text).toContain('50 samples');
    expect(text).toContain('index 50');
    expect(text).toContain('signalled 4');

    // The old readout printed "usage 244.0%" and "signals 8.0%" side by side.
    // Neither was a share of a common whole -- usage was usages-per-entry and
    // could exceed 100% -- and the two were drawn on independently scaled
    // axes. Absolute counts on a shared axis replace both.
    expect(text).not.toContain('%');
  });

  it('legend names every band in both panels', () => {
    const w = loadUtils();
    loadChart(w);
    const canvas = document.getElementById('catalog-history-chart') as HTMLCanvasElement;
    w.renderCatalogChart(canvas, makeTimeline(30));
    const legend = document.getElementById('catalog-history-legend')!;
    const text = legend.textContent ?? '';

    // Identity is never colour-alone: every band is named.
    for (const label of ['never used', 'retrieved', 'signalled', 'applied', 'helpful', 'not-relevant', 'outdated']) {
      expect(text).toContain(label);
    }
  });

  it('offers a data table carrying the same numbers as the bands', () => {
    const w = loadUtils();
    loadChart(w);
    const canvas = document.getElementById('catalog-history-chart') as HTMLCanvasElement;
    w.renderCatalogChart(canvas, makeTimeline(12));

    const toggle = document.getElementById('catalog-history-table-toggle') as HTMLButtonElement;
    const table = document.getElementById('catalog-history-table') as HTMLElement;
    expect(toggle).toBeTruthy();
    expect(table.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    expect(table.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // Header names each band; body carries a row per sample (newest first).
    expect(table.querySelectorAll('thead th').length).toBe(9);
    expect(table.querySelectorAll('tbody tr').length).toBe(12);
  });

  it('derives coverage bands from a legacy sample that lacks them', () => {
    const w = loadUtils();
    loadChart(w);
    const canvas = document.getElementById('catalog-history-chart') as HTMLCanvasElement;

    // A mixed-version response must still render real numbers rather than
    // reporting every band as zero.
    expect(() => w.renderCatalogChart(canvas, makeLegacyTimeline(30))).not.toThrow();
    const text = canvas.parentElement!.textContent ?? '';
    expect(text).toContain('index 30');
    expect(text).toContain('signalled 2');
  });

  it('two consecutive renders do NOT stack listeners', () => {
    const w = loadUtils();
    loadChart(w);
    const canvas = document.getElementById('catalog-history-chart') as HTMLCanvasElement;
    const tl = makeTimeline(10);
    w.renderCatalogChart(canvas, tl);
    const spy = vi.spyOn(canvas, 'addEventListener');
    w.renderCatalogChart(canvas, tl);
    expect(spy.mock.calls.length).toBe(0);
    spy.mockRestore();
  });

  it('stat rows above chart still render when endpoint 404s', async () => {
    const w = loadUtils();
    w.adminAuth = {
      adminFetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    };
    loadChart(w);
    const statRows = document.querySelectorAll('.stat-row');
    expect(statRows.length).toBeGreaterThanOrEqual(3);
    const labels = Array.from(document.querySelectorAll('.stat-label')).map(el => el.textContent);
    expect(labels).toContain('Total Connections');
  });
});
