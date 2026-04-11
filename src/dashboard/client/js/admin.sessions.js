/* eslint-disable */
// Extracted sessions module from admin.html
(function(){
    // Pagination state for active sessions
    let __sessionsData = [];
    let __sessionsPage = 1;
    let __sessionsPageSize = 25;

    // Expose functions used by UI buttons and other modules

    function getSessionsPaginationEl(){
        return document.getElementById('sessions-pagination');
    }

    function updateSessionsPaginationControls(){
        const el = getSessionsPaginationEl();
        if(!el) return;
        const total = __sessionsData.length;
        if(!total){ el.style.display = 'none'; return; }
        const totalPages = Math.max(1, Math.ceil(total / __sessionsPageSize));
        if(__sessionsPage > totalPages) __sessionsPage = totalPages;
        el.style.display = 'flex';
        const info = el.querySelector('[data-role="page-info"]');
        if(info) info.textContent = `Page ${__sessionsPage} / ${totalPages}`;
        const prevBtn = el.querySelector('[data-role="prev-page"]');
        const nextBtn = el.querySelector('[data-role="next-page"]');
        if(prevBtn) prevBtn.disabled = (__sessionsPage <= 1);
        if(nextBtn) nextBtn.disabled = (__sessionsPage >= totalPages);
        const sizeSel = el.querySelector('[data-role="page-size"]');
        if(sizeSel && parseInt(sizeSel.value,10)!==__sessionsPageSize){ sizeSel.value = String(__sessionsPageSize); }
    }

    function renderSessionsPage(){
        const host = document.getElementById('sessions-list');
        if(!host) return;
        host.classList.add('index-list');
        if(!__sessionsData.length){
            host.innerHTML = '<div class="empty-state">No active admin sessions</div>';
            updateSessionsPaginationControls();
            return;
        }
        const totalPages = Math.max(1, Math.ceil(__sessionsData.length / __sessionsPageSize));
        if(__sessionsPage > totalPages) __sessionsPage = totalPages;
        const start = (__sessionsPage - 1) * __sessionsPageSize;
        const end = start + __sessionsPageSize;
        const slice = __sessionsData.slice(start, end);
        host.innerHTML = slice.map(s => {
            const startStr = new Date(s.startTime).toLocaleString();
            const last = new Date(s.lastActivity).toLocaleString();
            return `<div class="index-item" data-session="${s.id}">
              <div class="index-item-header">
                <div class="index-item-name">${escapeHtml(s.id)}</div>
                <div class="index-item-actions">
                  <button class="action-btn danger" onclick="terminateSession('${s.id}')">Terminate</button>
                </div>
              </div>
              <div class="index-item-meta">
                <div class="meta-chip"><span class="chip-label">USER</span><span class="chip-value">${escapeHtml(s.userId)}</span></div>
                <div class="meta-chip"><span class="chip-label">IP</span><span class="chip-value">${escapeHtml(s.ipAddress||'—')}</span></div>
              </div>
              <div class="index-item-summary" style="font-size:11.5px;">
                <div class="meta-line"><span class="chip-label">START</span> <span class="chip-value">${startStr}</span></div>
                <div class="meta-line"><span class="chip-label">LAST</span> <span class="chip-value">${last}</span></div>
              </div>
            </div>`;
        }).join('');
        updateSessionsPaginationControls();
                // Expose current page for HTML inline handlers referencing window.__sessionsPage
                window.__sessionsPage = __sessionsPage;
    }

    function setSessionsPage(p){
        const totalPages = Math.max(1, Math.ceil(__sessionsData.length / __sessionsPageSize));
        __sessionsPage = Math.min(Math.max(1, p), totalPages);
        renderSessionsPage();
    }

    function changeSessionsPageSize(size){
        __sessionsPageSize = size;
        __sessionsPage = 1; // reset to first page
        renderSessionsPage();
    }

    async function loadSessions() {
        try {
            let sessionsCount = 0;
            let connectionsCount = 0;
            const response = await fetch('/api/admin/sessions');
            const data = await response.json();
            if (data.success) {
                displaySessions(data.sessions);
                sessionsCount = Array.isArray(data.sessions) ? data.sessions.length : 0;
                if (sessionsCount === 0) {
                    try {
                        const created = await maybeEnsureAdminSession(true);
                        if (created) {
                            const r2 = await fetch('/api/admin/sessions');
                            const d2 = await r2.json();
                            if (d2.success) { displaySessions(d2.sessions); sessionsCount = d2.sessions.length; }
                        }
                    } catch(e) { /* ignore */ }
                }
            } else {
                showError('Failed to load sessions');
            }

            try {
                const connRes = await fetch('/api/admin/connections');
                const connData = await connRes.json();
                const connEl = document.getElementById('connections-list');
                if (connData.success && connEl) {
                    connectionsCount = Array.isArray(connData.connections) ? connData.connections.length : 0;
                    connEl.classList.add('index-list');
                    if (!connectionsCount) {
                        connEl.innerHTML = '<div class="empty-state">No active websocket connections</div>';
                    } else {
                        const fmt = (ms) => {
                            if (ms == null) return '—';
                            if (ms < 1000) return ms + ' ms';
                            const s = ms / 1000;
                            if (s < 60) return s.toFixed(1) + ' s';
                            const m = Math.floor(s / 60);
                            const rs = Math.floor(s % 60);
                            return m + 'm ' + rs + 's';
                        };
                        connEl.innerHTML = connData.connections.map(c => {
                            const connected = c.connectedAt ? new Date(c.connectedAt).toLocaleString() : '—';
                            return `<div class="index-item" data-connection="${escapeHtml(c.id)}">
                                <div class="index-item-header">
                                    <div class="index-item-name">${escapeHtml(c.id)}</div>
                                    <div class="index-item-actions"></div>
                                </div>
                                <div class="index-item-meta">
                                    <div class="meta-chip"><span class="chip-label">DURATION</span><span class="chip-value">${fmt(c.durationMs)}</span></div>
                                    <div class="meta-chip"><span class="chip-label">STATE</span><span class="chip-value">open</span></div>
                                </div>
                                <div class="index-item-summary" style="font-size:11.5px;">
                                    <div class="meta-line"><span class="chip-label">CONNECTED</span> <span class="chip-value">${connected}</span></div>
                                </div>
                            </div>`;
                        }).join('');
                    }
                } else if (connEl) {
                    connEl.innerHTML = '<div class="error-message">Failed to load active connections</div>';
                }
            } catch (e) {
                const connEl = document.getElementById('connections-list');
                if (connEl) connEl.innerHTML = '<div class="error-message">Error loading active connections</div>';
            }

            try { if (typeof loadSessionHistory === 'function') loadSessionHistory(parseInt((document.getElementById('session-history-limit')||{value:'50'}).value,10)); } catch {}
            window.__lastSessionsCount = sessionsCount;
            window.__lastConnectionsCount = connectionsCount;
            updateSessionsNavBadge();
        } catch (error) {
            console.error('Error loading sessions:', error);
            showError('Failed to load sessions');
        }
    }

    function updateSessionsNavBadge(){
        const navBtn = document.getElementById('nav-sessions');
        if(!navBtn) return;
        const s = window.__lastSessionsCount ?? 0;
        const c = window.__lastConnectionsCount ?? 0;
        let badge = navBtn.querySelector('.nav-badge');
        if(!badge){
            badge = document.createElement('span');
            badge.className = 'nav-badge';
            badge.style.cssText = 'margin-left:6px; background:#2c3038; color:#d0d4d8; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:500;';
            navBtn.appendChild(badge);
        }
        badge.textContent = `${s}/${c}`;
        badge.title = `Admin sessions: ${s} | Websocket connections: ${c}`;
    }

    async function maybeEnsureAdminSession(onlyIfRequested) {
        try {
            if (typeof sessionStorage === 'undefined') return false;
            const existing = sessionStorage.getItem('mcp_admin_session_id');
            if (existing && !onlyIfRequested) return false;
            const res = await fetch('/api/admin/sessions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId: 'dashboard_auto' }) });
            const data = await res.json().catch(()=>({}));
            if (data.success && data.session && data.session.id) {
                sessionStorage.setItem('mcp_admin_session_id', data.session.id);
                return true;
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    async function loadSessionHistory(limit = 50) {
        try {
            const res = await fetch('/api/admin/sessions/history?limit=' + limit);
            const data = await res.json();
            if (!data.success) throw new Error();
            renderSessionHistory(data.history || []);
        } catch (err) {
            const el = document.getElementById('session-history-list');
            if (el) el.innerHTML = '<div class="error">Failed to load session history</div>';
        }
    }

    function renderSessionHistory(history) {
        const el = document.getElementById('session-history-list');
        if (!el) return;
        if (!history.length) { el.innerHTML = '<div class="empty-state">No history entries</div>'; return; }
        el.classList.add('index-list');
        el.innerHTML = history.map(h => {
            const started = h.startTime ? new Date(h.startTime).toLocaleString() : '—';
            const ended = h.endTime ? new Date(h.endTime).toLocaleString() : '—';
            const status = h.terminationReason || 'active';
            return `<div class="index-item" data-session-history="${h.id}">
                <div class="index-item-header">
                    <div class="index-item-name">${escapeHtml(h.id)}</div>
                    <div class="index-item-actions"></div>
                </div>
                <div class="index-item-meta">
                    <div class="meta-chip" title="Status"><span class="chip-label">STATUS</span><span class="chip-value">${escapeHtml(status)}</span></div>
                </div>
                <div class="index-item-summary" style="font-size:11.5px;">
                    <div class="meta-line"><span class="chip-label">START</span> <span class="chip-value">${started}</span></div>
                    <div class="meta-line"><span class="chip-label">END</span> <span class="chip-value">${ended}</span></div>
                </div>
            </div>`;
        }).join('');
    }

    function refreshSessionHistory() {
        const limitSel = document.getElementById('session-history-limit');
        const limit = parseInt(limitSel.value, 10) || 50;
        loadSessionHistory(limit);
    }

    function displaySessions(sessions) {
        __sessionsData = Array.isArray(sessions) ? sessions.slice() : [];
        __sessionsPage = 1;
        renderSessionsPage();
    }

    async function createTestSession() {
        try {
            const response = await fetch('/api/admin/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: 'test_admin_' + Date.now() })
            });

            const data = await response.json();
            if (data.success) {
                showSuccess('Test session created successfully');
                loadSessions();
            } else {
                showError('Failed to create test session');
            }
        } catch (error) {
            console.error('Error creating test session:', error);
            showError('Failed to create test session');
        }
    }

    async function terminateSession(sessionId) {
        try {
            const response = await fetch(`/api/admin/sessions/${sessionId}`, {
                method: 'DELETE'
            });

            const data = await response.json();
            if (data.success) {
                showSuccess('Session terminated successfully');
                loadSessions();
            } else {
                showError('Failed to terminate session');
            }
        } catch (error) {
            console.error('Error terminating session:', error);
            showError('Failed to terminate session');
        }
    }

    // Expose to global scope
    window.loadSessions = loadSessions;
    window.updateSessionsNavBadge = updateSessionsNavBadge;
    window.maybeEnsureAdminSession = maybeEnsureAdminSession;
    window.loadSessionHistory = loadSessionHistory;
    window.renderSessionHistory = renderSessionHistory;
    window.refreshSessionHistory = refreshSessionHistory;
    window.displaySessions = displaySessions;
    window.setSessionsPage = setSessionsPage;
    window.changeSessionsPageSize = changeSessionsPageSize;
    window.createTestSession = createTestSession;
    window.terminateSession = terminateSession;
})();
