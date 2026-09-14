/**
 * @vitest-environment jsdom
 *
 * Index Growth chart client — admin.growth.js.
 *
 * Follows the eval-into-jsdom pattern from performanceChart.spec.ts. The
 * properties pinned here are the ones a rendering bug would quietly break:
 * that the provenance caveat is always present (a derived curve presented as
 * measured history is the failure mode this chart was built to avoid), that an
 * empty catalog says so instead of drawing a blank box, and that repeated
 * refreshes do not stack canvas listeners.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const UTILS_JS = path.resolve(__dirname, '..', 'dashboard', 'client', 'js', 'admin.utils.js');
const GROWTH_JS = path.resolve(__dirname, '..', 'dashboard', 'client', 'js', 'admin.growth.js');

const utilsSource = fs.readFileSync(UTILS_JS, 'utf8');
const growthSource = fs.readFileSync(GROWTH_JS, 'utf8');

type W = Window & typeof globalThis & Record<string, any>;

/** Records what was painted; jsdom has no canvas backend. */
function makeRecordingContext() {
  const painted: Array<{ op: string; args: unknown[] }> = [];
  const ctx: Record<string, unknown> = { painted };
  const noop = (op: string) => (...args: unknown[]) => { painted.push({ op, args }); };
  for (const op of [
    'clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill',
    'stroke', 'save', 'restore', 'arc', 'quadraticCurveTo', 'rect', 'setTransform',
    'strokeRect', 'fillText',
  ]) ctx[op] = noop(op);
  ctx.measureText = () => ({ width: 10 });
  return ctx as Record<string, unknown> & { painted: typeof painted };
}

function buildDom(response: unknown): { w: W; ctx: ReturnType<typeof makeRecordingContext>; calls: string[] } {
  const w = window as unknown as W;
  document.body.innerHTML = `
    <div class="admin-card">
      <div id="growth-chart-host" class="growth-chart">
        <canvas id="growth-chart" height="130"></canvas>
      </div>
      <div id="growth-legend" class="catalog-chart-legend"></div>
      <div id="growth-readout" class="catalog-chart-readout"></div>
      <div id="growth-caveat" class="chart-caveat"></div>
      <select id="growth-bucket"><option value="day" selected>daily</option></select>
      <select id="growth-window"><option value="all" selected>all time</option></select>
    </div>
  `;
  const ctx = makeRecordingContext();
  const canvas = document.getElementById('growth-chart') as HTMLCanvasElement;
  (canvas as unknown as Record<string, unknown>).getContext = () => ctx;

  const calls: string[] = [];
  w.adminAuth = {
    adminFetch: async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => response };
    },
  };
  return { w, ctx, calls };
}

function points(spec: Array<[number, number, number]>) {
  const base = Date.parse('2026-02-08T00:00:00Z');
  return spec.map(([dayOffset, added, cumulative]) => ({
    ts: base + dayOffset * 86400000, added, archived: 0, cumulative,
  }));
}

const OK = (pts: unknown[], extra: Record<string, unknown> = {}) => ({
  success: true,
  since: Date.parse('2026-02-08T00:00:00Z'),
  until: Date.parse('2026-09-06T00:00:00Z'),
  bucket: 'day',
  bucketMs: 86400000,
  points: pts,
  baseline: 0,
  undated: 0,
  totals: { entries: 284, archived: 6, firstCreated: '2026-02-08T01:32:43.490Z', lastCreated: '2026-09-06T11:19:00.969Z' },
  derived: true,
  ...extra,
});

/** Let the module's async refresh() settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as W).__adminGrowth;
});

describe('Index Growth chart', () => {
  it('fetches /api/usage/growth and omits `since` for the all-time range', async () => {
    const { w, calls } = buildDom(OK(points([[0, 18, 18], [1, 0, 18], [2, 5, 23]])));
    w.eval(utilsSource);
    w.eval(growthSource);
    await settle();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toContain('/api/usage/growth');
    expect(calls[0]).toContain('bucket=day');
    // 'all time' must let the server pick the catalog's own origin.
    expect(calls[0]).not.toContain('since=');
  });

  it('always renders the provenance caveat', async () => {
    const { w } = buildDom(OK(points([[0, 18, 18]])));
    w.eval(utilsSource);
    w.eval(growthSource);
    await settle();

    const caveat = document.getElementById('growth-caveat')!.textContent ?? '';
    expect(caveat).toMatch(/Derived from entry timestamps/i);
    expect(caveat).toMatch(/understate/i);
  });

  it('summarises the span as first → last with the delta', async () => {
    const { w } = buildDom(OK(points([[0, 18, 18], [1, 0, 18], [2, 5, 23]])));
    w.eval(utilsSource);
    w.eval(growthSource);
    await settle();

    const readout = document.getElementById('growth-readout')!.textContent ?? '';
    expect(readout).toContain('18 → 23');
    expect(readout).toContain('(+5)');
    expect(readout).toContain('3 buckets');
  });

  it('reports undated entries as excluded rather than hiding them', async () => {
    const { w } = buildDom(OK(points([[0, 5, 5]]), { undated: 7 }));
    w.eval(utilsSource);
    w.eval(growthSource);
    await settle();

    expect(document.getElementById('growth-readout')!.textContent).toContain('7 undated entries excluded');
  });

  it('legend lists exactly the one series that is drawn', async () => {
    const { w } = buildDom(OK(points([[0, 1, 1]])));
    w.eval(utilsSource);
    w.eval(growthSource);
    await settle();

    const items = document.querySelectorAll('#growth-legend .catalog-chart-legend-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('catalog size');
  });

  it('says so when there is nothing to derive, rather than drawing an empty box', async () => {
    const { w, ctx } = buildDom(OK([]));
    w.eval(utilsSource);
    w.eval(growthSource);
    await settle();

    const texts = ctx.painted.filter((p) => p.op === 'fillText').map((p) => String(p.args[0]));
    expect(texts.join(' ')).toMatch(/No dated catalog entries/i);
  });

  it('draws a dot for a single point so one entry does not look like a broken chart', async () => {
    const { w, ctx } = buildDom(OK(points([[0, 1, 1]])));
    w.eval(utilsSource);
    w.eval(growthSource);
    await settle();

    expect(ctx.painted.some((p) => p.op === 'arc')).toBe(true);
  });

  it('degrades to a message instead of throwing when the endpoint fails', async () => {
    const w = window as unknown as W;
    document.body.innerHTML = `
      <div id="growth-chart-host" class="growth-chart"><canvas id="growth-chart"></canvas></div>
      <div id="growth-legend"></div><div id="growth-readout"></div><div id="growth-caveat"></div>
    `;
    const canvas = document.getElementById('growth-chart') as HTMLCanvasElement;
    (canvas as unknown as Record<string, unknown>).getContext = () => makeRecordingContext();
    w.adminAuth = { adminFetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) };

    w.eval(utilsSource);
    expect(() => w.eval(growthSource)).not.toThrow();
    await settle();

    expect(document.getElementById('growth-readout')!.textContent).toBe('Growth data unavailable');
  });

  it('two consecutive refreshes do NOT stack canvas listeners', async () => {
    const { w } = buildDom(OK(points([[0, 1, 1], [1, 1, 2]])));
    w.eval(utilsSource);
    w.eval(growthSource);
    await settle();

    const canvas = document.getElementById('growth-chart') as HTMLCanvasElement;
    let added = 0;
    const realAdd = canvas.addEventListener.bind(canvas);
    (canvas as unknown as Record<string, unknown>).addEventListener = (...args: unknown[]) => {
      added++;
      return (realAdd as (...a: unknown[]) => void)(...args);
    };

    await w.__adminGrowth.refresh();
    await w.__adminGrowth.refresh();
    expect(added).toBe(0);
  });
});
