/* eslint-disable */
/**
 * admin.activity.js — catalog activity, the FLOW view (issue #525 follow-up)
 *
 * Counts of discrete events per time bucket, from /api/usage/activity.
 *
 * Drawn as STACKED BARS, not lines. The composition chart above is a stock
 * measure sampled continuously, so a line is honest there. These are counts of
 * things that happened inside a bucket; a line between two buckets would draw
 * values that were never observed, and a quiet Tuesday would read as a smooth
 * slope rather than as nothing happening.
 *
 * Series colours are the validated categorical order (dark steps), checked
 * against this surface (#13151a): worst adjacent CVD dE 8.4, worst adjacent
 * normal-vision dE 19.3, all five >= 3:1 contrast.
 *
 * Instance attribution lives in the table below the chart rather than as extra
 * series: instances come and go, and a chart whose series count changes as
 * processes restart would repaint the survivors on every poll.
 */
(function (window, document) {
  'use strict';

  var CANVAS_ID = 'activity-chart';
  var HOST_ID = 'activity-chart-host';
  var LEGEND_ID = 'activity-legend';
  var READOUT_ID = 'activity-readout';
  var INSTANCES_ID = 'activity-instances';
  var BUCKET_ID = 'activity-bucket';
  var WINDOW_ID = 'activity-window';

  var PAD_LEFT = 34;
  var PAD_RIGHT = 8;
  var PAD_TOP = 10;
  var PLOT_H = 104;
  var XAXIS_H = 16;
  var CHART_HEIGHT = PAD_TOP + PLOT_H + XAXIS_H;
  var FALLBACK_WIDTH = 320;

  // Bars are separated by a surface gap and capped in width so a 7-day view
  // does not render five enormous slabs.
  var BAR_GAP = 2;
  var MAX_BAR_W = 28;
  var SEGMENT_GAP = 2;
  var BAR_RADIUS = 4;

  var REFRESH_MS = 60_000;
  var EMPTY_TEXT = 'No catalog activity recorded in this window';

  // Bottom-to-top. Order is fixed: a colour follows its event type, never its
  // rank, so a quiet period cannot recolour the series that remain.
  // 70% alpha fills to match the muted resource-trend canvas aesthetic.
  // Full-colour swatches kept for the legend so they remain legible.
  var SERIES = [
    { key: 'added',    label: 'added',    color: '#3987e5B3', swatch: '#3987e5' },
    { key: 'modified', label: 'modified', color: '#d95926B3', swatch: '#d95926' },
    { key: 'signaled', label: 'signalled', color: '#199e70B3', swatch: '#199e70' },
    { key: 'archived', label: 'archived', color: '#c98500B3', swatch: '#c98500' },
    { key: 'removed',  label: 'removed',  color: '#d55181B3', swatch: '#d55181' }
  ];

  var state = { buckets: [], instances: [], bucketMs: 86400000, geom: null, palette: null, hover: null, bound: false };

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

  function bucketTotal(b) {
    var t = 0;
    for (var i = 0; i < SERIES.length; i++) t += num(b[SERIES[i].key]);
    return t;
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

  /** Geometry of bucket i's bar. */
  function barRect(geom, count, i) {
    var slot = geom.width / Math.max(1, count);
    var w = Math.max(1, Math.min(MAX_BAR_W, slot - BAR_GAP));
    var cx = geom.left + slot * (i + 0.5);
    return { x: cx - w / 2, w: w, slot: slot, cx: cx };
  }

  /** Rounded only on the top two corners — the data end, anchored to baseline. */
  function topRoundedRect(ctx, x, y, w, h, r) {
    var rr = Math.max(0, Math.min(r, w / 2, h));
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
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

    var buckets = state.buckets;
    if (!buckets.length) {
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
    for (var i = 0; i < buckets.length; i++) peak = Math.max(peak, bucketTotal(buckets[i]));
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

    // Bars.
    for (i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      var rect = barRect(geom, buckets.length, i);
      var y = geom.bottom;

      for (var s = 0; s < SERIES.length; s++) {
        var v = num(b[SERIES[s].key]);
        if (v <= 0) continue;
        var h = (v / max) * geom.height;
        var top = y - h;

        ctx.save();
        ctx.fillStyle = SERIES[s].color;
        // Round only the topmost drawn segment; inner segments stay square so
        // the stack reads as one bar.
        var isTop = true;
        for (var t = s + 1; t < SERIES.length; t++) {
          if (num(b[SERIES[t].key]) > 0) { isTop = false; break; }
        }
        if (isTop) topRoundedRect(ctx, rect.x, top, rect.w, h, BAR_RADIUS);
        else { ctx.beginPath(); ctx.rect(rect.x, top, rect.w, h); }
        ctx.fill();
        ctx.restore();

        // Surface gap between stacked segments.
        if (!isTop) {
          ctx.save();
          ctx.strokeStyle = palette.bg;
          ctx.lineWidth = SEGMENT_GAP;
          ctx.beginPath();
          ctx.moveTo(rect.x, Math.round(top) + 0.5);
          ctx.lineTo(rect.x + rect.w, Math.round(top) + 0.5);
          ctx.stroke();
          ctx.restore();
        }
        y = top;
      }

      if (state.hover === i) {
        ctx.save();
        ctx.strokeStyle = palette.ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x - 1.5, geom.top, rect.w + 3, geom.height);
        ctx.restore();
      }
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
    ctx.fillText(formatBucket(buckets[0].ts, state.bucketMs), geom.left, geom.bottom + 4);
    if (buckets.length > 1) {
      ctx.textAlign = 'right';
      ctx.fillText(formatBucket(buckets[buckets.length - 1].ts, state.bucketMs), geom.left + geom.width, geom.bottom + 4);
    }
    if (geom.width > 220 && buckets.length > 2) {
      ctx.textAlign = 'center';
      var mid = buckets[Math.floor(buckets.length / 2)];
      ctx.fillText(formatBucket(mid.ts, state.bucketMs), geom.left + geom.width / 2, geom.bottom + 4);
    }
    ctx.restore();
  }

  // ── Chrome ────────────────────────────────────────────────────────────────

  function totals(buckets) {
    var acc = { added: 0, modified: 0, signaled: 0, archived: 0, removed: 0, restored: 0, signals: {} };
    for (var i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      acc.added += num(b.added);
      acc.modified += num(b.modified);
      acc.signaled += num(b.signaled);
      acc.archived += num(b.archived);
      acc.removed += num(b.removed);
      acc.restored += num(b.restored);
      var sigs = b.signals || {};
      for (var k in sigs) {
        if (Object.prototype.hasOwnProperty.call(sigs, k)) acc.signals[k] = (acc.signals[k] || 0) + num(sigs[k]);
      }
    }
    return acc;
  }

  function renderLegend(sum) {
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
      sw.style.backgroundColor = s.swatch || s.color;
      var label = document.createElement('span');
      label.textContent = s.label + ' ' + num(sum[s.key]);
      item.appendChild(sw);
      item.appendChild(label);
      legend.appendChild(item);
    }
  }

  function signalBreakdown(sum) {
    var parts = [];
    var order = ['applied', 'helpful', 'not-relevant', 'outdated', 'unspecified'];
    for (var i = 0; i < order.length; i++) {
      var n = num(sum.signals[order[i]]);
      if (n > 0) parts.push(order[i] + ' ' + n);
    }
    // Anything the server reports that is not in the known vocabulary still
    // shows up, rather than being silently dropped from the total.
    for (var k in sum.signals) {
      if (Object.prototype.hasOwnProperty.call(sum.signals, k) && order.indexOf(k) === -1) {
        parts.push(k + ' ' + num(sum.signals[k]));
      }
    }
    return parts.join(', ');
  }

  function setReadout(text) {
    var el = document.getElementById(READOUT_ID);
    if (el) el.textContent = text;
  }

  function renderHealthBanner(health) {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    var existing = host.parentElement.querySelector('.activity-health-banner');
    if (existing) existing.remove();
    if (!health) return;

    var problems = [];
    if (!health.enabled) problems.push('activity logging is disabled (INDEX_SERVER_ACTIVITY_LOG=off or test env)');
    else if (!health.available) problems.push('activity store failed to initialize' + (health.lastError ? ': ' + health.lastError : ''));
    if (health.degraded) problems.push('store is degraded (' + health.writeFailures + ' write failures)');
    if (health.initFailures > 0) problems.push(health.initFailures + ' init failure(s)');
    if (health.available && health.activityCount === 0) problems.push('store is empty — no mutations recorded yet');
    if (!problems.length) return;

    var banner = document.createElement('div');
    banner.className = 'activity-health-banner';
    banner.style.cssText = 'padding:6px 10px;margin-bottom:4px;font:11px/1.4 system-ui,sans-serif;color:#f2a735;background:#2a2210;border:1px solid #4d3a10;border-radius:4px';
    var label = document.createElement('strong');
    label.textContent = 'Activity store: ';
    banner.appendChild(label);
    banner.appendChild(document.createTextNode(problems.join('; ')));
    if (health.file) {
      var fileSpan = document.createElement('span');
      fileSpan.style.cssText = 'display:block;margin-top:2px;color:#8e959e;font-size:10px';
      fileSpan.textContent = 'db: ' + health.file;
      banner.appendChild(fileSpan);
    }
    host.parentElement.insertBefore(banner, host);
  }

  function summaryText(sum, buckets) {
    if (!buckets.length) return EMPTY_TEXT;
    var sig = signalBreakdown(sum);
    return buckets.length + ' buckets — added ' + sum.added + ', modified ' + sum.modified +
      ', archived ' + sum.archived + ', removed ' + sum.removed +
      ', signalled ' + sum.signaled + (sig ? ' (' + sig + ')' : '');
  }

  function bucketText(b) {
    var sig = [];
    var sigs = b.signals || {};
    for (var k in sigs) {
      if (Object.prototype.hasOwnProperty.call(sigs, k)) sig.push(k + ' ' + num(sigs[k]));
    }
    return formatBucket(b.ts, state.bucketMs) + ' — added ' + num(b.added) +
      ', modified ' + num(b.modified) + ', archived ' + num(b.archived) +
      ', removed ' + num(b.removed) + ', signalled ' + num(b.signaled) +
      (sig.length ? ' (' + sig.join(', ') + ')' : '');
  }

  function renderInstances(instances) {
    var host = document.getElementById(INSTANCES_ID);
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    if (!instances.length) return;

    // Collapsed by default. This is one row per instance and instances are
    // ephemeral, so the list grows without bound: a real deployment held 1,068
    // distinct instances over seven days, which buried the chart the table
    // belongs to. <details> gives keyboard and screen-reader behaviour for free
    // and needs no open/close state of our own; the count stays in the summary
    // so the row remains informative while shut.
    // No class here on purpose: the host element already carries
    // .activity-instances, so the descendant table rules still apply and a
    // second copy would double its margin-top.
    var details = document.createElement('details');

    var caption = document.createElement('summary');
    caption.className = 'activity-instances-caption';
    caption.textContent = 'By instance (' + num(instances.length) + ')';
    details.appendChild(caption);

    var table = document.createElement('table');
    var cols = ['instance', 'added', 'modified', 'archived', 'restored', 'removed', 'signalled', 'signal breakdown'];
    var thead = document.createElement('thead');
    var hrow = document.createElement('tr');
    for (var i = 0; i < cols.length; i++) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = cols[i];
      hrow.appendChild(th);
    }
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    for (i = 0; i < instances.length; i++) {
      var inst = instances[i];
      var tr = document.createElement('tr');
      var vals = [
        inst.instance,
        num(inst.added), num(inst.modified), num(inst.archived),
        num(inst.restored), num(inst.removed), num(inst.signaled),
        signalBreakdown({ signals: inst.signals || {} }) || '—'
      ];
      for (var c = 0; c < vals.length; c++) {
        var td = document.createElement('td');
        td.textContent = String(vals[c]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    details.appendChild(table);
    host.appendChild(details);
  }

  function bindCanvas(canvas) {
    if (state.bound) return;
    state.bound = true;

    canvas.addEventListener('mousemove', function (event) {
      var geom = state.geom;
      if (!geom || !state.buckets.length) return;
      var rect = canvas.getBoundingClientRect();
      var x = event.clientX - rect.left;
      var slot = geom.width / state.buckets.length;
      var idx = Math.floor((x - geom.left) / slot);
      if (idx < 0 || idx >= state.buckets.length) idx = null;
      if (idx === state.hover) return;
      state.hover = idx;
      setReadout(idx === null ? summaryText(totals(state.buckets), state.buckets) : bucketText(state.buckets[idx]));
      draw(canvas);
    });

    canvas.addEventListener('mouseleave', function () {
      state.hover = null;
      setReadout(summaryText(totals(state.buckets), state.buckets));
      draw(canvas);
    });

    window.addEventListener('resize', function () { draw(canvas); });
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  function currentQuery() {
    var bucketEl = document.getElementById(BUCKET_ID);
    var windowEl = document.getElementById(WINDOW_ID);
    var bucket = bucketEl ? bucketEl.value : 'day';
    var days = windowEl ? parseInt(windowEl.value, 10) : 30;
    if (!isFinite(days) || days <= 0) days = 30;
    var until = Date.now();
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
      var qs = '?since=' + q.since + '&until=' + q.until + '&bucket=' + encodeURIComponent(q.bucket);
      var res = await auth.adminFetch('/api/usage/activity' + qs);
      if (!res.ok) throw new Error('http ' + res.status);
      var json = await res.json();

      state.buckets = Array.isArray(json.buckets) ? json.buckets : [];
      state.bucketMs = num(json.bucketMs) || 86400000;
      state.palette = resolvePalette();

      renderHealthBanner(json.health || null);

      var sum = totals(state.buckets);
      renderLegend(sum);
      setReadout(summaryText(sum, state.buckets));
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', summaryText(sum, state.buckets));

      bindCanvas(canvas);
      draw(canvas);

      var ires = await auth.adminFetch('/api/usage/activity/instances?since=' + q.since + '&until=' + q.until);
      if (ires.ok) {
        var ijson = await ires.json();
        state.instances = Array.isArray(ijson.instances) ? ijson.instances : [];
        renderInstances(state.instances);
      }
    } catch (e) {
      // Activity telemetry is supplementary; a failure here must not take the
      // Overview panel down with it.
      setReadout('Activity data unavailable');
    }
  }

  function init() {
    var bucketEl = document.getElementById(BUCKET_ID);
    var windowEl = document.getElementById(WINDOW_ID);
    if (bucketEl) bucketEl.addEventListener('change', refresh);
    if (windowEl) windowEl.addEventListener('change', refresh);
    refresh();
    setInterval(refresh, REFRESH_MS);
  }

  window.__adminActivity = { refresh: refresh, _draw: draw, _totals: totals, _state: state, _renderInstances: renderInstances, SERIES: SERIES };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
