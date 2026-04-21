/**
 * Feature domain config: feature flags, feedback, messaging, semantic search,
 * minimal mode, bootstrap seed, validation, dynamic config, and graph settings.
 */
import path from 'path';
import { getBooleanEnv, parseBooleanEnv } from '../utils/envUtils';
import {
  CWD,
  toAbsolute,
  numberFromEnv,
  parseCsvEnv,
} from './configUtils';
import { DIR } from './dirConstants';
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

export function parseFeatureFlagsConfig(): FeatureFlagsConfig {
  const envNamespace: Record<string, string> = {};
  for(const [key, value] of Object.entries(process.env)){
    if(key.startsWith('INDEX_SERVER_FLAG_') && typeof value === 'string'){
      envNamespace[key.substring('INDEX_SERVER_FLAG_'.length).toLowerCase()] = value;
    }
  }
  return {
    file: toAbsolute(process.env.INDEX_SERVER_FLAGS_FILE, path.join(CWD, DIR.FLAGS)),
    envNamespace,
    indexFeatures: new Set(parseCsvEnv('INDEX_SERVER_FEATURES')),
  };
}

export function parseFeedbackConfig(): FeedbackConfig {
  return {
    dir: toAbsolute(process.env.INDEX_SERVER_FEEDBACK_DIR, path.join(CWD, DIR.FEEDBACK)),
    maxEntries: numberFromEnv('INDEX_SERVER_FEEDBACK_MAX_ENTRIES', DEFAULT_LIMITS.MAX_FEEDBACK_ENTRIES),
  };
}

export function parseMessagingConfig(): MessagingConfig {
  return {
    dir: toAbsolute(process.env.INDEX_SERVER_MESSAGING_DIR, path.join(CWD, DIR.DATA_MESSAGING)),
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
    cacheDir: toAbsolute(process.env.INDEX_SERVER_SEMANTIC_CACHE_DIR, path.join(CWD, DIR.DATA_MODELS)),
    embeddingPath: toAbsolute(process.env.INDEX_SERVER_EMBEDDING_PATH, path.join(CWD, DIR.DATA_EMBEDDINGS)),
    device,
    localOnly: getBooleanEnv('INDEX_SERVER_SEMANTIC_LOCAL_ONLY', true),
  };
}

export function parseMinimalConfig(): MinimalConfig {
  return {
    debugOrdering: getBooleanEnv('INDEX_SERVER_MINIMAL_DEBUG'),
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
}

export function parseStorageConfig(): StorageConfig {
  const raw = (process.env.INDEX_SERVER_STORAGE_BACKEND || 'json').toLowerCase();
  const backend = (raw === 'sqlite' ? 'sqlite' : 'json') as 'json' | 'sqlite';
  if (backend === 'sqlite') {
    console.warn('[config] ⚠️  EXPERIMENTAL: SQLite storage backend selected. Limited testing has been performed. Use at your own risk.');
  }
  return {
    backend,
    sqlitePath: toAbsolute(process.env.INDEX_SERVER_SQLITE_PATH, path.join(CWD, DIR.DATA_SQLITE)),
    sqliteWal: parseBooleanEnv(process.env.INDEX_SERVER_SQLITE_WAL, true),
    sqliteMigrateOnStart: parseBooleanEnv(process.env.INDEX_SERVER_SQLITE_MIGRATE_ON_START, true),
  };
}
