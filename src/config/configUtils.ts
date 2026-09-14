/**
 * Shared low-level utilities used by config domain modules.
 * No imports from other local config files — safe to import anywhere.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LogLevelLower } from '../lib/logLevels';

export type LogLevel = LogLevelLower;

export const CWD = process.cwd();

/**
 * The installation root — the directory containing `package.json`, derived from
 * this module's own location.
 *
 * Compiled: <root>/dist/config/configUtils.js -> up 2 == <root>
 * Source:   <root>/src/config/configUtils.ts  -> up 2 == <root>
 *
 * Prefer this over CWD for anything the *installation* owns (logs, metrics,
 * databases). index-server runs as an MCP stdio server, so `process.cwd()` is
 * whatever directory the spawning client happened to be in — a property of the
 * client, not of this install. Defaulting install-owned files to CWD scatters
 * them across unrelated project folders, one private copy per client.
 */
export const INSTALL_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Like `toAbsolute`, but resolves relative values against the installation
 * root rather than the working directory. Use for install-owned artifacts.
 */
export function toInstallAbsolute(raw: string | undefined, fallback?: string): string {
  const pick = raw && raw.trim().length ? raw : fallback;
  if (!pick || !pick.trim().length) return INSTALL_ROOT;
  return path.isAbsolute(pick) ? pick : path.resolve(INSTALL_ROOT, pick);
}

/**
 * OS user-data directory for all mutable server state (logs, metrics, data,
 * feedback, flags). Never cwd-relative, never inside the package directory.
 *
 * Precedence:
 *   1. INDEX_SERVER_STATE_ROOT env var — always wins
 *   2. Platform default — %LOCALAPPDATA%\index-server (Win) or
 *      $XDG_STATE_HOME/index-server (Linux/Mac, XDG default ~/.local/state)
 */
export const STATE_ROOT = resolveStateRoot();

function resolveStateRoot(): string {
  const explicit = process.env.INDEX_SERVER_STATE_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  // path.resolve (not path.join) on both platform branches: LOCALAPPDATA and
  // XDG_STATE_HOME are attacker- or misconfiguration-supplied. A relative or
  // empty value would otherwise yield a relative STATE_ROOT, and since
  // ensureStateDirectories() mkdirs the whole tree under it, the entire state
  // tree would be created under process.cwd() — reintroducing #577 by way of a
  // malformed environment rather than a missed call site.
  if (process.platform === 'win32') {
    return path.resolve(
      process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Local'),
      'index-server',
    );
  }
  return path.resolve(
    process.env.XDG_STATE_HOME?.trim() || path.join(os.homedir(), '.local', 'state'),
    'index-server',
  );
}

/**
 * Like `toAbsolute`, but resolves relative values against STATE_ROOT.
 * Use for all mutable server-owned artifacts (logs, metrics, data, feedback).
 */
export function toStateAbsolute(raw: string | undefined, fallback?: string): string {
  const pick = raw && raw.trim().length ? raw : fallback;
  if (!pick || !pick.trim().length) return STATE_ROOT;
  return path.isAbsolute(pick) ? pick : path.resolve(STATE_ROOT, pick);
}

export function toAbsolute(raw: string | undefined, fallback?: string): string {
  if(raw && raw.trim().length){
    return path.isAbsolute(raw) ? raw : path.resolve(CWD, raw);
  }
  if(fallback && fallback.trim().length){
    return path.isAbsolute(fallback) ? fallback : path.resolve(CWD, fallback);
  }
  return CWD;
}

export function numberFromEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if(!raw) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

export function optionalNumberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if(raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function floatFromEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if(!raw) return defaultValue;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

export function optionalIntFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if(raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : undefined;
}

export function clamp(value: number, min: number, max: number): number {
  if(value < min) return min;
  if(value > max) return max;
  return value;
}

export function stringFromEnv(name: string, defaultValue: string): string {
  const raw = process.env[name];
  if(raw && raw.trim().length) return raw;
  return defaultValue;
}

export function parseCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if(!raw) return [];
  return raw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

export function parseJSONMaybe<T = unknown>(src?: string): T | undefined {
  if(!src) return undefined;
  try { return JSON.parse(src) as T; } catch { return undefined; }
}

let _stateRootEmitted = false;

/**
 * Create the state directory tree under STATE_ROOT on first boot.
 * Idempotent — safe to call on every startup.
 */
export function ensureStateDirectories(): void {
  const dirs = ['logs', 'logs/trace', 'data', 'data/state', 'data/messaging', 'data/models', 'data/sessions', 'metrics', 'feedback', 'snapshots'];
  // Per-directory, and never fatal. This runs as the second statement of
  // main(), and index-server.ts calls `main()` bare — no `.catch()` on an async
  // function — so an unguarded throw here becomes an unhandled rejection that
  // kills the process BEFORE the MCP handshake. The client then sees only
  // "server exited" and the operator gets a rejection stack rather than a
  // diagnosis. EACCES / EROFS / ENOSPC on %LOCALAPPDATA% or $XDG_STATE_HOME are
  // all reachable in the wild: read-only home, hardened container, roaming
  // profile, full disk.
  //
  // Before #577 these directories were created lazily by whichever feature
  // needed them, so an unwritable state dir degraded one feature. Preserve that
  // property: log and continue, and let the feature that actually needs the
  // directory fail on its own with its own context.
  for (const dir of dirs) {
    const target = path.join(STATE_ROOT, dir);
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      try {
        process.stderr.write(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'ERROR',
          msg: '[state] could not create state directory; features needing it will degrade individually',
          detail: JSON.stringify({ dir: target, code: e?.code ?? 'UNKNOWN', errno: e?.errno, message: e?.message }),
          pid: process.pid,
        }) + '\n');
      } catch { /* stderr unavailable — nothing further to do */ }
    }
  }
  if (!_stateRootEmitted) {
    _stateRootEmitted = true;
    try {
      process.stderr.write(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'INFO',
        msg: `[state] State root: ${STATE_ROOT} (set INDEX_SERVER_STATE_ROOT to override)`,
        pid: process.pid,
      }) + '\n');
    } catch { /* ignore */ }

    // Warn if legacy state exists at the old install-root location
    const legacyActivityDb = path.join(INSTALL_ROOT, 'metrics', 'activity.db');
    if (fs.existsSync(legacyActivityDb) && path.resolve(legacyActivityDb) !== path.resolve(STATE_ROOT, 'metrics', 'activity.db')) {
      try {
        process.stderr.write(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'WARN',
          msg: `[state] Found legacy activity.db at ${legacyActivityDb}; new location is ${path.join(STATE_ROOT, 'metrics', 'activity.db')}. Move manually if history should be preserved.`,
          pid: process.pid,
        }) + '\n');
      } catch { /* ignore */ }
    }

    // Same notice for backups, which moved from `<catalog>/../backups` (i.e.
    // `<cwd>/backups` on a default install) to STATE_ROOT. Anchored to CWD
    // rather than INSTALL_ROOT because that is where the stranded copies
    // actually are: the old default followed the client's working directory,
    // so the operator who is affected is the one running from a project folder.
    // A notice keyed on the install root would never fire for them.
    //
    // Gated on the directory being non-empty: an empty `backups/` left behind
    // by a previous run is noise, not something anyone needs to migrate.
    const legacyBackups = path.join(CWD, 'backups');
    const currentBackups = path.resolve(STATE_ROOT, 'backups');
    if (path.resolve(legacyBackups) !== currentBackups) {
      let hasContent = false;
      try { hasContent = fs.existsSync(legacyBackups) && fs.readdirSync(legacyBackups).length > 0; } catch { /* unreadable — say nothing */ }
      if (hasContent) {
        try {
          process.stderr.write(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'WARN',
            msg: `[state] Found legacy backups at ${legacyBackups}; new location is ${currentBackups}. Move them manually if they should be retained, or set INDEX_SERVER_BACKUPS_DIR to keep using the old path.`,
            pid: process.pid,
          }) + '\n');
        } catch { /* ignore */ }
      }
    }
  }
}
