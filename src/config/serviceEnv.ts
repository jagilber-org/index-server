/**
 * Config-layer accessors for settings consumed by the service layer (#611,
 * constitution S-4).
 *
 * Why these are functions and not fields on `RuntimeConfig`
 * --------------------------------------------------------
 * `getRuntimeConfig()` memoizes: it parses `process.env` once and returns the
 * same object until `reloadRuntimeConfig()` is called. That is right for the
 * ~200 settings that are read once at boot and wrong for the ones below, every
 * one of which is read *per call* today, on purpose:
 *
 *   - `EventRing.resolveCapacity()` re-reads on every `add()` so a capacity
 *     change takes effect without a restart.
 *   - `activityLog.isEnabled()` / `resolveDbPath()` are consulted on every
 *     logged mutation, and ~36 specs set `INDEX_SERVER_ACTIVITY_DB` and friends
 *     mid-run to redirect telemetry into a temp directory. Under a snapshot
 *     they would keep writing wherever the first read resolved — which is the
 *     exact failure that put 902 test-fixture rows into a real catalog's
 *     activity database (see the comment in `activityLog.isEnabled`).
 *   - `mcpLogBridge` reads its flag during module evaluation, and it is the
 *     FIRST import in `src/server/index-server.ts` — deliberately above
 *     `applyOverlay()`. Materializing `RuntimeConfig` there would move the
 *     whole config snapshot in front of the overlay and silently invert the
 *     precedence documented at `index-server.ts:34-45`.
 *
 * So S-4 is satisfied the way the guard's own allowlist defines it — the READ
 * lives in `src/config/`, and the service layer consumes a named accessor —
 * without changing when the read happens. `scripts/governance/enforce-config-usage.ts`
 * exempts this directory because reading `process.env` is the config layer's
 * entire job; the policy is that code *outside* it must go through the layer.
 *
 * Rules for adding to this file:
 *   - Resolve fully here (defaults, clamping, path resolution) and return a
 *     typed value. A bare `process.env.X` passthrough moves the read without
 *     moving the decision, and leaves the parsing duplicated at the call site.
 *   - If the value is only read at boot, it belongs on `RuntimeConfig` instead.
 *   - Keep imports to config leaves (`configUtils`, `dirConstants`) so this
 *     module stays safe to import from anywhere, including entry points that
 *     run before `applyOverlay()`.
 */
import path from 'path';
import { STATE_ROOT, toStateAbsolute } from './configUtils';
import { DIR } from './dirConstants';

// ---------------------------------------------------------------------------
// Activity telemetry (src/services/activityLog.ts)
// ---------------------------------------------------------------------------

/** Default retention window for activity rows, in days. */
export const DEFAULT_ACTIVITY_RETENTION_DAYS = 90;

/**
 * Tri-state reading of `INDEX_SERVER_ACTIVITY_LOG`.
 *
 * The caller needs all three: `off` disables outright, `on` is an explicit
 * opt-in that is NOT sufficient under a test runner, and `unset` means "on in
 * production, off under a test runner". Collapsing this to a boolean is what
 * previously let `INDEX_SERVER_ACTIVITY_LOG=1` re-arm writes inside vitest.
 */
export function activityLogSetting(): 'on' | 'off' | 'unset' {
  const raw = process.env.INDEX_SERVER_ACTIVITY_LOG;
  if (raw === undefined) return 'unset';
  return /^(0|off|false|no)$/i.test(raw.trim()) ? 'off' : 'on';
}

/** Whether an explicit activity-database path was configured. */
export function activityDbConfigured(): boolean {
  const raw = process.env.INDEX_SERVER_ACTIVITY_DB;
  return Boolean(raw && raw.trim());
}

/**
 * Resolve the activity database path.
 *
 * Precedence: explicit DB override, then the metrics directory override, then
 * `<STATE_ROOT>/metrics/activity.db`.
 */
export function resolveActivityDbPath(): string {
  const configured = process.env.INDEX_SERVER_ACTIVITY_DB;
  if (configured && configured.trim()) return path.resolve(configured.trim());

  const metricsDir = process.env.INDEX_SERVER_METRICS_DIR;
  if (metricsDir && metricsDir.trim()) {
    return path.join(path.resolve(metricsDir.trim()), 'activity.db');
  }

  return path.join(STATE_ROOT, DIR.METRICS, 'activity.db');
}

/** Retention window for activity rows; non-finite or non-positive falls back. */
export function activityRetentionDays(): number {
  const raw = Number(process.env.INDEX_SERVER_ACTIVITY_RETENTION_DAYS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_ACTIVITY_RETENTION_DAYS;
}

// ---------------------------------------------------------------------------
// In-process event ring (src/services/eventBuffer.ts)
// ---------------------------------------------------------------------------

/** Default capacity of the WARN/ERROR event ring. */
export const DEFAULT_EVENT_BUFFER_CAPACITY = 500;

/**
 * Capacity of the in-process event ring, clamped to [50, 5000].
 * Unset, unparseable and non-positive values all fall back to the default.
 */
export function eventBufferCapacity(): number {
  const raw = process.env.INDEX_SERVER_EVENT_BUFFER_SIZE;
  if (!raw) return DEFAULT_EVENT_BUFFER_CAPACITY;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EVENT_BUFFER_CAPACITY;
  return Math.min(5000, Math.max(50, n));
}

// ---------------------------------------------------------------------------
// MCP stderr bridge (src/services/mcpLogBridge.ts)
// ---------------------------------------------------------------------------

/**
 * Whether to route server logs through MCP `notifications/message` instead of
 * raw stderr. Read during module evaluation of the entry point's first import,
 * so this must never reach for `getRuntimeConfig()` — see the header.
 */
export function stderrBridgeEnabled(): boolean {
  return process.env.INDEX_SERVER_ENABLE_STDERR_BRIDGE === '1';
}

// ---------------------------------------------------------------------------
// Paths (manifest, usage snapshot, state dir)
// ---------------------------------------------------------------------------

/** Repo-relative default location of the index manifest. */
export const MANIFEST_RELATIVE = path.join('snapshots', 'index-manifest.json');

/**
 * Resolve the on-disk manifest location, honouring `INDEX_SERVER_MANIFEST_PATH`.
 *
 * Relative values resolve against STATE_ROOT, not CWD: the reader
 * (`integrity_manifest`) resolves the same way, and when the two disagree the
 * reader reports `{ manifest: 'missing' }` for every caller whose cwd is not
 * STATE_ROOT — looking somewhere the writer never writes (#577).
 */
export function resolveManifestPath(): string {
  const override = process.env.INDEX_SERVER_MANIFEST_PATH;
  if (override && override.trim()) return toStateAbsolute(override);
  return toStateAbsolute(undefined, MANIFEST_RELATIVE);
}

/**
 * Resolve the JSON usage-snapshot path.
 *
 * CWD-relative by default, unlike the paths above. That is deliberate for now:
 * it is the pre-existing behaviour and `indexUsage` shares this exact function,
 * so changing the default here would silently orphan existing counters. Moving
 * it under STATE_ROOT is the same migration #577 performed for the other
 * stores and needs its own change with a merge step.
 */
export function resolveUsageSnapshotPath(): string {
  const override = process.env.INDEX_SERVER_USAGE_SNAPSHOT_PATH;
  return override ? path.resolve(override) : path.join(process.cwd(), DIR.DATA, 'usage-snapshot.json');
}

/**
 * Directory holding the leader lock file, honouring `INDEX_SERVER_STATE_DIR`.
 *
 * One definition, shared by the leader (which writes the lock, via
 * `dashboardConfig`) and the thin client (which reads it). The thin client used
 * to build `<cwd>/data/state` itself; after #577 moved server state under
 * STATE_ROOT that stopped matching where the leader writes, so with the env var
 * unset discovery silently found no leader and every request fell through to
 * the retry path.
 */
export function resolveStateDir(): string {
  return toStateAbsolute(process.env.INDEX_SERVER_STATE_DIR, DIR.DATA_STATE);
}

/** Explicit leader URL for the thin client; undefined means auto-discover. */
export function leaderUrl(): string | undefined {
  return process.env.INDEX_SERVER_LEADER_URL || undefined;
}

// ---------------------------------------------------------------------------
// MCP client-config management (src/services/mcpConfig/*)
// ---------------------------------------------------------------------------

/** Default number of per-file config backups retained. */
export const DEFAULT_MCP_BACKUP_RETAIN = 10;

/** How many backups of each managed MCP config file to keep. */
export function mcpBackupRetention(): number {
  const raw = process.env.INDEX_SERVER_MCP_BACKUP_RETAIN;
  const parsed = raw ? Number(raw) : DEFAULT_MCP_BACKUP_RETAIN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MCP_BACKUP_RETAIN;
}

/**
 * Root directory written into generated MCP client configs.
 * An explicit caller-supplied root wins over the env var, which wins over CWD.
 */
export function resolveMcpConfigRoot(explicit?: string): string {
  return path.resolve(explicit ?? process.env.INDEX_SERVER_MCP_CONFIG_ROOT ?? process.cwd());
}
