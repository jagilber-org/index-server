/**
 * Server domain config: MCP server, bootstrap, transport, protocol, logging,
 * metrics, tracing, atomicFs, and preflight settings.
 */
import path from 'path';
import { getBooleanEnv, parseBooleanEnv } from '../utils/envUtils';
import { INSTANCE_MODES, type InstanceMode } from '../lib/instanceTopology';
import {
  CWD,
  LogLevel,
  toAbsolute,
  numberFromEnv,
  floatFromEnv,
  optionalNumberFromEnv,
  optionalIntFromEnv,
  parseCsvEnv,
} from './configUtils';
import { DIR } from './dirConstants';
import { DEFAULT_TIMEOUTS_MS, DEFAULT_THRESHOLDS, DEFAULT_LIMITS, DEFAULT_PORTS } from './defaultValues';

function isDevMode(): boolean {
  return process.env.NODE_ENV === 'development' || process.argv.some(a => a === '--watch' || a.includes('--watch'));
}

export type { LogLevel };

interface ServerBootstrapConfig {
  autoconfirm: boolean;
  tokenTtlSec: number;
  referenceMode: boolean;
}

interface ServerindexPollingConfig {
  enabled: boolean;
  proactive: boolean;
  intervalMs: number;
}

export interface ServerConfig {
  disableEarlyStdinBuffer: boolean;
  fatalExitDelayMs: number;
  idleKeepaliveMs: number;
  sharedSentinel?: string;
  bootstrap: ServerBootstrapConfig;
  indexPolling: ServerindexPollingConfig;
  multicoreTrace: boolean;
  /** Multi-instance mode: standalone (default), leader, follower, auto [EXPERIMENTAL] */
  instanceMode: InstanceMode;
  /** HTTP port for leader's MCP transport (thin clients connect here) */
  leaderPort: number;
  /** Leader heartbeat interval (ms) */
  heartbeatIntervalMs: number;
  /** Stale leader threshold (ms) — follower promotes after this */
  staleThresholdMs: number;
}

export interface LoggingConfig {
  level: LogLevel;
  verbose: boolean;
  json: boolean;
  sync: boolean;
  diagnostics: boolean;
  protocol: boolean;
  file?: string;
  rawFileValue?: string;
  sentinelRequested: boolean;
}

interface MetricsToolcallConfig {
  chunkSize: number;
  flushMs: number;
  compactMs: number;
  appendLogEnabled: boolean;
}

interface MetricsHealthConfig {
  memoryThreshold: number;
  errorRateThreshold: number;
  minUptimeMs: number;
}

export interface MetricsConfig {
  dir: string;
  resourceCapacity: number;
  sampleIntervalMs: number;
  toolcall: MetricsToolcallConfig;
  health: MetricsHealthConfig;
  fileStorage: boolean;
}

export interface AtomicFsConfig {
  retries: number;
  backoffMs: number;
}

export interface PreflightConfig {
  modules: string[];
  strict: boolean;
}

interface TracingBufferConfig {
  file?: string;
  sizeBytes: number;
  dumpOnExit: boolean;
}

export interface TracingConfig {
  level: LogLevel | 'verbose';
  categories: Set<string>;
  buffer: TracingBufferConfig;
  file?: string;
  persist: boolean;
  dir: string;
  fsync: boolean;
  maxFileSizeBytes: number;
  sessionId?: string;
  callsite: boolean;
}

export function parseServerConfig(): ServerConfig {
  const sharedSentinel = process.env.INDEX_SERVER_SHARED_SERVER_SENTINEL;
  const rawMode = (process.env.INDEX_SERVER_MODE || 'standalone').trim().toLowerCase();
  const instanceMode: InstanceMode = (INSTANCE_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as InstanceMode)
    : 'standalone';
  return {
    disableEarlyStdinBuffer: getBooleanEnv('INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER'),
    fatalExitDelayMs: numberFromEnv('INDEX_SERVER_FATAL_EXIT_DELAY_MS', DEFAULT_TIMEOUTS_MS.FATAL_EXIT_DELAY),
    idleKeepaliveMs: numberFromEnv('INDEX_SERVER_IDLE_KEEPALIVE_MS', DEFAULT_TIMEOUTS_MS.IDLE_KEEPALIVE),
    sharedSentinel: sharedSentinel && sharedSentinel.trim().length ? sharedSentinel : undefined,
    bootstrap: {
      autoconfirm: getBooleanEnv('INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM'),
      tokenTtlSec: numberFromEnv('INDEX_SERVER_BOOTSTRAP_TOKEN_TTL_SEC', DEFAULT_PORTS.BOOTSTRAP_TOKEN_TTL_SEC),
      referenceMode: getBooleanEnv('INDEX_SERVER_REFERENCE_MODE'),
    },
    indexPolling: {
      enabled: getBooleanEnv('INDEX_SERVER_ENABLE_INDEX_SERVER_POLLER'),
      proactive: getBooleanEnv('INDEX_SERVER_POLL_PROACTIVE'),
      intervalMs: numberFromEnv('INDEX_SERVER_POLL_MS', DEFAULT_TIMEOUTS_MS.POLL_INTERVAL),
    },
    multicoreTrace: getBooleanEnv('MULTICLIENT_TRACE'),
    instanceMode,
    leaderPort: numberFromEnv('INDEX_SERVER_LEADER_PORT', isDevMode() ? DEFAULT_PORTS.LEADER_DEV : DEFAULT_PORTS.LEADER),
    heartbeatIntervalMs: numberFromEnv('INDEX_SERVER_HEARTBEAT_MS', DEFAULT_TIMEOUTS_MS.HEARTBEAT),
    staleThresholdMs: numberFromEnv('INDEX_SERVER_STALE_THRESHOLD_MS', DEFAULT_TIMEOUTS_MS.STALE_THRESHOLD),
  };
}

function resolveLogFile(): { file?: string; raw?: string; sentinelRequested: boolean } {
  const raw = process.env.INDEX_SERVER_LOG_FILE;
  if(!raw) return { raw: undefined, sentinelRequested: false };
  const normalized = raw.trim().toLowerCase();
  const isSentinel = raw === '1' || ['true','yes','on'].includes(normalized);
  if(isSentinel){
    return {
      file: toAbsolute(path.join(DIR.LOGS_MCP_SERVER)),
      raw,
      sentinelRequested: true,
    };
  }
  return { file: toAbsolute(raw), raw, sentinelRequested: false };
}

export function parseLoggingConfig(level: LogLevel): LoggingConfig {
  const fileInfo = resolveLogFile();
  return {
    level,
    verbose: getBooleanEnv('INDEX_SERVER_VERBOSE_LOGGING') || getBooleanEnv('INDEX_SERVER_DEBUG'),
    json: getBooleanEnv('INDEX_SERVER_LOG_JSON'),
    sync: getBooleanEnv('INDEX_SERVER_LOG_SYNC'),
    diagnostics: getBooleanEnv('INDEX_SERVER_LOG_DIAG'),
    protocol: getBooleanEnv('INDEX_SERVER_LOG_PROTOCOL'),
    file: fileInfo.file,
    rawFileValue: fileInfo.raw,
    sentinelRequested: fileInfo.sentinelRequested,
  };
}

export function parseMetricsConfig(): MetricsConfig {
  return {
    dir: toAbsolute(process.env.INDEX_SERVER_METRICS_DIR, path.join(CWD, DIR.METRICS)),
    resourceCapacity: numberFromEnv('INDEX_SERVER_RESOURCE_CAPACITY', DEFAULT_THRESHOLDS.RESOURCE_CAPACITY),
    sampleIntervalMs: numberFromEnv('INDEX_SERVER_RESOURCE_SAMPLE_INTERVAL_MS', DEFAULT_THRESHOLDS.RESOURCE_SAMPLE_INTERVAL_MS),
    toolcall: {
      chunkSize: numberFromEnv('INDEX_SERVER_TOOLCALL_CHUNK_SIZE', DEFAULT_LIMITS.TOOLCALL_CHUNK_SIZE),
      flushMs: numberFromEnv('INDEX_SERVER_TOOLCALL_FLUSH_MS', DEFAULT_TIMEOUTS_MS.TOOLCALL_FLUSH),
      compactMs: numberFromEnv('INDEX_SERVER_TOOLCALL_COMPACT_MS', DEFAULT_TIMEOUTS_MS.TOOLCALL_COMPACT),
      appendLogEnabled: getBooleanEnv('INDEX_SERVER_TOOLCALL_APPEND_LOG'),
    },
    health: {
      memoryThreshold: floatFromEnv('INDEX_SERVER_HEALTH_MEMORY_THRESHOLD', DEFAULT_THRESHOLDS.MEMORY_THRESHOLD),
      errorRateThreshold: floatFromEnv('INDEX_SERVER_HEALTH_ERROR_THRESHOLD', DEFAULT_THRESHOLDS.ERROR_RATE_THRESHOLD),
      minUptimeMs: numberFromEnv('INDEX_SERVER_HEALTH_MIN_UPTIME', DEFAULT_TIMEOUTS_MS.HEALTH_MIN_UPTIME),
    },
    fileStorage: getBooleanEnv('INDEX_SERVER_METRICS_FILE_STORAGE'),
  };
}

export function parseAtomicFsConfig(): AtomicFsConfig {
  return {
    retries: numberFromEnv('INDEX_SERVER_ATOMIC_WRITE_RETRIES', DEFAULT_LIMITS.ATOMIC_WRITE_RETRIES),
    backoffMs: numberFromEnv('INDEX_SERVER_ATOMIC_WRITE_BACKOFF_MS', DEFAULT_LIMITS.ATOMIC_WRITE_BACKOFF_MS),
  };
}

export function parsePreflightConfig(): PreflightConfig {
  const modules = parseCsvEnv('INDEX_SERVER_PREFLIGHT_MODULES');
  return {
    modules: modules.length ? modules : ['mime-db','ajv','ajv-formats'],
    strict: getBooleanEnv('INDEX_SERVER_PREFLIGHT_STRICT'),
  };
}

function resolveTraceLevel(traceSet: Set<string>, fallbackLevel: LogLevel): LogLevel | 'verbose' {
  const raw = process.env.INDEX_SERVER_TRACE_LEVEL?.toLowerCase();
  switch(raw){
    case 'verbose': return 'verbose';
    case 'trace':
    case 'files':
    case 'perf':
      return 'trace';
    case 'debug':
    case 'core':
      return 'debug';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    default:
      if(traceSet.has('verbose')) return 'verbose';
      if(traceSet.size > 0) return 'trace';
      return fallbackLevel;
  }
}

function resolveTracingBuffer(): TracingBufferConfig {
  const rawFile = process.env.INDEX_SERVER_TRACE_BUFFER_FILE;
  const trimmed = rawFile?.trim();
  const file = trimmed && trimmed.length ? toAbsolute(trimmed) : undefined;
  const sizeBytes = optionalNumberFromEnv('INDEX_SERVER_TRACE_BUFFER_SIZE') ?? 0;
  const dumpOnExit = getBooleanEnv('INDEX_SERVER_TRACE_BUFFER_DUMP_ON_EXIT');
  return { file, sizeBytes, dumpOnExit };
}

export function parseTracingConfig(traceSet: Set<string>, fallbackLevel: LogLevel): TracingConfig {
  const categories = new Set(parseCsvEnv('INDEX_SERVER_TRACE_CATEGORIES'));
  const buffer = resolveTracingBuffer();
  const filePath = (() => {
    const raw = process.env.INDEX_SERVER_TRACE_FILE;
    if(!raw) return undefined;
    const trimmed = raw.trim();
    return trimmed.length ? toAbsolute(trimmed) : undefined;
  })();
  return {
    level: resolveTraceLevel(traceSet, fallbackLevel),
    categories,
    buffer,
    file: filePath,
    persist: parseBooleanEnv(process.env.INDEX_SERVER_TRACE_PERSIST, !!filePath),
    dir: toAbsolute(process.env.INDEX_SERVER_TRACE_DIR, path.join(CWD, DIR.LOGS_TRACE)),
    fsync: getBooleanEnv('INDEX_SERVER_TRACE_FSYNC'),
    maxFileSizeBytes: optionalIntFromEnv('INDEX_SERVER_TRACE_MAX_FILE_SIZE') ?? 0,
    sessionId: process.env.INDEX_SERVER_TRACE_SESSION || undefined,
    callsite: getBooleanEnv('INDEX_SERVER_TRACE_CALLSITE'),
  };
}
