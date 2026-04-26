import { ChildProcess, spawn } from 'child_process';

export interface DashboardProcess {
  proc: ChildProcess;
  url: string;
  kill: () => void;
}

/**
 * Spawn the index server with dashboard enabled and resolve once the dashboard
 * has started and emitted its startup line. Retries until timeoutMs.
 */
export async function startDashboardServer(extraEnv: NodeJS.ProcessEnv = {}, timeoutMs = 15000): Promise<DashboardProcess> {
  const env = {
    ...process.env,
    INDEX_SERVER_DASHBOARD: '1',
    INDEX_SERVER_DISABLE_STDERR_BRIDGE: '1',
    ...extraEnv,
  };
  const proc = spawn('node', ['dist/server/index-server.js', '--dashboard-port=0', '--dashboard-host=127.0.0.1'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let url: string | undefined;
  const pat = /(?:Server started on|\[startup\] Dashboard URL:)\s+(https?:\/\/[^\s"]+)/;
  const capture = (data: string) => {
    const m = pat.exec(data);
    if (m) url = m[1];
  };
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', capture);
  proc.stderr.on('data', capture);

  const start = Date.now();
  while (!url && Date.now() - start < timeoutMs) {
    // If process exited early, break with failure
    if (proc.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 40));
  }
  if (!url) {
    try { proc.kill(); } catch { /* ignore */ }
    throw new Error('dashboard start timeout');
  }
  const readyStart = Date.now();
  while (Date.now() - readyStart < timeoutMs) {
    try {
      const resp = await fetch(url + 'api/status');
      if (resp.ok) {
        const normalizedUrl = url.replace(/\/+$/, '');
        return { proc, url: normalizedUrl, kill: () => { try { proc.kill(); } catch { /* ignore */ } } };
      }
    } catch {
      // keep polling until timeout
    }
    if (proc.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 40));
  }
  try { proc.kill(); } catch { /* ignore */ }
  throw new Error('dashboard readiness timeout');
}
