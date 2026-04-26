/**
 * admin.feedback.js — Dashboard Feedback CRUD panel.
 *
 * Human-operator surface for browsing, creating, editing, and deleting
 * persisted feedback entries, plus a client-side GitHub issue handoff.
 *
 * Design constraints (Morpheus architecture review / decisions.md G-1..G-8):
 *   - CRUD against /api/admin/feedback (operator-tier, NOT the MCP surface)
 *   - GitHub handoff is client-side ONLY — window.open with pre-filled URL
 *   - No server-side GitHub API calls, no token handling, no OAuth
 *   - GitHub target: https://github.com/jagilber-org/index-server
 */

(function () {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────────

  const GITHUB_ISSUES_URL = 'https://github.com/jagilber-org/index-server/issues/new';
  const API_BASE = '/api/admin/feedback';

  const STATUS_COLORS = {
    'new': '#3b82f6',
    'acknowledged': '#8b5cf6',
    'in-progress': '#ff9830',
    'resolved': '#73bf69',
    'closed': '#8e959e',
  };

  const SEV_COLORS = {
    'low': '#73bf69',
    'medium': '#ff9830',
    'high': '#f2495c',
    'critical': '#dc2626',
  };

  // ── Module state ────────────────────────────────────────────────────────────

  let _entries = [];
  let _selectedId = null;
  let _filterText = '';
  let _statusFilter = '';
  let _editMode = null; // 'create' | 'edit' | null

  // ── Public API ──────────────────────────────────────────────────────────────

  window.initFeedback = async function () {
    setupDelegation();
    await loadEntries();
    renderTable();
  };

  // ── GitHub URL builder (tested by Tank B-2..B-5) ────────────────────────────

  function buildGitHubIssueUrl(entry) {
    const params = new URLSearchParams();
    const titleParam = entry && entry.title
      ? `[Feedback] ${entry.title}`
      : '[Feedback] New Issue';
    params.set('title', titleParam);

    const lines = [];
    if (entry) {
      if (entry.type)        lines.push(`**Type:** ${entry.type}`);
      if (entry.severity)    lines.push(`**Severity:** ${entry.severity}`);
      if (entry.status)      lines.push(`**Status:** ${entry.status}`);
      if (entry.description) lines.push(`\n${entry.description}`);
    }
    params.set('body', lines.join('\n'));
    return `${GITHUB_ISSUES_URL}?${params.toString()}`;
  }

  // ── Event delegation (CSP-safe) ─────────────────────────────────────────────

  function setupDelegation() {
    const section = document.getElementById('feedback-section');
    if (!section || section._fbDelegated) return;
    section._fbDelegated = true;

    section.addEventListener('click', function (e) {
      const el = e.target.closest('[data-fb-action]');
      if (!el) return;
      const action = el.dataset.fbAction;

      if (action === 'refresh')       { loadEntries().then(renderTable); return; }
      if (action === 'create')        { openCreate(); return; }
      if (action === 'edit')          { openEdit(el.dataset.id); return; }
      if (action === 'delete')        { confirmDelete(el.dataset.id); return; }
      if (action === 'save')          { saveEntry(); return; }
      if (action === 'cancel')        { closeDetail(); return; }
      if (action === 'github')        { openGitHubHandoff(); return; }
      if (action === 'row-select')    { openEdit(el.dataset.id); return; }
    });

    const filterInput = document.getElementById('feedback-filter');
    if (filterInput) {
      filterInput.addEventListener('input', function () {
        _filterText = this.value.toLowerCase();
        renderTable();
      });
    }

    const statusSel = document.getElementById('feedback-status-filter');
    if (statusSel) {
      statusSel.addEventListener('change', function () {
        _statusFilter = this.value;
        renderTable();
      });
    }
  }

  // ── API helpers ─────────────────────────────────────────────────────────────

  async function apiFetch(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
    return data;
  }

  async function loadEntries() {
    try {
      const data = await apiFetch('GET', API_BASE);
      _entries = Array.isArray(data.entries) ? data.entries : [];
    } catch (err) {
      console.warn('[feedback] loadEntries failed:', err.message);
      _entries = [];
      showTableMessage(`⚠️ Failed to load entries: ${err.message}`);
    }
  }

  // ── Table rendering ─────────────────────────────────────────────────────────

  function renderTable() {
    const container = document.getElementById('feedback-table');
    if (!container) return;

    const filtered = _entries.filter(e => {
      const matchText = !_filterText ||
        (e.title || '').toLowerCase().includes(_filterText) ||
        (e.type || '').toLowerCase().includes(_filterText) ||
        (e.description || '').toLowerCase().includes(_filterText);
      const matchStatus = !_statusFilter || e.status === _statusFilter;
      return matchText && matchStatus;
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div class="feedback-empty">${
        _entries.length === 0
          ? 'No feedback entries. Click <strong>New Entry</strong> to create one.'
          : 'No entries match the current filter.'
      }</div>`;
      return;
    }

    const rows = filtered.map(e => {
      const sColor = STATUS_COLORS[e.status] || '#8e959e';
      const sevColor = SEV_COLORS[e.severity] || '#8e959e';
      const ts = e.timestamp ? new Date(e.timestamp).toLocaleString() : '—';
      return `<tr class="feedback-row${e.id === _selectedId ? ' selected' : ''}"
                  data-fb-action="row-select" data-id="${esc(e.id)}">
        <td class="fb-cell fb-id">${esc(e.id.slice(0, 8))}…</td>
        <td class="fb-cell fb-title">${esc(e.title)}</td>
        <td class="fb-cell fb-type">${esc(e.type)}</td>
        <td class="fb-cell fb-sev" style="color:${sevColor}">${esc(e.severity)}</td>
        <td class="fb-cell fb-status">
          <span class="fb-badge" style="background:${sColor}22;color:${sColor};border:1px solid ${sColor}44">${esc(e.status)}</span>
        </td>
        <td class="fb-cell fb-ts text-dim">${esc(ts)}</td>
        <td class="fb-cell fb-actions" onclick="event.stopPropagation()">
          <button class="action-btn sm" data-fb-action="edit" data-id="${esc(e.id)}" title="Edit">✏️</button>
          <button class="action-btn sm danger" data-fb-action="delete" data-id="${esc(e.id)}" title="Delete">🗑️</button>
        </td>
      </tr>`;
    });

    container.innerHTML = `
      <table class="fb-table">
        <thead>
          <tr>
            <th class="fb-th">ID</th>
            <th class="fb-th">Title</th>
            <th class="fb-th">Type</th>
            <th class="fb-th">Severity</th>
            <th class="fb-th">Status</th>
            <th class="fb-th">Created</th>
            <th class="fb-th">Actions</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>`;
  }

  function showTableMessage(msg) {
    const container = document.getElementById('feedback-table');
    if (!container) return;
    const message = document.createElement('div');
    message.className = 'feedback-empty';
    message.textContent = String(msg || '');
    container.replaceChildren(message);
  }

  // ── Detail / edit panel ──────────────────────────────────────────────────────

  function openCreate() {
    _selectedId = null;
    _editMode = 'create';
    populateForm(null);
    showDetail('New Feedback Entry');
    document.getElementById('feedback-delete-btn').style.display = 'none';
    document.getElementById('feedback-github-btn').style.display = 'none';
  }

  function openEdit(id) {
    const entry = _entries.find(e => e.id === id);
    if (!entry) return;
    _selectedId = id;
    _editMode = 'edit';
    populateForm(entry);
    showDetail('Edit Feedback Entry');
    document.getElementById('feedback-delete-btn').style.display = '';
    document.getElementById('feedback-github-btn').style.display = '';
    renderTable(); // update row highlight
  }

  function showDetail(titleText) {
    const detail = document.getElementById('feedback-detail');
    const titleEl = document.getElementById('feedback-detail-title');
    if (detail) detail.classList.remove('hidden');
    if (titleEl) titleEl.textContent = titleText;
    if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeDetail() {
    _selectedId = null;
    _editMode = null;
    const detail = document.getElementById('feedback-detail');
    if (detail) detail.classList.add('hidden');
    renderTable();
  }

  function populateForm(entry) {
    setValue('feedback-entry-title',       entry ? entry.title : '');
    setValue('feedback-entry-type',        entry ? entry.type : 'bug-report');
    setValue('feedback-entry-severity',    entry ? entry.severity : 'medium');
    setValue('feedback-entry-status',      entry ? entry.status : 'new');
    setValue('feedback-entry-description', entry ? (entry.description || '') : '');
  }

  function readForm() {
    return {
      title:       (getValue('feedback-entry-title') || '').trim(),
      type:        getValue('feedback-entry-type') || 'other',
      severity:    getValue('feedback-entry-severity') || 'medium',
      status:      getValue('feedback-entry-status') || 'new',
      description: (getValue('feedback-entry-description') || '').trim(),
    };
  }

  // ── CRUD operations ──────────────────────────────────────────────────────────

  async function saveEntry() {
    const data = readForm();
    if (!data.title) {
      alert('Title is required.');
      return;
    }
    try {
      if (_editMode === 'create') {
        await apiFetch('POST', API_BASE, { type: data.type, severity: data.severity, title: data.title, description: data.description });
      } else if (_editMode === 'edit' && _selectedId) {
        await apiFetch('PATCH', `${API_BASE}/${_selectedId}`, { status: data.status, title: data.title, description: data.description, severity: data.severity });
      }
      await loadEntries();
      closeDetail();
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  }

  async function confirmDelete(id) {
    if (!id) return;
    const entry = _entries.find(e => e.id === id);
    const label = entry ? entry.title : id;
    if (!confirm(`Delete entry: "${label}"?`)) return;
    try {
      await apiFetch('DELETE', `${API_BASE}/${id}`);
      if (_selectedId === id) closeDetail();
      await loadEntries();
      renderTable();
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  // ── GitHub handoff (client-side only — no server calls, no token) ────────────

  function openGitHubHandoff() {
    const data = readForm();
    const entry = _selectedId
      ? { ..._entries.find(e => e.id === _selectedId), ...data }
      : data;
    const url = buildGitHubIssueUrl(entry);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  const esc = window.adminUtils.escapeHtml;

  function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function getValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

})();
