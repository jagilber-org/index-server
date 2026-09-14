/* eslint-disable */
// admin.utils.js
// Shared helper utilities for admin UI. Keep this file small and stable.
(function(window){
  'use strict';

  function escapeHtml(str){
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes){
    const sizes = ['B','KB','MB','GB'];
    if (!bytes) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Resolve a CSS custom property from :root, so JS-drawn surfaces (canvas
   * charts) track the theme instead of duplicating its hex literals.
   *
   * Two non-obvious behaviours, both load-bearing (issue #525, ADR Q7):
   *  - getPropertyValue() returns the declaration text verbatim, which for
   *    `--admin-accent: #3b82f6;` includes the leading space. Untrimmed, that
   *    string is rejected by some canvas colour parsers.
   *  - It returns '' for an unset property, and jsdom returns '' for ALL custom
   *    properties. The fallback is therefore the real path exercised under
   *    test, not defensive dead code.
   *
   * Deliberately uncached: callers resolve their palette once per render pass
   * (see admin.performance.chart.js). Caching here would freeze the theme
   * process-wide and defeat any future light/dark toggle.
   *
   * @param {string} name Custom property name, including the leading `--`.
   * @param {string} fallback Value used when the property resolves empty.
   * @returns {string} Trimmed property value, or fallback.
   */
  function themeVar(name, fallback){
    try {
      var raw = getComputedStyle(document.documentElement).getPropertyValue(name);
      var value = (raw == null ? '' : String(raw)).trim();
      return value || fallback;
    } catch {
      // getComputedStyle throws on a detached/destroyed document. Returning the
      // fallback IS the handling (CQ-6): the caller gets a usable colour and the
      // chart still draws, which is strictly better than propagating.
      return fallback;
    }
  }

  function showError(message){
    const container = document.querySelector('.admin-container');
    if(!container) return;
    document.querySelectorAll('.error, .success').forEach(el => el.remove());
    const d = document.createElement('div'); d.className='error'; d.textContent = message;
    container.insertBefore(d, container.firstChild.nextSibling);
    setTimeout(()=> d.remove(), 5000);
  }

  function showSuccess(message){
    const container = document.querySelector('.admin-container');
    if(!container) return;
    document.querySelectorAll('.error, .success').forEach(el => el.remove());
    const d = document.createElement('div'); d.className='success'; d.textContent = message;
    container.insertBefore(d, container.firstChild.nextSibling);
    setTimeout(()=> d.remove(), 5000);
  }

  /**
   * Show a rate-limit notification banner with countdown timer.
   * Accessible: uses role="alert" and aria-live for screen readers.
   */
  function showRateLimitBanner(retryAfterSeconds, tier) {
    clearRateLimitBanner();
    var container = document.querySelector('.admin-container');
    if (!container) return;
    var banner = document.createElement('div');
    banner.id = 'rate-limit-banner';
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');
    banner.style.cssText = 'background:#f2495c22;border:1px solid #f2495c66;border-radius:6px;padding:10px 16px;margin:8px 0;font-size:13px;color:#f2495c;display:flex;align-items:center;gap:8px;';
    var tierLabel = (tier === 'mutation') ? 'Mutation rate limit' : 'Rate limit';
    var seconds = Math.max(1, Math.round(retryAfterSeconds));
    banner.innerHTML = '<span style="font-size:18px;" aria-hidden="true">🚦</span>'
      + '<span><strong>' + tierLabel + ' exceeded.</strong> Retry in <span id="rl-countdown">' + seconds + '</span> second(s).</span>';
    container.insertBefore(banner, container.firstChild.nextSibling);

    var countdownEl = document.getElementById('rl-countdown');
    var interval = setInterval(function() {
      seconds--;
      if (countdownEl) countdownEl.textContent = String(Math.max(0, seconds));
      if (seconds <= 0) {
        clearInterval(interval);
        clearRateLimitBanner();
      }
    }, 1000);
    banner._rlInterval = interval;
  }

  function clearRateLimitBanner() {
    var existing = document.getElementById('rate-limit-banner');
    if (existing) {
      if (existing._rlInterval) clearInterval(existing._rlInterval);
      existing.remove();
    }
  }

  // Expose minimal API
  window.adminUtils = Object.assign(window.adminUtils || {}, {
    escapeHtml,
    formatBytes,
    showError,
    showSuccess,
    showRateLimitBanner,
    themeVar,
    clearRateLimitBanner
  });
  if (!window.escapeHtml) window.escapeHtml = escapeHtml;
})(window);
