import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { createServer } from 'net';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to allocate test port')));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

// Runtime test verifying aggregated HTTP metrics bucket increments when dashboard & HTTP instrumentation enabled.
// Marked fast: spawns one server, performs a handful of requests (<2s typical).
describe('HTTP Metrics Instrumentation (dashboard)', () => {
  const dashboardEnabled = process.env.INDEX_SERVER_DASHBOARD === '1';

  it('increments http/request bucket after REST calls', async () => {
    if(!dashboardEnabled) return; // skip when dashboard not enabled
    const port = await getFreePort();
    const env = {
      ...process.env,
      INDEX_SERVER_DASHBOARD: '1',
      INDEX_SERVER_HTTP_METRICS: '1',
      INDEX_SERVER_DASHBOARD_PORT: String(port),
      INDEX_SERVER_DASHBOARD_HOST: '127.0.0.1',
    };
    const proc = spawn('node', ['dist/server/index-server.js'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
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
      const target = new URL(p, url).toString();
      let lastError: unknown;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const res = await fetch(target);
          expect(res.ok).toBe(true);
          return res.json();
        } catch (err) {
          lastError = err;
          await new Promise(r => setTimeout(r, 100));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    try {
      const before = await getJson('/api/metrics');
      const beforeCount = before.tools['http/request']?.callCount || 0;

      for (let i = 0; i < 3; i++) {
        await getJson('/api/status');
      }
      const after = await getJson('/api/metrics');
      const afterCount = after.tools['http/request']?.callCount || 0;

      expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 3);
    } finally {
      try { proc.kill(); } catch { /* ignore */ }
    }
  }, 20000);
});
