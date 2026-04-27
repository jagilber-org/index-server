/* eslint-disable */
// admin.auth.js
// Dashboard authentication — manages admin API key for non-loopback access.
// Token is held in module-scoped memory only (never written to sessionStorage
// or localStorage). It is cleared on tab close / reload by virtue of being a
// JavaScript variable, and cleared on 401/403 + explicit logout. On 401/403,
// shows a login modal and retries the request once after the user enters a
// key. This avoids js/clear-text-storage-of-sensitive-data exposure to XSS.
(function(window) {
  'use strict';

  // In-memory only. Re-prompt on page reload.
  var _token = '';
  var _loginPromise = null;
  var _overlay = null;

  function getToken() {
    return _token || '';
  }

  function setToken(token) {
    _token = token ? String(token) : '';
  }

  function clearToken() {
    _token = '';
  }

  function isAuthenticated() {
    return !!_token;
  }

  function applyAuthHeader(headers, token) {
    if (!token) return headers;
    if (headers instanceof Headers) {
      headers.set('Authorization', 'Bearer ' + token);
    } else {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return headers;
  }

  // Drop-in replacement for fetch() that injects auth and handles 401/403.
  async function adminFetch(url, options) {
    options = Object.assign({}, options);
    options.headers = options.headers instanceof Headers
      ? new Headers(options.headers)
      : Object.assign({}, options.headers);
    applyAuthHeader(options.headers, getToken());

    var response = await fetch(url, options);

    // Rate-limit detection: surface 429 visibly (issue #63)
    if (response.status === 429) {
      try {
        var rlBody = await response.clone().json();
        var retryAfter = rlBody.retryAfterSeconds || Number(response.headers.get('Retry-After')) || 60;
        var tier = rlBody.tier || 'global';
        if (window.adminUtils && window.adminUtils.showRateLimitBanner) {
          window.adminUtils.showRateLimitBanner(retryAfter, tier);
        }
      } catch (_e) { /* couldn't parse 429 body — still return the response */ }
      return response;
    }

    if (response.status !== 401 && response.status !== 403) return response;

    // Deduplicate: if login prompt is already showing, wait for the same promise
    if (!_loginPromise) {
      _loginPromise = showLoginPrompt().finally(function() { _loginPromise = null; });
    }

    try {
      await _loginPromise;
    } catch (_) {
      // User dismissed — return original failed response
      return response;
    }

    // Retry once with the newly-stored token
    var retryOpts = Object.assign({}, options);
    retryOpts.headers = options.headers instanceof Headers
      ? new Headers(options.headers)
      : Object.assign({}, options.headers);
    applyAuthHeader(retryOpts.headers, getToken());
    return fetch(url, retryOpts);
  }

  // ── Login modal ────────────────────────────────────────────────────────
  function ensureOverlay() {
    if (_overlay) return _overlay;
    _overlay = document.createElement('div');
    _overlay.className = 'auth-overlay';
    _overlay.innerHTML =
      '<div class="auth-modal">' +
        '<h3>🔑 Authentication Required</h3>' +
        '<p class="auth-hint">Enter the admin API key ' +
          '(<code>INDEX_SERVER_ADMIN_API_KEY</code>).</p>' +
        '<input type="password" class="auth-key-input form-input" ' +
          'placeholder="Admin API key…" autocomplete="off" spellcheck="false">' +
        '<div class="auth-error"></div>' +
        '<div class="auth-actions">' +
          '<button class="auth-submit-btn btn">Authenticate</button>' +
          '<button class="auth-dismiss-btn btn btn-secondary">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(_overlay);
    return _overlay;
  }

  function showLoginPrompt() {
    return new Promise(function(resolve, reject) {
      var ov = ensureOverlay();
      ov.style.display = 'flex';
      var input   = ov.querySelector('.auth-key-input');
      var errEl   = ov.querySelector('.auth-error');
      var submitBtn  = ov.querySelector('.auth-submit-btn');
      var dismissBtn = ov.querySelector('.auth-dismiss-btn');

      input.value = '';
      errEl.textContent = '';
      input.focus();

      function cleanup() {
        submitBtn.onclick = null;
        dismissBtn.onclick = null;
        input.onkeydown = null;
        ov.style.display = 'none';
      }

      function submit() {
        var key = input.value.trim();
        if (!key) { errEl.textContent = 'Please enter a key'; return; }
        setToken(key);
        cleanup();
        updateAuthIndicator();
        resolve();
      }

      function dismiss() {
        cleanup();
        reject(new Error('dismissed'));
      }

      submitBtn.onclick  = submit;
      dismissBtn.onclick = dismiss;
      input.onkeydown = function(e) {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') dismiss();
      };
    });
  }

  // ── Header auth indicator ──────────────────────────────────────────────
  function updateAuthIndicator() {
    var badge = document.getElementById('auth-indicator');
    if (!badge) return;
    if (isAuthenticated()) {
      badge.textContent = '🔓 Authenticated';
      badge.className = 'auth-indicator auth-ok';
      badge.title = 'Admin API key active (in-memory; cleared on reload). Click to logout.';
      badge.onclick = logout;
      badge.style.cursor = 'pointer';
    } else {
      badge.textContent = '';
      badge.className = 'auth-indicator';
      badge.onclick = null;
      badge.style.cursor = '';
    }
  }

  function logout() {
    clearToken();
    updateAuthIndicator();
    location.reload();
  }

  // Initialize indicator on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateAuthIndicator);
  } else {
    updateAuthIndicator();
  }

  window.adminAuth = {
    getToken: getToken,
    setToken: setToken,
    clearToken: clearToken,
    isAuthenticated: isAuthenticated,
    adminFetch: adminFetch,
    logout: logout
  };
})(window);
