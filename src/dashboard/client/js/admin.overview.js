/* eslint-disable */
// Extracted overview functions from admin.html
(function(){
    // rely on global helpers: formatUptime, formatBytes, showError
    window.statsAvailable = false;

    async function loadOverviewData(){
        try {
            const [statsRes, maintenanceRes, healthRes] = await Promise.allSettled([
                adminAuth.adminFetch('/api/admin/stats'),
                adminAuth.adminFetch('/api/admin/maintenance'),
                adminAuth.adminFetch('/api/system/health')
            ]);
            const statsData = statsRes.status==='fulfilled' ? await statsRes.value.json().catch(()=> ({})) : {};
            const maintenanceData = maintenanceRes.status==='fulfilled' ? await maintenanceRes.value.json().catch(()=> ({})) : {};
            const healthData = healthRes.status==='fulfilled' ? await healthRes.value.json().catch(()=> ({})) : {};
            if(statsData?.success && statsData.stats){
                window.statsAvailable = true; displaySystemStats(statsData.stats);
            } else {
                window.statsAvailable = false; const statsEl = document.getElementById('system-stats'); if(statsEl) statsEl.innerHTML = '<div class="error-message">Stats unavailable</div>';
            }
            if(maintenanceData?.success && maintenanceData.maintenance && typeof displayMaintenanceInfo==='function'){
                try { displayMaintenanceInfo(maintenanceData.maintenance); } catch(e){ console.warn('displayMaintenanceInfo failed:', e); }
            }
            if(healthData && (healthData.success || ['ok','healthy','degraded'].includes(healthData.status))){
                // /api/system/health wraps the actual payload under .data; older
                // shapes use .systemHealth or .maintenance.systemHealth. Unwrap so
                // displaySystemHealth sees status/uptime/checks at the top level
                // instead of receiving the wrapper and degrading to 'unknown'.
                displaySystemHealth(healthData.systemHealth || healthData.maintenance?.systemHealth || healthData.data || healthData);
            }
        } catch(err){
            console.error('Error loading overview data:', err);
            showError('Failed to load overview data');
        }
    }

    function displaySystemStats(stats) {
        try { window.lastSystemStats = stats; } catch(e) { /* ignore */ }
        const html = `
            <div class="stat-row">
                <span class="stat-label">Uptime</span>
                <span class="stat-value">${formatUptime(stats.uptime)}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Active Connections (WS)</span>
                <span class="stat-value">${stats.activeConnections}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Admin Sessions</span>
                <span class="stat-value">${stats.adminActiveSessions ?? '0'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Total Requests</span>
                <span class="stat-value">${stats.totalRequests.toLocaleString()}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Error Rate</span>
                <span class="stat-value">${stats.errorRate.toFixed(2)}%</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Avg Response Time</span>
                <span class="stat-value">${stats.avgResponseTime.toFixed(1)}ms</span>
            </div>
            <hr style="opacity:.15;margin:6px 0;"/>
            <div class="stat-row">
                <span class="stat-label" style="opacity:.8">index Accepted</span>
                <span class="stat-value">${stats.indexStats?.acceptedInstructions ?? stats.indexStats?.totalInstructions ?? '—'}</span>
            </div>
            <div class="stat-row" title="Physical *.json files discovered (raw). May exceed accepted due to validation skips">
                <span class="stat-label" style="opacity:.8">index Files</span>
                <span class="stat-value">${stats.indexStats?.rawFileCount ?? '—'}</span>
            </div>
            <div class="stat-row" title="Rejected/skipped after validation/normalization">
                <span class="stat-label" style="opacity:.8">index Skipped</span>
                <span class="stat-value">${stats.indexStats?.skippedInstructions ?? '—'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label" style="opacity:.8">index Version</span>
                <span class="stat-value">${stats.indexStats?.version ?? '—'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label" style="opacity:.8">Schema Version</span>
                <span class="stat-value">${stats.indexStats?.schemaVersion ?? 'unknown'}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label" style="opacity:.8">Last Updated</span>
                <span class="stat-value">${stats.indexStats?.lastUpdated ? new Date(stats.indexStats.lastUpdated).toLocaleString() : 'N/A'}</span>
            </div>
        `;
        const el = document.getElementById('system-stats'); if(el) el.innerHTML = html;

        const perfParts = [];
        perfParts.push(`
            <div class="stat-row">
                <span class="stat-label">Total Connections</span>
                <span class="stat-value">${stats.totalConnections.toLocaleString()}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Error Rate</span>
                <span class="stat-value">${stats.errorRate.toFixed(2)}%</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Response Time</span>
                <span class="stat-value">${stats.avgResponseTime.toFixed(1)}ms</span>
            </div>`);
        try {
            if(window.__resourceTrendCache){
                const t = window.__resourceTrendCache;
                perfParts.push(`
                    <div class="stat-row">
                        <span class="stat-label">Window</span>
                        <span class="stat-value">${t.windowSec}s (${t.sampleCount} samples)</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Memory Usage</span>
                        <span class="stat-value">${formatBytes(stats.memoryUsage.heapUsed)} / ${formatBytes(stats.memoryUsage.heapLimit || stats.memoryUsage.heapTotal)}</span>
                    </div>`);
            }
        } catch(e) { /* ignore */ }
        const perfEl = document.getElementById('performance-stats'); if(perfEl) perfEl.innerHTML = perfParts.join('');

        displayToolMetrics(stats);
    }

    function displayToolMetrics(stats) {
        const toolMetricsEl = document.getElementById('tool-metrics');
        if (!toolMetricsEl || !stats.toolMetrics) {
            if (toolMetricsEl) toolMetricsEl.innerHTML = '<div class="error-message">Tool metrics unavailable</div>';
            return;
        }
        const tools = Object.entries(stats.toolMetrics);
        tools.sort(([,a], [,b]) => b.callCount - a.callCount);

        let html = '<div class="tool-metrics-grid">';
        tools.forEach(([toolName, metrics]) => {
            const avgResponseTime = metrics.callCount > 0 ? (metrics.totalResponseTime / metrics.callCount).toFixed(1) : '0.0';
            const successRate = metrics.callCount > 0 ? ((metrics.successCount / metrics.callCount) * 100).toFixed(1) : '100.0';
            html += `
                <div class="tool-metric-card">
                    <div class="tool-name">${toolName}</div>
                    <div class="tool-stats">
                        <div class="stat-row">
                            <span class="stat-label">Total Calls</span>
                            <span class="stat-value">${metrics.callCount.toLocaleString()}</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Success Rate</span>
                            <span class="stat-value ${parseFloat(successRate) < 95 ? 'warning' : ''}">${successRate}%</span>
                        </div>
                        <div class="stat-row">
                            <span class="stat-label">Avg Response</span>
                            <span class="stat-value">${avgResponseTime}ms</span>
                        </div>
                    </div>
                </div>`;
        });
        html += '</div>';
        toolMetricsEl.innerHTML = html;
    }

    // expose for other scripts and inline handlers
    window.loadOverviewData = loadOverviewData;
    window.displaySystemStats = displaySystemStats;
    window.displayToolMetrics = displayToolMetrics;

    // Usage Signals panel
    async function loadUsageSignals() {
        const panel = document.getElementById('usage-signals-panel');
        if (!panel) return;
        try {
            const res = await adminAuth.adminFetch('/api/usage/snapshot');
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            const snap = data.snapshot || {};
            const entries = Object.entries(snap).filter(function(e) { return e[1] && (e[1].lastSignal || e[1].usageCount); });
            if (!entries.length) { panel.innerHTML = '<div style="opacity:.6;">No usage signals recorded yet.</div>'; return; }

            // Summary counts
            var signalCounts = {};
            var totalUsage = 0;
            var withSignal = 0;
            entries.forEach(function(e) {
                var rec = e[1];
                totalUsage += rec.usageCount || 0;
                if (rec.lastSignal) { withSignal++; signalCounts[rec.lastSignal] = (signalCounts[rec.lastSignal] || 0) + 1; }
            });

            var colors = { 'outdated': '#f2495c', 'not-relevant': '#ff9830', 'helpful': '#73bf69', 'applied': '#5794f2' };
            var summaryHtml = '<div class="stat-row"><span class="stat-label">Instructions with Usage</span><span class="stat-value">' + entries.length + '</span></div>';
            summaryHtml += '<div class="stat-row"><span class="stat-label">Total Usage Count</span><span class="stat-value">' + totalUsage + '</span></div>';
            summaryHtml += '<div class="stat-row"><span class="stat-label">Instructions with Signals</span><span class="stat-value">' + withSignal + '</span></div>';
            summaryHtml += '<hr style="opacity:.15;margin:6px 0;"/>';
            Object.keys(signalCounts).sort().forEach(function(sig) {
                var c = colors[sig] || '#888';
                summaryHtml += '<div class="stat-row"><span class="stat-label"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + c + ';margin-right:6px;"></span>' + sig + '</span><span class="stat-value">' + signalCounts[sig] + '</span></div>';
            });

            // Top 10 most signaled
            var signaled = entries.filter(function(e) { return e[1].lastSignal; }).sort(function(a, b) { return (b[1].usageCount || 0) - (a[1].usageCount || 0); }).slice(0, 10);
            if (signaled.length) {
                summaryHtml += '<hr style="opacity:.15;margin:6px 0;"/>';
                summaryHtml += '<div style="font-weight:600;font-size:11px;margin-bottom:4px;">Top Signaled Instructions</div>';
                signaled.forEach(function(e) {
                    var id = e[0]; var rec = e[1];
                    var c = colors[rec.lastSignal] || '#888';
                    var badge = '<span style="background:' + c + '22;color:' + c + ';border:1px solid ' + c + '44;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600;">' + rec.lastSignal + '</span>';
                    var comment = rec.lastComment ? ' <span style="opacity:.5;font-size:10px;" title="' + (rec.lastComment || '').replace(/"/g, '&quot;').slice(0,200) + '">💬</span>' : '';
                    summaryHtml += '<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:11px;"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;" title="' + id + '">' + id + '</span><span>' + badge + ' <span style="opacity:.6;">(' + (rec.usageCount || 0) + ' uses)</span>' + comment + '</span></div>';
                });
            }

            panel.innerHTML = '<div class="metrics-list">' + summaryHtml + '</div>';
        } catch (e) {
            panel.innerHTML = '<div class="error-message">Failed to load usage signals: ' + (e.message || e) + '</div>';
        }
    }

    // Hook into overview load
    var origLoadOverview = window.loadOverviewData;
    window.loadOverviewData = async function() {
        await Promise.all([origLoadOverview(), loadUsageSignals()]);
    };
    window.loadUsageSignals = loadUsageSignals;
})();
