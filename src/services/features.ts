// Feature flag & metrics infrastructure (Phase 0)
// INDEX_SERVER_FEATURES=usage,window,hotness,drift,risk

import { getRuntimeConfig } from '../config/runtimeConfig';

const BASE_FEATURES = Array.from(getRuntimeConfig().featureFlags.indexFeatures);
const SET = new Set(BASE_FEATURES);

export function hasFeature(name: string){ return SET.has(name); }

// Simple in-memory counters (could be exposed via metrics_snapshot already existing)
const counters: Record<string, number> = {};
export function incrementCounter(name: string, by=1){ counters[name] = (counters[name]||0)+by; }
export function getCounters(){ return { ...counters }; }

// Record activation counts once at module load
for(const f of SET){ incrementCounter(`featureActivated:${f}`); }

export function featureStatus(){
  return {
    features: Array.from(SET.values()).sort(),
    counters: getCounters(),
    env: BASE_FEATURES.length ? [...BASE_FEATURES] : [],
  };
}

// Canonical set of feature-flag names recognised by the server. Surfacing a
// dense boolean map (rather than a sparse list of active names) lets operators
// see at a glance which flags are off vs unknown — see #384 obs 1.
export const KNOWN_FEATURE_FLAGS = ['usage', 'window', 'hotness', 'drift', 'risk'] as const;

export type FeatureFlagMap = Record<(typeof KNOWN_FEATURE_FLAGS)[number], boolean>;

export function getFeatureFlagMap(): FeatureFlagMap {
  const map = {} as FeatureFlagMap;
  for (const flag of KNOWN_FEATURE_FLAGS) {
    map[flag] = SET.has(flag);
  }
  return map;
}

// Test helper / dynamic enable (used in tests to activate features post-initial load)
export function enableFeature(name: string){
  if(!SET.has(name)){
    SET.add(name);
    incrementCounter(`featureActivated:${name}`);
  }
}
