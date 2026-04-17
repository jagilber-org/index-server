/* eslint-disable */
// Configuration panel – dynamic flags grouped by category with search, auto-refresh, and doc links
(function(){
    var _configRefreshTimer = null;
    var _collapsedCategories = {};

    function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function buildFlagRow(f, featureFlags) {
        var isBool = f.type === 'boolean';
        var currentVal = (f.enabled !== undefined ? (f.enabled ? 'on' : 'off') : (f.value !== undefined ? f.value : '')) || '';
        var control = isBool
            ? '<select data-flag="' + escapeHtml(f.name.toLowerCase()) + '" class="form-input cfg-flag-select">'
              + '<option value="1"' + ((featureFlags[f.name.toLowerCase()] ?? f.enabled) ? ' selected' : '') + '>On</option>'
              + '<option value="0"' + (!(featureFlags[f.name.toLowerCase()] ?? f.enabled) ? ' selected' : '') + '>Off</option>'
              + '</select>'
            : '<span class="cfg-flag-ro">' + escapeHtml(currentVal) + '</span>';
        var stabClass = 'cfg-stab-' + (f.stability || 'stable');
        var docHref = f.docAnchor ? ('https://github.com/jagilber-org/index-server/blob/main/docs/configuration.md#' + encodeURIComponent(f.docAnchor)) : '';
        var docIcon = docHref ? ' <a class="cfg-doc-link" href="' + docHref + '" target="_blank" rel="noopener" title="Documentation for ' + escapeHtml(f.name) + '">📖</a>' : '';
        return '<tr class="cfg-flag-row" data-flagname="' + escapeHtml(f.name.toLowerCase()) + '">'
            + '<td class="cfg-flag-name">' + escapeHtml(f.name) + docIcon + '</td>'
            + '<td>' + control + '</td>'
            + '<td class="cfg-flag-default">' + escapeHtml(f.default || '') + '</td>'
            + '<td class="' + stabClass + '">' + escapeHtml(f.stability || '') + '</td>'
            + '<td class="cfg-flag-desc">' + escapeHtml(f.description || '') + '</td>'
            + '</tr>';
    }

    function groupByCategory(flags) {
        var groups = {};
        var order = [];
        flags.forEach(function(f) {
            if (!groups[f.category]) { groups[f.category] = []; order.push(f.category); }
            groups[f.category].push(f);
        });
        return { groups: groups, order: order };
    }

    function buildFlagsHtml(allFlags, featureFlags) {
        if (!allFlags.length) return '<div class="cfg-no-flags">No feature flags detected</div>';
        var catData = groupByCategory(allFlags);
        var html = '<div class="cfg-flag-filter"><input type="text" id="cfg-flag-search" class="form-input" placeholder="Filter flags..." /></div>';
        catData.order.forEach(function(cat) {
            var collapsed = _collapsedCategories[cat];
            var flags = catData.groups[cat];
            html += '<div class="cfg-category-group" data-category="' + escapeHtml(cat) + '">';
            html += '<div class="cfg-category-header" onclick="toggleConfigCategory(\'' + escapeHtml(cat) + '\')">';
            html += '<span class="cfg-category-chevron">' + (collapsed ? '▶' : '▼') + '</span> ';
            html += '<span class="cfg-category-name">' + escapeHtml(cat.charAt(0).toUpperCase() + cat.slice(1)) + '</span>';
            html += ' <span class="cfg-category-count">(' + flags.length + ')</span>';
            html += '</div>';
            html += '<table class="cfg-flag-table"' + (collapsed ? ' style="display:none"' : '') + '>';
            html += '<thead><tr><th>Flag</th><th>Value</th><th>Default</th><th>Stability</th><th>Description</th></tr></thead>';
            html += '<tbody>';
            flags.forEach(function(f) { html += buildFlagRow(f, featureFlags); });
            html += '</tbody></table>';
            html += '</div>';
        });
        return html;
    }

    async function loadConfiguration() {
        try {
            var res = await adminAuth.adminFetch('/api/admin/config');
            var data = await res.json();
            if (!data.success) throw new Error('Failed to load config');
            var cfg = data.config;
            var featureFlags = data.featureFlags || {};
            var allFlags = Array.isArray(data.allFlags) ? data.allFlags : [];
            if (!allFlags.length) {
                try {
                    var fres = await adminAuth.adminFetch('/api/admin/flags');
                    var fdata = await fres.json();
                    if (fdata.success && Array.isArray(fdata.allFlags)) allFlags = fdata.allFlags;
                } catch(e) { /* ignore */ }
            }
            var refreshedAt = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

            var html = '<div class="cfg-panel">'
                + '<form onsubmit="return updateConfiguration(event)" class="cfg-server-form">'
                + '<div class="cfg-server-grid">'
                + '<div class="form-group"><label class="form-label">Max Connections</label>'
                + '<input class="form-input" type="number" id="cfg-maxConnections" value="' + cfg.serverSettings.maxConnections + '" /></div>'
                + '<div class="form-group"><label class="form-label">Request Timeout (ms)</label>'
                + '<input class="form-input" type="number" id="cfg-requestTimeout" value="' + cfg.serverSettings.requestTimeout + '" /></div>'
                + '<div class="form-group"><label class="form-label">Verbose Logging</label>'
                + '<select class="form-input" id="cfg-verbose"><option value="1"' + (cfg.serverSettings.enableVerboseLogging ? ' selected' : '') + '>Enabled</option>'
                + '<option value="0"' + (!cfg.serverSettings.enableVerboseLogging ? ' selected' : '') + '>Disabled</option></select></div>'
                + '<div class="form-group"><label class="form-label">Enable Mutation</label>'
                + '<select class="form-input" id="cfg-mutation"><option value="1"' + (cfg.serverSettings.enableMutation ? ' selected' : '') + '>Enabled</option>'
                + '<option value="0"' + (!cfg.serverSettings.enableMutation ? ' selected' : '') + '>Disabled</option></select></div>'
                + '<div class="form-group"><label class="form-label">Rate Limit Window (ms)</label>'
                + '<input class="form-input" type="number" id="cfg-windowMs" value="' + cfg.serverSettings.rateLimit.windowMs + '" /></div>'
                + '<div class="form-group"><label class="form-label">Rate Limit Max Requests</label>'
                + '<input class="form-input" type="number" id="cfg-maxRequests" value="' + cfg.serverSettings.rateLimit.maxRequests + '" /></div>'
                + '</div>'
                + '<div class="cfg-save-row"><button class="action-btn" type="submit">💾 Save Config</button></div>'
                + '</form>'
                + '<div class="cfg-flags-section">'
                + '<div class="cfg-flags-header">'
                + '<h3 class="cfg-flags-title">Feature Flags</h3>'
                + '<span class="cfg-refreshed">Last refreshed: ' + escapeHtml(refreshedAt) + '</span>'
                + '</div>'
                + '<div class="cfg-flags-note">All recognized flags grouped by category. Edit boolean flags inline – changes persist to file. Non-boolean flags are read-only.</div>'
                + buildFlagsHtml(allFlags, featureFlags)
                + '</div></div>';

            var target = document.getElementById('config-form');
            if (target) {
                target.innerHTML = html;
                target.classList.remove('loading');
                var searchInput = document.getElementById('cfg-flag-search');
                if (searchInput) searchInput.addEventListener('input', filterConfigFlags);
            }
        } catch (e) {
            var target = document.getElementById('config-form');
            if (target) target.innerHTML = '<div class="error">Failed to load configuration</div>';
        }
    }

    function filterConfigFlags() {
        var term = (document.getElementById('cfg-flag-search') || {}).value;
        if (term === undefined) return;
        term = term.toLowerCase();
        var rows = document.querySelectorAll('.cfg-flag-row');
        rows.forEach(function(row) {
            var name = row.getAttribute('data-flagname') || '';
            var desc = (row.querySelector('.cfg-flag-desc') || {}).textContent || '';
            row.style.display = (name.indexOf(term) !== -1 || desc.toLowerCase().indexOf(term) !== -1) ? '' : 'none';
        });
        // Show all category groups when filtering
        if (term) {
            document.querySelectorAll('.cfg-flag-table').forEach(function(t) { t.style.display = ''; });
        }
    }

    function toggleConfigCategory(cat) {
        _collapsedCategories[cat] = !_collapsedCategories[cat];
        var group = document.querySelector('.cfg-category-group[data-category="' + cat + '"]');
        if (!group) return;
        var table = group.querySelector('.cfg-flag-table');
        var chevron = group.querySelector('.cfg-category-chevron');
        if (table) table.style.display = _collapsedCategories[cat] ? 'none' : '';
        if (chevron) chevron.textContent = _collapsedCategories[cat] ? '▶' : '▼';
    }

    function startConfigAutoRefresh() {
        stopConfigAutoRefresh();
        _configRefreshTimer = setInterval(function() {
            // Only auto-refresh if config section is visible
            var section = document.getElementById('config-section');
            if (section && !section.classList.contains('hidden')) loadConfiguration();
        }, 15000);
    }

    function stopConfigAutoRefresh() {
        if (_configRefreshTimer) { clearInterval(_configRefreshTimer); _configRefreshTimer = null; }
    }

    async function updateConfiguration(ev) {
        ev.preventDefault();
        var flagSelects = document.querySelectorAll('[data-flag]');
        var featureFlags = {};
        flagSelects.forEach(function(sel) {
            var name = sel.getAttribute('data-flag');
            if (name) featureFlags[name] = sel.value === '1';
        });
        var updates = {
            serverSettings: {
                maxConnections: parseInt(document.getElementById('cfg-maxConnections').value),
                requestTimeout: parseInt(document.getElementById('cfg-requestTimeout').value),
                enableVerboseLogging: document.getElementById('cfg-verbose').value === '1',
                enableMutation: document.getElementById('cfg-mutation').value === '1',
                rateLimit: {
                    windowMs: parseInt(document.getElementById('cfg-windowMs').value),
                    maxRequests: parseInt(document.getElementById('cfg-maxRequests').value)
                }
            },
            featureFlags: featureFlags
        };
        try {
            var res = await adminAuth.adminFetch('/api/admin/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(updates)});
            var data = await res.json();
            if (data.success) { if (typeof showSuccess === 'function') showSuccess('Configuration updated'); loadConfiguration(); }
            else { if (typeof showError === 'function') showError(data.error || 'Update failed'); }
        } catch (e) { if (typeof showError === 'function') showError('Update failed'); }
        return false;
    }

    window.loadConfiguration = loadConfiguration;
    window.updateConfiguration = updateConfiguration;
    window.toggleConfigCategory = toggleConfigCategory;
    window.startConfigAutoRefresh = startConfigAutoRefresh;
    window.stopConfigAutoRefresh = stopConfigAutoRefresh;
})();
