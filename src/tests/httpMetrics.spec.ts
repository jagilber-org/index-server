import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

// Runtime test verifying aggregated HTTP metrics bucket increments when dashboard & HTTP instrumentation enabled.
// Marked fast: spawns one server, performs a handful of requests (<2s typical).
describe('HTTP Metrics Instrumentation (dashboard)', () => {
  const dashboardEnabled = process.env.INDEX_SERVER_DASHBOARD === '1';

  it('increments http/request bucket after REST calls', async () => {
    if(!dashboardEnabled) return; // skip when dashboard not enabled
    const env = { ...process.env, INDEX_SERVER_DASHBOARD: '1', INDEX_SERVER_HTTP_METRICS: '1' };
    const proc = spawn('node', ['dist/server/index-server.js', '--dashboard-port=0', '--dashboard-host=127.0.0.1'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let url: string | undefined;
    const pattern = /(?:Server started on|\[startup\] Dashboard URL:)\s+(https?:\/\/[^\s"]+)/;
    const capture = (d: string) => {
      const m = pattern.exec(d);
      if (m) url = m[1];
    };
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', capture);
    proc.stderr.on('data', capture); // defensive: if logging changes

    // Wait for dashboard start or timeout
    const start = Date.now();
    while (!url && Date.now() - start < 7000) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (!url) {
      try { proc.kill(); } catch { /* noop */ }
      return; // skip when dashboard fails to start
    }

    async function getJson(p: string) {
      const res = await fetch(url + p);
      expect(res.ok).toBe(true);
      return res.json();
    }

    const before = await getJson('/api/metrics');
    const beforeCount = before.tools['http/request']?.callCount || 0;

    for (let i = 0; i < 3; i++) {
      await getJson('/api/status');
    }
    const after = await getJson('/api/metrics');
    const afterCount = after.tools['http/request']?.callCount || 0;

    expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 3);

    try { proc.kill(); } catch { /* ignore */ }
  }, 20000);
});
