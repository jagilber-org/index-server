/**
 * admin.embeddings.js — Embeddings Visualization Panel
 *
 * Interactive 2D scatter plot of PCA-projected instruction embeddings.
 * Features: category coloring, norm coloring, HTML tooltips, grid lines,
 *           devicePixelRatio, click-to-inspect, search filter, zoom/pan.
 */
(function () {
  'use strict';

  const CAT_COLORS = {
    'AI/ML': '#e74c3c', 'Azure': '#3498db', 'Service Fabric': '#e67e22',
    'PowerShell': '#2ecc71', 'Agent': '#9b59b6', 'MCP': '#1abc9c',
    'VS Code': '#f39c12', 'Git/Repo': '#34495e', 'Testing': '#16a085',
    'Debugging': '#c0392b', 'Containers': '#8e44ad', 'Security': '#d35400',
    'Runbooks/Guides': '#27ae60', 'Other': '#95a5a6',
  };

  let embData = null;
  let canvas = null;
  let ctx = null;
  let searchTerm = '';
  let highlightCat = null;
  let colorByNorm = false;

  // Data bounds (computed once on load)
  let minX = 0, maxX = 0, minY = 0, maxY = 0, rangeX = 1, rangeY = 1;
  let minNorm = 1, maxNorm = 1;

  // Pan/zoom state
  let panX = 0, panY = 0, zoom = 1;
  let dragging = false, lastMouse = null;
  let selectedIdx = -1;

  function init() {
    canvas = document.getElementById('embeddings-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);

    var searchInput = document.getElementById('emb-search');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        searchTerm = this.value.toLowerCase();
        draw();
      });
    }
  }

  function resize() {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.parentElement.clientWidth;
    var h = canvas.parentElement.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  // ── Data Loading ──────────────────────────────────────────────────────

  window.loadEmbeddings = async function loadEmbeddings() {
    if (!canvas) init();
    var statusEl = document.getElementById('emb-status');
    if (statusEl) statusEl.textContent = 'Loading embeddings\u2026';
    try {
      var res = await fetch('/api/embeddings/projection');
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        if (statusEl) statusEl.textContent = 'Error: ' + (err.error || res.statusText);
        return;
      }
      embData = await res.json();
      computeBounds();
      buildLegend();
      buildStats();
      buildSimilarPairs();
      panX = 0; panY = 0; zoom = 1;
      draw();
      if (statusEl) statusEl.textContent = embData.count + ' embeddings loaded (' + embData.dimensions + 'D \u2192 2D)';
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Failed: ' + e.message;
    }
  };

  function computeBounds() {
    if (!embData || !embData.points.length) return;
    var pts = embData.points;
    minX = maxX = pts[0].x;
    minY = maxY = pts[0].y;
    minNorm = maxNorm = pts[0].norm || 1;
    for (var i = 1; i < pts.length; i++) {
      if (pts[i].x < minX) minX = pts[i].x;
      if (pts[i].x > maxX) maxX = pts[i].x;
      if (pts[i].y < minY) minY = pts[i].y;
      if (pts[i].y > maxY) maxY = pts[i].y;
      var n = pts[i].norm || 1;
      if (n < minNorm) minNorm = n;
      if (n > maxNorm) maxNorm = n;
    }
    rangeX = maxX - minX || 1;
    rangeY = maxY - minY || 1;
  }

  // ── Coordinate transforms ────────────────────────────────────────────

  function toScreen(px, py) {
    var w = canvas.width / (window.devicePixelRatio || 1);
    var h = canvas.height / (window.devicePixelRatio || 1);
    var pad = 40;
    var sx = pad + ((px - minX) / rangeX) * (w - 2 * pad);
    var sy = pad + ((py - minY) / rangeY) * (h - 2 * pad);
    return [(sx - w / 2) * zoom + w / 2 + panX, (sy - h / 2) * zoom + h / 2 + panY];
  }

  // ── Category & UI builders ────────────────────────────────────────────

  function catColor(cat) {
    return CAT_COLORS[cat] || '#95a5a6';
  }

  function normColor(n) {
    var t = (n - minNorm) / (maxNorm - minNorm || 1);
    return 'rgb(' + Math.round(30 + t * 225) + ',' + Math.round(180 - t * 100) + ',' + Math.round(255 - t * 200) + ')';
  }

  function buildLegend() {
    var el = document.getElementById('emb-legend');
    if (!el || !embData) return;
    // Count per category
    var counts = {};
    for (var i = 0; i < embData.points.length; i++) {
      var c = embData.points[i].category || 'Other';
      counts[c] = (counts[c] || 0) + 1;
    }
    var cats = Object.keys(counts).sort();
    if (!cats.length) { el.innerHTML = '<span class="emb-status-text">No category data</span>'; return; }
    el.innerHTML = cats.map(function (c) {
      return '<div class="emb-cat-item" data-cat="' + c + '">' +
        '<div class="emb-cat-dot" style="background:' + catColor(c) + '"></div>' +
        c + ' (' + counts[c] + ')</div>';
    }).join('');
    el.querySelectorAll('.emb-cat-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var cat = item.getAttribute('data-cat');
        highlightCat = highlightCat === cat ? null : cat;
        el.querySelectorAll('.emb-cat-item').forEach(function (e) { e.style.background = ''; });
        if (highlightCat) item.style.background = 'var(--admin-surface-alt)';
        draw();
      });
    });
  }

  function buildStats() {
    var el = document.getElementById('emb-stats');
    if (!el || !embData) return;
    var s = embData.stats || {};
    var hash = embData.indexHash || '';
    var shortHash = hash.length > 16 ? hash.substring(0, 16) + '\u2026' : (hash || '?');
    el.innerHTML =
      stat('Instructions', embData.count) +
      stat('Dimensions', embData.dimensions) +
      stat('Model', embData.model || '?') +
      stat('index Hash', '<span title="' + hash + '">' + shortHash + '</span>') +
      stat('Avg Cosine Sim', s.avgCosineSim) +
      stat('Min / Max Sim', (s.minCosineSim || '?') + ' / ' + (s.maxCosineSim || '?')) +
      stat('Avg Norm', s.avgNorm);
  }
  function stat(label, value) {
    return '<div class="emb-stat"><span class="label">' + label + ':</span> <span class="value">' + value + '</span></div>';
  }

  function buildSimilarPairs() {
    var el = document.getElementById('emb-similar');
    if (!el || !embData || !embData.similarPairs) return;
    if (!embData.similarPairs.length) { el.innerHTML = '<em class="emb-status-text">No similar pairs</em>'; return; }
    el.innerHTML = embData.similarPairs.slice(0, 10).map(function (p) {
      var aShort = p.a.length > 30 ? p.a.substring(0, 30) : p.a;
      var bShort = p.b.length > 30 ? p.b.substring(0, 30) : p.b;
      return '<div class="emb-pair"><span class="sim">' + p.similarity + '</span> ' + aShort + ' \u2194 ' + bShort + '</div>';
    }).join('');
  }

  // ── Drawing ───────────────────────────────────────────────────────────

  function draw() {
    if (!ctx || !canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.width / dpr;
    var h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    if (!embData || !embData.points.length) {
      ctx.fillStyle = '#8e959e';
      ctx.font = '14px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Click "Load" to visualize embeddings', w / 2, h / 2);
      ctx.textAlign = 'start';
      return;
    }

    // Grid
    ctx.strokeStyle = '#21262d';
    ctx.lineWidth = 0.5;
    for (var gi = 0; gi <= 10; gi++) {
      var gx = (gi / 10) * rangeX + minX;
      var gy = (gi / 10) * rangeY + minY;
      var sx1 = toScreen(gx, minY)[0];
      var sy1 = toScreen(minX, gy)[1];
      ctx.beginPath(); ctx.moveTo(sx1, 0); ctx.lineTo(sx1, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, sy1); ctx.lineTo(w, sy1); ctx.stroke();
    }

    // Points
    var search = searchTerm;
    var pts = embData.points;
    for (var i = 0; i < pts.length; i++) {
      var pt = pts[i];
      var scr = toScreen(pt.x, pt.y);
      var sx = scr[0], sy = scr[1];
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

      var matchSearch = !search || pt.id.toLowerCase().indexOf(search) !== -1;
      var matchCat = !highlightCat || pt.category === highlightCat;
      var highlighted = matchSearch && matchCat;

      var color = colorByNorm ? normColor(pt.norm || 1) : catColor(pt.category);
      ctx.globalAlpha = highlighted ? 0.9 : 0.12;
      ctx.fillStyle = color;
      ctx.beginPath();
      var r = highlighted ? (4 * Math.sqrt(zoom)) : (2.5 * Math.sqrt(zoom));
      r = Math.max(r, 1.5);
      if (i === selectedIdx) r *= 1.5;
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();

      // Label on search match when zoomed
      if (highlighted && search && zoom > 1.5) {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#c9d1d9';
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.fillText(pt.id.substring(0, 25), sx + r + 3, sy + 3);
      }
    }
    ctx.globalAlpha = 1;

    // Axis labels
    ctx.fillStyle = '#484f58';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillText('PC1 \u2192', w - 50, h - 8);
    ctx.save();
    ctx.translate(12, 50);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('\u2190 PC2', 0, 0);
    ctx.restore();
  }

  // ── Interaction ───────────────────────────────────────────────────────

  function hitTest(mx, my) {
    if (!embData) return -1;
    var closest = -1, closestDist = 15;
    for (var i = 0; i < embData.points.length; i++) {
      var scr = toScreen(embData.points[i].x, embData.points[i].y);
      var d = Math.hypot(scr[0] - mx, scr[1] - my);
      if (d < closestDist) { closest = i; closestDist = d; }
    }
    return closest;
  }

  function onMouseMove(e) {
    var mx = e.offsetX, my = e.offsetY;
    if (dragging && lastMouse) {
      panX += mx - lastMouse.x;
      panY += my - lastMouse.y;
      lastMouse = { x: mx, y: my };
      draw();
      return;
    }
    // HTML tooltip
    var tooltip = document.getElementById('emb-tooltip');
    var idx = hitTest(mx, my);
    if (idx >= 0 && embData) {
      var pt = embData.points[idx];
      canvas.style.cursor = 'pointer';
      if (tooltip) {
        tooltip.style.display = 'block';
        tooltip.style.left = (mx + 16) + 'px';
        tooltip.style.top = (my - 10) + 'px';
        tooltip.innerHTML =
          '<div class="tt-id">' + pt.id + '</div>' +
          '<div class="tt-cat">Category: ' + (pt.category || 'Other') + '</div>' +
          '<div class="tt-norm">Norm: ' + (pt.norm ? pt.norm.toFixed(4) : '?') + '</div>' +
          '<div>PC1: ' + pt.x.toFixed(4) + ', PC2: ' + pt.y.toFixed(4) + '</div>';
      }
    } else {
      canvas.style.cursor = 'default';
      if (tooltip) tooltip.style.display = 'none';
    }
  }

  function onClick(e) {
    var mx = e.offsetX, my = e.offsetY;
    selectedIdx = hitTest(mx, my);
    var detailEl = document.getElementById('emb-detail');
    if (detailEl && selectedIdx >= 0 && embData) {
      var pt = embData.points[selectedIdx];
      detailEl.innerHTML =
        '<b>' + pt.id + '</b>' +
        (pt.title ? '<br>' + pt.title : '') +
        (pt.category ? '<br>Category: ' + pt.category : '') +
        '<br>Norm: ' + (pt.norm ? pt.norm.toFixed(4) : '?') +
        '<br>Position: (' + pt.x.toFixed(4) + ', ' + pt.y.toFixed(4) + ')';
    } else if (detailEl) {
      detailEl.innerHTML = '<em style="color:var(--admin-text-dim)">Click a point to inspect</em>';
    }
    draw();
  }

  function onWheel(e) {
    e.preventDefault();
    var factor = e.deltaY > 0 ? 0.9 : 1.1;
    var mx = e.offsetX, my = e.offsetY;
    panX = mx - factor * (mx - panX);
    panY = my - factor * (my - panY);
    zoom *= factor;
    draw();
  }

  function onMouseDown(e) {
    dragging = true;
    lastMouse = { x: e.offsetX, y: e.offsetY };
    canvas.style.cursor = 'grabbing';
  }

  function onMouseUp() {
    dragging = false;
    lastMouse = null;
    canvas.style.cursor = 'default';
  }

  function onMouseLeave() {
    var tooltip = document.getElementById('emb-tooltip');
    if (tooltip) tooltip.style.display = 'none';
    dragging = false;
    lastMouse = null;
  }

  // ── Public API ────────────────────────────────────────────────────────

  window.resetEmbeddingsView = function () {
    panX = 0; panY = 0; zoom = 1;
    draw();
  };

  window.toggleNormColor = function () {
    colorByNorm = !colorByNorm;
    var btn = document.getElementById('emb-norm-btn');
    if (btn) {
      if (colorByNorm) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    draw();
  };

  // Hook into showSection for lazy-load
  var origShowSection = window.showSection;
  window.showSection = function (name) {
    if (origShowSection) origShowSection(name);
    if (name === 'embeddings' && !embData) {
      setTimeout(init, 50);
    }
  };

  window.computeEmbeddings = async function computeEmbeddings() {
    if (!canvas) init();
    var statusEl = document.getElementById('emb-status');
    if (statusEl) statusEl.textContent = 'Computing embeddings (model download on first run)…';
    try {
      var res = await fetch('/api/embeddings/compute', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        if (statusEl) statusEl.textContent = 'Error: ' + (err.error || res.statusText) + (err.hint ? ' — ' + err.hint : '');
        return;
      }
      var result = await res.json();
      if (statusEl) statusEl.textContent = 'Computed ' + result.count + ' embeddings (' + result.model + ', ' + result.elapsedMs + 'ms). Loading visualization…';
      // Auto-load the projection after compute
      await window.loadEmbeddings();
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Compute failed: ' + e.message;
    }
  };

  // ── Event delegation for CSP-safe buttons ────────────────────────────
  var embSection = document.getElementById('embeddings-section');
  if (embSection) {
    embSection.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-emb-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-emb-action');
      if (action === 'compute') window.computeEmbeddings();
      else if (action === 'load') window.loadEmbeddings();
      else if (action === 'reset') window.resetEmbeddingsView();
      else if (action === 'norm') window.toggleNormColor();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var sec = document.getElementById('embeddings-section');
    if (sec && !sec.classList.contains('hidden')) {
      init();
    }
  });
})();
