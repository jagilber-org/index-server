/* eslint-disable */
/**
 * admin.performance.chart.js — index composition timeline (issue #525)
 *
 * Two stacked-area panels sharing one x-axis, drawn from real sampled history
 * (CatalogSampler -> SQLite -> /api/system/resources.catalogHistory).
 *
 *   Panel 1 "coverage"  total height IS the instruction count, split into
 *                       never used / retrieved only / signalled. Because the
 *                       total is the entry count, signals and instruction
 *                       count share one axis and no second scale is needed.
 *
 *   Panel 2 "signals"   the signalled band decomposed by signal value, on its
 *                       own axis.
 *
 * Two panels rather than one plot with two y-scales: a dual-axis chart lets
 * any two series be made to look correlated by choosing the scales, and the
 * previous version of this chart was worse than that — it normalised EVERY
 * series to its own maximum, so a 10.8% line and a 289.6% line both touched
 * the top of the plot, with no ticks to reveal it.
 *
 * Colour is assigned by the job each scale does, and every palette below was
 * checked with the dataviz validator against this surface (#13151a):
 *   - coverage is ORDINAL (engagement depth), so it is a single-hue aqua ramp,
 *     darkest = least engaged. Monotone lightness, all gaps >= 0.06.
 *   - signals are DIVERGING (sentiment), blue arm positive / red arm negative,
 *     two steps each, no midpoint category. Worst adjacent pair (helpful vs
 *     not-relevant) CVD dE 11.6, normal-vision dE 15.1, all four >= 3:1 on
 *     surface.
 * The two scales use different hue families on purpose: reusing blue for both
 * "engagement" and "positive sentiment" would make one hue mean two things in
 * a single figure.
 */
(function (window, document) {
  'use strict';

  var META_ID = 'catalog-history-meta';
  var LEGEND_ID = 'catalog-history-legend';
  var READOUT_ID = 'catalog-history-readout';
  var TABLE_ID = 'catalog-history-table';
  var TOGGLE_ID = 'catalog-history-table-toggle';

  // Layout (CSS px). Panel 2 is shorter: it is the drill-down, not the headline.
  var PAD_LEFT = 34;      // room for y-axis tick labels
  var PAD_RIGHT = 8;
  var PAD_TOP = 8;
  var PANEL1_H = 96;
  var PANEL_GAP = 20;
  var PANEL2_H = 58;
  var XAXIS_H = 16;
  var CHART_HEIGHT = PAD_TOP + PANEL1_H + PANEL_GAP + PANEL2_H + XAXIS_H;
  var FALLBACK_WIDTH = 320;

  // 2px surface-coloured gap between stacked segments so bands stay separable
  // where they meet, including for viewers who cannot separate them by hue.
  var SEGMENT_GAP = 2;

  var EMPTY_TEXT = 'No sampled history yet';
  var STATE_KEY = '__catalogChartState';

  // Panel 1: ordinal ramp, least -> most engaged. Order is bottom-to-top.
  //
  // `color` is the FILL, painted at 70% alpha (`B3`) so the chart sits at the
  // same visual weight as the resource-trend canvases. `swatch` is the opaque
  // hex used in the legend, where a translucent chip would read as a different
  // colour from the band it labels.
  //
  // NOTE: the contrast figures quoted in the file header were measured against
  // the OPAQUE values. Compositing at 70% over the #13151a surface lowers them
  // (e.g. retrieved #1baf7a -> approx #19815d), so those numbers describe the
  // swatches, not the bands as painted. Re-run the dataviz validator against
  // the composited fills before relying on them for an accessibility claim.
  var COVERAGE_SERIES = [
    { key: 'neverUsed',     label: 'never used',    color: '#12664fB3', swatch: '#12664f' },
    { key: 'retrievedOnly', label: 'retrieved',     color: '#1baf7aB3', swatch: '#1baf7a' },
    { key: 'signalCount',   label: 'signalled',     color: '#8fe0c2B3', swatch: '#8fe0c2' }
  ];

  // Panel 2: diverging, positive arm -> negative arm. Order is bottom-to-top.
  var SIGNAL_SERIES = [
    { key: 'sigApplied',     label: 'applied',      color: '#2a78d6B3', swatch: '#2a78d6' },
    { key: 'sigHelpful',     label: 'helpful',      color: '#9ec5f4B3', swatch: '#9ec5f4' },
    { key: 'sigNotRelevant', label: 'not-relevant', color: '#e8a0a0B3', swatch: '#e8a0a0' },
    { key: 'sigOutdated',    label: 'outdated',     color: '#c23434B3', swatch: '#c23434' }
  ];

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  /**
   * Normalise a server sample. Older servers sent only
   * {indexCount, usageTotal, signalCount}; the per-signal and coverage buckets
   * are derived so a mixed-version response still renders rather than drawing
   * a flat zero line. `count` is accepted as an alias because the API used it
   * before the sampler and the chart agreed on `indexCount`.
   */
  function normalize(raw) {
    return raw.map(function (pt) {
      var indexCount = num(pt.indexCount) || num(pt.count);
      var signalCount = num(pt.signalCount);
      var applied = num(pt.sigApplied);
      var helpful = num(pt.sigHelpful);
      var notRelevant = num(pt.sigNotRelevant);
      var outdated = num(pt.sigOutdated);
      var bucketed = applied + helpful + notRelevant + outdated;

      // Pre-bucket samples: attribute the whole signalled band to "unspecified"
      // rather than silently reporting every signal type as zero.
      var unspecified = Math.max(0, signalCount - bucketed);

      var retrievedOnly = pt.retrievedOnly !== undefined
        ? num(pt.retrievedOnly)
        : Math.max(0, indexCount - signalCount);
      var neverUsed = pt.neverUsed !== undefined
        ? num(pt.neverUsed)
        : Math.max(0, indexCount - signalCount - retrievedOnly);

      return {
        timestamp: num(pt.timestamp),
        indexCount: indexCount,
        usageTotal: num(pt.usageTotal),
        signalCount: signalCount,
        sigApplied: applied,
        sigHelpful: helpful,
        sigNotRelevant: notRelevant,
        sigOutdated: outdated,
        sigUnspecified: unspecified,
        retrievedOnly: retrievedOnly,
        neverUsed: neverUsed
      };
    }).sort(function (a, b) { return a.timestamp - b.timestamp; });
  }

  function themeVar(name, fallback) {
    var utils = window.adminUtils;
    if (utils && typeof utils.themeVar === 'function') return utils.themeVar(name, fallback);
    return fallback;
  }

  function resolvePalette() {
    return {
      grid: themeVar('--admin-border-muted', '#24282f'),
      axis: themeVar('--admin-border', '#2c3038'),
      // Text wears ink tokens, never a series colour.
      text: themeVar('--admin-text-dim', '#8e959e'),
      ink: themeVar('--admin-text', '#d0d4d8'),
      bg: themeVar('--admin-spark-bg', '#13151a')
    };
  }

  function getState(canvas) {
    if (!canvas[STATE_KEY]) {
      canvas[STATE_KEY] = { listenersBound: false, samples: [], geom: null, palette: null, meta: null };
    }
    return canvas[STATE_KEY];
  }

  // Mantissas allowed for the y-axis maximum. A bare 1/2/5 ladder rounds 278
  // up to 500, throwing away nearly half the panel height and flattening the
  // very trend the chart exists to show; the intermediate steps keep the data
  // filling the panel. All are divisible by 2 so the midpoint tick stays a
  // whole number.
  var NICE_STEPS = [1, 1.2, 1.4, 1.6, 1.8, 2, 2.4, 3, 4, 5, 6, 8, 10];

  /** Round a maximum up to the nearest readable tick value. */
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

  function formatDate(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function formatDateTime(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
  }

  // ── DOM chrome ────────────────────────────────────────────────────────────

  function ensureMeta(canvas) {
    var parent = canvas.parentElement;
    if (!parent) return null;
    var existing = parent.querySelector('#' + META_ID);
    if (existing) return existing;

    var meta = document.createElement('div');
    meta.id = META_ID;
    meta.className = 'catalog-chart-meta';

    // Time window selector
    var twBar = document.createElement('div');
    twBar.className = 'catalog-chart-timewindow';
    var windows = window.__catalogTimeWindows || [
      { label: '1d', days: 1 }, { label: '7d', days: 7 },
      { label: '30d', days: 30 }, { label: '90d', days: 90 },
      { label: 'All', days: 0 }
    ];
    // `|| 30` would treat the "All" window (days: 0) as falsy and silently
    // re-light the 30d button instead, so the selected window and the
    // highlighted button disagree. Check for the property explicitly.
    var currentDays = (window.__catalogTimeWindow && typeof window.__catalogTimeWindow.days === 'number')
      ? window.__catalogTimeWindow.days
      : 30;
    for (var wi = 0; wi < windows.length; wi++) {
      (function (w) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'catalog-chart-tw-btn' + (w.days === currentDays ? ' active' : '');
        btn.textContent = w.label;
        btn.setAttribute('data-days', String(w.days));
        btn.addEventListener('click', function () {
          if (window.__catalogTimeWindow) window.__catalogTimeWindow.days = w.days;
          var btns = twBar.querySelectorAll('.catalog-chart-tw-btn');
          for (var b = 0; b < btns.length; b++) btns[b].classList.remove('active');
          btn.classList.add('active');
        });
        twBar.appendChild(btn);
      })(windows[wi]);
    }

    var legend = document.createElement('div');
    legend.id = LEGEND_ID;
    legend.className = 'catalog-chart-legend';

    var readout = document.createElement('div');
    readout.id = READOUT_ID;
    readout.className = 'catalog-chart-readout';
    readout.setAttribute('aria-live', 'polite');

    // Accessibility: the same numbers without relying on colour or on hover.
    var toggle = document.createElement('button');
    toggle.id = TOGGLE_ID;
    toggle.type = 'button';
    toggle.className = 'catalog-chart-table-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = 'Show data table';

    var table = document.createElement('div');
    table.id = TABLE_ID;
    table.className = 'catalog-chart-table';
    table.hidden = true;

    toggle.addEventListener('click', function () {
      var open = table.hidden;
      table.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Hide data table' : 'Show data table';
    });

    meta.appendChild(twBar);
    meta.appendChild(legend);
    meta.appendChild(readout);
    meta.appendChild(toggle);
    meta.appendChild(table);

    if (canvas.nextSibling) parent.insertBefore(meta, canvas.nextSibling);
    else parent.appendChild(meta);
    return meta;
  }

  function addLegendGroup(legend, title, series, last) {
    var group = document.createElement('span');
    group.className = 'catalog-chart-legend-group';

    var caption = document.createElement('span');
    caption.className = 'catalog-chart-legend-caption';
    caption.textContent = title;
    group.appendChild(caption);

    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      var item = document.createElement('span');
      item.className = 'catalog-chart-legend-item';

      var swatch = document.createElement('span');
      swatch.className = 'catalog-chart-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.backgroundColor = s.swatch || s.color;

      var label = document.createElement('span');
      label.textContent = s.label + ' ' + (last ? num(last[s.key]) : 0);

      item.appendChild(swatch);
      item.appendChild(label);
      group.appendChild(item);
    }
    legend.appendChild(group);
  }

  function updateLegend(meta, samples) {
    if (!meta) return;
    var legend = meta.querySelector('#' + LEGEND_ID);
    if (!legend) return;
    while (legend.firstChild) legend.removeChild(legend.firstChild);
    if (!samples.length) return;

    var last = samples[samples.length - 1];
    addLegendGroup(legend, 'index ' + num(last.indexCount) + ':', COVERAGE_SERIES, last);
    addLegendGroup(legend, 'signals:', SIGNAL_SERIES, last);
  }

  function updateTable(meta, samples) {
    if (!meta) return;
    var host = meta.querySelector('#' + TABLE_ID);
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!samples.length) return;

    var cols = ['when', 'index'];
    var keys = [];
    var i;
    for (i = 0; i < COVERAGE_SERIES.length; i++) { cols.push(COVERAGE_SERIES[i].label); keys.push(COVERAGE_SERIES[i].key); }
    for (i = 0; i < SIGNAL_SERIES.length; i++) { cols.push(SIGNAL_SERIES[i].label); keys.push(SIGNAL_SERIES[i].key); }

    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var hrow = document.createElement('tr');
    for (i = 0; i < cols.length; i++) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = cols[i];
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    // Most recent first, capped — the table is a reading aid, not an export.
    var tbody = document.createElement('tbody');
    var rows = samples.slice(-40).reverse();
    for (i = 0; i < rows.length; i++) {
      var pt = rows[i];
      var tr = document.createElement('tr');

      var tdWhen = document.createElement('td');
      tdWhen.textContent = formatDateTime(pt.timestamp);
      tr.appendChild(tdWhen);

      var tdIdx = document.createElement('td');
      tdIdx.textContent = String(num(pt.indexCount));
      tr.appendChild(tdIdx);

      for (var k = 0; k < keys.length; k++) {
        var td = document.createElement('td');
        td.textContent = String(num(pt[keys[k]]));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function updateReadout(meta, text) {
    if (!meta) return;
    var el = meta.querySelector('#' + READOUT_ID);
    if (el) el.textContent = text;
  }

  // ── Canvas ────────────────────────────────────────────────────────────────

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

    var width = Math.max(1, cssW - PAD_LEFT - PAD_RIGHT);
    var p1Top = PAD_TOP;
    var p2Top = PAD_TOP + PANEL1_H + PANEL_GAP;
    return {
      cssW: cssW, cssH: cssH,
      left: PAD_LEFT, width: width,
      panels: [
        { top: p1Top, height: PANEL1_H, bottom: p1Top + PANEL1_H },
        { top: p2Top, height: PANEL2_H, bottom: p2Top + PANEL2_H }
      ]
    };
  }

  function drawBackground(ctx, geom, palette) {
    ctx.clearRect(0, 0, geom.cssW, geom.cssH);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, geom.cssW, geom.cssH);
  }

  function drawEmpty(ctx, geom, palette) {
    ctx.save();
    ctx.fillStyle = palette.text;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(EMPTY_TEXT, geom.left + geom.width / 2, geom.cssH / 2);
    ctx.restore();
  }

  function xAt(geom, samples, i) {
    var n = samples.length;
    if (n <= 1) return geom.left + geom.width / 2;
    var tMin = samples[0].timestamp;
    var tSpan = samples[n - 1].timestamp - tMin || 1;
    return geom.left + ((samples[i].timestamp - tMin) / tSpan) * geom.width;
  }

  /**
   * Draw one stacked-area panel with a real y-axis.
   *
   * Every series in a panel shares `max`, so segment heights are comparable —
   * the defect in the previous chart was scaling each series independently.
   */
  function drawPanel(ctx, samples, geom, palette, panel, series, max, title) {
    var n = samples.length;
    var i, j;

    // Gridlines + y ticks (recessive).
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.fillStyle = palette.text;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (i = 0; i <= 2; i++) {
      var frac = i / 2;
      // +0.5 keeps a 1px line on a device pixel instead of straddling two.
      var gy = Math.round(panel.bottom - frac * panel.height) + 0.5;
      ctx.beginPath();
      ctx.moveTo(geom.left, gy);
      ctx.lineTo(geom.left + geom.width, gy);
      ctx.stroke();
      ctx.fillText(String(Math.round(max * frac)), geom.left - 5, gy);
    }
    ctx.restore();

    // Panel title — ink, not a series colour.
    ctx.save();
    ctx.fillStyle = palette.text;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, geom.left, panel.top - 8);
    ctx.restore();

    if (!n || !(max > 0)) return;

    function yFor(v) {
      return panel.bottom - (v / max) * panel.height;
    }

    // Running baseline per x, so each band stacks on the previous.
    var base = new Array(n);
    for (i = 0; i < n; i++) base[i] = 0;

    for (i = 0; i < series.length; i++) {
      var s = series[i];
      var tops = new Array(n);
      var hasArea = false;
      for (j = 0; j < n; j++) {
        var v = num(samples[j][s.key]);
        if (v > 0) hasArea = true;
        tops[j] = base[j] + v;
      }
      if (hasArea) {
        ctx.save();
        if (n === 1) {
          // A single observation has no width, so the area path collapses to a
          // zero-width sliver and fills nothing — the panel renders as bare
          // axes while the legend below shows real numbers, which reads as
          // "no data" when the data is in fact known. Every fresh deploy and
          // every restart hits this for the first sampling interval, so draw
          // the lone sample as a centred bar instead.
          var cx = xAt(geom, samples, 0);
          var halfW = Math.min(28, geom.width / 6);
          ctx.fillStyle = s.color;
          ctx.fillRect(cx - halfW, yFor(tops[0]), halfW * 2, yFor(base[0]) - yFor(tops[0]));
          if (i < series.length - 1) {
            ctx.strokeStyle = palette.bg;
            ctx.lineWidth = SEGMENT_GAP;
            ctx.beginPath();
            ctx.moveTo(cx - halfW, yFor(tops[0]));
            ctx.lineTo(cx + halfW, yFor(tops[0]));
            ctx.stroke();
          }
        } else {
          ctx.beginPath();
          ctx.moveTo(xAt(geom, samples, 0), yFor(tops[0]));
          for (j = 1; j < n; j++) ctx.lineTo(xAt(geom, samples, j), yFor(tops[j]));
          for (j = n - 1; j >= 0; j--) ctx.lineTo(xAt(geom, samples, j), yFor(base[j]));
          ctx.closePath();
          ctx.fillStyle = s.color;
          ctx.fill();

          // 2px surface gap along the band's upper edge. Drawn in the surface
          // colour rather than by insetting the fill so the separation survives
          // bands that are only a pixel or two tall.
          if (i < series.length - 1) {
            ctx.beginPath();
            ctx.moveTo(xAt(geom, samples, 0), yFor(tops[0]));
            for (j = 1; j < n; j++) ctx.lineTo(xAt(geom, samples, j), yFor(tops[j]));
            ctx.strokeStyle = palette.bg;
            ctx.lineWidth = SEGMENT_GAP;
            ctx.lineJoin = 'round';
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      for (j = 0; j < n; j++) base[j] = tops[j];
    }

    // Baseline.
    ctx.save();
    ctx.strokeStyle = palette.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(geom.left, Math.round(panel.bottom) + 0.5);
    ctx.lineTo(geom.left + geom.width, Math.round(panel.bottom) + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function drawXAxis(ctx, samples, geom, palette) {
    var n = samples.length;
    if (n < 2) return;
    var bottom = geom.panels[1].bottom;
    ctx.save();
    ctx.fillStyle = palette.text;
    ctx.font = '9px system-ui, sans-serif';
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.fillText(formatDate(samples[0].timestamp), geom.left, bottom + 4);

    ctx.textAlign = 'right';
    ctx.fillText(formatDate(samples[n - 1].timestamp), geom.left + geom.width, bottom + 4);

    if (geom.width > 200) {
      ctx.textAlign = 'center';
      var mid = samples[Math.floor(n / 2)];
      ctx.fillText(formatDate(mid.timestamp), geom.left + geom.width / 2, bottom + 4);
    }
    ctx.restore();
  }

  function drawCursor(ctx, samples, geom, palette, hoverIndex) {
    if (hoverIndex === null || hoverIndex === undefined) return;
    if (hoverIndex < 0 || hoverIndex >= samples.length) return;
    var hx = Math.round(xAt(geom, samples, hoverIndex)) + 0.5;
    ctx.save();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1;
    // One crosshair spanning both panels: the panels share an x, so hovering
    // reads coverage and signal composition at the same instant.
    ctx.beginPath();
    ctx.moveTo(hx, geom.panels[0].top);
    ctx.lineTo(hx, geom.panels[0].bottom);
    ctx.moveTo(hx, geom.panels[1].top);
    ctx.lineTo(hx, geom.panels[1].bottom);
    ctx.stroke();
    ctx.restore();
  }

  function computeMaxes(samples) {
    var idxMax = 0;
    var sigMax = 0;
    for (var i = 0; i < samples.length; i++) {
      var pt = samples[i];
      // Panel 1's stack is the coverage split; use its true total so the top
      // band is never clipped if the buckets disagree with indexCount.
      var stack = num(pt.neverUsed) + num(pt.retrievedOnly) + num(pt.signalCount);
      var total = Math.max(num(pt.indexCount), stack);
      if (total > idxMax) idxMax = total;
      var sig = num(pt.sigApplied) + num(pt.sigHelpful) + num(pt.sigNotRelevant) + num(pt.sigOutdated);
      if (sig > sigMax) sigMax = sig;
    }
    return { index: niceMax(idxMax), signal: niceMax(sigMax) };
  }

  function paint(canvas, state, hoverIndex) {
    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) return;

    var geom = sizeCanvas(canvas, ctx);
    state.geom = geom;
    var palette = state.palette || resolvePalette();
    drawBackground(ctx, geom, palette);

    var samples = state.samples;
    if (!samples.length) { drawEmpty(ctx, geom, palette); return; }

    var maxes = computeMaxes(samples);
    drawPanel(ctx, samples, geom, palette, geom.panels[0], COVERAGE_SERIES, maxes.index, 'index composition');
    drawPanel(ctx, samples, geom, palette, geom.panels[1], SIGNAL_SERIES, maxes.signal, 'signals by type');
    drawXAxis(ctx, samples, geom, palette);
    drawCursor(ctx, samples, geom, palette, hoverIndex);
  }

  function indexFromEvent(canvas, state, event) {
    var geom = state.geom;
    var samples = state.samples;
    if (!geom || !samples.length) return null;
    var rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    var x = rect ? (event.clientX - rect.left) : 0;
    var tMin = samples[0].timestamp;
    var tMax = samples[samples.length - 1].timestamp;
    var tSpan = tMax - tMin || 1;
    var ratio = (x - geom.left) / geom.width;
    if (!isFinite(ratio)) return null;
    var targetTs = tMin + ratio * tSpan;

    var lo = 0, hi = samples.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (samples[mid].timestamp < targetTs) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(samples[lo - 1].timestamp - targetTs) < Math.abs(samples[lo].timestamp - targetTs)) lo--;
    return lo;
  }

  function readoutText(pt) {
    return formatDateTime(pt.timestamp) +
      ' — index ' + num(pt.indexCount) +
      ' · never used ' + num(pt.neverUsed) +
      ' · retrieved ' + num(pt.retrievedOnly) +
      ' · signalled ' + num(pt.signalCount) +
      ' (applied ' + num(pt.sigApplied) +
      ', helpful ' + num(pt.sigHelpful) +
      ', not-relevant ' + num(pt.sigNotRelevant) +
      ', outdated ' + num(pt.sigOutdated) + ')';
  }

  function summaryText(samples) {
    if (!samples.length) return EMPTY_TEXT;
    var last = samples[samples.length - 1];
    var span = samples.length > 1
      ? formatDate(samples[0].timestamp) + '–' + formatDate(last.timestamp)
      : formatDate(last.timestamp);
    return samples.length + ' samples (' + span + ') — index ' + num(last.indexCount) +
      ', signalled ' + num(last.signalCount);
  }

  function ensureListeners(canvas, state) {
    if (state.listenersBound) return;
    state.listenersBound = true;
    canvas.addEventListener('mousemove', function (event) {
      var idx = indexFromEvent(canvas, state, event);
      if (idx === null) return;
      updateReadout(state.meta, readoutText(state.samples[idx]));
      paint(canvas, state, idx);
    });
    canvas.addEventListener('mouseleave', function () {
      updateReadout(state.meta, summaryText(state.samples));
      paint(canvas, state, null);
    });
  }

  function ensureResizeBinding() {
    if (window.__catalogChartResizeBound) return;
    window.__catalogChartResizeBound = true;
    window.addEventListener('resize', function () {
      var inst = window.__catalogChartInstance;
      if (!inst || !inst.canvas) return;
      var s = inst.canvas[STATE_KEY];
      if (s) paint(inst.canvas, s, null);
    });
  }

  window.renderCatalogChart = function renderCatalogChart(canvas, catalogHistory) {
    if (!canvas || typeof canvas.getContext !== 'function') return;

    var samples = normalize(Array.isArray(catalogHistory) ? catalogHistory : []);
    var state = getState(canvas);
    state.samples = samples;
    state.palette = resolvePalette();
    state.meta = ensureMeta(canvas);

    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', summaryText(samples));
    updateLegend(state.meta, samples);
    updateTable(state.meta, samples);
    updateReadout(state.meta, summaryText(samples));

    ensureListeners(canvas, state);
    ensureResizeBinding();

    window.__catalogChartInstance = {
      canvas: canvas,
      sampleCount: samples.length,
      destroy: function () {
        state.samples = [];
        if (window.__catalogChartInstance && window.__catalogChartInstance.canvas === canvas) {
          delete window.__catalogChartInstance;
        }
      }
    };
    paint(canvas, state, null);
  };
})(window, document);
