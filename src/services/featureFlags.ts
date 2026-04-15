// Simple feature flag loader: environment variables + optional JSON file.
// Precedence: explicit env var (INDEX_SERVER_FLAG_<UPPER>) > JSON file > default (false)
import fs from 'fs';
import path from 'path';
import { getRuntimeConfig, type RuntimeConfig } from '../config/runtimeConfig';

export type FeatureFlag = 'response_envelope_v1' | 'tools_extended' | 'tools_admin';

interface FlagConfig { [k: string]: boolean }

let cache: FlagConfig | null = null;
let lastFilePath: string | null = null;
let lastConfigIdentity: RuntimeConfig | null = null;

function ensureConfigSync(): RuntimeConfig {
  const cfg = getRuntimeConfig();
  if(lastConfigIdentity !== cfg){
    cache = null;
    lastFilePath = null;
    lastConfigIdentity = cfg;
  }
  return cfg;
}

function loadFile(): FlagConfig {
  const cfg = ensureConfigSync();
  const file = cfg.featureFlags.file || path.join(process.cwd(), 'flags.json');
  lastFilePath = file;
  if(!fs.existsSync(file)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(file,'utf8'));
    if(raw && typeof raw === 'object'){
      const out: FlagConfig = {};
      for(const [k,v] of Object.entries(raw)){
        if(typeof v === 'boolean') out[k] = v;
      }
      return out;
    }
  } catch { /* ignore */ }
  return {};
}

function load(): FlagConfig {
  const cfg = ensureConfigSync();
  if(cache) return cache;
  const base = loadFile();
  // Overlay env-derived namespace captured in runtime config
  for(const [flagName, rawValue] of Object.entries(cfg.featureFlags.envNamespace)){
    const v = String(rawValue).toLowerCase();
    if(['1','true','yes','on','enabled'].includes(v)) base[flagName] = true;
    else if(['0','false','no','off','disabled'].includes(v)) base[flagName] = false;
  }
  cache = base;
  return cache;
}

/**
 * Check whether a feature flag is currently enabled.
 * @param flag - Feature flag name to evaluate
 * @returns `true` if the flag is enabled, `false` otherwise
 */
export function flagEnabled(flag: FeatureFlag): boolean {
  const cfg = load();
  return !!cfg[flag];
}

/** Return a shallow copy of the current flag configuration map.
 * @returns Object mapping flag names to their boolean values
 */
export function dumpFlags(){ return { ...load() }; }

/**
 * Replace the in-memory flag cache and persist the new values to the flags file.
 * @param newFlags - Complete flag configuration to apply
 * @returns Shallow copy of the resulting flag configuration after the update
 */
export function updateFlags(newFlags: FlagConfig){
  cache = { ...newFlags };
  try {
    const cfg = ensureConfigSync();
    const file = lastFilePath || cfg.featureFlags.file || path.join(process.cwd(), 'flags.json');
    fs.writeFileSync(file, JSON.stringify(cache, null, 2));
  } catch { /* ignore write errors */ }
  return dumpFlags();
}
