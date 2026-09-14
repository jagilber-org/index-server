/* eslint-disable */
/**
 * admin.growth.js — index growth, the DERIVED stock view.
 *
 * Cumulative catalog size over time, from /api/usage/growth.
 *
 * Why this exists next to the other two catalog charts:
 *
 *   - "index composition" (admin.performance.chart.js) is a MEASURED stock
 *     view. It can only show what a sampler actually observed, so it starts at
 *     the first sample and shows a flat line on a catalog that has not changed
 *     in the last few hours.
 *   - "Catalog Activity" (admin.activity.js) is a MEASURED flow view, bounded
 *     the same way by when activity telemetry was switched on.
 *   - This chart is a DERIVED stock view. It reads no telemetry at all — the
 *     server reconstructs it from each entry's own createdAt/archivedAt — so it
 *     reaches back to the oldest entry in the catalog even on a server that has
 *     never recorded a single sample.
 *
 * Drawn as a filled area with a line cap, not bars: cumulative size is a
 * quantity that genuinely exists between observations, so interpolating across
 * a quiet week is honest here in a way it would not be for event counts.
 *
 * The caveat under the chart is not decoration. This is a SURVIVOR curve: an
 * entry created and then hard-deleted leaves no row anywhere, so it cannot
 * appear. Presenting the line as measured history would overstate what the data
 * supports, so the caption says what it is every time it renders.
 */
(function (window, document) {
  'use strict';

  var CANVAS_ID = 'growth-chart';
  var HOST_ID = 'growth-chart-host';
  var LEGEND_ID = 'growth-legend';
  var READOUT_ID = 'growth-readout';
  var CAVEAT_ID = 'growth-caveat';
  var BUCKET_ID = 'growth-bucket';
  var WINDOW_ID = 'growth-window';

  var PAD_LEFT = 34;
  var PAD_RIGHT = 8;
  var PAD_TOP = 10;
  var PLOT_H = 104;
  var XAXIS_H = 16;
  var CHART_HEIGHT = PAD_TOP + PLOT_H + XAXIS_H;
  var FALLBACK_WIDTH = 320;

  var REFRESH_MS = 300000; // 5 min — derived from entry timestamps, not a live feed
  var EMPTY_TEXT = 'No dated catalog entries to derive growth from';
  var CAVEAT_TEXT =
    'Derived from entry timestamps, not sampled history. Entries that were created ' +
    'and later permanently deleted leave no record, so the line can understate past size.';

  // One entry, because one series is drawn. Per-bucket added/archived counts
  // are in the readout and the hover text, not on the canvas — listing them
  // here would advertise bands that are never painted.
  var SERIES = [
    { key: 'cumulative', label: 'catalog size', color: '#3987e5' }
  ];
  var LINE_COLOR = SERIES[0].color;
  var FILL_ALPHA = 0.18;

  var state = { points: [], bucketMs: 86400000, totals: null, baseline: 0, undated: 0, geom: null, palette: null, hover: null, bound: false };

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  function themeVar(name, fallback) {
    var utils = window.adminUtils;
    if (utils && typeof utils.themeVar === 'function') return utils.themeVar(name, fallback);
    return fallback;
  }

  function resolvePalette() {
    return {
      grid: themeVar('--admin-border-muted', '#24282f'),
      axis: themeVar('--admin-border', '#2c3038'),
      text: themeVar('--admin-text-dim', '#8e959e'),
      ink: themeVar('--admin-text', '#d0d4d8'),
      bg: themeVar('--admin-spark-bg', '#13151a')
    };
  }

  var NICE_STEPS = [1, 1.2, 1.4, 1.6, 1.8, 2, 2.4, 3, 4, 5, 6, 8, 10];

  function niceMax(v) {
    if (!(v > 0)) return 1;
    var exp = Math.floor(Math.log(v) / Math.LN10);
    var pow = Math.pow(10, exp);
    var frac = v / pow;
    for (var i = 0; i < NICE_STEPS.length; i++) {
      if (frac <= NICE_STEPS[i]) return NICE_STEPS[i] * pow;
    }
    return 10 * pow;
  }

  function formatBucket(ts, bucketMs) {
    var d = new Date(ts);
    if (bucketMs <= 6 * 3600000) {
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':00';
    }
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  function sizeCanvas(canvas, ctx) {
    var dpr = window.devicePixelRatio || 1;
    var parent = canvas.parentElement;
    var cssW = (parent && parent.clientWidth) || canvas.clientWidth || FALLBACK_WIDTH;
    if (!cssW) cssW = FALLBACK_WIDTH;
    var cssH = CHART_HEIGHT;

    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    if (typeof ctx.setTransform === 'function') ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return {
      cssW: cssW, cssH: cssH,
      left: PAD_LEFT,
      width: Math.max(1, cssW - PAD_LEFT - PAD_RIGHT),
      top: PAD_TOP,
      height: PLOT_H,
      bottom: PAD_TOP + PLOT_H
    };
  }

  /** X centre of point i. A single point sits mid-plot rather than at x=0. */
  function pointX(geom, count, i) {
    if (count <= 1) return geom.left + geom.width / 2;
    return geom.left + (geom.width * i) / (count - 1);
  }

  function pointY(geom, value, max) {
    return geom.bottom - (num(value) / max) * geom.height;
  }

  function draw(canvas) {
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) return;

    var geom = sizeCanvas(canvas, ctx);
    state.geom = geom;
    var palette = state.palette || resolvePalette();

    ctx.clearRect(0, 0, geom.cssW, geom.cssH);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, geom.cssW, geom.cssH);

    var points = state.points;
    if (!points.length) {
      ctx.save();
      ctx.fillStyle = palette.text;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(EMPTY_TEXT, geom.left + geom.width / 2, geom.top + geom.height / 2);
      ctx.restore();
      return;
    }

    var peak = 0;
    for (var i = 0; i < points.length; i++) peak = Math.max(peak, num(points[i].cumulative));
    // Always scale from zero. A cumulative count auto-scaled to its own min
    // would turn a 2-entry drift into a dramatic climb — exactly the misreading
    // this chart exists to correct.
    var max = niceMax(peak);

    // Gridlines + y ticks.
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.fillStyle = palette.text;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (i = 0; i <= 2; i++) {
      var frac = i / 2;
      var gy = Math.round(geom.bottom - frac * geom.height) + 0.5;
      ctx.beginPath();
      ctx.moveTo(geom.left, gy);
      ctx.lineTo(geom.left + geom.width, gy);
      ctx.stroke();
      ctx.fillText(String(Math.round(max * frac)), geom.left - 5, gy);
    }
    ctx.restore();

    // Filled area under the cumulative line.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pointX(geom, points.length, 0), geom.bottom);
    for (i = 0; i < points.length; i++) {
      ctx.lineTo(pointX(geom, points.length, i), pointY(geom, points[i].cumulative, max));
    }
    ctx.lineTo(pointX(geom, points.length, points.length - 1), geom.bottom);
    ctx.closePath();
    ctx.globalAlpha = FILL_ALPHA;
    ctx.fillStyle = LINE_COLOR;
    ctx.fill();
    ctx.restore();

    // The line itself.
    ctx.save();
    ctx.beginPath();
    for (i = 0; i < points.length; i++) {
      var x = pointX(geom, points.length, i);
      var y = pointY(geom, points[i].cumulative, max);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();

    // A single point draws no stroke, so give it a dot — otherwise a catalog
    // with one dated entry renders as an empty plot that looks broken.
    if (points.length === 1) {
      ctx.save();
      ctx.fillStyle = LINE_COLOR;
      ctx.beginPath();
      ctx.arc(pointX(geom, 1, 0), pointY(geom, points[0].cumulative, max), 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Hover cursor.
    if (state.hover !== null && points[state.hover]) {
      var hx = pointX(geom, points.length, state.hover);
      ctx.save();
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + 0.5, geom.top);
      ctx.lineTo(Math.round(hx) + 0.5, geom.bottom);
      ctx.stroke();
      ctx.fillStyle = LINE_COLOR;
      ctx.beginPath();
      ctx.arc(hx, pointY(geom, points[state.hover].cumulative, max), 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Baseline + x labels.
    ctx.save();
    ctx.strokeStyle = palette.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(geom.left, Math.round(geom.bottom) + 0.5);
    ctx.lineTo(geom.left + geom.width, Math.round(geom.bottom) + 0.5);
    ctx.stroke();

    ctx.fillStyle = palette.text;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(formatBucket(points[0].ts, state.bucketMs), geom.left, geom.bottom + 4);
    if (points.length > 1) {
      ctx.textAlign = 'right';
      ctx.fillText(formatBucket(points[points.length - 1].ts, state.bucketMs), geom.left + geom.width, geom.bottom + 4);
    }
    if (geom.width > 220 && points.length > 2) {
      ctx.textAlign = 'center';
      var mid = points[Math.floor(points.length / 2)];
      ctx.fillText(formatBucket(mid.ts, state.bucketMs), geom.left + geom.width / 2, geom.bottom + 4);
    }
    ctx.restore();
  }

  // ── Chrome ────────────────────────────────────────────────────────────────

  function totals(points) {
    var acc = { added: 0, archived: 0, first: 0, last: 0 };
    for (var i = 0; i < points.length; i++) {
      acc.added += num(points[i].added);
      acc.archived += num(points[i].archived);
    }
    if (points.length) {
      acc.first = num(points[0].cumulative);
      acc.last = num(points[points.length - 1].cumulative);
    }
    return acc;
  }

  function renderLegend() {
    var legend = document.getElementById(LEGEND_ID);
    if (!legend) return;
    while (legend.firstChild) legend.removeChild(legend.firstChild);
    for (var i = 0; i < SERIES.length; i++) {
      var s = SERIES[i];
      var item = document.createElement('span');
      item.className = 'catalog-chart-legend-item';
      var sw = document.createElement('span');
      sw.className = 'catalog-chart-swatch';
      sw.setAttribute('aria-hidden', 'true');
      sw.style.backgroundColor = s.color;
      var label = document.createElement('span');
      label.textContent = s.label;
      item.appendChild(sw);
      item.appendChild(label);
      legend.appendChild(item);
    }
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function summaryText(sum, points) {
    if (!points.length) return EMPTY_TEXT;
    var delta = sum.last - sum.first;
    var sign = delta >= 0 ? '+' : '';
    var parts = points.length + ' buckets — ' + sum.first + ' → ' + sum.last + ' entries (' + sign + delta + ')';
    parts += ', ' + sum.added + ' added';
    if (sum.archived > 0) parts += ', ' + sum.archived + ' archived';
    if (state.undated > 0) parts += '; ' + state.undated + ' undated entries excluded';
    return parts;
  }

  function pointText(p) {
    var t = formatBucket(p.ts, state.bucketMs) + ' — ' + num(p.cumulative) + ' entries';
    if (num(p.added) > 0) t += ', +' + num(p.added) + ' added';
    if (num(p.archived) > 0) t += ', -' + num(p.archived) + ' archived';
    return t;
  }

  function bindCanvas(canvas) {
    if (state.bound) return;
    state.bound = true;

    canvas.addEventListener('mousemove', function (event) {
      var geom = state.geom;
      if (!geom || !state.points.length) return;
      var rect = canvas.getBoundingClientRect();
      var x = event.clientX - rect.left;
      var n = state.points.length;
      var idx;
      if (n <= 1) {
        idx = 0;
      } else {
        var step = geom.width / (n - 1);
        idx = Math.round((x - geom.left) / step);
      }
      if (idx < 0 || idx >= n) idx = null;
      if (idx === state.hover) return;
      state.hover = idx;
      setText(READOUT_ID, idx === null ? summaryText(totals(state.points), state.points) : pointText(state.points[idx]));
      draw(canvas);
    });

    canvas.addEventListener('mouseleave', function () {
      state.hover = null;
      setText(READOUT_ID, summaryText(totals(state.points), state.points));
      draw(canvas);
    });

    window.addEventListener('resize', function () { draw(canvas); });
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  function currentQuery() {
    var bucketEl = document.getElementById(BUCKET_ID);
    var windowEl = document.getElementById(WINDOW_ID);
    var bucket = bucketEl ? bucketEl.value : 'day';
    var raw = windowEl ? windowEl.value : 'all';
    var until = Date.now();
    // 'all' omits `since` entirely so the server can default it to the
    // catalog's own first creation — the whole point of this chart.
    if (raw === 'all') return { bucket: bucket, since: null, until: until };
    var days = parseInt(raw, 10);
    if (!isFinite(days) || days <= 0) return { bucket: bucket, since: null, until: until };
    return { bucket: bucket, since: until - days * 86400000, until: until };
  }

  async function refresh() {
    var canvas = document.getElementById(CANVAS_ID);
    var host = document.getElementById(HOST_ID);
    if (!canvas || !host) return;

    var q = currentQuery();
    var auth = window.adminAuth;
    if (!auth || typeof auth.adminFetch !== 'function') return;

    try {
      var qs = '?until=' + q.until + '&bucket=' + encodeURIComponent(q.bucket);
      if (q.since !== null) qs += '&since=' + q.since;
      var res = await auth.adminFetch('/api/usage/growth' + qs);
      if (!res.ok) throw new Error('http ' + res.status);
      var json = await res.json();

      state.points = Array.isArray(json.points) ? json.points : [];
      state.bucketMs = num(json.bucketMs) || 86400000;
      state.baseline = num(json.baseline);
      state.undated = num(json.undated);
      state.totals = json.totals || null;
      state.palette = resolvePalette();

      var sum = totals(state.points);
      renderLegend();
      setText(READOUT_ID, summaryText(sum, state.points));
      setText(CAVEAT_ID, CAVEAT_TEXT);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', summaryText(sum, state.points));

      bindCanvas(canvas);
      draw(canvas);
    } catch (e) {
      // Supplementary panel — never take Overview down with it.
      setText(READOUT_ID, 'Growth data unavailable');
    }
  }

  function init() {
    var bucketEl = document.getElementById(BUCKET_ID);
    var windowEl = document.getElementById(WINDOW_ID);
    if (bucketEl) bucketEl.addEventListener('change', refresh);
    if (windowEl) windowEl.addEventListener('change', refresh);
    setText(CAVEAT_ID, CAVEAT_TEXT);
    refresh();
    setInterval(refresh, REFRESH_MS);
  }

  window.__adminGrowth = { refresh: refresh, _draw: draw, _totals: totals, _state: state, SERIES: SERIES };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
