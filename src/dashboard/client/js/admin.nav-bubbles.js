/* eslint-disable */
/**
 * admin.nav-bubbles.js — Counter bubbles for Messaging, Instructions, and
 * Feedback nav tabs. Mirrors the Monitoring-tab bubble pattern from
 * admin.events.js: poll lightweight endpoints, show the count of items that
 * arrived since the user last visited the tab, and clear the bubble on click.
 */
(function () {
  'use strict';

  var POLL_MS = 15000;

  function getAdminFetch() {
    return (window.adminAuth && window.adminAuth.adminFetch) || fetch.bind(window);
  }

  var tabs = {
    messaging: {
      bubbleId: 'nav-messaging-bubble',
      current: 0,
      lastSeen: null,
      endpoint: '/api/messages/stats',
      extract: function (d) {
        return d && d.success !== false && typeof d.total === 'number' ? d.total : null;
      }
    },
    instructions: {
      bubbleId: 'nav-instructions-bubble',
      current: 0,
      lastSeen: null,
      endpoint: '/api/instructions',
      extract: function (d) {
        if (!d || d.success === false) return null;
        if (typeof d.count === 'number') return d.count;
        if (Array.isArray(d.instructions)) return d.instructions.length;
        return null;
      }
    },
    feedback: {
      bubbleId: 'nav-feedback-bubble',
      current: 0,
      lastSeen: null,
      endpoint: '/api/admin/feedback',
      extract: function (d) {
        if (!d) return null;
        if (typeof d.total === 'number') return d.total;
        if (Array.isArray(d.entries)) return d.entries.length;
        return null;
      }
    }
  };

  function updateBubble(tabKey) {
    var t = tabs[tabKey];
    var el = document.getElementById(t.bubbleId);
    if (!el) return;
    if (t.lastSeen === null) { el.hidden = true; return; }
    var delta = Math.max(0, t.current - t.lastSeen);
    if (delta > 0) {
      el.textContent = delta > 99 ? '99+' : String(delta);
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  function pollTab(tabKey) {
    var t = tabs[tabKey];
    getAdminFetch()(t.endpoint)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var count = t.extract(data);
        if (count === null) return;
        t.current = count;
        if (window.currentSection === tabKey) { t.lastSeen = count; return; }
        if (t.lastSeen === null) { t.lastSeen = count; return; }
        updateBubble(tabKey);
      })
      .catch(function () { /* ignore */ });
  }

  function pollAll() {
    var keys = Object.keys(tabs);
    for (var i = 0; i < keys.length; i++) pollTab(keys[i]);
  }

  // Reset bubble when user navigates to the tab.
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('[data-section]');
    if (!btn) return;
    var section = btn.getAttribute('data-section');
    if (!tabs[section]) return;
    tabs[section].lastSeen = tabs[section].current;
    updateBubble(section);
  }, true);

  // Instant bubble update for messaging via the shared WebSocket.
  window.dashboardSocketListeners = window.dashboardSocketListeners || [];
  window.dashboardSocketListeners.push(function (msg) {
    if (!msg) return;
    if (msg.type === 'message_received' || msg.type === 'message_purged') {
      pollTab('messaging');
    }
  });

  function start() {
    pollAll();
    setInterval(pollAll, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window._navBubbles = { tabs: tabs, pollTab: pollTab, pollAll: pollAll, updateBubble: updateBubble };
})();
