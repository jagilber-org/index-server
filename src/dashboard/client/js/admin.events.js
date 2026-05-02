/**
 * admin.events.js — Recent events panel + nav-bubble polling.
 *
 * Polls /api/admin/events/counts every 10s for an unread bubble on the
 * Monitoring nav button. When the Monitoring section is active, also fetches
 * the full event list and renders into #events-panel.
 *
 * Client-side pagination + text search + per-row collapse-to-detail.
 */
(function() {
    var lastSeenId = 0;
    var pollTimer = null;
    var refreshTimer = null;
    var allEvents = [];      // most-recent-first cache
    var filterText = '';
    var filterLevel = '';
    var pageIndex = 0;
    var pageSize = 50;

    function adminFetch(url, opts) {
        if (window.adminAuth && typeof window.adminAuth.adminFetch === 'function') {
            return window.adminAuth.adminFetch(url, opts);
        }
        return fetch(url, opts);
    }

    function escapeText(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function highlight(text, term) {
        var escaped = escapeText(text);
        if (!term) return escaped;
        try {
            // Escape regex meta in user input.
            var re = new RegExp(term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
            return escaped.replace(re, function(m) { return '<mark>' + m + '</mark>'; });
        } catch (_err) { void _err; return escaped; }
    }

    function applyFilters() {
        var t = filterText.trim().toLowerCase();
        return allEvents.filter(function(e) {
            if (filterLevel && e.level !== filterLevel) return false;
            if (!t) return true;
            var hay = (e.msg || '') + ' ' + (e.detail || '');
            return hay.toLowerCase().indexOf(t) !== -1;
        });
    }

    function renderEvents() {
        var panel = document.getElementById('events-panel');
        var pager = document.getElementById('events-pager');
        var pageInfo = document.getElementById('events-page-info');
        if (!panel) return;

        var filtered = applyFilters();
        var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        if (pageIndex >= totalPages) pageIndex = totalPages - 1;
        if (pageIndex < 0) pageIndex = 0;
        var start = pageIndex * pageSize;
        var slice = filtered.slice(start, start + pageSize);

        panel.classList.remove('loading');
        if (filtered.length === 0) {
            panel.innerHTML = '<div class="muted">' + (allEvents.length === 0 ? 'No recent events.' : 'No events match the current filter.') + '</div>';
            if (pager) pager.classList.add('hidden');
            return;
        }

        var rows = slice.map(function(e) {
            var lvlClass = e.level === 'ERROR' ? 'level-error' : 'level-warn';
            var ts = e.ts ? new Date(e.ts).toLocaleTimeString() : '';
            var msgHtml = highlight(e.msg || '', filterText);
            var detailHtml = e.detail ? '<div class="event-detail muted">' + highlight(e.detail, filterText) + '</div>' : '';
            var caret = e.detail ? '<span class="toggle-caret">▶</span> ' : '';
            return '<tr class="event-row ' + lvlClass + '" data-evt-id="' + e.id + '">'
                + '<td class="event-ts">' + escapeText(ts) + '</td>'
                + '<td class="event-level"><span class="event-badge ' + lvlClass + '">' + escapeText(e.level) + '</span></td>'
                + '<td class="event-msg">' + caret + msgHtml + detailHtml + '</td>'
                + '</tr>';
        }).join('');

        panel.innerHTML = '<table class="events-table">'
            + '<thead><tr><th>Time</th><th>Level</th><th>Message</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table>';

        if (pager) {
            pager.classList.remove('hidden');
            if (pageInfo) {
                pageInfo.textContent = 'Page ' + (pageIndex + 1) + ' of ' + totalPages
                    + ' · ' + filtered.length + ' event' + (filtered.length === 1 ? '' : 's')
                    + (filtered.length !== allEvents.length ? ' (filtered from ' + allEvents.length + ')' : '');
            }
            var prev = document.getElementById('events-prev');
            var next = document.getElementById('events-next');
            if (prev) prev.disabled = pageIndex === 0;
            if (next) next.disabled = pageIndex >= totalPages - 1;
        }
    }

    function loadEvents() {
        var levelSel = document.getElementById('events-level-filter');
        filterLevel = levelSel ? levelSel.value : '';
        // Always fetch the buffer max — pagination/filter is client-side so
        // searching can hit older events without round-trips.
        adminFetch('/api/admin/events?limit=1000')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data || !data.success) return;
                // listEvents returns oldest→newest; reverse for newest-first paging.
                allEvents = (data.events || []).slice().reverse();
                if (data.counts) {
                    lastSeenId = data.counts.latestId || lastSeenId;
                    updateBubble({ warn: 0, error: 0, total: 0 });
                    var summary = document.getElementById('events-counts-summary');
                    if (summary) summary.textContent = '(' + (data.counts.warn || 0) + ' warn / ' + (data.counts.error || 0) + ' error in buffer)';
                }
                renderEvents();
            })
            .catch(function() { /* ignore transient errors */ });
    }

    function clearEventsBuffer() {
        adminFetch('/api/admin/events', { method: 'DELETE' })
            .then(function(r) { return r.json(); })
            .then(function() { allEvents = []; pageIndex = 0; loadEvents(); })
            .catch(function() { /* ignore */ });
    }

    function updateBubble(counts) {
        var bubble = document.getElementById('nav-events-bubble');
        if (!bubble) return;
        var total = (counts.warn || 0) + (counts.error || 0);
        if (total > 0) {
            bubble.textContent = total > 99 ? '99+' : String(total);
            bubble.hidden = false;
            bubble.classList.toggle('has-error', (counts.error || 0) > 0);
        } else {
            bubble.hidden = true;
            bubble.classList.remove('has-error');
        }
    }

    function pollCounts() {
        adminFetch('/api/admin/events/counts?since=' + encodeURIComponent(lastSeenId))
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data || !data.success || !data.counts) return;
                updateBubble(data.counts);
            })
            .catch(function() { /* ignore */ });
    }

    function startPolling() {
        stopPolling();
        pollCounts();
        pollTimer = setInterval(pollCounts, 10000);
    }
    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function startMonitoringRefresh() {
        stopMonitoringRefresh();
        refreshTimer = setInterval(function() {
            var section = document.getElementById('monitoring-section');
            if (section && !section.classList.contains('hidden')) loadEvents();
        }, 15000);
    }
    function stopMonitoringRefresh() {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    }

    // When user navigates to Monitoring, load events; mark-as-read by adopting latestId.
    document.addEventListener('click', function(ev) {
        var t = ev.target;
        if (t && t.getAttribute && t.getAttribute('data-section') === 'monitoring') {
            setTimeout(loadEvents, 50);
        }
    }, true);

    // Row expand/collapse (delegated; only inside events-panel).
    function attachPanelHandlers() {
        var panel = document.getElementById('events-panel');
        if (!panel || panel._evtBound) return;
        panel._evtBound = true;
        panel.addEventListener('click', function(ev) {
            var row = ev.target.closest && ev.target.closest('tr.event-row');
            if (!row) return;
            // Don't toggle on selection of text within already-expanded detail.
            var sel = window.getSelection && window.getSelection();
            if (sel && sel.toString().length > 0) return;
            row.classList.toggle('expanded');
        });
    }

    function attachControlHandlers() {
        var search = document.getElementById('events-search');
        if (search && !search._evtBound) {
            search._evtBound = true;
            var debounce;
            search.addEventListener('input', function() {
                clearTimeout(debounce);
                debounce = setTimeout(function() {
                    filterText = search.value || '';
                    pageIndex = 0;
                    renderEvents();
                }, 120);
            });
        }
        var pageSel = document.getElementById('events-page-size');
        if (pageSel && !pageSel._evtBound) {
            pageSel._evtBound = true;
            pageSel.addEventListener('change', function() {
                var n = parseInt(pageSel.value, 10);
                if (Number.isFinite(n) && n > 0) { pageSize = n; pageIndex = 0; renderEvents(); }
            });
        }
        var prev = document.getElementById('events-prev');
        if (prev && !prev._evtBound) {
            prev._evtBound = true;
            prev.addEventListener('click', function() { if (pageIndex > 0) { pageIndex--; renderEvents(); } });
        }
        var next = document.getElementById('events-next');
        if (next && !next._evtBound) {
            next._evtBound = true;
            next.addEventListener('click', function() { pageIndex++; renderEvents(); });
        }
    }

    // Init after DOM ready (script is `defer`).
    function init() {
        startPolling();
        startMonitoringRefresh();
        attachPanelHandlers();
        attachControlHandlers();
        var levelFilter = document.getElementById('events-level-filter');
        if (levelFilter && !levelFilter._evtBound) {
            levelFilter._evtBound = true;
            levelFilter.addEventListener('change', function() { pageIndex = 0; loadEvents(); });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.loadEvents = loadEvents;
    window.clearEvents = clearEventsBuffer;
})();
