/* eslint-disable */
// Extracted from admin.html: Resource Trend (CPU/Mem) helpers
(function(){
    (function initResourceTrendMerge(){
        async function fetchResourceTrends(){
            try {
                const res = await fetch('/api/system/resources?limit=300');
                if(!res.ok) throw new Error('http '+res.status);
                const json = await res.json();
                const samples = json?.data?.samples || [];
                const trend = json?.data?.trend || { cpuSlope:0, memSlope:0 };
                if(samples.length === 0){
                    window.__resourceTrendCache = { windowSec:0, sampleCount:0, latestCpu:0, latestHeap:0, cpuSlope:0, memSlope:0, spark:'' };
                    return;
                }
                const latest = samples[samples.length-1];
                const first = samples[0];
                const durationSec = ((latest.timestamp - first.timestamp)/1000).toFixed(0);
                const tail = samples.slice(-40);
                const spark = tail.map(s=>{
                    const v = Math.min(100, Math.max(0, s.cpuPercent));
                    const idx = Math.round(v/12.5);
                    const blocks = ['▁','▂','▃','▄','▅','▆','▇','█'];
                    return blocks[Math.min(blocks.length-1, idx)];
                }).join('');
                const minCpu = tail.reduce((m,s)=> s.cpuPercent<m? s.cpuPercent:m, tail[0].cpuPercent);
                const maxCpu = tail.reduce((m,s)=> s.cpuPercent>m? s.cpuPercent:m, tail[0].cpuPercent);
                const maxHeap = tail.reduce((m,s)=> s.heapUsed>m?s.heapUsed:m,0) || 1;
                const minHeap = tail.reduce((m,s)=> s.heapUsed<m?s.heapUsed:m, tail[0].heapUsed);
                const memSpark = tail.map(s=>{
                    const ratio = Math.min(1, Math.max(0, s.heapUsed / maxHeap));
                    const idx = Math.round(ratio*7);
                    const blocks = ['▁','▂','▃','▄','▅','▆','▇','█'];
                    return blocks[Math.min(blocks.length-1, idx)];
                }).join('');
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
                    spark,
                    memSpark
                };
                try {
                    if(typeof window.lastSystemStats === 'object') displaySystemStats(window.lastSystemStats);
                    if(typeof window.lastSystemHealth === 'object') displaySystemHealth(window.lastSystemHealth);
                } catch(e){/*ignore*/}
            } catch(e){
                // ignore failures
            }
        }
        fetchResourceTrends();
        setInterval(fetchResourceTrends, 10000);
    })();
})();
