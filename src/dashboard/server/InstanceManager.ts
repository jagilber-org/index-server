/**
 * InstanceManager - Discovers running Index Server dashboard instances.
 *
 * Each dashboard writes a small JSON port file on startup and removes it on
 * shutdown. Other instances (and the `/api/instances` endpoint) read these
 * files to present a list of all active servers the user can switch between.
 *
 * Port file location: `<stateDir>/dashboard-<pid>.json`
 * Default stateDir:   `<cwd>/data/state`  (override via INDEX_SERVER_STATE_DIR)
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { getRuntimeConfig } from '../../config/runtimeConfig';

export interface PortFileEntry {
  pid: number;
  port: number;
  host: string;
  startedAt: string;
  protocol?: 'http' | 'https';
}

export interface InstanceInfo extends PortFileEntry {
  current: boolean;
  alive: boolean;
}

const PORT_FILE_PREFIX = 'dashboard-';
const PORT_FILE_SUFFIX = '.json';

let _stateDir: string | undefined;

/** Track the port/host/protocol this process registered so self-healing can recreate the file. */
let _registeredPort = 0;
let _registeredHost = '';


/** Resolve the state directory (cached after first call). */
function getStateDir(): string {
  if (!_stateDir) {
    _stateDir = getRuntimeConfig().dashboard.admin.stateDir;
  }
  return _stateDir;
}

/** Build the port file path for a given PID. */
function portFilePath(pid: number): string {
  return path.join(getStateDir(), `${PORT_FILE_PREFIX}${pid}${PORT_FILE_SUFFIX}`);
}

/** Ensure the state directory exists. */
function ensureStateDir(): void {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write a port file for the current process.
 * Called once when the dashboard HTTP server starts listening.
 */
export function writePortFile(port: number, host: string): void {
  ensureStateDir();
  const tlsEnabled = getRuntimeConfig().dashboard.http.tls.enabled;
  const entry: PortFileEntry = {
    pid: process.pid,
    port,
    host,
    startedAt: new Date().toISOString(),
    protocol: tlsEnabled ? 'https' : 'http',
  };
  const filePath = portFilePath(process.pid);
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
  _registeredPort = port;
  _registeredHost = host;
}

/**
 * Remove the port file for the current process.
 * Called during graceful shutdown.
 */
export function removePortFile(): void {
  try {
    const filePath = portFilePath(process.pid);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Best-effort removal; ignore errors during shutdown.
  }
}

/**
 * Check whether a process with the given PID is still alive.
 * Uses signal-0 which doesn't actually send a signal but checks existence.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove stale port files for processes that no longer exist.
 * Called on startup to clean up after crashes.
 */
export function cleanStalePortFiles(): void {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) return;

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.startsWith(PORT_FILE_PREFIX) || !file.endsWith(PORT_FILE_SUFFIX)) continue;
    const pidStr = file.slice(PORT_FILE_PREFIX.length, -PORT_FILE_SUFFIX.length);
    const pid = parseInt(pidStr, 10);
    if (!Number.isFinite(pid) || pid <= 0) continue;

    if (!isProcessAlive(pid)) {
      try {
        fs.unlinkSync(path.join(dir, file));
      } catch {
        // Ignore removal errors.
      }
    }
  }
}

/**
 * Get a list of all active dashboard instances by reading port files.
 * Stale files (dead PIDs) are cleaned up automatically.
 */
export function getActiveInstances(): InstanceInfo[] {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) return [];

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const instances: InstanceInfo[] = [];

  for (const file of files) {
    if (!file.startsWith(PORT_FILE_PREFIX) || !file.endsWith(PORT_FILE_SUFFIX)) continue;

    const fullPath = path.join(dir, file);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const entry: PortFileEntry = JSON.parse(raw);

      // Validate expected shape
      if (typeof entry.pid !== 'number' || typeof entry.port !== 'number') continue;

      const alive = isProcessAlive(entry.pid);
      if (!alive) {
        // Clean up stale file
        try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
        continue;
      }

      instances.push({
        ...entry,
        current: entry.pid === process.pid,
        alive,
      });
    } catch {
      // Skip malformed files.
    }
  }

  // Sort: current instance first, then by port ascending
  instances.sort((a, b) => {
    if (a.current && !b.current) return -1;
    if (!a.current && b.current) return 1;
    return a.port - b.port;
  });

  // Self-healing: if this process registered a port but has no port file, recreate it.
  if (_registeredPort > 0 && !instances.some(i => i.current)) {
    try {
      writePortFile(_registeredPort, _registeredHost);
      instances.unshift({
        pid: process.pid,
        port: _registeredPort,
        host: _registeredHost,
        startedAt: new Date().toISOString(),
        current: true,
        alive: true,
      });
    } catch { /* ignore self-heal failures */ }
  }

  return instances;
}

/**
 * Ping an instance to verify it is a live MCP dashboard server.
 * Uses HTTPS when the port file indicates the instance runs with TLS.
 * Returns true if the instance responds within the timeout, false otherwise.
 */
function pingInstance(host: string, port: number, protocol: 'http' | 'https' = 'http', timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const transport = protocol === 'https' ? https : http;
    const tlsOpts: Record<string, unknown> = {};
    if (protocol === 'https') {
      const caPath = getRuntimeConfig().dashboard.http.tls.caPath;
      if (caPath && fs.existsSync(caPath)) {
        tlsOpts.ca = fs.readFileSync(caPath);
      } else {
        // Localhost health-check against self-signed certs when no CA configured
        tlsOpts.rejectUnauthorized = false;
      }
    }
    const opts = {
      hostname: host || '127.0.0.1',
      port,
      path: '/api/instances',
      timeout: timeoutMs,
      ...tlsOpts,
    };
    const req = transport.get(opts, (res) => {
      // Any HTTP response means the server is alive (even 4xx/5xx)
      res.resume(); // drain the response
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Validate all registered instances by HTTP health check.
 * Removes port files for instances that are alive (PID exists) but no longer
 * respond on their registered port -- i.e., orphaned processes whose dashboard
 * HTTP server has shut down or whose PID was recycled.
 *
 * Called periodically from a background timer (every ~30s). Skips the current
 * process (always considered valid).
 */
export async function validateInstances(): Promise<void> {
  const dir = getStateDir();
  if (!fs.existsSync(dir)) return;

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.startsWith(PORT_FILE_PREFIX) || !file.endsWith(PORT_FILE_SUFFIX)) continue;

    const fullPath = path.join(dir, file);
    try {
      const raw = fs.readFileSync(fullPath, 'utf8');
      const entry: PortFileEntry = JSON.parse(raw);
      if (typeof entry.pid !== 'number' || typeof entry.port !== 'number') continue;

      // Skip current process -- we know we're alive
      if (entry.pid === process.pid) continue;

      // First: fast PID check. If process is dead, clean up immediately.
      if (!isProcessAlive(entry.pid)) {
        try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
        continue;
      }

      // PID is alive, but verify it's actually serving HTTP on the expected port.
      // This catches orphaned processes (alive but not functional) and recycled PIDs.
      const proto = entry.protocol || 'http';
      const responds = await pingInstance(entry.host, entry.port, proto);
      if (!responds) {
        try {
          process.stderr.write(`[instance-validate] removing stale port file: pid=${entry.pid} port=${entry.port} (HTTP unreachable)\n`);
          fs.unlinkSync(fullPath);
        } catch { /* ignore */ }
      }
    } catch {
      // Skip malformed files.
    }
  }
}

/** Reset the cached state dir (useful for testing). */
export function _resetStateDir(): void {
  _stateDir = undefined;
}
