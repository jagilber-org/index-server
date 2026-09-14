/* eslint-disable */
// Extracted from admin.html: Resource Trend (CPU/Mem) helpers
(function(){
    (function initResourceTrendMerge(){
        // Time window selector state — default 30 days
        var TIME_WINDOWS = [
            { label: '1d',  days: 1 },
            { label: '7d',  days: 7 },
            { label: '30d', days: 30 },
            { label: '90d', days: 90 },
            { label: 'All', days: 0 }
        ];
        var selectedDays = 30;

        window.__catalogTimeWindow = {
            get days() { return selectedDays; },
            set days(v) { selectedDays = v; fetchResourceTrends(); }
        };

        async function fetchResourceTrends(){
            try {
                var url = '/api/system/resources?limit=2000';
                if(selectedDays > 0){
                    var since = Date.now() - selectedDays * 86400000;
                    url += '&since=' + since;
                }
                const res = await adminAuth.adminFetch(url);
                if(!res.ok) throw new Error('http '+res.status);
                const json = await res.json();
                const samples = json?.data?.samples || [];
                const trend = json?.data?.trend || { cpuSlope:0, memSlope:0 };
                updateCatalogChart(json?.catalogHistory);
                if(samples.length === 0){
                    window.__resourceTrendCache = { windowSec:0, sampleCount:0, latestCpu:0, latestHeap:0, cpuSlope:0, memSlope:0, samples:[] };
                    return;
                }
                const latest = samples[samples.length-1];
                const first = samples[0];
                const durationSec = ((latest.timestamp - first.timestamp)/1000).toFixed(0);
                const tail = samples.slice(-40);
                const minCpu = tail.reduce((m,s)=> s.cpuPercent<m? s.cpuPercent:m, tail[0].cpuPercent);
                const maxCpu = tail.reduce((m,s)=> s.cpuPercent>m? s.cpuPercent:m, tail[0].cpuPercent);
                const maxHeap = tail.reduce((m,s)=> s.heapUsed>m?s.heapUsed:m,0) || 1;
                const minHeap = tail.reduce((m,s)=> s.heapUsed<m?s.heapUsed:m, tail[0].heapUsed);
                window.__resourceTrendCache = {
                    windowSec: durationSec,
                    sampleCount: samples.length,
                    latestCpu: latest.cpuPercent,
                    latestHeap: latest.heapUsed,
                    minCpu,
                    maxCpu,
                    minHeap,
                    maxHeap,
                    cpuSlope: trend.cpuSlope || 0,
                    memSlope: trend.memSlope || 0,
                    samples: tail
                };
                try {
                    if(typeof window.lastSystemStats === 'object') displaySystemStats(window.lastSystemStats);
                    if(typeof window.lastSystemHealth === 'object') displaySystemHealth(window.lastSystemHealth);
                } catch(e){/*ignore*/}
            } catch(e){
                // ignore failures
            }
        }
        function updateCatalogChart(catalogHistory){
            const host = document.getElementById('catalog-history');
            const canvas = document.getElementById('catalog-history-chart');
            if(!host || !canvas) return;
            if(!Array.isArray(catalogHistory)){ host.hidden = true; return; }
            host.hidden = false;
            if(typeof window.renderCatalogChart === 'function'){
                window.renderCatalogChart(canvas, catalogHistory);
            }
        }

        // Expose time window options for the chart module to build the selector
        window.__catalogTimeWindows = TIME_WINDOWS;

        fetchResourceTrends();
        setInterval(fetchResourceTrends, 10000);
    })();
})();
