/* eslint-disable */
// Extracted from admin.html: Log Viewer helpers
(function(){
    let logEventSource = null;
    let logTailing = false;

    async function loadLogs() {
        try {
            const lines = document.getElementById('log-lines').value || 100;
            let logsArray = [];
            let rawMode = false;
            let response = await fetch(`/api/logs?lines=${lines}`);
            if (response.ok) {
                const ct = response.headers.get('content-type') || '';
                if (ct.includes('application/json')) {
                    try {
                        const data = await response.json();
                        if (Array.isArray(data.logs)) {
                            logsArray = data.logs;
                        } else if (typeof data === 'object') {
                            logsArray = Object.values(data).filter(v=>typeof v === 'string');
                        }
                    } catch {
                        rawMode = true;
                    }
                } else {
                    rawMode = true;
                }
            }
            if (rawMode) {
                response = await fetch(`/api/logs?lines=${lines}&raw=1`);
                const txt = await response.text();
                logsArray = txt.split(/\r?\n/);
            }
            const rendered = logsArray.join('\n');
            const el = document.getElementById('log-content');
            if (el) el.innerHTML = `<pre>${escapeHtml(rendered)}</pre>`;

            if (logTailing) {
                const logContent = document.getElementById('log-content');
                if (logContent) logContent.scrollTop = logContent.scrollHeight;
            }
        } catch (error) {
            console.error('Failed to load logs:', error);
            const el = document.getElementById('log-content');
            if (el) el.innerHTML = '<div class="error">Failed to load logs</div>';
        }
    }

    function toggleLogTail() {
        const button = document.getElementById('log-tail-btn');
        if (logTailing) {
            if (logEventSource) {
                logEventSource.close();
                logEventSource = null;
            }
            logTailing = false;
            if (button) { button.textContent = '▶️ Start Tail'; button.className = 'action-btn'; }
        } else {
            logTailing = true;
            if (button) { button.textContent = '⏹ Stop Tail'; button.className = 'action-btn warning'; }
            logEventSource = new EventSource('/api/logs/stream');
            logEventSource.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.line) {
                        const logContent = document.getElementById('log-content');
                        const pre = logContent.querySelector('pre') || document.createElement('pre');
                        if (!logContent.querySelector('pre')) {
                            logContent.innerHTML = '';
                            logContent.appendChild(pre);
                        }
                        pre.textContent += data.line + '\n';
                        logContent.scrollTop = logContent.scrollHeight;
                        const lines = pre.textContent.split('\n');
                        const maxLines = 2000;
                        if (lines.length > maxLines) {
                            pre.textContent = lines.slice(-maxLines).join('\n');
                        }
                    }
                } catch (error) {
                    console.error('Error processing log stream:', error);
                }
            };
            logEventSource.onerror = function(error) {
                console.error('Log stream error:', error);
                setTimeout(() => {
                    if (logTailing) {
                        toggleLogTail();
                        setTimeout(() => toggleLogTail(), 1000);
                    }
                }, 2000);
            };
        }
    }

    function clearLogViewer() {
        const el = document.getElementById('log-content');
        if (el) el.innerHTML = '<div class="info">Log viewer cleared</div>';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Expose functions for staged migration
    window.loadLogs = loadLogs;
    window.toggleLogTail = toggleLogTail;
    window.clearLogViewer = clearLogViewer;
    window.escapeHtml = escapeHtml;
})();
