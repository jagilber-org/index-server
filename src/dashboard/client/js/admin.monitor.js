/* eslint-disable */
// Lightweight monitoring module extracted from admin.html
(function(){
    // Toggle synthetic traces wrapper visibility
    function toggleSyntheticTraceVisibility(){
        const wrap = document.getElementById('synthetic-traces-wrapper');
        const chk = document.getElementById('synthetic-trace-toggle');
        if(!wrap||!chk) return;
        wrap.style.display = chk.checked ? 'block':'none';
    }

    // Run synthetic activity (keeps a faster monitoring poll while running)
    async function runSyntheticActivity() {
        const iter = parseInt(document.getElementById('synthetic-iterations').value, 10) || 10;
        const conc = parseInt(document.getElementById('synthetic-concurrency').value, 10) || 2;
        const wantTrace = document.getElementById('synthetic-trace-toggle')?.checked !== false; // default true
        const btn = document.getElementById('synthetic-run-btn');
        const output = document.getElementById('synthetic-output');
        if(btn) { btn.disabled = true; btn.textContent = 'Running…'; }
        if(output) output.textContent = 'Executing synthetic activity...';
        const tracesBody = document.getElementById('synthetic-traces-body');
        if(tracesBody) tracesBody.innerHTML = '';
        // Accelerate monitoring poll during run
        let previousInterval = window.monitoringInterval;
        if (window.monitoringInterval) { clearInterval(window.monitoringInterval); window.monitoringInterval=null; }
        window.monitoringInterval = setInterval(()=>{
            if (document.getElementById('monitoring-section')?.classList.contains('hidden')) return;
            loadMonitoringData();
            updateActiveSyntheticRequests();
        }, 1000); // fast poll while running
        let statusTimer = setInterval(updateActiveSyntheticRequests, 1000);
        try {
            const url = '/api/admin/synthetic/activity?debug=1'+(wantTrace?'&trace=1&stream=1':'');
            const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ iterations: iter, concurrency: conc }) });
            const rawText = await res.text();
            let data = null; try { data = JSON.parse(rawText); } catch { /* ignore */ }
            if (!res.ok || !data) {
                throw new Error(data && (data.error || data.message) ? (data.error || data.message) : `HTTP ${res.status} (non-JSON)`);
            }
            if (!data.success) {
                throw new Error(data.error || data.message || 'Unknown failure');
            }
            const metaLine = `Executed ${data.executed}/${data.iterationsRequested} (errors:${data.errors}) in ${data.durationMs}ms @c=${data.concurrency} tools:${data.availableCount}`;
            if(output) output.textContent = metaLine + (data.available ? `\nSample: ${data.available.slice(0,5).join(', ')}` : '');
            const lastMeta = document.getElementById('synthetic-last-meta');
            if (lastMeta) lastMeta.textContent = `Last run: ${new Date().toLocaleTimeString()} ${metaLine}`;
            if (wantTrace && tracesBody) {
                if (Array.isArray(data.traces) && data.traces.length) {
                    const rows = data.traces.map((t,i)=>{
                        const clr = t.success ? '#0a0' : '#a00';
                        const err = t.error ? String(t.error).slice(0,80) : '';
                        const skipped = t.skipped ? ' (skipped)' : '';
                        return `<tr>
                            <td style="padding:2px 4px; border-bottom:1px solid #eee;">${i+1}</td>
                            <td style="padding:2px 4px; border-bottom:1px solid #eee; font-family:monospace;">${t.method}${skipped}</td>
                            <td style="padding:2px 4px; border-bottom:1px solid #eee; color:${clr};">${t.success?'✓':'✗'}</td>
                            <td style="padding:2px 4px; border-bottom:1px solid #eee;">${t.durationMs}ms</td>
                            <td style="padding:2px 4px; border-bottom:1px solid #eee; color:${t.error?'#b55':'#666'};">${err}</td>
                        </tr>`;
                    }).join('');
                    tracesBody.innerHTML = rows;
                } else {
                    const reason = data.traceReason || 'no traces captured';
                    tracesBody.innerHTML = `<tr><td colspan="5" style="padding:4px; font-style:italic;">${reason}</td></tr>`;
                }
                document.getElementById('synthetic-traces-wrapper').style.display = 'block';
            }
            // Refresh overview + monitoring for updated metrics
            loadOverviewData();
            loadMonitoringData();
        } catch (err) {
            const emsg = (err && err.message) || 'unknown error';
            if(output) output.textContent = `Synthetic activity failed: ${emsg}`;
            if (/No safe tools/i.test(emsg)) {
                if(output) output.textContent += '\nHint: Ensure server started after tool handlers registered (import order)';
            }
        } finally {
            if(btn) { btn.disabled = false; btn.textContent = 'Run Synthetic Activity'; }
            // Restore slower poll cadence
            if (window.monitoringInterval) { clearInterval(window.monitoringInterval); window.monitoringInterval=null; }
            if (statusTimer) { clearInterval(statusTimer); statusTimer=null; }
            if (!previousInterval) { // restart default if monitoring tab visible
                ensureMonitoringPoll();
            }
            // One last status refresh to clear active counter
            updateActiveSyntheticRequests();
        }
    }

    // Fetch active synthetic request count and inject into monitoring panel if present
    async function updateActiveSyntheticRequests(){
        try {
            const res = await fetch('/api/admin/synthetic/status');
            const data = await res.json();
            if (!data.success) return;
            const active = data.activeRequests || 0;
            // Find monitoring panel metric list and append/update a synthetic active row
            const container = document.getElementById('monitoring-data');
            if (container && container.innerHTML.includes('Throughput')) {
                const id = 'active-synth-requests-row';
                let el = document.getElementById(id);
                if (!el) {
                    const div = document.createElement('div');
                    div.className='stat-row';
                    div.id = id;
                    div.innerHTML = '<span class="stat-label">Active Synthetic Requests</span><span class="stat-value">0</span>';
                    container.insertBefore(div, container.firstChild.nextSibling); // after first row
                    el = div;
                }
                const valSpan = el.querySelector('.stat-value');
                if (valSpan) valSpan.textContent = String(active);
            }
        } catch { /* ignore */ }
    }

    // Monitoring data fetch
    async function loadMonitoringData() {
        try {
            const [perfRes, sysRes, alertsRes] = await Promise.all([
                fetch('/api/performance/detailed').catch(e=>e),
                fetch('/api/system/health').catch(e=>e),
                fetch('/api/alerts/active').catch(e=>e)
            ]);
            const [perfData, sysData, alertsData] = await Promise.all([
                perfRes?.json ? perfRes.json().catch(()=>({})) : {},
                sysRes?.json ? sysRes.json().catch(()=>({})) : {},
                alertsRes?.json ? alertsRes.json().catch(()=>({})) : {}
            ]);
            const perf = perfData.data || {};
            const sys = sysData.data || {};
            const alerts = (alertsData.data || []).slice(0,5);
                        const html = `
                            <div class="metrics-list">
                                <div class="metrics-row"><span class="label">Throughput (rpm)</span><span class="value">${perf.requestThroughput ?? '—'}</span></div>
                                <div class="metrics-row"><span class="label">Avg Response</span><span class="value">${perf.averageResponseTime?.toFixed ? perf.averageResponseTime.toFixed(1)+'ms':'—'}</span></div>
                                <div class="metrics-row"><span class="label">P95</span><span class="value">${perf.p95ResponseTime ?? '—'}ms</span></div>
                                <div class="metrics-row"><span class="label">Error Rate</span><span class="value">${perf.errorRate?.toFixed ? perf.errorRate.toFixed(2)+'%':'—'}</span></div>
                                <div class="metrics-row"><span class="label">Active Connections</span><span class="value">${perf.concurrentConnections ?? '—'}</span></div>
                                <div class="metrics-row"><span class="label">System Health</span><span class="value">${sys.status || '—'}</span></div>
                            </div>
                            <div style="margin-top:12px; font-size:12px;">
                                <div class="metrics-section-title">Active Alerts (${alerts.length})</div>
                                <ul style="margin:4px 0 0 18px;">${alerts.map(a=>`<li>${a.type} (${a.severity}) - ${a.message}</li>`).join('') || '<li style="opacity:.7;">No active alerts</li>'}</ul>
                            </div>`;
            const el = document.getElementById('monitoring-data');
            if (el) el.innerHTML = html;
            // Update nav badge if sessions already loaded
            if (typeof updateSessionsNavBadge === 'function') updateSessionsNavBadge();
        } catch (e) {
            const el = document.getElementById('monitoring-data');
            if (el) el.innerHTML = '<div class="error">Failed to load monitoring data</div>';
        }
    }

    // Periodic refresh when Monitoring tab visible
    window.monitoringInterval = window.monitoringInterval || null;
    function ensureMonitoringPoll(){
        if (document.getElementById('monitoring-section')?.classList.contains('hidden')) return;
        if (window.monitoringInterval) return; // already
        window.monitoringInterval = setInterval(()=>{
            if (document.getElementById('monitoring-section')?.classList.contains('hidden')) { clearInterval(window.monitoringInterval); window.monitoringInterval=null; return; }
            loadMonitoringData();
        }, 5000);
    }

    // Expose functions to global scope for compatibility with admin.html
    window.toggleSyntheticTraceVisibility = toggleSyntheticTraceVisibility;
    window.runSyntheticActivity = runSyntheticActivity;
    window.updateActiveSyntheticRequests = updateActiveSyntheticRequests;
    window.loadMonitoringData = loadMonitoringData;
    window.ensureMonitoringPoll = ensureMonitoringPoll;

    // Wire synthetic run button if present (some refactors removed inline onclick)
    document.addEventListener('DOMContentLoaded', function(){
        const btn = document.getElementById('synthetic-run-btn');
        if(btn && !btn.__wired){
            btn.addEventListener('click', function(ev){ ev.preventDefault(); runSyntheticActivity(); });
            Object.defineProperty(btn,'__wired',{value:true});
        }
    });
})();
