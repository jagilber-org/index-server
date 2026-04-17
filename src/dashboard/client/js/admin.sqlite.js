/**
 * admin.sqlite.js — SQLite dashboard tab controller.
 *
 * Shows backend badge, DB stats, query console, maintenance,
 * backup/restore, WAL management, migration, grooming.
 * Only renders when INDEX_SERVER_STORAGE_BACKEND=sqlite.
 */

(function () {
  'use strict';

  // ── Storage Badge (header indicator) ────────────────────────────────────
  async function initStorageBadge(attempt) {
    attempt = attempt || 0;
    try {
      const res = await adminAuth.adminFetch('/api/sqlite/info');
      if (res.status === 429 && attempt < 3) {
        const delay = (res.headers.get('retry-after') || 2) * 1000;
        setTimeout(function() { initStorageBadge(attempt + 1); }, delay);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      const badge = document.getElementById('storage-badge');
      if (!badge) return;

      if (data.active) {
        badge.textContent = '🗄️ SQLite (Experimental)';
        badge.style.display = 'inline-block';
        badge.style.background = '#d97706';
        badge.style.color = '#fff';
        // Show the SQLite nav tab
        const navBtn = document.getElementById('nav-sqlite');
        if (navBtn) navBtn.style.display = '';
      } else {
        badge.textContent = '📁 JSON';
        badge.style.display = 'inline-block';
        badge.style.background = 'var(--admin-card-bg, #1e293b)';
        badge.style.color = 'var(--admin-text-dim, #94a3b8)';
        badge.style.border = '1px solid var(--admin-border, #334155)';
      }
    } catch { /* ignore — badge stays hidden */ }
  }

  // ── Format helpers ──────────────────────────────────────────────────────
  function fmtBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ── Load DB Info ────────────────────────────────────────────────────────
  async function loadSqliteInfo() {
    const infoEl = document.getElementById('sqlite-info');
    const tablesEl = document.getElementById('sqlite-tables');
    if (!infoEl) return;

    try {
      const res = await adminAuth.adminFetch('/api/sqlite/info');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      if (!data.active) {
        infoEl.innerHTML = '<div class="stat-row"><span class="stat-label">Status</span><span class="stat-value" style="color:#f59e0b">Inactive — JSON backend in use</span></div>';
        if (tablesEl) tablesEl.innerHTML = '<div style="color:var(--admin-text-dim)">N/A — SQLite not active</div>';
        return;
      }

      infoEl.innerHTML = `
        <div class="stat-row"><span class="stat-label">Backend</span><span class="stat-value">SQLite (node:sqlite)</span></div>
        <div class="stat-row"><span class="stat-label">Database Path</span><span class="stat-value" style="font-family:monospace;font-size:12px">${esc(data.dbPath)}</span></div>
        <div class="stat-row"><span class="stat-label">File Size</span><span class="stat-value">${fmtBytes(data.fileSize)}</span></div>
        <div class="stat-row"><span class="stat-label">WAL Size</span><span class="stat-value">${fmtBytes(data.walSize)}</span></div>
        <div class="stat-row"><span class="stat-label">SHM Size</span><span class="stat-value">${fmtBytes(data.shmSize || 0)}</span></div>
        <div class="stat-row"><span class="stat-label">Total Disk</span><span class="stat-value" style="font-weight:600">${fmtBytes(data.fileSize + (data.walSize || 0) + (data.shmSize || 0))}</span></div>
        <div class="stat-row"><span class="stat-label">WAL Enabled</span><span class="stat-value">${data.walEnabled ? '✅ Yes' : '❌ No'}</span></div>
        <div class="stat-row"><span class="stat-label">Journal Mode</span><span class="stat-value">${esc(String(data.pragmas?.journalMode ?? '—'))}</span></div>
        <div class="stat-row"><span class="stat-label">Page Size</span><span class="stat-value">${data.pragmas?.pageSize ?? '—'}</span></div>
        <div class="stat-row"><span class="stat-label">Page Count</span><span class="stat-value">${data.pragmas?.pageCount ?? '—'}</span></div>
        <div class="stat-row"><span class="stat-label">Freelist Pages</span><span class="stat-value">${data.pragmas?.freelistCount ?? '—'}</span></div>
      `;

      if (tablesEl && data.tableStats) {
        let html = '';
        for (const [table, count] of Object.entries(data.tableStats)) {
          html += `<div class="stat-row"><span class="stat-label">${esc(table)}</span><span class="stat-value">${count} rows</span></div>`;
        }
        tablesEl.innerHTML = html || '<div style="color:var(--admin-text-dim)">No tables found</div>';
      }
    } catch (err) {
      infoEl.innerHTML = '<div class="error-message">Failed to load SQLite info: ' + esc(err.message) + '</div>';
    }
  }

  // ── Maintenance Actions ─────────────────────────────────────────────────
  async function runMaintenance(action) {
    const resultEl = document.getElementById('sqlite-maintenance-result');
    if (resultEl) resultEl.innerHTML = '<span style="color:var(--admin-text-dim)">Running…</span>';

    try {
      const res = await adminAuth.adminFetch('/api/sqlite/' + action, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        let msg = data.message || 'Done';
        if (data.ok !== undefined) msg = data.ok ? '✅ Database integrity OK' : '⚠️ Issues found';
        if (data.sizeAfter !== undefined) msg += ' — DB size: ' + fmtBytes(data.sizeAfter);
        if (data.results && Array.isArray(data.results) && typeof data.results[0] === 'string') {
          msg += '<ul style="margin:6px 0 0 16px;font-size:12px">' + data.results.map(function(r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>';
        } else if (data.results) {
          msg += '<pre style="margin-top:4px;font-size:12px;max-height:200px;overflow:auto">' + esc(JSON.stringify(data.results, null, 2)) + '</pre>';
        }
        resultEl.innerHTML = '<span style="color:#22c55e">' + msg + '</span>';
      } else {
        resultEl.innerHTML = '<span style="color:#ef4444">Error: ' + esc(data.error) + '</span>';
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">Request failed: ' + esc(err.message) + '</span>';
    }
    loadSqliteInfo();
  }

  // ── Backup / Restore ────────────────────────────────────────────────────
  async function createBackup() {
    const resultEl = document.getElementById('sqlite-backup-result');
    if (resultEl) resultEl.innerHTML = '<span style="color:var(--admin-text-dim)">Creating backup…</span>';
    try {
      const res = await adminAuth.adminFetch('/api/sqlite/backup', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        resultEl.innerHTML = '<span style="color:#22c55e">✅ ' + esc(data.message) + ' (' + fmtBytes(data.backupSize) + ')</span>';
      } else {
        resultEl.innerHTML = '<span style="color:#ef4444">Error: ' + esc(data.error) + '</span>';
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">' + esc(err.message) + '</span>';
    }
    loadBackupsList();
  }

  async function loadBackupsList() {
    const listEl = document.getElementById('sqlite-backups-list');
    if (!listEl) return;
    try {
      const res = await adminAuth.adminFetch('/api/sqlite/backups');
      const data = await res.json();
      if (!data.success || !data.backups || data.backups.length === 0) {
        listEl.innerHTML = '<div style="color:var(--admin-text-dim)">No backups found</div>';
        return;
      }
      let html = '<div style="display:flex;flex-direction:column;gap:6px">';
      for (const b of data.backups) {
        const date = new Date(b.created).toLocaleString();
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:var(--admin-card-bg,#1e293b);border:1px solid var(--admin-border,#334155);border-radius:6px">';
        html += '<div><span style="font-family:monospace;font-size:12px">' + esc(b.name) + '</span>';
        html += '<span style="margin-left:8px;font-size:11px;color:var(--admin-text-dim)">' + esc(date) + ' · ' + fmtBytes(b.dbSize) + '</span></div>';
        html += '<button class="action-btn" style="font-size:11px;padding:2px 8px" data-sqlite-action="restore" data-backup-name="' + esc(b.name) + '">↩ Restore</button>';
        html += '</div>';
      }
      html += '</div>';
      listEl.innerHTML = html;
    } catch (err) {
      listEl.innerHTML = '<div style="color:#ef4444">' + esc(err.message) + '</div>';
    }
  }

  async function restoreBackup(backupName) {
    if (!confirm('Restore database from "' + backupName + '"?\n\nCurrent DB will be auto-backed up before restore.')) return;
    const resultEl = document.getElementById('sqlite-backup-result');
    if (resultEl) resultEl.innerHTML = '<span style="color:var(--admin-text-dim)">Restoring…</span>';
    try {
      const res = await adminAuth.adminFetch('/api/sqlite/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupName }),
      });
      const data = await res.json();
      if (data.success) {
        resultEl.innerHTML = '<span style="color:#22c55e">✅ ' + esc(data.message) + '</span>';
      } else {
        resultEl.innerHTML = '<span style="color:#ef4444">Error: ' + esc(data.error) + '</span>';
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">' + esc(err.message) + '</span>';
    }
    loadSqliteInfo();
    loadBackupsList();
  }

  // ── WAL Checkpoint ──────────────────────────────────────────────────────
  async function walCheckpoint() {
    const resultEl = document.getElementById('sqlite-backup-result');
    if (resultEl) resultEl.innerHTML = '<span style="color:var(--admin-text-dim)">Running WAL checkpoint…</span>';
    try {
      const res = await adminAuth.adminFetch('/api/sqlite/wal-checkpoint', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        resultEl.innerHTML = '<span style="color:#22c55e">✅ ' + esc(data.message) + ' — WAL: ' + fmtBytes(data.walSizeAfter) + '</span>';
      } else {
        resultEl.innerHTML = '<span style="color:#ef4444">Error: ' + esc(data.error) + '</span>';
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">' + esc(err.message) + '</span>';
    }
    loadSqliteInfo();
  }

  // ── Migration / Reset ───────────────────────────────────────────────────
  async function runMigration(action) {
    const resultEl = document.getElementById('sqlite-migration-result');
    if (resultEl) resultEl.innerHTML = '<span style="color:var(--admin-text-dim)">Running…</span>';
    try {
      const res = await adminAuth.adminFetch('/api/sqlite/' + action, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        let msg = '✅ ' + esc(data.message);
        if (data.errors && data.errors.length > 0) {
          msg += '<br><span style="color:#f59e0b">⚠️ ' + data.errors.length + ' error(s):</span>';
          msg += '<pre style="font-size:11px;max-height:150px;overflow:auto">' + esc(JSON.stringify(data.errors, null, 2)) + '</pre>';
        }
        resultEl.innerHTML = '<span style="color:#22c55e">' + msg + '</span>';
      } else {
        resultEl.innerHTML = '<span style="color:#ef4444">Error: ' + esc(data.error) + '</span>';
      }
    } catch (err) {
      if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444">' + esc(err.message) + '</span>';
    }
    loadSqliteInfo();
  }

  async function resetDatabase() {
    if (!confirm('⚠️ RESET DATABASE?\n\nThis will DELETE all data and reinitialize an empty schema.\nA backup will be created automatically.\n\nThis action cannot be undone.')) return;
    if (!confirm('Are you absolutely sure? Type OK to proceed.')) return;
    runMigration('reset');
  }

  // ── Query Console ───────────────────────────────────────────────────────
  async function runQuery() {
    const input = document.getElementById('sqlite-query-input');
    const resultEl = document.getElementById('sqlite-query-result');
    const statusEl = document.getElementById('sqlite-query-status');
    if (!input || !resultEl) return;

    const sql = input.value.trim();
    if (!sql) { statusEl.textContent = 'Enter a query'; return; }

    statusEl.textContent = 'Running…';
    resultEl.innerHTML = '';

    try {
      const start = performance.now();
      const res = await adminAuth.adminFetch('/api/sqlite/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      const elapsed = (performance.now() - start).toFixed(0);
      const data = await res.json();

      if (!data.success) {
        statusEl.textContent = 'Error';
        resultEl.innerHTML = '<div style="color:#ef4444;font-family:monospace;font-size:13px">' + esc(data.error) + '</div>';
        return;
      }

      statusEl.textContent = data.rowCount + ' row' + (data.rowCount !== 1 ? 's' : '') + ' · ' + elapsed + 'ms';

      if (data.rowCount === 0) {
        resultEl.innerHTML = '<div style="color:var(--admin-text-dim)">No results</div>';
        return;
      }

      // Build HTML table
      let html = '<table class="sqlite-result-table"><thead><tr>';
      for (const col of data.columns) {
        html += '<th>' + esc(col) + '</th>';
      }
      html += '</tr></thead><tbody>';
      const maxRows = Math.min(data.rows.length, 500);
      for (let i = 0; i < maxRows; i++) {
        html += '<tr>';
        for (const col of data.columns) {
          const val = data.rows[i][col];
          const display = val === null ? '<span style="color:var(--admin-text-dim)">NULL</span>' : esc(String(val));
          html += '<td>' + display + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      if (data.rowCount > 500) {
        html += '<div style="margin-top:4px;font-size:12px;color:var(--admin-text-dim)">Showing 500 of ' + data.rowCount + ' rows</div>';
      }
      resultEl.innerHTML = html;
    } catch (err) {
      statusEl.textContent = 'Error';
      resultEl.innerHTML = '<div style="color:#ef4444">' + esc(err.message) + '</div>';
    }
  }

  // ── Event Delegation (CSP-safe) ─────────────────────────────────────────
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-sqlite-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-sqlite-action');
    switch (action) {
      case 'vacuum': case 'optimize': case 'integrity': case 'analyze': case 'reindex': case 'groom':
        runMaintenance(action === 'integrity' ? 'integrity-check' : action);
        break;
      case 'run-query': runQuery(); break;
      case 'backup': createBackup(); break;
      case 'wal-checkpoint': walCheckpoint(); break;
      case 'restore': restoreBackup(btn.getAttribute('data-backup-name')); break;
      case 'migrate': runMigration('migrate'); break;
      case 'export': runMigration('export'); break;
      case 'reset': resetDatabase(); break;
    }
  });

  // Ctrl+Enter or Enter to run query (Enter only when not Shift+Enter for newline)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      const input = document.getElementById('sqlite-query-input');
      if (input && document.activeElement === input) {
        if (e.shiftKey) return; // Shift+Enter = newline
        e.preventDefault();
        runQuery();
      }
    }
  });

  // ── Section observer ────────────────────────────────────────────────────
  const observer = new MutationObserver(function () {
    const section = document.getElementById('sqlite-section');
    if (section && !section.classList.contains('hidden')) {
      loadSqliteInfo();
      loadBackupsList();
    }
  });

  function startObserver() {
    const section = document.getElementById('sqlite-section');
    if (section) {
      observer.observe(section, { attributes: true, attributeFilter: ['class'] });
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────
  function init() {
    initStorageBadge();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── CSS for result table ────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .sqlite-result-table { width:100%; border-collapse:collapse; font-size:13px; font-family:monospace; }
    .sqlite-result-table th { text-align:left; padding:6px 10px; background:var(--admin-card-bg,#1e293b); color:var(--admin-accent,#60a5fa); font-weight:600; border-bottom:2px solid var(--admin-border,#334155); position:sticky; top:0; }
    .sqlite-result-table td { padding:4px 10px; border-bottom:1px solid var(--admin-border,#334155); color:var(--admin-text,#e2e8f0); max-width:400px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .sqlite-result-table tr:hover td { background:rgba(96,165,250,0.05); }
    .storage-badge { vertical-align:middle; }
  `;
  document.head.appendChild(style);
})();
