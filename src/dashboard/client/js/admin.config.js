/* eslint-disable */
/**
 * admin.config — Configuration tab orchestrator.
 *
 * Issue #359: rewritten to be driven entirely by the FLAG_REGISTRY surfaced
 * through GET /api/admin/config. The bespoke top form is gone. All rendering
 * lives in admin.config.render.js (so Tank's T5 jsdom tests can exercise pure
 * helpers); this file owns fetch, DOM mutation, event wiring, and POST.
 *
 * Marks `window.__configExternalLoaded = true` to suppress the inline fallback
 * in admin.html (which now shows a hard error if this module fails to load).
 */
(function(){
    window.__configExternalLoaded = true;

    var render = window.adminConfigRender;
    if (!render) {
        console.error('[admin.config] adminConfigRender helpers missing — admin.config.render.js failed to load before admin.config.js.');
        return;
    }

    var _configRefreshTimer = null;
    var _lastSnapshot = { allFlags: [], byKey: {} };

    function snapshotFlags(allFlags) {
        var byKey = {};
        (allFlags || []).forEach(function(f){ if (f && f.key) byKey[f.key] = f; });
        _lastSnapshot = { allFlags: allFlags || [], byKey: byKey };
    }

    function coerceForType(raw, type) {
        if (type === 'boolean') return raw === true || raw === 'true' || raw === '1' || raw === 1;
        if (type === 'number') {
            if (raw === '' || raw === null || raw === undefined) return raw;
            var n = Number(raw);
            return Number.isFinite(n) ? n : raw;
        }
        return raw;
    }

    function collectEdits(rootEl) {
        var edits = {};
        var inputs = (rootEl || document).querySelectorAll('.cfg-flag-input');
        inputs.forEach(function(el){
            if (el.disabled) return;
            var key = el.getAttribute('data-flag-key');
            var type = el.getAttribute('data-flag-type') || 'string';
            if (!key) return;
            var raw = (el.tagName === 'SELECT') ? el.value : el.value;
            var current = _lastSnapshot.byKey[key];
            if (!current) return;
            var coerced = coerceForType(raw, type);
            var prior = current.value;
            // Only include if the user actually changed it (string-compare avoids
            // sending the entire registry on every Save).
            if (String(coerced) === String(prior === undefined || prior === null ? '' : prior)) return;
            edits[key] = coerced;
        });
        return edits;
    }

    function attachFilter() {
        var input = document.getElementById('cfg-flag-search');
        if (!input) return;
        input.addEventListener('input', function(){
            var term = (input.value || '').toLowerCase();
            var rows = document.querySelectorAll('.cfg-flag-row');
            rows.forEach(function(row){
                var key = (row.getAttribute('data-flag-key') || '').toLowerCase();
                var desc = ((row.querySelector('.cfg-flag-desc') || {}).textContent || '').toLowerCase();
                row.style.display = (!term || key.indexOf(term) !== -1 || desc.indexOf(term) !== -1) ? '' : 'none';
            });
        });
    }

    function attachSectionToggles() {
        var headers = document.querySelectorAll('.cfg-section-header');
        headers.forEach(function(h){
            h.style.cursor = 'pointer';
            h.addEventListener('click', function(){
                var section = h.parentElement;
                if (!section) return;
                var body = section.querySelector('.cfg-section-body');
                if (!body) return;
                var collapsed = section.getAttribute('data-collapsed') === 'true';
                section.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
                if (collapsed) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
            });
        });
    }

    function attachSaveAll() {
        var btn = document.getElementById('cfg-save-all-btn');
        if (!btn) return;
        btn.addEventListener('click', function(){ saveAllChanges(); });
    }

    function attachResetButtons() {
        // Per-row reset is not currently rendered — handled by the POST
        // /api/admin/config/reset/:flag endpoint. Reserved for follow-up UI work.
    }

    async function loadConfiguration() {
        var target = document.getElementById('config-form');
        if (!target) return;
        target.classList.add('loading');
        try {
            var res = await adminAuth.adminFetch('/api/admin/config');
            var data = await res.json();
            if (!data || !data.success) throw new Error((data && data.error) || 'Failed to load /api/admin/config');
            var allFlags = Array.isArray(data.allFlags) ? data.allFlags : [];
            snapshotFlags(allFlags);
            target.innerHTML = render.buildConfigPanel(allFlags, { timestamp: data.timestamp });
            attachFilter();
            attachSectionToggles();
            attachSaveAll();
            attachResetButtons();
        } catch (e) {
            console.error('[admin.config] load failed', e);
            target.innerHTML = '<div class="error" role="alert">Failed to load configuration: '
                + render.escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
        } finally {
            target.classList.remove('loading');
        }
    }

    function summarizeResults(results) {
        var applied = 0, errors = 0, restart = 0;
        var errLines = [];
        Object.keys(results || {}).forEach(function(k){
            var r = results[k];
            if (!r) return;
            if (r.applied) applied++;
            if (r.requiresRestart) restart++;
            if (r.error) { errors++; errLines.push(k + ': ' + r.error); }
        });
        return { applied: applied, errors: errors, restart: restart, errLines: errLines };
    }

    async function saveAllChanges() {
        var edits = collectEdits(document.getElementById('config-form'));
        if (!Object.keys(edits).length) {
            if (typeof showSuccess === 'function') showSuccess('No changes to save.');
            return;
        }
        try {
            var res = await adminAuth.adminFetch('/api/admin/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates: edits })
            });
            var data = await res.json();
            if (!data || !data.success) {
                if (typeof showError === 'function') showError((data && data.error) || 'Update failed');
                return;
            }
            var summary = summarizeResults(data.results);
            var msg = summary.applied + ' applied';
            if (summary.restart) msg += ', ' + summary.restart + ' require restart';
            if (summary.errors) msg += ', ' + summary.errors + ' rejected';
            if (summary.errors && typeof showError === 'function') {
                showError(msg + '\n' + summary.errLines.join('\n'));
            } else if (typeof showSuccess === 'function') {
                showSuccess(msg);
            }
            loadConfiguration();
        } catch (e) {
            console.error('[admin.config] save failed', e);
            if (typeof showError === 'function') showError('Save failed: ' + (e && e.message ? e.message : String(e)));
        }
    }

    async function resetFlag(key) {
        if (!key) return;
        try {
            var res = await adminAuth.adminFetch('/api/admin/config/reset/' + encodeURIComponent(key), { method: 'POST' });
            var data = await res.json();
            if (data && data.success) {
                if (typeof showSuccess === 'function') showSuccess(data.message || ('Reset ' + key));
                loadConfiguration();
            } else if (typeof showError === 'function') {
                showError((data && data.error) || 'Reset failed');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('Reset failed: ' + (e && e.message ? e.message : String(e)));
        }
    }

    function startConfigAutoRefresh() {
        stopConfigAutoRefresh();
        _configRefreshTimer = setInterval(function(){
            var section = document.getElementById('config-section');
            if (section && !section.classList.contains('hidden')) loadConfiguration();
        }, 15000);
    }

    function stopConfigAutoRefresh() {
        if (_configRefreshTimer) { clearInterval(_configRefreshTimer); _configRefreshTimer = null; }
    }

    window.loadConfiguration = loadConfiguration;
    window.saveAllChanges = saveAllChanges;
    window.resetFlag = resetFlag;
    window.startConfigAutoRefresh = startConfigAutoRefresh;
    window.stopConfigAutoRefresh = stopConfigAutoRefresh;
})();
