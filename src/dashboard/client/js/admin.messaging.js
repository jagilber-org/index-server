/* global adminAuth */
/**
 * admin.messaging.js — Dashboard messaging panel (enriched).
 *
 * Rich card-based messaging UI with channel/sender sidebar,
 * toolbar filters, sort, view modes, multi-select, edit, and detail modals.
 */
(function () {
  'use strict';

  const PAGE_SIZE = 50;
  // Poll cadence. Messages written by *other* processes (agents talking to the
  // stdio MCP server) never produce a WebSocket event in this process, so
  // polling — not the socket — is what actually keeps this tab current.
  const AUTO_REFRESH_MS = 15000;
  const AUTO_REFRESH_STORAGE_KEY = 'msgAutoRefresh';
  let _loaded = false;
  let _allMessages = [];
  let _channels = [];
  let _currentChannel = null;
  let _currentSender = null;
  let _currentPage = 0;
  let _filterText = '';
  let _priorityFilter = '';
  let _sortMode = 'newest';
  let _viewMode = 'list';
  let _selected = new Set();
  let _autoRefreshEnabled = readAutoRefreshPref();
  let _autoRefreshTimer = null;
  let _immediateTimer = null;
  let _refreshInFlight = false;
  let _signature = '';
  let _lastRefreshAt = 0;
  let _lastBlockedReason = null;

  // ── Public API ──────────────────────────────────────────────────────────

  window.initMessaging = async function () {
    if (_loaded) {
      // Re-entering the tab: pull anything that landed while we were away.
      scheduleImmediateRefresh(0);
      return;
    }
    _loaded = true;
    setupDelegation();
    await loadChannels();
    _allMessages = await fetchAllMessages();
    _signature = computeSignature();
    _lastRefreshAt = Date.now();
    renderSidebar();
    renderMessages();
    syncAutoRefreshToggle();
    startAutoRefreshLoop();
  };

  // ── Event Delegation (CSP-safe — no inline handlers) ───────────────────

  function setupDelegation() {
    const section = document.getElementById('messaging-section');
    if (!section || section._delegated) return;
    section._delegated = true;

    section.addEventListener('click', function (e) {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;

      if (action === 'stop-propagation') {
        e.stopPropagation();
        return;
      }
      if (action === 'select-channel') {
        window.selectChannel(el.dataset.channel || null);
        return;
      }
      if (action === 'select-sender') {
        window.selectSender(el.dataset.sender || null);
        return;
      }
      if (action === 'page') {
        window.msgPage(parseInt(el.dataset.delta, 10));
        return;
      }
      if (action === 'detail') {
        window.msgDetail(el.dataset.id);
        return;
      }
      if (action === 'edit') {
        window.msgEdit(el.dataset.id);
        return;
      }
      if (action === 'delete') {
        window.msgDelete(el.dataset.id);
        return;
      }
      if (action === 'close-modal') {
        const detail = document.getElementById('messaging-detail');
        if (detail) detail.innerHTML = '';
        return;
      }
      if (action === 'close-and-edit') {
        const detail = document.getElementById('messaging-detail');
        if (detail) detail.innerHTML = '';
        window.msgEdit(el.dataset.id);
        return;
      }
      if (action === 'save-edit') {
        window.msgSaveEdit(el.dataset.id);
        return;
      }
      if (action === 'view-mode') {
        window.msgViewMode(el.dataset.mode);
        return;
      }
      if (action === 'refresh') {
        window.msgRefresh();
        return;
      }
      if (action === 'download') {
        window.msgDownload();
        return;
      }
      if (action === 'delete-selected') {
        window.msgDeleteSelected();
        return;
      }
      if (action === 'send') {
        window.msgSend();
        return;
      }
    });

    // Prevent modal content clicks from closing the overlay
    section.addEventListener('click', function (e) {
      if (e.target.closest('.msg-modal') && !e.target.closest('[data-action="close-modal"]') && !e.target.closest('[data-action="close-and-edit"]') && !e.target.closest('[data-action="save-edit"]')) {
        e.stopPropagation();
      }
    }, true); // capture phase

    section.addEventListener('change', function (e) {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      if (el.dataset.action === 'toggle-select') {
        window.msgToggleSelect(el.dataset.id, el.checked);
      }
      if (el.dataset.action === 'select-all') {
        window.msgSelectAll(el.checked);
      }
      if (el.dataset.action === 'filter-priority') {
        window.msgFilterPriority(el.value);
      }
      if (el.dataset.action === 'sort') {
        window.msgSort(el.value);
      }
      if (el.dataset.action === 'toggle-auto-refresh') {
        window.msgSetAutoRefresh(el.checked);
      }
    });

    section.addEventListener('input', function (e) {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      if (el.dataset.action === 'filter-input') {
        window.msgFilter(el.value);
      }
    });
  }

  // ── Data Loading ────────────────────────────────────────────────────────

  async function loadChannels() {
    try {
      const res = await adminAuth.adminFetch('/api/messages/channels');
      const data = await res.json();
      _channels = data.channels || [];
    } catch (e) {
      console.warn('Failed to load channels', e);
      _channels = [];
    }
  }

  /**
   * Fetch every channel's messages and return them as a new sorted array.
   *
   * Deliberately returns instead of assigning: the auto-refresh path must be
   * able to fetch, then re-check the user-activity guards, and only *then*
   * commit the result. Assigning here would mutate the model out from under
   * an open modal or an in-progress edit.
   */
  async function fetchAllMessages() {
    const collected = [];
    try {
      const fetches = _channels.map(ch =>
        adminAuth.adminFetch(`/api/messages/${encodeURIComponent(ch.channel)}?reader=*&limit=500`)
          .then(r => r.json())
          .then(d => d.messages || [])
          .catch(() => [])
      );
      const results = await Promise.all(fetches);
      for (const msgs of results) collected.push(...msgs);
      collected.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
      console.warn('Failed to load messages', e);
    }
    return collected;
  }

  async function loadAllMessages() {
    _allMessages = await fetchAllMessages();
  }

  // ── Sidebar ─────────────────────────────────────────────────────────────

  function renderSidebar() {
    renderChannelList();
    renderSenderList();
    const summary = document.getElementById('msg-summary');
    if (summary) {
      const chCount = _channels.length;
      summary.textContent = `${_allMessages.length} msgs · ${chCount} ch`;
    }
  }

  function renderChannelList() {
    const list = document.getElementById('messaging-channel-list');
    if (!list) return;
    const totalCount = _allMessages.length;
    let html = `<div class="msg-sidebar-item ${!_currentChannel ? 'active' : ''}"
                     data-action="select-channel" data-channel="">
                  <span>All Channels</span>
                  <span class="msg-sidebar-badge">${totalCount}</span>
                </div>`;
    for (const ch of _channels) {
      const active = _currentChannel === ch.channel ? 'active' : '';
      html += `<div class="msg-sidebar-item ${active}"
                    data-action="select-channel" data-channel="${esc(ch.channel)}">
                 <span>${esc(ch.channel)}</span>
                 <span class="msg-sidebar-badge">${ch.messageCount}</span>
               </div>`;
    }
    list.innerHTML = html;
  }

  function renderSenderList() {
    const list = document.getElementById('messaging-sender-list');
    if (!list) return;
    const senderMap = {};
    for (const m of _allMessages) {
      senderMap[m.sender] = (senderMap[m.sender] || 0) + 1;
    }
    const senders = Object.entries(senderMap).sort((a, b) => b[1] - a[1]);
    let html = `<div class="msg-sidebar-item ${!_currentSender ? 'active' : ''}"
                     data-action="select-sender" data-sender="">
                  <span>All Senders</span>
                  <span class="msg-sidebar-badge">${_allMessages.length}</span>
                </div>`;
    for (const [name, count] of senders) {
      const active = _currentSender === name ? 'active' : '';
      html += `<div class="msg-sidebar-item ${active}"
                    data-action="select-sender" data-sender="${esc(name)}">
                 <span>${esc(name)}</span>
                 <span class="msg-sidebar-badge">${count}</span>
               </div>`;
    }
    list.innerHTML = html;
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  function getFiltered() {
    let filtered = _allMessages;
    if (_currentChannel) filtered = filtered.filter(m => m.channel === _currentChannel);
    if (_currentSender) filtered = filtered.filter(m => m.sender === _currentSender);
    if (_priorityFilter) filtered = filtered.filter(m => (m.priority || 'normal') === _priorityFilter);
    if (_filterText) {
      const lower = _filterText.toLowerCase();
      filtered = filtered.filter(m =>
        m.body.toLowerCase().includes(lower) ||
        m.sender.toLowerCase().includes(lower) ||
        m.channel.toLowerCase().includes(lower) ||
        (m.tags || []).some(t => t.toLowerCase().includes(lower))
      );
    }
    // Sort
    if (_sortMode === 'oldest') {
      filtered = [...filtered].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (_sortMode === 'priority') {
      const prio = { critical: 0, high: 1, normal: 2, low: 3 };
      filtered = [...filtered].sort((a, b) => (prio[a.priority || 'normal'] || 2) - (prio[b.priority || 'normal'] || 2));
    }
    return filtered;
  }

  function renderMessages() {
    const container = document.getElementById('messaging-message-list');
    if (!container) return;

    const filtered = getFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    _currentPage = Math.min(_currentPage, totalPages - 1);
    const start = _currentPage * PAGE_SIZE;
    const page = filtered.slice(start, start + PAGE_SIZE);

    // Count display
    const countEl = document.getElementById('msg-count');
    if (countEl) countEl.textContent = `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length}`;

    // Pagination
    const pager = document.getElementById('messaging-pagination');
    if (pager) {
      pager.innerHTML = totalPages > 1
        ? `<button data-action="page" data-delta="-1" ${_currentPage === 0 ? 'disabled' : ''}>&laquo; Prev</button>
           <span>Page ${_currentPage + 1} of ${totalPages}</span>
           <button data-action="page" data-delta="1" ${_currentPage >= totalPages - 1 ? 'disabled' : ''}>Next &raquo;</button>`
        : '';
    }

    if (page.length === 0) {
      container.innerHTML = '<div class="msg-empty">No messages found</div>';
      return;
    }

    const timelineClass = _viewMode === 'timeline' ? ' msg-timeline' : '';
    container.innerHTML = `<div class="${timelineClass}">${page.map(renderCard).join('')}</div>`;
  }

  function renderCard(m) {
    const checked = _selected.has(m.id) ? 'checked' : '';
    const selectedClass = _selected.has(m.id) ? ' selected' : '';
    const priority = m.priority || 'normal';
    const title = extractTitle(m.body);
    const bodyPreview = extractBody(m.body, title);
    const recipients = (m.recipients || ['*']).join(', ');
    const dateStr = formatDate(m.createdAt);

    // Build tags
    let tags = '';
    if (priority !== 'normal') tags += `<span class="msg-tag tag-priority-${priority}">${priority}</span>`;
    if (m.requiresAck) tags += '<span class="msg-tag tag-ack-required">ack-required</span>';
    if (m.persistent) tags += '<span class="msg-tag tag-persistent">📌 persistent</span>';
    if (m.tags?.length) {
      for (const t of m.tags) {
        const cls = getTagClass(t);
        tags += `<span class="msg-tag${cls}">${esc(t)}</span>`;
      }
    }

    return `
      <div class="msg-card priority-${priority}${selectedClass}" data-id="${esc(m.id)}">
        <div class="msg-card-header">
          <input type="checkbox" class="msg-card-checkbox" ${checked}
                 data-action="toggle-select" data-id="${esc(m.id)}" />
          <span class="msg-card-sender">${esc(m.sender)}</span>
          <span class="msg-card-route">
            <span class="channel-tag">#${esc(m.channel)}</span>
            <span class="route-arrow">→</span>
            <span class="recipient-tag">${esc(recipients)}</span>
          </span>
          <span class="msg-card-date">${dateStr}</span>
        </div>
        <div class="msg-card-body-wrap">
          ${title ? `<div class="msg-card-title" data-action="detail" data-id="${esc(m.id)}">${esc(title)}</div>` : ''}
          <div class="msg-card-body">${esc(bodyPreview)}</div>
        </div>
        <div class="msg-card-footer">
          ${tags}
          <span class="msg-card-actions">
            <button class="msg-action-btn btn-view" data-action="detail" data-id="${esc(m.id)}">👁 View</button>
            <button class="msg-action-btn btn-edit" data-action="edit" data-id="${esc(m.id)}">✏ Edit</button>
            <button class="msg-action-btn btn-delete" data-action="delete" data-id="${esc(m.id)}" title="Delete">🗑</button>
          </span>
          <span class="msg-card-id">${esc(m.id)}</span>
        </div>
      </div>`;
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  window.selectChannel = function (channel) {
    _currentChannel = channel;
    _currentPage = 0;
    renderSidebar();
    renderMessages();
  };

  window.selectSender = function (sender) {
    _currentSender = sender;
    _currentPage = 0;
    renderSidebar();
    renderMessages();
  };

  window.msgPage = function (delta) {
    _currentPage = Math.max(0, _currentPage + delta);
    renderMessages();
  };

  window.msgFilter = function (text) {
    _filterText = text;
    _currentPage = 0;
    renderMessages();
  };

  window.msgFilterPriority = function (priority) {
    _priorityFilter = priority;
    _currentPage = 0;
    renderMessages();
  };

  window.msgSort = function (mode) {
    _sortMode = mode;
    _currentPage = 0;
    renderMessages();
  };

  window.msgViewMode = function (mode) {
    _viewMode = mode;
    document.getElementById('msg-view-list')?.classList.toggle('active', mode === 'list');
    document.getElementById('msg-view-timeline')?.classList.toggle('active', mode === 'timeline');
    renderMessages();
  };

  window.msgSelectAll = function (checked) {
    const filtered = getFiltered();
    const start = _currentPage * PAGE_SIZE;
    const page = filtered.slice(start, start + PAGE_SIZE);
    for (const m of page) {
      if (checked) _selected.add(m.id); else _selected.delete(m.id);
    }
    syncDeleteSelectedBtn();
    renderMessages();
  };

  window.msgToggleSelect = function (id, checked) {
    if (checked) _selected.add(id); else _selected.delete(id);
    // Update select-all checkbox state
    const cb = document.getElementById('msg-select-all');
    if (cb) cb.checked = false;
    syncDeleteSelectedBtn();
  };

  window.msgDetail = function (id) {
    const msg = _allMessages.find(m => m.id === id);
    if (!msg) return;
    const detail = document.getElementById('messaging-detail');
    if (!detail) return;

    detail.innerHTML = `
      <div class="msg-overlay" data-action="close-modal">
        <div class="msg-modal" data-action="stop-propagation">
          <h3>Message Details</h3>
          <table class="msg-modal-table">
            <tr><td>ID</td><td>${esc(msg.id)}</td></tr>
            <tr><td>Channel</td><td>#${esc(msg.channel)}</td></tr>
            <tr><td>Sender</td><td>${esc(msg.sender)}</td></tr>
            <tr><td>Recipients</td><td>${esc((msg.recipients || []).join(', '))}</td></tr>
            <tr><td>Created</td><td>${msg.createdAt}</td></tr>
            <tr><td>TTL</td><td>${msg.persistent ? 'Persistent' : (msg.ttlSeconds || 0) + 's'}</td></tr>
            <tr><td>Priority</td><td>${msg.priority || 'normal'}</td></tr>
            <tr><td>Read By</td><td>${(msg.readBy || []).join(', ') || 'none'}</td></tr>
            ${msg.parentId ? `<tr><td>Parent</td><td>${esc(msg.parentId)}</td></tr>` : ''}
            ${msg.tags?.length ? `<tr><td>Tags</td><td>${msg.tags.map(t => `<span class="msg-tag">${esc(t)}</span>`).join(' ')}</td></tr>` : ''}
            ${msg.origin ? `<tr><td>Origin</td><td>${esc(msg.origin)}</td></tr>` : ''}
          </table>
          <div class="msg-modal-body"><pre>${esc(msg.body)}</pre></div>
          ${msg.payload ? `<div class="msg-modal-body"><strong>Payload</strong><pre>${esc(JSON.stringify(msg.payload, null, 2))}</pre></div>` : ''}
          <div class="msg-modal-actions">
            <button class="msg-action-btn btn-edit" data-action="close-and-edit" data-id="${esc(msg.id)}">✏ Edit</button>
            <button class="action-btn" data-action="close-modal">Close</button>
          </div>
        </div>
      </div>`;
  };

  window.msgEdit = function (id) {
    const msg = _allMessages.find(m => m.id === id);
    if (!msg) return;
    const detail = document.getElementById('messaging-detail');
    if (!detail) return;

    detail.innerHTML = `
      <div class="msg-overlay" data-action="close-modal">
        <div class="msg-modal" data-action="stop-propagation">
          <h3>Edit Message</h3>
          <table class="msg-modal-table">
            <tr><td>ID</td><td>${esc(msg.id)}</td></tr>
            <tr><td>Channel</td><td>#${esc(msg.channel)}</td></tr>
            <tr><td>Sender</td><td>${esc(msg.sender)}</td></tr>
          </table>
          <div style="margin:12px 0">
            <label style="font-size:12px;color:var(--admin-text-dim);margin-bottom:4px;display:block">Recipients</label>
            <input id="msg-edit-recipients" class="form-input" style="width:100%" value="${esc((msg.recipients || []).join(', '))}" />
          </div>
          <div style="margin:12px 0">
            <label style="font-size:12px;color:var(--admin-text-dim);margin-bottom:4px;display:block">Body</label>
            <textarea id="msg-edit-body" class="form-input" rows="6" style="width:100%;resize:vertical">${esc(msg.body)}</textarea>
          </div>
          <div class="msg-modal-actions">
            <button class="action-btn" data-action="close-modal">Cancel</button>
            <button class="msg-action-btn btn-view" data-action="save-edit" data-id="${esc(msg.id)}">💾 Save</button>
          </div>
        </div>
      </div>`;
  };

  window.msgSaveEdit = async function (id) {
    const body = document.getElementById('msg-edit-body')?.value?.trim();
    const recipientsRaw = document.getElementById('msg-edit-recipients')?.value?.trim();
    const recipients = recipientsRaw ? recipientsRaw.split(',').map(r => r.trim()).filter(Boolean) : undefined;

    try {
      const res = await adminAuth.adminFetch(`/api/messages/by-id/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, recipients }),
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('messaging-detail').innerHTML = '';
        // Update local cache
        const idx = _allMessages.findIndex(m => m.id === id);
        if (idx >= 0 && data.message) _allMessages[idx] = data.message;
        else if (idx >= 0) { _allMessages[idx].body = body; if (recipients) _allMessages[idx].recipients = recipients; }
        renderMessages();
      } else {
        alert('Save failed: ' + (data.error || 'Unknown'));
      }
    } catch (e) {
      alert('Save failed: ' + e.message);
    }
  };

  window.msgDelete = async function (id) {
    const ids = _selected.size > 0 && _selected.has(id) ? [..._selected] : [id];
    const label = ids.length > 1 ? `Delete ${ids.length} messages?` : 'Delete this message?';
    if (!confirm(label)) return;
    try {
      await adminAuth.adminFetch('/api/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: ids }),
      });
      _allMessages = _allMessages.filter(m => !ids.includes(m.id));
      for (const mid of ids) _selected.delete(mid);
      syncDeleteSelectedBtn();
      renderSidebar();
      renderMessages();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  };

  window.msgDeleteSelected = async function () {
    if (_selected.size === 0) return;
    const ids = [..._selected];
    if (!confirm(`Delete ${ids.length} selected message${ids.length > 1 ? 's' : ''}?`)) return;
    try {
      await adminAuth.adminFetch('/api/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: ids }),
      });
      _allMessages = _allMessages.filter(m => !ids.includes(m.id));
      _selected.clear();
      syncDeleteSelectedBtn();
      renderSidebar();
      renderMessages();
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  };

  window.msgSend = async function () {
    const channel = document.getElementById('msg-compose-channel')?.value?.trim();
    const sender = document.getElementById('msg-compose-sender')?.value?.trim() || 'dashboard';
    const body = document.getElementById('msg-compose-body')?.value?.trim();
    const recipients = (document.getElementById('msg-compose-recipients')?.value || '*').split(',').map(r => r.trim()).filter(Boolean);
    const priority = document.getElementById('msg-compose-priority')?.value || 'normal';
    const tagsRaw = document.getElementById('msg-compose-tags')?.value?.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined;

    if (!channel || !body) { alert('Channel and body are required'); return; }

    try {
      const payload = { channel, sender, recipients, body, priority };
      if (tags?.length) payload.tags = tags;
      const res = await adminAuth.adminFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('msg-compose-body').value = '';
        document.getElementById('msg-compose-tags').value = '';
        await loadChannels();
        await loadAllMessages();
        renderSidebar();
        renderMessages();
      } else {
        alert('Send failed: ' + (data.error || 'Unknown'));
      }
    } catch (e) {
      alert('Send failed: ' + e.message);
    }
  };

  window.msgRefresh = async function () {
    _loaded = false;
    _selected.clear();
    syncDeleteSelectedBtn();
    await loadChannels();
    await loadAllMessages();
    _loaded = true;
    _signature = computeSignature();
    _lastRefreshAt = Date.now();
    renderSidebar();
    renderMessages();
    updateRefreshStatus();
  };

  window.msgDownload = function () {
    const blob = new Blob([JSON.stringify(_allMessages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `messages-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Auto refresh ────────────────────────────────────────────────────────
  //
  // The rule: a background refresh must never move, clear, or steal anything
  // the user is currently working with. It is therefore gated twice — once
  // before the fetch (so we don't even spend the requests) and once after it
  // (so a modal opened *during* the fetch still wins) — and it repaints only
  // when the data genuinely changed.

  function readAutoRefreshPref() {
    try {
      return window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY) !== '0';
    } catch { return true; }
  }

  function writeAutoRefreshPref(enabled) {
    try { window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, enabled ? '1' : '0'); } catch { /* non-fatal */ }
  }

  /**
   * Why an auto refresh must not run right now, or null if it may.
   * Exposed on window for tests and for the status line.
   */
  function autoRefreshBlockedReason() {
    if (!_loaded) return 'loading';
    if (_refreshInFlight) return 'in-flight';

    // Tab not in front — nothing to update and no reason to poll.
    if (typeof document.hidden === 'boolean' && document.hidden) return 'background';

    const section = document.getElementById('messaging-section');
    if (!section || section.classList.contains('hidden')) return 'section-hidden';

    // A detail / edit modal is open. Re-rendering underneath it would drop
    // whatever is typed in the edit textarea.
    const detail = document.getElementById('messaging-detail');
    if (detail && detail.childElementCount > 0) return 'editing';

    // Focus is in a messaging input (search box, compose fields, edit form).
    const active = document.activeElement;
    if (active && section.contains(active)) {
      const tag = (active.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || active.isContentEditable) {
        return 'typing';
      }
    }

    // An unsent compose draft: repainting the list above it shifts the
    // compose box under the user's cursor.
    const composeBody = document.getElementById('msg-compose-body');
    if (composeBody && composeBody.value.trim()) return 'composing';

    // The user is selecting text inside the message list (i.e. copying).
    try {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const list = document.getElementById('messaging-message-list');
        if (list && list.contains(sel.getRangeAt(0).commonAncestorContainer)) return 'selecting';
      }
    } catch { /* selection API unavailable — not a reason to block */ }

    return null;
  }

  /** Content fingerprint — repaint only when this actually changes. */
  function computeSignature() {
    const msgs = _allMessages.map(m =>
      `${m.id}:${m.updatedAt || m.createdAt}:${(m.body || '').length}:${(m.readBy || []).length}`
    );
    const chans = _channels.map(c => `${c.channel}=${c.messageCount}`);
    return `${msgs.join('|')}##${chans.join('|')}`;
  }

  /** Drop selections for messages that no longer exist; keep the rest. */
  function pruneSelection() {
    if (_selected.size === 0) return;
    const live = new Set(_allMessages.map(m => m.id));
    for (const id of [..._selected]) if (!live.has(id)) _selected.delete(id);
  }

  /** Repaint without moving the page or the sidebar under the user. */
  function renderPreservingViewport() {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const sidebar = document.querySelector('#messaging-section .msg-sidebar');
    const sidebarTop = sidebar ? sidebar.scrollTop : 0;

    renderSidebar();
    renderMessages();

    if (sidebar) sidebar.scrollTop = sidebarTop;
    window.scrollTo(scrollX, scrollY);
  }

  function updateRefreshStatus() {
    const el = document.getElementById('msg-refresh-status');
    if (!el) return;
    if (!_autoRefreshEnabled) { el.textContent = 'auto-refresh off'; el.title = 'Enable Auto to poll for new messages'; return; }
    const stamp = _lastRefreshAt ? new Date(_lastRefreshAt).toLocaleTimeString() : '—';
    if (_lastBlockedReason && _lastBlockedReason !== 'in-flight') {
      el.textContent = `paused (${_lastBlockedReason}) · ${stamp}`;
      el.title = 'Auto-refresh pauses while you are viewing, editing, composing, or selecting text';
    } else {
      el.textContent = `updated ${stamp}`;
      el.title = `Auto-refreshing every ${Math.round(AUTO_REFRESH_MS / 1000)}s`;
    }
  }

  async function autoRefreshTick() {
    if (!_autoRefreshEnabled) { updateRefreshStatus(); return; }

    const blockedBefore = autoRefreshBlockedReason();
    _lastBlockedReason = blockedBefore;
    if (blockedBefore) { updateRefreshStatus(); return; }

    _refreshInFlight = true;
    let channels;
    let messages;
    try {
      const res = await adminAuth.adminFetch('/api/messages/channels');
      const data = await res.json();
      channels = data.channels || [];
      const prevChannels = _channels;
      _channels = channels;              // fetchAllMessages() fans out over _channels
      try {
        messages = await fetchAllMessages();
      } finally {
        _channels = prevChannels;        // restore until we decide to commit
      }
    } catch (e) {
      console.warn('Auto refresh failed', e);
      return;
    } finally {
      _refreshInFlight = false;
    }

    // Re-check: the user may have opened a message or started typing while
    // the fetch was in flight. If so, drop this result and try again later.
    const blockedAfter = autoRefreshBlockedReason();
    _lastBlockedReason = blockedAfter;
    if (blockedAfter) { updateRefreshStatus(); return; }

    const prevMessages = _allMessages;
    const prevChannelList = _channels;
    _allMessages = messages;
    _channels = channels;
    const sig = computeSignature();
    _lastRefreshAt = Date.now();
    if (sig === _signature) {
      // Nothing changed — restore the previous object identities and leave the
      // DOM completely untouched (no flicker, no lost hover/selection).
      _allMessages = prevMessages;
      _channels = prevChannelList;
      updateRefreshStatus();
      return;
    }
    _signature = sig;
    pruneSelection();
    renderPreservingViewport();
    updateRefreshStatus();
  }

  function startAutoRefreshLoop() {
    if (_autoRefreshTimer) return;
    _autoRefreshTimer = setInterval(autoRefreshTick, AUTO_REFRESH_MS);
    // Coming back to a backgrounded tab should feel instant.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleImmediateRefresh(250);
    });
  }

  /** Debounced out-of-band refresh (tab switch, websocket event). */
  function scheduleImmediateRefresh(delayMs) {
    if (_immediateTimer) clearTimeout(_immediateTimer);
    _immediateTimer = setTimeout(() => { _immediateTimer = null; autoRefreshTick(); }, delayMs == null ? 500 : delayMs);
  }

  function syncAutoRefreshToggle() {
    const cb = document.getElementById('msg-auto-refresh');
    if (cb) cb.checked = _autoRefreshEnabled;
    updateRefreshStatus();
  }

  window.msgSetAutoRefresh = function (enabled) {
    _autoRefreshEnabled = !!enabled;
    writeAutoRefreshPref(_autoRefreshEnabled);
    updateRefreshStatus();
    if (_autoRefreshEnabled) scheduleImmediateRefresh(0);
  };

  window.msgAutoRefreshBlockedReason = autoRefreshBlockedReason;
  window.msgAutoRefreshTick = autoRefreshTick;

  // ── Helpers ─────────────────────────────────────────────────────────────

  function syncDeleteSelectedBtn() {
    const btn = document.getElementById('msg-delete-selected');
    if (btn) btn.disabled = _selected.size === 0;
  }

  const esc = window.adminUtils.escapeHtml;

  function extractTitle(body) {
    if (!body) return '';
    const lines = body.split('\n');
    // Look for markdown-style heading
    for (const line of lines.slice(0, 3)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('## ')) return trimmed.slice(3).trim();
      if (trimmed.startsWith('# ')) return trimmed.slice(2).trim();
      if (trimmed.startsWith('**') && trimmed.endsWith('**')) return trimmed.slice(2, -2).trim();
    }
    // Use first line if short enough for a title
    const first = lines[0]?.trim() || '';
    if (first.length <= 100 && lines.length > 1) return first;
    return '';
  }

  function extractBody(body, title) {
    if (!body) return '';
    if (!title) return body.length > 200 ? body.slice(0, 200) + '…' : body;
    // Remove title line from preview
    const idx = body.indexOf(title);
    let rest = idx >= 0 ? body.slice(idx + title.length).replace(/^[\s*#]+/, '').trim() : body;
    return rest.length > 200 ? rest.slice(0, 200) + '…' : rest;
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      const now = new Date();
      const month = d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
      const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const diff = now.getTime() - d.getTime();
      if (diff < 86400000) return time;
      return `${month}, ${time}`;
    } catch {
      return iso;
    }
  }

  function getTagClass(tag) {
    const t = tag.toLowerCase().replace(/\s+/g, '-');
    const known = ['bug', 'bug-fix', 'deployment', 'ack-required', 'persistent'];
    for (const k of known) {
      if (t === k || t.includes(k)) return ` tag-${k}`;
    }
    return '';
  }

  // ── WebSocket live updates ──────────────────────────────────────────────
  //
  // Registers with the shared listener list rather than monkey-patching
  // dashboardSocket.onmessage. The old approach was dead code twice over: this
  // deferred script runs before initDashboardSocket() creates the socket (so
  // the handler was never installed), and the socket's onclose/reconnect
  // reassigns onmessage (so any wrapper would be dropped anyway).
  //
  // Note this only fires for messages posted through the dashboard's own REST
  // API. Messages written by agents over the stdio MCP server land in a
  // different process and never reach this socket — the poll above is what
  // covers those.
  window.dashboardSocketListeners = window.dashboardSocketListeners || [];
  window.dashboardSocketListeners.push(function (msg) {
    if (!msg) return;
    if (msg.type === 'message_received' || msg.type === 'message_purged') {
      scheduleImmediateRefresh();
    }
  });
})();
