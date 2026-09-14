/* eslint-disable */
/**
 * admin.config.render — pure rendering helpers for the dashboard Configuration tab.
 *
 * Issue #359, plan §2.6 T5. Extracted from admin.config.js so jsdom-based tests
 * can require() it directly and exercise the HTML output without spinning up
 * a real browser. All functions in this module MUST be pure — given the same
 * inputs they return the same HTML string and never touch `document`, `window`,
 * or any other ambient state. The orchestrator (admin.config.js) owns DOM
 * mutation, event wiring, and network I/O.
 *
 * Public API (also attached to `window.adminConfigRender` for browser use):
 *   escapeHtml(s)                            — minimal HTML escape
 *   reloadBehaviorBadge(b)                   — 🟢/🟡/🔴 badge HTML for a flag
 *   shadowIndicator(flag)                    — "shadows ENV" pill or empty string
 *   readonlyTooltip(flag)                    — text describing why a flag is read-only
 *   pendingRestartBanner(allFlags)           — top-of-tab banner when overlay
 *                                              has restart-required entries
 *   lifecycleHookSummary(allFlags)           — safe hook activation summary
 *   buildFlagControl(flag)                   — editable input/select for a flag
 *   buildFlagRow(flag)                       — <tr> for a flag including controls
 *   groupBySurface(allFlags)                 — { pinned: [...], advanced: [...] }
 *   buildSection(title, flags, collapsed)    — collapsible category section HTML
 *   buildConfigPanel(allFlags, opts)         — top-level config tab HTML
 */
(function(global){
    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    var BADGE_DEFS = {
        'dynamic':          { icon: '🟢', label: 'Dynamic',          klass: 'cfg-badge-dynamic',  title: 'Change takes effect immediately on save.' },
        'next-request':     { icon: '🟡', label: 'Next request',     klass: 'cfg-badge-next',     title: 'Change takes effect on the next request after save.' },
        'restart-required': { icon: '🔴', label: 'Restart required', klass: 'cfg-badge-restart',  title: 'Change persists to the overlay file but only takes effect after a server restart.' }
    };

    function reloadBehaviorBadge(behavior) {
        // restart-required is the global default communicated by the static banner;
        // suppress per-row badge to reduce noise (issue: restart-required column).
        if (!behavior || behavior === 'restart-required') return '';
        var def = BADGE_DEFS[behavior];
        if (!def) return '';
        return '<span class="cfg-reload-badge ' + def.klass + '" title="' + escapeHtml(def.title) + '">'
            + def.icon + ' ' + escapeHtml(def.label) + '</span>';
    }

    function restartInfoBanner() {
        return '<div class="cfg-restart-info-banner" role="note">'
            + '<strong>ℹ️ Heads up:</strong> Most settings persist to the overlay file and only take effect after a server restart. '
            + 'Flags marked <span class="cfg-reload-badge cfg-badge-dynamic">🟢 Dynamic</span> or '
            + '<span class="cfg-reload-badge cfg-badge-next">🟡 Next request</span> apply sooner.'
            + '</div>';
    }

    function shadowIndicator(flag) {
        if (!flag || !flag.overlayShadowsEnv) return '';
        var envVal = (flag.envValueAtBoot !== undefined && flag.envValueAtBoot !== null)
            ? String(flag.envValueAtBoot)
            : '(unknown)';
        var tip = 'Overlay value silently shadows the process environment value (' + envVal + ') captured at boot.';
        return '<span class="cfg-shadow-indicator" title="' + escapeHtml(tip) + '">⚠ shadows ENV</span>';
    }

    function readonlyTooltip(flag) {
        if (!flag || flag.editable === true) return '';
        var reason = flag.readonlyReason || 'reserved';
        var detail = flag.readonlyDetail ? ' — ' + flag.readonlyDetail : '';
        var human = {
            'derived':    'Derived from other settings; not directly editable.',
            'deprecated': 'Deprecated; do not edit.',
            'reserved':   'Reserved for future use; not editable here.',
            'sensitive':  'Sensitive value; edit via secure channel only.',
            'legacy':     'Legacy flag retained for compatibility.'
        }[reason] || 'Not editable.';
        return human + detail;
    }

    function pendingRestartBanner(allFlags) {
        if (!Array.isArray(allFlags)) return '';
        var pending = allFlags.filter(function(f){
            return f && f.reloadBehavior === 'restart-required'
                && f.overlayValue !== undefined
                && f.overlayValue !== null
                && String(f.overlayValue) !== String(f.value);
        });
        if (!pending.length) return '';
        var names = pending.slice(0, 5).map(function(f){ return escapeHtml(f.name || f.key || ''); }).join(', ');
        var extra = pending.length > 5 ? ' (+' + (pending.length - 5) + ' more)' : '';
        return '<div class="cfg-restart-banner" role="status">'
            + '<strong>🔴 Pending restart:</strong> '
            + pending.length + ' flag' + (pending.length === 1 ? '' : 's')
            + ' saved to overlay but not yet applied — restart the server to activate. '
            + '<span class="cfg-restart-flags">' + names + extra + '</span>'
            + '</div>';
    }

    function flagKey(flag) { return (flag && (flag.name || flag.key)) || ''; }

    function isSensitive(flag) {
        return !!flag && (flag.sensitive === true || (flag.editable !== true && flag.readonlyReason === 'sensitive'));
    }

    function sensitiveStatus(flag) {
        var configured = flag && flag.present === true;
        var label = configured ? 'Configured' : 'Not configured';
        var suffix = configured ? '' : ' cfg-sensitive-status--unset';
        return '<span class="cfg-sensitive-status' + suffix + '" role="status" aria-label="'
            + escapeHtml(flagKey(flag)) + ': ' + label.toLowerCase() + '">'
            + (configured ? '● ' : '○ ') + label + '</span>';
    }

    function controlForBoolean(flag) {
        var current = flag.value === true || flag.value === 'true' || flag.value === 1 || flag.value === '1';
        var disabled = (flag.editable === true) ? '' : ' disabled';
        return '<select class="form-input cfg-flag-input" data-flag-key="' + escapeHtml(flagKey(flag)) + '" data-flag-type="boolean"' + disabled + '>'
            + '<option value="true"'  + (current  ? ' selected' : '') + '>true</option>'
            + '<option value="false"' + (!current ? ' selected' : '') + '>false</option>'
            + '</select>';
    }

    function controlForEnum(flag) {
        var disabled = (flag.editable === true) ? '' : ' disabled';
        var opts = (flag.validation && Array.isArray(flag.validation.enum)) ? flag.validation.enum : [];
        var current = flag.value !== undefined && flag.value !== null ? String(flag.value) : '';
        var html = '<select class="form-input cfg-flag-input" data-flag-key="' + escapeHtml(flagKey(flag)) + '" data-flag-type="' + escapeHtml(flag.type || 'string') + '"' + disabled + '>';
        opts.forEach(function(opt){
            var v = String(opt);
            html += '<option value="' + escapeHtml(v) + '"' + (v === current ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
        });
        html += '</select>';
        return html;
    }

    function controlForScalar(flag) {
        var disabled = (flag.editable === true) ? '' : ' disabled';
        var inputType = 'text';
        var extra = '';
        if (flag.type === 'number') {
            inputType = 'number';
            if (flag.validation) {
                if (flag.validation.min !== undefined) extra += ' min="' + escapeHtml(flag.validation.min) + '"';
                if (flag.validation.max !== undefined) extra += ' max="' + escapeHtml(flag.validation.max) + '"';
            }
        }
        var current = flag.value !== undefined && flag.value !== null ? String(flag.value) : '';
        var placeholder = flag.default !== undefined && flag.default !== null ? ' placeholder="' + escapeHtml(String(flag.default)) + '"' : '';
        return '<input class="form-input cfg-flag-input" type="' + inputType + '"'
            + ' data-flag-key="' + escapeHtml(flagKey(flag)) + '"'
            + ' data-flag-type="' + escapeHtml(flag.type || 'string') + '"'
            + ' value="' + escapeHtml(current) + '"'
            + placeholder + extra + disabled + ' />';
    }

    function buildFlagControl(flag) {
        if (!flag) return '';
        // Sensitive values are presence-only by contract. Never render an input,
        // even if a malformed or future API response accidentally includes value.
        if (isSensitive(flag)) return sensitiveStatus(flag);
        if (flag.type === 'boolean') return controlForBoolean(flag);
        if (flag.validation && Array.isArray(flag.validation.enum) && flag.validation.enum.length) return controlForEnum(flag);
        return controlForScalar(flag);
    }

    function buildFlagRow(flag) {
        // Backend (FLAG_REGISTRY) emits `name`; tolerate legacy `key` for safety.
        var rawName = (flag && (flag.name || flag.key)) || '';
        var key = escapeHtml(rawName);
        var desc = escapeHtml(flag.description || '');
        var def  = escapeHtml(flag.default !== undefined && flag.default !== null ? String(flag.default) : '');
        var stab = escapeHtml(flag.stability || 'stable');
        var ro   = (flag.editable !== true);
        var roTip = ro ? ' title="' + escapeHtml(readonlyTooltip(flag)) + '"' : '';
        var roClass = ro ? ' cfg-flag-row--readonly' : '';
        var badge = reloadBehaviorBadge(flag.reloadBehavior);
        var shadow = shadowIndicator(flag);
        var tags = '';
        if (badge) tags += ' ' + badge;
        if (shadow) tags += ' ' + shadow;
        if (flag.writeOnly === true) tags += ' <span class="cfg-writeonly-tag">write-only</span>';
        if (ro) tags += ' <span class="cfg-readonly-tag">read-only</span>';
        return '<tr class="cfg-flag-row' + roClass + '" data-flag-key="' + key + '"' + roTip + '>'
            + '<td class="cfg-flag-name">'
                + '<div class="cfg-flag-key">' + key + '</div>'
                + (tags ? '<div class="cfg-flag-tags">' + tags + '</div>' : '')
            + '</td>'
            + '<td class="cfg-flag-value">' + buildFlagControl(flag) + '</td>'
            + '<td class="cfg-flag-default">' + def + '</td>'
            + '<td class="cfg-flag-stab cfg-stab-' + stab + '">' + stab + '</td>'
            + '<td class="cfg-flag-desc">' + desc + '</td>'
            + '</tr>';
    }

    function groupBySurface(allFlags) {
        var pinned = [];
        var rest = [];
        (allFlags || []).forEach(function(f){
            if (!f) return;
            var surfaces = Array.isArray(f.surfaces) ? f.surfaces : [];
            if (surfaces.indexOf('pinned') !== -1) pinned.push(f);
            else rest.push(f);
        });
        return { pinned: pinned, advanced: rest };
    }

    function groupByCategory(flags) {
        var groups = {};
        var order = [];
        (flags || []).forEach(function(f){
            var cat = f.category || 'uncategorized';
            if (!groups[cat]) { groups[cat] = []; order.push(cat); }
            groups[cat].push(f);
        });
        order.sort();
        return { groups: groups, order: order };
    }

    function lifecycleHookSummary(allFlags) {
        var prefix = 'INDEX_SERVER_HOOK_';
        var hooks = (allFlags || []).filter(function(flag){
            return flag && flagKey(flag).indexOf(prefix) === 0;
        });
        if (!hooks.length) return '';

        var byName = {};
        hooks.forEach(function(flag){ byName[flagKey(flag)] = flag; });
        var commandNames = [
            'INDEX_SERVER_HOOK_ON_CREATE',
            'INDEX_SERVER_HOOK_ON_UPDATE',
            'INDEX_SERVER_HOOK_ON_REMOVE',
            'INDEX_SERVER_HOOK_ON_CHANGE'
        ];
        var configured = commandNames.filter(function(name){
            return byName[name] && byName[name].present === true;
        }).length;
        function effective(name, fallback) {
            var flag = byName[name] || {};
            if (flag.value !== undefined && flag.value !== null && String(flag.value) !== '') return flag.value;
            if (flag.default !== undefined && flag.default !== null && String(flag.default) !== '') return flag.default;
            return fallback;
        }
        var blockingRaw = effective('INDEX_SERVER_HOOK_BLOCKING', 'off');
        var blocking = blockingRaw === true || blockingRaw === 1
            || ['1', 'true', 'on', 'yes'].indexOf(String(blockingRaw).toLowerCase()) !== -1;
        var timeout = Number(effective('INDEX_SERVER_HOOK_TIMEOUT_MS', 10000));
        var concurrency = Number(effective('INDEX_SERVER_HOOK_MAX_CONCURRENT', 4));
        var enabled = configured > 0;

        return '<section class="cfg-lifecycle-summary" aria-labelledby="cfg-lifecycle-summary-title">'
            + '<div class="cfg-lifecycle-summary__heading">'
            + '<div><h3 id="cfg-lifecycle-summary-title">Lifecycle hooks</h3>'
            + '<p>Post-mutation command dispatch status. Command text is never exposed.</p></div>'
            + '<span class="cfg-lifecycle-state cfg-lifecycle-state--' + (enabled ? 'enabled' : 'disabled') + '">'
            + (enabled ? 'Enabled' : 'Disabled') + '</span></div>'
            + '<div class="cfg-lifecycle-metrics">'
            + '<div><strong>' + configured + ' of 4</strong><span>commands configured</span></div>'
            + '<div><strong>' + (blocking ? 'On' : 'Off') + '</strong><span>Blocking</span></div>'
            + '<div><strong>' + (Number.isFinite(timeout) ? timeout.toLocaleString('en-US') : '10,000') + ' ms</strong><span>Timeout</span></div>'
            + '<div><strong>' + (Number.isFinite(concurrency) ? concurrency.toLocaleString('en-US') : '4') + '</strong><span>Max concurrent</span></div>'
            + '</div></section>';
    }

    function lifecycleHookManager(allFlags) {
        var byName = {};
        (allFlags || []).forEach(function(flag){ if (flag) byName[flagKey(flag)] = flag; });
        var commandDefs = [
            { key: 'INDEX_SERVER_HOOK_ON_CREATE', label: 'On create', help: 'Runs after a new instruction is durably created.' },
            { key: 'INDEX_SERVER_HOOK_ON_UPDATE', label: 'On update', help: 'Runs after an existing instruction is durably overwritten.' },
            { key: 'INDEX_SERVER_HOOK_ON_REMOVE', label: 'On remove', help: 'Runs after one or more instructions are durably removed.' },
            { key: 'INDEX_SERVER_HOOK_ON_CHANGE', label: 'On any change', help: 'Catch-all for every committed mutation, import, and promotion.' }
        ];
        function effective(name, fallback) {
            var flag = byName[name] || {};
            if (flag.value !== undefined && flag.value !== null && String(flag.value) !== '') return flag.value;
            if (flag.default !== undefined && flag.default !== null && String(flag.default) !== '') return flag.default;
            return fallback;
        }
        var blockingRaw = effective('INDEX_SERVER_HOOK_BLOCKING', 'off');
        var blocking = blockingRaw === true || blockingRaw === 1
            || ['1', 'true', 'on', 'yes'].indexOf(String(blockingRaw).toLowerCase()) !== -1;
        var timeout = Number(effective('INDEX_SERVER_HOOK_TIMEOUT_MS', 10000));
        var concurrency = Number(effective('INDEX_SERVER_HOOK_MAX_CONCURRENT', 4));
        var commands = commandDefs.map(function(def){
            var configured = byName[def.key] && byName[def.key].present === true;
            var placeholder = configured ? 'Configured — enter a replacement' : 'Not configured — enter a command';
            return '<div class="cfg-hook-command" data-hook-command="' + escapeHtml(def.key) + '">'
                + '<div class="cfg-hook-command__label"><label for="cfg-hook-' + escapeHtml(def.key.toLowerCase()) + '">' + escapeHtml(def.label) + '</label>'
                + '<span class="cfg-sensitive-status' + (configured ? '' : ' cfg-sensitive-status--unset') + '">' + (configured ? '● Configured' : '○ Not configured') + '</span></div>'
                + '<div class="cfg-hook-command__input-row"><input class="form-input cfg-hook-command-input" type="password" autocomplete="new-password" spellcheck="false"'
                + ' id="cfg-hook-' + escapeHtml(def.key.toLowerCase()) + '" data-hook-key="' + escapeHtml(def.key) + '" value="" placeholder="' + escapeHtml(placeholder) + '" />'
                + '<button class="action-btn cfg-hook-clear-btn" type="button" data-hook-clear="' + escapeHtml(def.key) + '">Clear</button></div>'
                + '<p>' + escapeHtml(def.help) + '</p></div>';
        }).join('');

        return '<section class="cfg-hook-manager" aria-labelledby="cfg-hook-manager-title">'
            + '<div class="cfg-hook-manager__heading"><div><h3 id="cfg-hook-manager-title">Manage lifecycle hooks</h3>'
            + '<p>Commands are write-only: existing text is never returned to this page. Enter a value to replace it, or choose Clear to disable it.</p></div>'
            + '<a class="header-chip" href="/api/docs/lifecycle-hooks">Hook documentation</a></div>'
            + '<div class="cfg-hook-command-grid">' + commands + '</div>'
            + '<div class="cfg-hook-execution"><div class="cfg-hook-setting"><label for="cfg-hook-blocking">Blocking</label>'
            + '<select class="form-input" id="cfg-hook-blocking" data-hook-setting-key="INDEX_SERVER_HOOK_BLOCKING" data-hook-setting-type="boolean">'
            + '<option value="true"' + (blocking ? ' selected' : '') + '>On</option><option value="false"' + (!blocking ? ' selected' : '') + '>Off</option></select></div>'
            + '<div class="cfg-hook-setting"><label for="cfg-hook-timeout">Timeout (ms)</label><input class="form-input" id="cfg-hook-timeout" type="number" min="1"'
            + ' data-hook-setting-key="INDEX_SERVER_HOOK_TIMEOUT_MS" data-hook-setting-type="number" value="' + escapeHtml(Number.isFinite(timeout) ? timeout : 10000) + '" /></div>'
            + '<div class="cfg-hook-setting"><label for="cfg-hook-max-concurrent">Max concurrent</label><input class="form-input" id="cfg-hook-max-concurrent" type="number" min="1"'
            + ' data-hook-setting-key="INDEX_SERVER_HOOK_MAX_CONCURRENT" data-hook-setting-type="number" value="' + escapeHtml(Number.isFinite(concurrency) ? concurrency : 4) + '" /></div>'
            + '<button class="action-btn" id="cfg-hook-save-btn" type="button">💾 Save hook configuration</button></div>'
            + '<p class="cfg-hook-security-note">Do not embed credentials in command text. Pass secrets to hook scripts through a protected secret store or launcher environment.</p>'
            + '</section>';
    }

    function buildSection(title, flags, opts) {
        opts = opts || {};
        if (!flags || !flags.length) return '';
        var sectionId = 'cfg-section-' + escapeHtml((opts.id || title || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        var collapsed = !!opts.collapsed;
        var grouped = groupByCategory(flags);
        var inner = '';
        grouped.order.forEach(function(cat){
            var rows = grouped.groups[cat].map(buildFlagRow).join('');
            inner += '<div class="cfg-category-group" data-category="' + escapeHtml(cat) + '">'
                + '<div class="cfg-category-header"><span class="cfg-category-name">'
                + escapeHtml(cat.charAt(0).toUpperCase() + cat.slice(1)) + '</span>'
                + ' <span class="cfg-category-count">(' + grouped.groups[cat].length + ')</span></div>'
                + '<table class="cfg-flag-table"><thead><tr>'
                + '<th>Flag</th><th>Value</th><th>Default</th><th>Stability</th><th>Description</th>'
                + '</tr></thead><tbody>' + rows + '</tbody></table>'
                + '</div>';
        });
        return '<section class="cfg-section" id="' + sectionId + '" data-collapsed="' + (collapsed ? 'true' : 'false') + '">'
            + '<header class="cfg-section-header">'
            + '<h3 class="cfg-section-title">' + escapeHtml(title) + '</h3>'
            + '<span class="cfg-section-count">(' + flags.length + ')</span>'
            + '</header>'
            + '<div class="cfg-section-body"' + (collapsed ? ' hidden' : '') + '>' + inner + '</div>'
            + '</section>';
    }

    function buildConfigPanel(allFlags, opts) {
        opts = opts || {};
        var flags = Array.isArray(allFlags) ? allFlags : [];
        if (!flags.length) {
            return '<div class="cfg-panel"><div class="cfg-no-flags">No flags returned from /api/admin/config.</div></div>';
        }
        var groups = groupBySurface(flags);
        var refreshedAt = opts.timestamp ? new Date(opts.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
        return '<div class="cfg-panel">'
            + restartInfoBanner()
            + pendingRestartBanner(flags)
            + lifecycleHookSummary(flags)
            + lifecycleHookManager(flags)
            + '<div class="cfg-panel-header">'
            + '<div class="cfg-search-row"><input type="text" id="cfg-flag-search" class="form-input" placeholder="Filter flags by name or description..." /></div>'
            + '<div class="cfg-meta">Last refreshed: ' + escapeHtml(refreshedAt) + ' · ' + flags.length + ' flags</div>'
            + '</div>'
            + buildSection('Pinned', groups.pinned, { id: 'pinned', collapsed: false })
            + buildSection('All flags', groups.advanced, { id: 'advanced', collapsed: false })
            + '<div class="cfg-save-row">'
            + '<button class="action-btn" id="cfg-save-all-btn" type="button">💾 Save all changes</button>'
            + '<span class="cfg-save-hint">Saves all edited rows in one request. Restart-required flags persist to overlay and apply on next restart.</span>'
            + '</div>'
            + '</div>';
    }

    var api = {
        escapeHtml: escapeHtml,
        reloadBehaviorBadge: reloadBehaviorBadge,
        shadowIndicator: shadowIndicator,
        readonlyTooltip: readonlyTooltip,
        pendingRestartBanner: pendingRestartBanner,
        restartInfoBanner: restartInfoBanner,
        lifecycleHookSummary: lifecycleHookSummary,
        lifecycleHookManager: lifecycleHookManager,
        buildFlagControl: buildFlagControl,
        buildFlagRow: buildFlagRow,
        groupBySurface: groupBySurface,
        groupByCategory: groupByCategory,
        buildSection: buildSection,
        buildConfigPanel: buildConfigPanel
    };

    if (global && typeof global === 'object') global.adminConfigRender = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
