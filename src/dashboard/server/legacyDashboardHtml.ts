/* eslint-disable */
/**
 * legacyDashboardHtml - generates the v1 legacy dashboard HTML page.
 * Extracted from DashboardServer.ts to keep the coordinator within line limits.
 * CSS lives in legacyDashboardStyles.ts to stay within per-file line limits.
 */

import { MetricsSnapshot } from "./MetricsCollector.js";
import { LEGACY_DASHBOARD_CSS } from "./legacyDashboardStyles.js";

// ---------------------------------------------------------------------------
// stripGraphTab - removes graph-related markup when the graph feature is off
// ---------------------------------------------------------------------------
export function stripGraphTab(html: string): string {
  html = html.replace(/<button[^>]*data-section="graph"[^>]*>Graph<\/button>\s*/i, ""); // lgtm[js/incomplete-multi-character-sanitization] — stripping graph tab, not sanitization
  html = html.replace(/<!--\s*Graph Section\s*-->[\s\S]*?(?=<!--\s*Configuration Section\s*-->)/i, "");
  html = html.replace(/<script[^>]*src="js\/admin\.graph\.js[^"]*"[^>]*><\/script>\s*/i, "");
  return html;
}

// ---------------------------------------------------------------------------
// formatUptime - converts milliseconds to a human-readable duration string
// ---------------------------------------------------------------------------
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

// ---------------------------------------------------------------------------
// generateDashboardHtml - full legacy v1 dashboard page
// ---------------------------------------------------------------------------
export function generateDashboardHtml(
  nonce: string,
  snapshot: MetricsSnapshot,
  webSocketUrl: string | null,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Index Server - Enhanced Dashboard v2.0</title>
    <script nonce="${nonce}" src="/js/chart.umd.js"></script>
    <style nonce="${nonce}">
${LEGACY_DASHBOARD_CSS}
    </style>
</head>
</head>
<body>
    <div class="header">
        <h1>Index Server Dashboard</h1>
        <div class="subtitle">Enhanced Real-time Monitoring v2.0</div>
        <div class="version">Server v${snapshot.server.version} | Start Time ${new Date(snapshot.server.startTime).toLocaleString()}</div>
    </div>

    <div class="container">
        <!-- Dashboard Controls -->
        <div class="dashboard-controls">
            <div class="control-group">
                <label class="control-label">WebSocket Status</label>
                <div id="connection-status" class="connection-status ${webSocketUrl ? 'connected' : 'disconnected'}">
                    ${webSocketUrl ? 'Connected' : 'Disabled'}
                </div>
            </div>
            <div class="control-group">
                <label class="control-label">Actions</label>
                <button id="refresh-btn" class="control-button">Refresh Metrics</button>
            </div>
            ${!webSocketUrl ? `<div class="control-group">
                <label class="control-label">Manual Refresh</label>
                <button id="reconnect-btn" class="control-button">Enable Real-time</button>
            </div>` : ''}
        </div>

        <!-- Status Cards -->
        <div class="status-grid">
            <div class="status-card">
                <div class="status-label">Server Uptime</div>
                <div id="uptime-value" class="status-value status-online">${formatUptime(snapshot.server.uptime)}</div>
            </div>
            <div class="status-card">
                <div class="status-label">Total Tool Calls</div>
                <div id="total-requests-value" class="status-value">${Object.values(snapshot.tools).reduce((sum, tool) => sum + tool.callCount, 0).toLocaleString()}</div>
            </div>
            <div class="status-card">
                <div class="status-label">Success Rate</div>
                <div id="success-rate-value" class="status-value status-online">${(snapshot.performance.successRate * 100).toFixed(1)}%</div>
            </div>
            <div class="status-card">
                <div class="status-label">Avg Response Time</div>
                <div id="avg-response-time-value" class="status-value">${snapshot.performance.avgResponseTime.toFixed(0)}ms</div>
            </div>
            <div class="status-card">
                <div class="status-label">Active Connections</div>
                <div id="connections-value" class="status-value">${snapshot.connections.totalConnections}</div>
            </div>
        </div>

        <!-- Performance Metrics -->
        <div class="performance-metrics">
            <div class="metric-item">
                <div class="metric-label">Requests/Min</div>
                <div id="requests-per-minute" class="metric-value">${snapshot.performance.requestsPerMinute.toFixed(1)}</div>
            </div>
            <div class="metric-item ${snapshot.performance.errorRate > 0.05 ? 'metric-danger' : snapshot.performance.errorRate > 0.01 ? 'metric-warning' : 'metric-success'}">
                <div class="metric-label">Error Rate</div>
                <div id="error-rate-percent" class="metric-value">${(snapshot.performance.errorRate * 100).toFixed(2)}%</div>
            </div>
        </div>

        <!-- Phase 3 Enhanced Charts with Time Range Selection -->
        <div class="charts-controls">
            <div class="time-range-selector">
                <label for="time-range">Time Range:</label>
                <select id="time-range" class="time-range-select">
                    <option value="60">Last Hour</option>
                    <option value="360">Last 6 Hours</option>
                    <option value="1440" selected>Last 24 Hours</option>
                    <option value="10080">Last 7 Days</option>
                    <option value="43200">Last 30 Days</option>
                </select>
            </div>
            <div class="chart-actions">
                <button id="refresh-charts" class="action-btn">🔄 Refresh</button>
                <button id="export-charts" class="action-btn">📊 Export</button>
                <button id="fullscreen-toggle" class="action-btn">⛶ Fullscreen</button>
            </div>
        </div>

        <div class="charts-grid">
            <div class="chart-container">
                <div class="chart-title">
                    Requests per Minute
                    <span class="chart-status" id="requests-status">●</span>
                </div>
                <div class="chart-wrapper">
                    <canvas id="requestsChart"></canvas>
                </div>
            </div>
            <div class="chart-container">
                <div class="chart-title">
                    Tool Usage Distribution
                    <span class="chart-status" id="usage-status">●</span>
                </div>
                <div class="chart-wrapper">
                    <canvas id="toolUsageChart"></canvas>
                </div>
            </div>
            <div class="chart-container">
                <div class="chart-title">
                    Response Time Trends
                    <span class="chart-status" id="response-status">●</span>
                </div>
                <div class="chart-wrapper">
                    <canvas id="responseTimeChart"></canvas>
                </div>
            </div>
            <div class="chart-container">
                <div class="chart-title">
                    Error Rate Over Time
                    <span class="chart-status" id="error-status">●</span>
                </div>
                <div class="chart-wrapper">
                    <canvas id="errorRateChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Enhanced Tools Section -->
        <div class="tools-section">
            <div class="tools-header">
                <h2 class="tools-title">Tool Registry</h2>
                <input type="text" id="tools-filter" class="tools-filter" placeholder="Filter tools...">
            </div>
            <table class="tools-table">
                <thead>
                    <tr>
                        <th>Tool Name</th>
                        <th>Calls</th>
                        <th>Success</th>
                        <th>Errors</th>
                        <th>Avg Response</th>
                        <th>Last Called</th>
                    </tr>
                </thead>
                <tbody id="tools-table-body">
                    ${Object.entries(snapshot.tools).map(([toolName, metrics]) => `
                        <tr>
                            <td class="tool-name">${toolName}</td>
                            <td class="tool-calls">${metrics.callCount}</td>
                            <td class="tool-success">${metrics.successCount}</td>
                            <td class="tool-errors">${metrics.errorCount}</td>
                            <td class="tool-response-time">${(metrics.totalResponseTime / Math.max(metrics.callCount, 1)).toFixed(0)}ms</td>
                            <td class="tool-last-called">${metrics.lastCalled ? new Date(metrics.lastCalled).toLocaleTimeString() : 'Never'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <script nonce="${nonce}">
        // Set global WebSocket URL for client
        window.DASHBOARD_WS_URL = ${webSocketUrl ? `'${webSocketUrl}'` : 'null'};

        console.log('[Dashboard] Enhanced dashboard v2.0 loaded');

        // Basic functionality for non-WebSocket environments
        if (!window.DASHBOARD_WS_URL) {
            document.getElementById('refresh-btn')?.addEventListener('click', () => {
                window.location.reload();
            });

            document.getElementById('reconnect-btn')?.addEventListener('click', () => {
                alert('WebSocket support is disabled. Enable it in server configuration.');
            });
        }

        // Tools filter functionality
        const filterInput = document.getElementById('tools-filter');
        if (filterInput) {
            filterInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const tbody = document.getElementById('tools-table-body');
                if (tbody) {
                    const rows = tbody.getElementsByTagName('tr');
                    Array.from(rows).forEach(row => {
                        const toolName = row.querySelector('.tool-name')?.textContent?.toLowerCase() || '';
                        row.style.display = toolName.includes(searchTerm) ? '' : 'none';
                    });
                }
            });
        }

        // Initialize interactions
        document.querySelectorAll('.status-card, .chart-container').forEach(card => {
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-2px)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = 'translateY(0)';
            });
        });

        // Phase 3 Enhanced Dashboard with Interactive Features
        if (window.Chart && window.DASHBOARD_WS_URL) {
            console.log('[Dashboard] Phase 3 initialization - Chart.js available');

            // Phase 3 state management
                        let currentTimeRange = 1440; // 24 hours default
                        const charts = {}; // will hold Chart.js instances keyed by id
            let isFullscreen = false;
                        const chartConfig = {
                            responsive: true,
                            maintainAspectRatio: false,
                            animation: false,
                            interaction: { mode: 'nearest', intersect: false },
                            plugins: { legend: { position: 'bottom' } },
                            scales: { x: { ticks: { maxRotation: 0, autoSkip: true } }, y: { beginAtZero: true } }
                        };
                        const metricIdAliases = {
                            'success-rate-percent': ['success-rate-value'],
                            'avg-response-time': ['avg-response-time-value']
                        };
                        ensureStatusBar();

        } else {
            console.log('[Dashboard] Phase 3 disabled - WebSocket not available');
        }

        // Phase 3 Feature Initialization
        function initializePhase3Features() {
            console.log('[Dashboard] Initializing Phase 3 interactive features');

            // Time range selector
            const timeRangeSelect = document.getElementById('time-range');
            if (timeRangeSelect) {
                timeRangeSelect.addEventListener('change', function() {
                    currentTimeRange = parseInt(this.value);
                    updateChartsWithTimeRange(currentTimeRange);
                    updateChartStatus('updating');
                });
            }

            // Refresh button
            const refreshBtn = document.getElementById('refresh-charts');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', function() {
                    refreshAllCharts();
                    updateChartStatus('refreshing');
                });
            }

            // Export button
            const exportBtn = document.getElementById('export-charts');
            if (exportBtn) {
                exportBtn.addEventListener('click', function() {
                    exportChartData();
                });
            }

            // Fullscreen toggle
            const fullscreenBtn = document.getElementById('fullscreen-toggle');
            if (fullscreenBtn) {
                fullscreenBtn.addEventListener('click', function() {
                    toggleFullscreen();
                });
            }

            // Initialize real-time updates
            startRealtimeUpdates();
        }

        // Update charts with new time range
        function updateChartsWithTimeRange(minutes) {
            console.log('[Dashboard] Updating charts for ' + minutes + ' minutes');

            // Update tool usage chart
            fetch('/api/charts/tool-usage?minutes=' + minutes)
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        updateToolUsageChart(data.data);
                    }
                })
                .catch(error => console.error('Failed to update tool usage:', error));

            // Update performance chart
            fetch('/api/charts/performance?minutes=' + minutes)
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        updatePerformanceCharts(data.data);
                    }
                })
                .catch(error => console.error('Failed to update performance:', error));
        }

        // Refresh all charts
        function refreshAllCharts() {
            console.log('[Dashboard] Refreshing all charts');
            updateChartsWithTimeRange(currentTimeRange);

            // Refresh realtime metrics
            fetch('/api/realtime')
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        updateRealtimeWidgets(data.data);
                    }
                })
                .catch(error => console.error('Failed to refresh realtime:', error));
        }

        // Export chart data
        function exportChartData() {
            console.log('[Dashboard] Exporting chart data');
            const range = getTimeRangeString(currentTimeRange);
            const exportUrl = '/api/charts/export?format=csv&range=' + range;

            // Create download link
            const link = document.createElement('a');
            link.href = exportUrl;
            link.download = 'dashboard-metrics-' + range + '-' + Date.now() + '.csv';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // Toggle fullscreen mode
        function toggleFullscreen() {
            const chartsGrid = document.querySelector('.charts-grid');
            if (!chartsGrid) return;

            if (!isFullscreen) {
                chartsGrid.style.position = 'fixed';
                chartsGrid.style.top = '0';
                chartsGrid.style.left = '0';
                chartsGrid.style.width = '100vw';
                chartsGrid.style.height = '100vh';
                chartsGrid.style.zIndex = '9999';
                chartsGrid.style.background = 'var(--bg-color)';
                chartsGrid.style.padding = '2rem';
                chartsGrid.style.overflow = 'auto';
                isFullscreen = true;
                document.getElementById('fullscreen-toggle').textContent = '⛶ Exit Fullscreen';
            } else {
                chartsGrid.style.position = '';
                chartsGrid.style.top = '';
                chartsGrid.style.left = '';
                chartsGrid.style.width = '';
                chartsGrid.style.height = '';
                chartsGrid.style.zIndex = '';
                chartsGrid.style.background = '';
                chartsGrid.style.padding = '';
                chartsGrid.style.overflow = '';
                isFullscreen = false;
                document.getElementById('fullscreen-toggle').textContent = '⛶ Fullscreen';
            }
        }

        // Update chart status indicators
        function updateChartStatus(status) {
            const statusElements = document.querySelectorAll('.chart-status');
            statusElements.forEach(el => {
                el.style.color = status === 'updating' ? '#ffc107' :
                                 status === 'refreshing' ? '#17a2b8' : '#28a745';
            });

            if (status !== 'normal') {
                setTimeout(() => updateChartStatus('normal'), 2000);
            }
        }

        // Start real-time updates
        function startRealtimeUpdates() {
            setInterval(() => {
                fetch('/api/realtime')
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            updateRealtimeWidgets(data.data);
                        }
                    })
                    .catch(error => console.error('Realtime update failed:', error));
            }, 30000); // Update every 30 seconds
        }

        // Helper functions
        function getTimeRangeString(minutes) {
            if (minutes === 60) return '1h';
            if (minutes === 360) return '6h';
            if (minutes === 1440) return '24h';
            if (minutes === 10080) return '7d';
            if (minutes === 43200) return '30d';
            return '1h';
        }

        function updateToolUsageChart(data) {
                        if (!data) return;
                        try {
                            const canvas = document.getElementById('toolUsageChart');
                            if (!canvas) return;
                            const labels = data.timestamps?.map(ts => new Date(ts).toLocaleTimeString()) || [];
                            const series = (data.series || data.datasets || []);
                            if (!charts.toolUsageChart) {
                                charts.toolUsageChart = new Chart(canvas.getContext('2d'), {
                                    type: 'line',
                                    data: {
                                        labels,
                                        datasets: series.map(s => ({
                                            label: s.label || s.name || 'Series',
                                            data: s.data || [],
                                            fill: false,
                                            tension: 0.25,
                                            borderWidth: 2
                                        }))
                                    },
                                    options: chartConfig
                                });
                            } else {
                                charts.toolUsageChart.data.labels = labels;
                                charts.toolUsageChart.data.datasets.forEach((ds, i) => {
                                    ds.data = series[i] ? series[i].data : [];
                                });
                                charts.toolUsageChart.update();
                            }
                        } catch (e) { console.error('toolUsageChart update failed', e); showErrorBanner('Tool usage chart error'); }
        }

        function updatePerformanceCharts(data) {
                        if (!data) return;
                        try {
                            const labels = data.timestamps?.map(ts => new Date(ts).toLocaleTimeString()) || [];
                            const perfSeries = data.series || data.datasets || [];
                            const chartMap = [
                                { id: 'requestsChart', key: 'requestsPerMinute' },
                                { id: 'responseTimeChart', key: 'avgResponseTime' },
                                { id: 'errorRateChart', key: 'errorRate' }
                            ];
                            chartMap.forEach(cfg => {
                                const canvas = document.getElementById(cfg.id);
                                if (!canvas) return;
                                // Build/find series with matching key
                                const s = perfSeries.find(s => s.key === cfg.key || s.label === cfg.key);
                                const datasetData = s?.data || [];
                                if (!charts[cfg.id]) {
                                    charts[cfg.id] = new Chart(canvas.getContext('2d'), {
                                        type: 'line',
                                        data: { labels, datasets: [{ label: cfg.key, data: datasetData, borderWidth: 2, tension: 0.25, fill: false }] },
                                        options: chartConfig
                                    });
                                } else {
                                    charts[cfg.id].data.labels = labels;
                                    charts[cfg.id].data.datasets[0].data = datasetData;
                                    charts[cfg.id].update();
                                }
                            });
                        } catch (e) { console.error('performance charts update failed', e); showErrorBanner('Performance chart error'); }
        }

        function updateRealtimeWidgets(data) {
            // Update real-time metric widgets
            console.log('[Dashboard] Updating realtime widgets', data);

            // Update metric cards if they exist
            const elements = {
                'requests-per-minute': data.currentRpm,
                'active-connections': data.activeConnections,
                'avg-response-time': data.avgResponseTime + 'ms',
                'success-rate-percent': (data.successRate * 100).toFixed(2) + '%',
                'error-rate-percent': (data.errorRate * 100).toFixed(2) + '%'
            };

            for (const id in elements) {
                                let element = document.getElementById(id);
                                if (!element && metricIdAliases[id]) {
                                    for (const alias of metricIdAliases[id]) {
                                        element = document.getElementById(alias);
                                        if (element) break;
                                    }
                                }
                                if (element) element.textContent = elements[id];
            }
        }

                // Error banner utilities
                function ensureStatusBar() {
                    if (!document.getElementById('dashboard-status-bar')) {
                        const bar = document.createElement('div');
                        bar.id = 'dashboard-status-bar';
                        bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;font:12px sans-serif;padding:4px 8px;display:flex;gap:12px;align-items:center;background:#222;color:#eee;z-index:99999;';
                        bar.innerHTML = '<span id="ws-status">WS: pending</span><span id="error-banner" style="display:none;background:#b00020;padding:2px 6px;border-radius:4px;">Error</span>';
                        document.body.appendChild(bar);
                    }
                }
                function setWsStatus(text, color) {
                    const el = document.getElementById('ws-status');
                    if (el) { el.textContent = 'WS: ' + text; el.style.color = color; }
                }
                function showErrorBanner(msg) {
                    const el = document.getElementById('error-banner');
                    if (el) { el.textContent = msg; el.style.display = 'inline-block'; setTimeout(()=>{ el.style.display='none';}, 5000); }
                }
                // Live metric buffers for incremental chart updates (last 120 points)
                const liveBuffers = { labels: [], rpm: [], avg: [], err: [] };
                const MAX_POINTS = 120;

                function handleMetricsUpdate(snapshot) {
                    if(!snapshot || !snapshot.performance) return;
                    const tsLabel = new Date(snapshot.timestamp || Date.now()).toLocaleTimeString();
                    liveBuffers.labels.push(tsLabel);
                    liveBuffers.rpm.push(snapshot.performance.requestsPerMinute || 0);
                    liveBuffers.avg.push(snapshot.performance.avgResponseTime || 0);
                    liveBuffers.err.push(snapshot.performance.errorRate || 0);
                    if(liveBuffers.labels.length > MAX_POINTS) {
                        ['labels','rpm','avg','err'].forEach(k=>liveBuffers[k].splice(0, liveBuffers[k].length - MAX_POINTS));
                    }
                    // Update existing charts if they exist
                    try {
                        if (typeof charts !== 'undefined') {
                            if (charts.requestsChart) {
                                charts.requestsChart.data.labels = liveBuffers.labels.slice();
                                charts.requestsChart.data.datasets[0].data = liveBuffers.rpm.slice();
                                charts.requestsChart.update();
                            }
                            if (charts.responseTimeChart) {
                                charts.responseTimeChart.data.labels = liveBuffers.labels.slice();
                                charts.responseTimeChart.data.datasets[0].data = liveBuffers.avg.slice();
                                charts.responseTimeChart.update();
                            }
                            if (charts.errorRateChart) {
                                charts.errorRateChart.data.labels = liveBuffers.labels.slice();
                                charts.errorRateChart.data.datasets[0].data = liveBuffers.err.slice();
                                charts.errorRateChart.update();
                            }
                        }
                    } catch(e){ console.warn('live chart update failed', e); }

                    // Derive realtime widget shape (normalize successRate to 0-1)
                    try {
                        const perf = snapshot.performance;
                        const derived = {
                            currentRpm: perf.requestsPerMinute || 0,
                            activeConnections: snapshot.connections?.activeConnections || 0,
                            avgResponseTime: perf.avgResponseTime || 0,
                            successRate: (perf.successRate > 1 ? perf.successRate/100 : perf.successRate),
                            errorRate: (perf.errorRate > 1 ? perf.errorRate/100 : perf.errorRate)
                        };
                        updateRealtimeWidgets(derived);
                    } catch(e){ console.warn('realtime widget update from metrics_update failed', e); }
                }

                // Establish WebSocket connection for status + metrics streaming
                (function initStatusWebSocket(){
                    if(!("WebSocket" in window) || !window.DASHBOARD_WS_URL) { setWsStatus('unavailable','gray'); return; }
                    try {
                        const ws = new WebSocket(window.DASHBOARD_WS_URL);
                        let opened = false;
                        ws.addEventListener('open', ()=>{ opened = true; setWsStatus('connected','#16a34a'); });
                        ws.addEventListener('message', (ev)=>{
                            if(opened) setWsStatus('active','#16a34a');
                            try {
                                const msg = JSON.parse(ev.data);
                                if(msg && msg.type === 'metrics_update') { handleMetricsUpdate(msg.data); }
                            } catch { /* non-JSON or ignored */ }
                        });
                        ws.addEventListener('close', ()=>{ setWsStatus('closed','#dc2626'); setTimeout(()=>{ initStatusWebSocket(); }, 2000); });
                        ws.addEventListener('error', ()=>{ setWsStatus('error','#f97316'); try { ws.close(); } catch {/* ignore */} });
                    } catch(e){ console.error('ws status init failed', e); setWsStatus('error','#f97316'); }
                })();
    </script>
</body>
</html>`;
}
