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
    clearRateLimitBanner
  });
  if (!window.escapeHtml) window.escapeHtml = escapeHtml;
})(window);
