/**
 * Feature domain config: feature flags, feedback, messaging, semantic search,
 * minimal mode, bootstrap seed, validation, dynamic config, and graph settings.
 */
import { getBooleanEnv, parseBooleanEnv } from '../utils/envUtils';
import {
  toStateAbsolute,
  numberFromEnv,
  parseCsvEnv,
} from './configUtils';
import { DIR } from './dirConstants';
import { resolveMessagingDir } from './pathResolution';
import { DEFAULT_LIMITS, DEFAULT_TIMEOUTS_MS, DEFAULT_SEMANTIC } from './defaultValues';

export interface FeatureFlagsConfig {
  file: string;
  envNamespace: Record<string, string>;
  indexFeatures: Set<string>;
}

export interface FeedbackConfig {
  dir: string;
  maxEntries: number;
}

export interface MessagingConfig {
  /**
   * When `false` the messaging subsystem is disabled at boot: messaging_* MCP
   * tools are removed from the registry, dashboard REST routes are skipped,
   * and the Messaging tab is hidden. Defaults to `true` (enabled). Gated by
   * the `INDEX_SERVER_MESSAGING_ENABLED` env var. Issue #353.
   *
   * Optional in the interface so test fixtures that construct partial configs
   * for `AgentMailbox` (which only consumes `dir`/`maxMessages`/`sweepIntervalMs`)
   * remain compatible. Treat `undefined` as enabled (the default).
   */
  enabled?: boolean;
  dir: string;
  maxMessages: number;
  sweepIntervalMs: number;
}

type SemanticDevice = 'cpu' | 'cuda' | 'dml';

export interface SemanticConfig {
  enabled: boolean;
  model: string;
  cacheDir: string;
  embeddingPath: string;
  device: SemanticDevice;
  localOnly: boolean;
  /** Auto-compute embeddings after import/restore when semantic is enabled (INDEX_SERVER_AUTO_EMBED_ON_IMPORT, default true). */
  autoEmbedOnImport: boolean;
}

export interface MinimalConfig {
  debugOrdering: boolean;
}

export interface BootstrapSeedConfig {
  autoSeed: boolean;
  verbose: boolean;
}

export interface ValidationConfig {
  mode: string;
}

export interface DynamicConfig {
  dashboardConfig: Record<string, string>;
  apiIntegration: Record<string, string>;
}

export interface GraphConfig {
  includePrimaryEdges: boolean;
  largeCategoryCap: number;
  explicitIncludePrimaryEnv: boolean;
  explicitLargeCategoryEnv: boolean;
  signature: string;
}

/**
 * The raw, unparsed `INDEX_SERVER_FEATURES` value, or null when unset.
 *
 * Diagnostic only (#611). `incrementUsage()` reports it verbatim when it
 * refuses a call because the `usage` feature is off, so the operator can see
 * what the gate actually observed. The parsed `indexFeatures` set is the wrong
 * thing to echo there: it has already had `usage` added or removed by
 * `INDEX_SERVER_USAGE_ENABLED`, so it would show a value nobody configured.
 */
export function rawIndexFeaturesSetting(): string | null {
  const raw = process.env.INDEX_SERVER_FEATURES;
  return raw === undefined ? null : raw;
}

export function parseFeatureFlagsConfig(): FeatureFlagsConfig {
  const envNamespace: Record<string, string> = {};
  for(const [key, value] of Object.entries(process.env)){
    if(key.startsWith('INDEX_SERVER_FLAG_') && typeof value === 'string'){
      envNamespace[key.substring('INDEX_SERVER_FLAG_'.length).toLowerCase()] = value;
    }
  }
  // Usage tracking is on for every profile (#495). It is local-only — see PRIVACY.md —
  // and its history cannot be backfilled, so a silent default-off is unrecoverable.
  // INDEX_SERVER_USAGE_ENABLED is the dedicated switch and wins over the CSV list.
  const indexFeatures = new Set(parseCsvEnv('INDEX_SERVER_FEATURES'));
  if (parseBooleanEnv(process.env.INDEX_SERVER_USAGE_ENABLED, true)) indexFeatures.add('usage');
  else indexFeatures.delete('usage');
  return {
    file: toStateAbsolute(process.env.INDEX_SERVER_FLAGS_FILE, DIR.FLAGS),
    envNamespace,
    indexFeatures,
  };
}

export function parseFeedbackConfig(): FeedbackConfig {
  return {
    dir: toStateAbsolute(process.env.INDEX_SERVER_FEEDBACK_DIR, DIR.FEEDBACK),
    maxEntries: numberFromEnv('INDEX_SERVER_FEEDBACK_MAX_ENTRIES', DEFAULT_LIMITS.MAX_FEEDBACK_ENTRIES),
  };
}

export function parseMessagingConfig(): MessagingConfig {
  const enabled = parseBooleanEnv(process.env.INDEX_SERVER_MESSAGING_ENABLED, true);
  return {
    enabled,
    // Anchored to STATE_ROOT (#577), never to CWD: every MCP client launches the
    // server from a different working directory, so a cwd-relative default gives
    // each client a private store and messages silently stop crossing between
    // them. STATE_ROOT is per-user and machine-wide, so every client converges on
    // one store — which also closes this PR's own residual, where an unset
    // INDEX_SERVER_DIR still put the store at `<cwd>/index-messaging`.
    //
    // resolveMessagingDir() rather than a bare toStateAbsolute() because the
    // containment guard is still load-bearing: the DEFAULT can no longer land
    // inside the catalog, but an explicit INDEX_SERVER_MESSAGING_DIR still can,
    // and message files inside the catalog are loaded as malformed instructions
    // and corrupt the index.
    //
    // Validation is gated on `enabled` so the kill-switch actually works. The
    // guard throws, and this literal is evaluated during getRuntimeConfig() at
    // boot — ungated, a bad messaging path exits the process before the MCP
    // handshake, so the client sees a bare "server exited" and
    // INDEX_SERVER_MESSAGING_ENABLED=0 could not rescue it.
    dir: resolveMessagingDir(enabled),
    maxMessages: numberFromEnv('INDEX_SERVER_MESSAGING_MAX', DEFAULT_LIMITS.MAX_MESSAGES),
    sweepIntervalMs: numberFromEnv('INDEX_SERVER_MESSAGING_SWEEP_MS', DEFAULT_TIMEOUTS_MS.MESSAGING_SWEEP),
  };
}

export function parseSemanticConfig(): SemanticConfig {
  const validDevices: SemanticDevice[] = ['cpu', 'cuda', 'dml'];
  const rawDevice = (process.env.INDEX_SERVER_SEMANTIC_DEVICE || 'cpu').toLowerCase() as SemanticDevice;
  const device = validDevices.includes(rawDevice) ? rawDevice : 'cpu';
  return {
    enabled: getBooleanEnv('INDEX_SERVER_SEMANTIC_ENABLED'),
    model: process.env.INDEX_SERVER_SEMANTIC_MODEL || DEFAULT_SEMANTIC.MODEL,
    cacheDir: toStateAbsolute(process.env.INDEX_SERVER_SEMANTIC_CACHE_DIR, DIR.DATA_MODELS),
    embeddingPath: toStateAbsolute(process.env.INDEX_SERVER_EMBEDDING_PATH, DIR.DATA_EMBEDDINGS),
    device,
    localOnly: getBooleanEnv('INDEX_SERVER_SEMANTIC_LOCAL_ONLY', true),
    autoEmbedOnImport: getBooleanEnv('INDEX_SERVER_AUTO_EMBED_ON_IMPORT', true),
  };
}

export function parseMinimalConfig(): MinimalConfig {
  return {
    debugOrdering: getBooleanEnv('INDEX_SERVER_MINIMAL_DEBUG'),
  };
}

/**
 * Optional lifecycle hooks (#447): operator-configured commands run after a
 * committed instruction CRUD mutation. Off by default; enabled only when at
 * least one hook command is set. Commands come from trusted operator env only
 * (never from instruction content or tool params).
 */
export interface LifecycleHooksConfig {
  /** True when at least one hook command is configured. */
  enabled: boolean;
  /** Command run when a new instruction is created (index_add of a new id). */
  onCreate?: string;
  /** Command run when an existing instruction is updated (index_add overwrite). */
  onUpdate?: string;
  /** Command run when instructions are removed (index_remove). */
  onRemove?: string;
  /** Catch-all command run for any committed mutation (incl. import/promote). */
  onChange?: string;
  /** When true, await hook completion before the mutation returns (default false = fire-and-forget). */
  blocking: boolean;
  /** Per-hook wall-clock timeout (ms). */
  timeoutMs: number;
  /** Max concurrent in-flight hook processes; excess dispatches are dropped with a WARN. */
  maxConcurrent: number;
}

export function parseLifecycleHooksConfig(): LifecycleHooksConfig {
  const onCreate = process.env.INDEX_SERVER_HOOK_ON_CREATE?.trim() || undefined;
  const onUpdate = process.env.INDEX_SERVER_HOOK_ON_UPDATE?.trim() || undefined;
  const onRemove = process.env.INDEX_SERVER_HOOK_ON_REMOVE?.trim() || undefined;
  const onChange = process.env.INDEX_SERVER_HOOK_ON_CHANGE?.trim() || undefined;
  return {
    enabled: Boolean(onCreate || onUpdate || onRemove || onChange),
    onCreate,
    onUpdate,
    onRemove,
    onChange,
    blocking: getBooleanEnv('INDEX_SERVER_HOOK_BLOCKING'),
    timeoutMs: Math.max(1, numberFromEnv('INDEX_SERVER_HOOK_TIMEOUT_MS', 10_000)),
    maxConcurrent: Math.max(1, numberFromEnv('INDEX_SERVER_HOOK_MAX_CONCURRENT', 4)),
  };
}

export function parseBootstrapSeedConfig(): BootstrapSeedConfig {
  return {
    autoSeed: process.env.INDEX_SERVER_AUTO_SEED === undefined ? true : process.env.INDEX_SERVER_AUTO_SEED !== '0',
    verbose: getBooleanEnv('INDEX_SERVER_SEED_VERBOSE'),
  };
}

export function parseValidationConfig(): ValidationConfig {
  return {
    mode: (process.env.INDEX_SERVER_VALIDATION_MODE || 'zod').toLowerCase(),
  };
}

export function parseDynamicConfig(): DynamicConfig {
  return {
    dashboardConfig: {},
    apiIntegration: {},
  };
}

export function parseGraphConfig(): GraphConfig {
  const includeRaw = process.env.INDEX_SERVER_GRAPH_INCLUDE_PRIMARY_EDGES;
  const includePrimaryEdges = includeRaw === undefined ? true : parseBooleanEnv(includeRaw, true);
  const largeRaw = process.env.INDEX_SERVER_GRAPH_LARGE_CATEGORY_CAP;
  let largeCategoryCap = Number.POSITIVE_INFINITY;
  let explicitLargeCategoryEnv = false;
  if(largeRaw && largeRaw.trim().length){
    const parsed = Number.parseInt(largeRaw, 10);
    if(Number.isFinite(parsed) && parsed >= 0){
      largeCategoryCap = parsed;
    }
    explicitLargeCategoryEnv = true;
  }
  const explicitIncludePrimaryEnv = includeRaw !== undefined;
  const signature = `${includePrimaryEdges ? 'P1' : 'P0'}:${explicitLargeCategoryEnv ? largeCategoryCap : 'INF'}`;
  return {
    includePrimaryEdges,
    largeCategoryCap,
    explicitIncludePrimaryEnv,
    explicitLargeCategoryEnv,
    signature,
  };
}

// StorageConfig is defined here and re-exported from runtimeConfig.ts for public API compatibility.
export interface StorageConfig {
  backend: 'json' | 'sqlite';
  sqlitePath: string;
  sqliteWal: boolean;
  sqliteMigrateOnStart: boolean;
  sqliteVecEnabled: boolean;
  sqliteVecPath: string;
}

export function parseStorageConfig(): StorageConfig {
  const raw = (process.env.INDEX_SERVER_STORAGE_BACKEND || 'json').toLowerCase();
  const backend = (raw === 'sqlite' ? 'sqlite' : 'json') as 'json' | 'sqlite';
  if (backend === 'sqlite') {
    try { process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'WARN', msg: '[config] EXPERIMENTAL: SQLite storage backend selected. Limited testing has been performed. Use at your own risk.', pid: process.pid }) + '\n'); } catch { /* ignore */ }
  }
  return {
    backend,
    sqlitePath: toStateAbsolute(process.env.INDEX_SERVER_SQLITE_PATH, DIR.DATA_SQLITE),
    sqliteWal: parseBooleanEnv(process.env.INDEX_SERVER_SQLITE_WAL, true),
    sqliteMigrateOnStart: parseBooleanEnv(process.env.INDEX_SERVER_SQLITE_MIGRATE_ON_START, true),
    sqliteVecEnabled: parseBooleanEnv(
      process.env.INDEX_SERVER_SQLITE_VEC_ENABLED,
      // Default to enabled when the storage backend is already sqlite;
      // factory.ts falls back to JSON automatically if the native extension fails.
      backend === 'sqlite',
    ),
    sqliteVecPath: process.env.INDEX_SERVER_SQLITE_VEC_PATH || '',
  };
}
