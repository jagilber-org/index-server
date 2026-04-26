/**
 * Unified runtime configuration loader — thin aggregate.
 *
 * All configuration is driven by INDEX_SERVER_ prefixed env vars.
 * See docs/configuration.md for the full reference.
 *
 * Domain modules handle parsing for their respective areas:
 *   - serverConfig.ts  : MCP server, bootstrap, transport, logging, metrics, tracing
 *   - dashboardConfig.ts : HTTP server, TLS, WebSocket, persistence
 *   - featureConfig.ts : feature flags, feedback, messaging, semantic, graph, storage
 */
import fs from 'fs';
import path from 'path';
import { getBooleanEnv, parseBooleanEnv, isFalsy, isFalsyExtended, isTruthy, isDebugOrVerbose, TRUTHY_OR_DEFAULT } from '../utils/envUtils';
import { CWD, LogLevel, toAbsolute, numberFromEnv, optionalIntFromEnv, clamp, parseJSONMaybe } from './configUtils';
import { DIR } from './dirConstants';
import { DEFAULT_LIMITS, DEFAULT_GOVERNANCE, DEFAULT_TIMEOUTS_MS } from './defaultValues';
import { parseServerConfig, parseLoggingConfig, parseMetricsConfig, parseAtomicFsConfig, parsePreflightConfig, parseTracingConfig } from './serverConfig';
import type { ServerConfig, LoggingConfig, MetricsConfig, AtomicFsConfig, PreflightConfig, TracingConfig } from './serverConfig';
import { parseDashboardConfig } from './dashboardConfig';
import type { DashboardConfig } from './dashboardConfig';
import {
  parseFeatureFlagsConfig,
  parseFeedbackConfig,
  parseMessagingConfig,
  parseSemanticConfig,
  parseMinimalConfig,
  parseBootstrapSeedConfig,
  parseValidationConfig,
  parseDynamicConfig,
  parseGraphConfig,
  parseStorageConfig,
} from './featureConfig';
import type {
  FeatureFlagsConfig,
  FeedbackConfig,
  MessagingConfig,
  SemanticConfig,
  MinimalConfig,
  BootstrapSeedConfig,
  ValidationConfig,
  DynamicConfig,
  GraphConfig,
  StorageConfig,
} from './featureConfig';

export type IndexMode = 'normal' | 'memoize' | 'memoize+hash' | 'reload' | 'reload+memo';
export type { LogLevel };

// Re-export publicly used types from domain modules.
export type { MessagingConfig } from './featureConfig';
export type { StorageConfig } from './featureConfig';

interface TimingMap { [key: string]: number; }

interface BufferRingConfig { append: boolean; preload: boolean; }

interface CoverageConfig {
  hardMin?: number;
  target?: number;
  fastMode: boolean;
  strictMode: boolean;
}

interface IndexReadRetriesConfig {
  attempts: number;
  backoffMs: number;
}

interface IndexGovernanceConfig {
  trailingNewline: boolean;
  hashHardeningEnabled: boolean;
  hashCanonVariants: number;
  hashImportSetSize: number;
}

interface IndexConfig {
  mode: IndexMode;
  baseDir: string;
  reloadAlways: boolean;
  memoize: boolean;
  memoizeDisabledExplicitly: boolean;
  memoizeHash: boolean;
  normalizationLog?: string | boolean;
  fileTrace: boolean;
  eventSilent: boolean;
  readRetries: IndexReadRetriesConfig;
  usageFlushMs: number;
  disableUsageClamp: boolean;
  govHash: IndexGovernanceConfig;
  maxFiles?: number; // Optional limit on index size for performance
  loadWarningThreshold?: number; // Warn if load time exceeds this (ms)
  /** Configurable warn/truncate/reject threshold for instruction body length (default 50000). */
  bodyWarnLength: number;
  /** Hard maximum body character length — schema reject ceiling, always 1MB. Not configurable. */
  bodyMaxLength: number;
  autoSplitOversized: boolean; // Auto-split oversized entries on startup instead of truncating (default false)
  autoUsageTrack: boolean; // Automatically track usage on get/search responses (default true)
}

interface InstructionsManifestConfig {
  writeEnabled: boolean;
  fastload: boolean;
}

interface InstructionsCIContextConfig {
  inCI: boolean;
  githubActions: boolean;
  tfBuild: boolean;
}

interface InstructionsAuditLogConfig {
  enabled: boolean;
  file?: string;
  rawValue?: string;
  usesDefault: boolean;
}

interface InstructionsListValidationConfig {
  forceFullScan: boolean;
  allowSampling: boolean;
  effectiveSampleSize?: number;
  sampleSeed?: number;
  concurrency: number;
  maxDurationMs: number;
}

interface InstructionsConfig {
  workspaceId?: string;
  agentId?: string;
  canonicalDisable: boolean;
  strictVisibility: boolean;
  strictCreate: boolean;
  strictRemove: boolean;
  requireCategory: boolean;
  traceQueryDiag: boolean;
  manifest: InstructionsManifestConfig;
  ciContext: InstructionsCIContextConfig;
  auditLog: InstructionsAuditLogConfig;
  listValidation: InstructionsListValidationConfig;
}

interface MutationConfig {
  enabled: boolean;
  dispatcherTiming: boolean;
  maxBulkDelete: number;
  backupBeforeBulkDelete: boolean;
  autoBackupEnabled: boolean;
  autoBackupIntervalMs: number;
  autoBackupMaxCount: number;
}

export interface RuntimeConfig {
  profile: string;
  testMode: string | undefined;
  index: IndexConfig;
  mutationEnabled: boolean;
  logLevel: LogLevel;
  trace: Set<string>;
  initFeatures: Set<string>;
  bufferRing: BufferRingConfig;
  timing: (key: string, fallback?: number) => number | undefined;
  rawTiming: TimingMap;
  coverage: CoverageConfig;
  dashboard: DashboardConfig;
  server: ServerConfig;
  logging: LoggingConfig;
  metrics: MetricsConfig;
  instructions: InstructionsConfig;
  tracing: TracingConfig;
  mutation: MutationConfig;
  featureFlags: FeatureFlagsConfig;
  feedback: FeedbackConfig;
  messaging: MessagingConfig;
  semantic: SemanticConfig;
  minimal: MinimalConfig;
  bootstrapSeed: BootstrapSeedConfig;
  atomicFs: AtomicFsConfig;
  preflight: PreflightConfig;
  validation: ValidationConfig;
  dynamic: DynamicConfig;
  graph: GraphConfig;
  storage: StorageConfig;
}


function parseTiming(): TimingMap {
  const map: TimingMap = {};
  const timingSrc = process.env.INDEX_SERVER_TIMING_JSON;
  if(timingSrc){
    let obj: Record<string, unknown> | undefined;
    if(timingSrc.startsWith('{')) obj = parseJSONMaybe<Record<string, unknown>>(timingSrc);
    else if(fs.existsSync(timingSrc)) obj = parseJSONMaybe<Record<string, unknown>>(fs.readFileSync(timingSrc,'utf8'));
    if(obj && typeof obj === 'object'){
      for(const [k,v] of Object.entries(obj)){
        if(typeof v === 'number' && Number.isFinite(v)) map[k]=v;
      }
    }
  }
  return map;
}

function deriveIndexMode(): IndexMode {
  const explicit = process.env.INDEX_SERVER_CACHE_MODE as IndexMode | undefined;
  if(explicit) return explicit;
  const memo = process.env.INDEX_SERVER_MEMOIZE === '1';
  const hash = process.env.INDEX_SERVER_MEMOIZE_HASH === '1';
  const reload = process.env.INDEX_SERVER_ALWAYS_RELOAD === '1';
  if(reload && memo && hash) return 'reload+memo';
  if(reload && memo) return 'reload+memo';
  if(reload) return 'reload';
  if(memo && hash) return 'memoize+hash';
  if(memo) return 'memoize';
  return 'normal';
}

function parseTrace(): Set<string> {
  const set = new Set<string>();
  const raw = process.env.INDEX_SERVER_TRACE;
  if(raw){
    raw.split(',').map(s=>s.trim()).filter(Boolean).forEach(v=>set.add(v));
  }
  return set;
}

function parseInitFeatures(): Set<string> {
  const set = new Set<string>();
  const raw = process.env.INDEX_SERVER_INIT_FEATURES;
  if(raw){ raw.split(',').map(s=>s.trim()).filter(Boolean).forEach(v=>set.add(v)); }
  return set;
}

function parseLogLevel(traceSet: Set<string>): LogLevel {
  const raw = process.env.INDEX_SERVER_LOG_LEVEL?.toLowerCase();
  const valid: LogLevel[] = ['error','warn','info','debug','trace'];
  if(raw && (valid as string[]).includes(raw)) return raw as LogLevel;
  if(traceSet.has('verbose')) return 'trace';
  if(isDebugOrVerbose()) return 'debug';
  return 'info';
}

function parseBufferRing(): BufferRingConfig {
  let append: boolean | undefined;
  let preload = false;
  const appendRaw = process.env.INDEX_SERVER_BUFFER_RING_APPEND;
  const preloadRaw = process.env.INDEX_SERVER_BUFFER_RING_PRELOAD;
  if(appendRaw === '0') append = false;
  else if(appendRaw === '1') append = true;
  if(preloadRaw === '1') preload = true;
  return { append: append ?? true, preload };
}

function parseMutation(): boolean {
  const raw = process.env.INDEX_SERVER_MUTATION;
  if(raw === undefined) return true;
  return parseBooleanEnv(raw, false);
}

function parseCoverage(): CoverageConfig {
  const fast = process.env.INDEX_SERVER_COVERAGE_FAST === '1' || process.env.INDEX_SERVER_TEST_MODE === 'coverage-fast';
  const hardMinRaw = process.env.INDEX_SERVER_COVERAGE_HARD_MIN;
  const targetRaw = process.env.INDEX_SERVER_COVERAGE_TARGET;
  const hardMin = hardMinRaw ? Number(hardMinRaw) : undefined;
  const target = targetRaw ? Number(targetRaw) : undefined;
  const strictMode = parseBooleanEnv(process.env.INDEX_SERVER_COVERAGE_STRICT, process.env.INDEX_SERVER_TEST_MODE === 'coverage-strict');
  return { hardMin, target, fastMode: fast, strictMode };
}

function resolveInstructionsAuditLog(): InstructionsAuditLogConfig {
  const defaultPath = toAbsolute(path.join(DIR.LOGS_AUDIT));
  const raw = process.env.INDEX_SERVER_AUDIT_LOG;
  if(raw === undefined || raw.trim().length === 0){
    return { enabled: true, file: defaultPath, rawValue: undefined, usesDefault: true };
  }
  const trimmed = raw.trim();
  if(isFalsyExtended(trimmed)){
    return { enabled: false, rawValue: raw, usesDefault: false };
  }
  const defaultRequested = trimmed === '1' || (TRUTHY_OR_DEFAULT as readonly string[]).includes(trimmed.toLowerCase());
  return {
    enabled: true,
    file: defaultRequested ? defaultPath : toAbsolute(trimmed),
    rawValue: raw,
    usesDefault: defaultRequested || trimmed.length === 0,
  };
}

function resolveInstructionsDir(): string {
  const raw = process.env.INDEX_SERVER_DIR;
  const fallback = path.join(CWD, DIR.INSTRUCTIONS);
  return toAbsolute(raw, fallback);
}

function parseIndexConfig(): IndexConfig {
  const baseDir = resolveInstructionsDir();
  const normalizationRaw = process.env.INDEX_SERVER_NORMALIZATION_LOG;
  let normalizationLog: string | boolean | undefined;
  if(normalizationRaw){
    if(isFalsy(normalizationRaw)) normalizationLog = false;
    else if(isTruthy(normalizationRaw)) normalizationLog = toAbsolute(path.join(DIR.LOGS_NORMALIZATION));
    else normalizationLog = toAbsolute(normalizationRaw);
  }
  const memoizeRaw = process.env.INDEX_SERVER_MEMOIZE;
  const attempts = numberFromEnv('INDEX_SERVER_READ_RETRIES', DEFAULT_LIMITS.READ_RETRIES);
  const backoffMs = numberFromEnv('INDEX_SERVER_READ_BACKOFF_MS', DEFAULT_LIMITS.READ_BACKOFF_MS);
  const usageFlushMs = numberFromEnv('INDEX_SERVER_USAGE_FLUSH_MS', DEFAULT_GOVERNANCE.USAGE_FLUSH_MS);
  const hashHardeningEnabled = parseBooleanEnv(process.env.INDEX_SERVER_GOV_HASH_HARDENING, true);
  const canonVariantsRaw = optionalIntFromEnv('INDEX_SERVER_GOV_HASH_CANON_VARIANTS');
  const importSetSizeRaw = optionalIntFromEnv('INDEX_SERVER_GOV_HASH_IMPORT_SET_SIZE');
  const hashCanonVariants = clamp(canonVariantsRaw ?? DEFAULT_GOVERNANCE.HASH_CANON_VARIANTS, 1, DEFAULT_GOVERNANCE.HASH_CANON_VARIANTS_MAX);
  const hashImportSetSize = clamp(importSetSizeRaw ?? DEFAULT_GOVERNANCE.HASH_IMPORT_SET_SIZE, 2, DEFAULT_GOVERNANCE.HASH_IMPORT_SET_SIZE_MAX);
  const maxFiles = optionalIntFromEnv('INDEX_SERVER_MAX_FILES');
  const loadWarningThreshold = optionalIntFromEnv('INDEX_SERVER_LOAD_WARN_MS');
  const bodyWarnLength = clamp(numberFromEnv('INDEX_SERVER_BODY_WARN_LENGTH', DEFAULT_LIMITS.BODY_WARN_LENGTH), DEFAULT_LIMITS.BODY_MIN_LENGTH, DEFAULT_LIMITS.BODY_MAX_LENGTH);
  const bodyMaxLength = DEFAULT_LIMITS.BODY_MAX_LENGTH;

  // Warn about removed legacy env var
  if (process.env.INDEX_SERVER_BODY_MAX_LENGTH !== undefined) {
    try { process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'WARN', msg: '[runtimeConfig] INDEX_SERVER_BODY_MAX_LENGTH is no longer recognized. Use INDEX_SERVER_BODY_WARN_LENGTH instead (default: 50000).', pid: process.pid }) + '\n'); } catch { /* ignore */ }
  }
  return {
    mode: deriveIndexMode(),
    baseDir,
    reloadAlways: getBooleanEnv('INDEX_SERVER_ALWAYS_RELOAD'),
    memoize: getBooleanEnv('INDEX_SERVER_MEMOIZE'),
    memoizeDisabledExplicitly: memoizeRaw !== undefined ? isFalsy(memoizeRaw) : false,
    memoizeHash: getBooleanEnv('INDEX_SERVER_MEMOIZE_HASH'),
    normalizationLog,
    fileTrace: getBooleanEnv('INDEX_SERVER_FILE_TRACE'),
    eventSilent: getBooleanEnv('INDEX_SERVER_EVENT_SILENT'),
    readRetries: { attempts, backoffMs },
    usageFlushMs,
    disableUsageClamp: getBooleanEnv('INDEX_SERVER_DISABLE_USAGE_CLAMP'),
    govHash: {
      trailingNewline: getBooleanEnv('GOV_HASH_TRAILING_NEWLINE'),
      hashHardeningEnabled,
      hashCanonVariants,
      hashImportSetSize,
    },
    maxFiles,
    loadWarningThreshold,
    bodyWarnLength,
    bodyMaxLength,
    autoSplitOversized: getBooleanEnv('INDEX_SERVER_AUTO_SPLIT_OVERSIZED'),
    autoUsageTrack: parseBooleanEnv(process.env.INDEX_SERVER_AUTO_USAGE_TRACK, true),
  };
}


function parseInstructionsConfig(_mutationEnabled: boolean): InstructionsConfig {
  const auditLog = resolveInstructionsAuditLog();
  const workspaceId = process.env.INDEX_SERVER_WORKSPACE;
  const manifestWriteRaw = process.env.INDEX_SERVER_MANIFEST_WRITE;
  const manifestWriteEnabled = manifestWriteRaw === undefined ? true : !isFalsy(manifestWriteRaw);
  const forceFullList = getBooleanEnv('FULL_LIST_GET') || getBooleanEnv('INDEX_SERVER_STRESS_MODE');
  const sampleOverride = optionalIntFromEnv('LIST_GET_SAMPLE_SIZE');
  const effectiveSampleSize = sampleOverride;
  const sampleSeed = optionalIntFromEnv('LIST_GET_SAMPLE_SEED');
  const concurrency = clamp(optionalIntFromEnv('LIST_GET_CONCURRENCY') ?? 8, 1, 64);
  const maxDurationMs = Math.max(500, optionalIntFromEnv('LIST_GET_MAX_DURATION_MS') ?? 7000);
  return {
    workspaceId: workspaceId && workspaceId.trim().length ? workspaceId : undefined,
    agentId: process.env.INDEX_SERVER_AGENT_ID || undefined,
    canonicalDisable: getBooleanEnv('INDEX_SERVER_CANONICAL_DISABLE'),
    strictVisibility: getBooleanEnv('INDEX_SERVER_TEST_STRICT_VISIBILITY'),
    strictCreate: getBooleanEnv('INDEX_SERVER_STRICT_CREATE'),
    strictRemove: getBooleanEnv('INDEX_SERVER_STRICT_REMOVE'),
    requireCategory: getBooleanEnv('INDEX_SERVER_REQUIRE_CATEGORY'),
    traceQueryDiag: getBooleanEnv('INDEX_SERVER_TRACE_QUERY_DIAG'),
    manifest: {
      writeEnabled: manifestWriteEnabled,
      fastload: getBooleanEnv('INDEX_SERVER_MANIFEST_FASTLOAD'),
    },
    ciContext: {
      inCI: !!process.env.CI,
      githubActions: !!process.env.GITHUB_ACTIONS,
      tfBuild: !!process.env.TF_BUILD,
    },
    auditLog,
    listValidation: {
      forceFullScan: forceFullList,
      allowSampling: !forceFullList,
      effectiveSampleSize,
      sampleSeed,
      concurrency,
      maxDurationMs,
    },
  };
}


function parseMutationConfig(mutationEnabled: boolean): MutationConfig {
  // Auto-backup defaults to true when mutation is enabled (protects against accidental data loss).
  const autoBackupDefault = mutationEnabled;
  return {
    enabled: mutationEnabled,
    dispatcherTiming: getBooleanEnv('INDEX_SERVER_ADD_TIMING'),
    maxBulkDelete: numberFromEnv('INDEX_SERVER_MAX_BULK_DELETE', DEFAULT_LIMITS.MAX_BULK_DELETE),
    backupBeforeBulkDelete: process.env.INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE === undefined ? true : getBooleanEnv('INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE'),
    autoBackupEnabled: process.env.INDEX_SERVER_AUTO_BACKUP === undefined ? autoBackupDefault : getBooleanEnv('INDEX_SERVER_AUTO_BACKUP'),
    autoBackupIntervalMs: numberFromEnv('INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS', DEFAULT_TIMEOUTS_MS.AUTO_BACKUP_INTERVAL),
    autoBackupMaxCount: numberFromEnv('INDEX_SERVER_AUTO_BACKUP_MAX_COUNT', DEFAULT_LIMITS.AUTO_BACKUP_MAX_COUNT),
  };
}

/** Valid profile names supported by the wizard and runtime. */
export const VALID_PROFILES = ['default', 'enhanced', 'experimental'] as const;
export type ProfileName = typeof VALID_PROFILES[number];

/**
 * Apply profile-aware environment defaults.
 * Called early in loadRuntimeConfig, sets env vars only when not already set.
 * This ensures the wizard's profile choice flows through to all downstream parsers.
 */
function applyProfileDefaults(profile: ProfileName): void {
  const setDefault = (key: string, value: string) => {
    if (process.env[key] === undefined) process.env[key] = value;
  };

  // All profiles enable dashboard by default
  setDefault('INDEX_SERVER_DASHBOARD', '1');

  if (profile === 'enhanced') {
    setDefault('INDEX_SERVER_SEMANTIC_ENABLED', '1');
    setDefault('INDEX_SERVER_SEMANTIC_LOCAL_ONLY', '0');
    setDefault('INDEX_SERVER_LOG_FILE', '1');
    setDefault('INDEX_SERVER_DASHBOARD_TLS', '1');
    setDefault('INDEX_SERVER_METRICS_FILE_STORAGE', '1');
    setDefault('INDEX_SERVER_FEATURES', 'usage');
  } else if (profile === 'experimental') {
    setDefault('INDEX_SERVER_SEMANTIC_ENABLED', '1');
    setDefault('INDEX_SERVER_SEMANTIC_LOCAL_ONLY', '0');
    setDefault('INDEX_SERVER_LOG_FILE', '1');
    setDefault('INDEX_SERVER_DASHBOARD_TLS', '1');
    setDefault('INDEX_SERVER_METRICS_FILE_STORAGE', '1');
    setDefault('INDEX_SERVER_FEATURES', 'usage');
    setDefault('INDEX_SERVER_STORAGE_BACKEND', 'sqlite');
    setDefault('INDEX_SERVER_LOG_LEVEL', 'debug');
  }
}


/**
 * Parse all environment variables and construct a fresh {@link RuntimeConfig} object.
 * Prefer {@link getRuntimeConfig} for normal use — this function always re-parses.
 * @returns Fully resolved runtime configuration object
 */
export function loadRuntimeConfig(): RuntimeConfig {
  const rawProfile = (process.env.INDEX_SERVER_PROFILE || 'default').toLowerCase();
  const profile = (VALID_PROFILES as readonly string[]).includes(rawProfile) ? rawProfile as ProfileName : 'default';
  applyProfileDefaults(profile);
  const testMode = process.env.INDEX_SERVER_TEST_MODE;
  const rawTiming = parseTiming();
  const trace = parseTrace();
  const initFeatures = parseInitFeatures();
  const logLevel = parseLogLevel(trace);
  const mutationEnabled = parseMutation();
  const index = parseIndexConfig();
  const dashboard = parseDashboardConfig(mutationEnabled, index.baseDir);
  const server = parseServerConfig();
  const logging = parseLoggingConfig(logLevel);
  const metrics = parseMetricsConfig();
  const instructions = parseInstructionsConfig(mutationEnabled);
  const tracing = parseTracingConfig(trace, logLevel);
  const mutation = parseMutationConfig(mutationEnabled);
  const featureFlags = parseFeatureFlagsConfig();
  const feedback = parseFeedbackConfig();
  const messaging = parseMessagingConfig();
  const semantic = parseSemanticConfig();
  const minimal = parseMinimalConfig();
  const bootstrapSeed = parseBootstrapSeedConfig();
  const atomicFs = parseAtomicFsConfig();
  const preflight = parsePreflightConfig();
  const validation = parseValidationConfig();
  const dynamic = parseDynamicConfig();
  const graph = parseGraphConfig();
  const storage = parseStorageConfig();
  return {
    profile,
    testMode,
    index,
    mutationEnabled: mutation.enabled,
    logLevel,
    trace,
    initFeatures,
    bufferRing: parseBufferRing(),
    timing: (key: string, fallback?: number) => rawTiming[key] ?? fallback,
    rawTiming,
    coverage: parseCoverage(),
    dashboard,
    server,
    logging,
    metrics,
    instructions,
    tracing,
    mutation,
    featureFlags,
    feedback,
    messaging,
    semantic,
    minimal,
    bootstrapSeed,
    atomicFs,
    preflight,
    validation,
    dynamic,
    graph,
    storage,
  };
}

let _cached: RuntimeConfig | undefined;
/**
 * Return the cached singleton {@link RuntimeConfig}, loading it on first call.
 * @returns The application-wide runtime configuration
 */
export function getRuntimeConfig(): RuntimeConfig {
  if(!_cached) _cached = loadRuntimeConfig();
  return _cached;
}

/**
 * Force a reload of the runtime configuration by discarding the cache and re-parsing all env vars.
 * @returns The freshly loaded runtime configuration
 */
export function reloadRuntimeConfig(): RuntimeConfig {
  _cached = loadRuntimeConfig();
  return _cached;
}

if(require.main === module){
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(getRuntimeConfig(), null, 2));
}
