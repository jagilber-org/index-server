/**
 * Embedding Service for Semantic Search
 *
 * Lazy-loaded embedding model — zero startup cost.
 * Model is loaded only on first embedText() call via dynamic import.
 * Vectors cached to disk for cross-instance sharing.
 *
 * Key design:
 * - cosineSimilarity, isStale, load/saveCachedEmbeddings are pure functions (no model needed)
 * - embedText and getInstructionEmbeddings trigger lazy model load
 * - Uses @huggingface/transformers (optional dep) via dynamic ESM import
 */

import fs from 'fs';
import path from 'path';
import { logInfo, logWarn } from './logger';
import { InstructionEntry } from '../models/instruction';
import type { EmbeddingCacheData, IEmbeddingStore } from './storage/types';

// Re-export for backwards compatibility
export type { EmbeddingCacheData } from './storage/types';

// Lazy model state — never loaded at import time
let pipeline: unknown = null;
let extractor: unknown = null;
let modelLoading: Promise<void> | null = null;

// Concurrency lock for index embedding computation — prevents N concurrent cache-miss
// requests from each independently computing embeddings for all index entries.
let indexEmbeddingComputing: Promise<Record<string, Float32Array>> | null = null;

/**
 * Cosine similarity between two vectors.
 * Pure math — no dependencies, no model needed.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Check if cached embeddings are stale (index has changed since last embed).
 */
export function isStale(indexHash: string, embeddingHash: string): boolean {
  return indexHash !== embeddingHash;
}

/**
 * Load cached embeddings from disk.
 * Returns null if file doesn't exist or is invalid.
 */
export function loadCachedEmbeddings(filePath: string): EmbeddingCacheData | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    // Backwards-compat: older caches used 'catalogHash' instead of 'indexHash'
    if (data && typeof data.catalogHash === 'string' && typeof data.indexHash !== 'string') {
      data.indexHash = data.catalogHash;
      delete data.catalogHash;
    }
    if (!data || typeof data.indexHash !== 'string' || typeof data.embeddings !== 'object') return null;
    return data as EmbeddingCacheData;
  } catch {
    return null;
  }
}

/**
 * Save embeddings to disk for cross-instance sharing.
 */
export function saveCachedEmbeddings(filePath: string, data: EmbeddingCacheData): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8'); // lgtm[js/http-to-file-access] — filePath is config-controlled embedding cache path
}

// Helper: dynamic ESM import (same pattern as sdkServer.ts)
const dynamicImport = (specifier: string) => (Function('m', 'return import(m);'))(specifier);

/**
 * Lazily initialize the embedding model.
 * Only called on first semantic search request — never at import/startup time.
 *
 * @param device - 'cpu' (default WASM), 'cuda' (NVIDIA GPU), 'dml' (DirectML/Windows GPU)
 * @param localOnly - When true, disables remote model downloads (model must already be cached)
 */
async function ensureModel(modelName: string, cacheDir: string, device: string = 'cpu', localOnly: boolean = false): Promise<void> {
  if (extractor) {
    logInfo('[embeddingService] Embedding model already loaded, skipping init');
    return;
  }
  if (modelLoading) {
    logInfo('[embeddingService] Embedding model load in progress, waiting...');
    await modelLoading;
    return;
  }
  modelLoading = (async () => {
    try {
      // Validate requested device against available ONNX Runtime providers
      const resolvedDevice = await resolveDevice(device);
      logInfo(`[embeddingService] Loading embedding model: ${modelName} (device=${resolvedDevice}, localOnly=${localOnly})`);
      const transformers = await dynamicImport('@huggingface/transformers');

      // Apply localOnly setting — block remote downloads when set
      if (localOnly && transformers.env) {
        transformers.env.allowRemoteModels = false;
      }

      pipeline = transformers.pipeline;
      const pipelineOpts: Record<string, unknown> = {
        cache_dir: cacheDir,
        quantized: true,
      };
      // Set device: 'cpu' uses default WASM; 'cuda'/'dml' use GPU execution providers
      if (resolvedDevice !== 'cpu') {
        pipelineOpts.device = resolvedDevice;
      }
      extractor = await (pipeline as CallableFunction)('feature-extraction', modelName, pipelineOpts);
      logInfo(`[embeddingService] Embedding model loaded successfully (device=${resolvedDevice})`);
    } catch (err) {
      modelLoading = null;
      throw err;
    }
  })();
  await modelLoading;
}

/**
 * Check available ONNX Runtime execution providers and resolve the best device.
 * Falls back to dml → cpu if the requested provider is not available.
 *
 * @returns The resolved device string ('cpu', 'cuda', or 'dml').
 */
/** ORT module shape accepted by resolveDevice for testability. */
export interface OrtModule {
  listSupportedBackends?: () => Array<{ name: string; bundled: boolean }>;
}

export async function resolveDevice(requested: string, ortModule?: OrtModule): Promise<string> {
  if (requested === 'cpu') return 'cpu';
  try {
    const ort: OrtModule = ortModule ?? await dynamicImport('onnxruntime-node');
    if (typeof ort.listSupportedBackends === 'function') {
      const backends: Array<{ name: string; bundled: boolean }> = ort.listSupportedBackends();
      const available = backends.map((b: { name: string }) => b.name);
      logInfo(`[embeddingService] ONNX Runtime backends available: [${available.join(', ')}]`);
      if (available.includes(requested)) return requested;
      // Requested provider not available — try fallback chain
      if (requested === 'cuda' && available.includes('dml')) {
        logWarn(`[embeddingService] CUDA provider not available (onnxruntime-node does not bundle CUDA). Falling back to DML.`);
        logWarn(`[embeddingService] To enable CUDA: install CUDA Toolkit + cuDNN, then copy onnxruntime_providers_cuda.dll into node_modules/onnxruntime-node/bin/`);
        return 'dml';
      }
      logWarn(`[embeddingService] ${requested} provider not available. Available: [${available.join(', ')}]. Falling back to cpu.`);
      return 'cpu';
    } else {
      logWarn(`[embeddingService] onnxruntime-node does not expose listSupportedBackends(). Falling back to cpu.`);
      return 'cpu';
    }
  } catch {
    logWarn(`[embeddingService] Could not probe ONNX Runtime backends (onnxruntime-node not installed or import failed). Falling back to cpu.`);
  }
  return 'cpu';
}

/**
 * Embed a single text string into a vector.
 * Triggers lazy model loading on first call.
 */
export async function embedText(text: string, modelName: string, cacheDir: string, device: string = 'cpu', localOnly: boolean = false): Promise<Float32Array> {
  const start = performance.now();
  await ensureModel(modelName, cacheDir, device, localOnly);
  const output = await (extractor as CallableFunction)(text, { pooling: 'mean', normalize: true });
  const vec = new Float32Array(output.data);
  logInfo(`[embeddingService] embedText completed in ${(performance.now() - start).toFixed(1)}ms (${text.substring(0, 60)}${text.length > 60 ? '...' : ''})`);
  return vec;
}

/**
 * Check if the embedding model is ready for use.
 * When localOnly is true, verifies model files exist in the cache directory.
 *
 * @returns Object with `ready` flag and optional remediation `message`.
 */
export function checkModelReadiness(
  modelName: string,
  cacheDir: string,
  localOnly: boolean,
): { ready: boolean; cached: boolean; modelPath: string; message?: string } {
  // HuggingFace transformers caches models as: models--<org>--<name>
  const modelDirName = `models--${modelName.replace(/\//g, '--')}`;
  const modelPath = path.join(cacheDir, modelDirName);

  let cached = false;
  try {
    if (fs.existsSync(modelPath) && fs.readdirSync(modelPath).length > 0) {
      cached = true;
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  if (cached) {
    return { ready: true, cached: true, modelPath };
  }

  if (!localOnly) {
    return {
      ready: true,
      cached: false,
      modelPath,
      message:
        `Embedding model '${modelName}' is not yet cached. ` +
        `It will be downloaded to '${cacheDir}' on first compute (~25 MB).`,
    };
  }

  return {
    ready: false,
    cached: false,
    modelPath,
    message:
      `Embedding model '${modelName}' not found in cache (${cacheDir}). ` +
      `LOCAL_ONLY is enabled, so the model cannot be downloaded automatically. ` +
      `To fix: set INDEX_SERVER_SEMANTIC_LOCAL_ONLY=0 to allow download, ` +
      `or manually place the model in the cache directory.`,
  };
}

/** Signature for the embed function (injectable for testing). */
export type EmbedFn = (text: string, modelName: string, cacheDir: string, device: string, localOnly: boolean) => Promise<Float32Array>;

/**
 * Get or compute embeddings for all index instructions.
 * Uses disk cache when available and fresh.
 *
 * Incremental update: when the index hash changes (instructions added/modified),
 * only entries whose sourceHash differs from the cached value are recomputed.
 * This reduces cold-recompute from O(all entries) to O(delta entries).
 *
 * Concurrency lock: concurrent cache-miss requests share a single in-flight computation
 * rather than each independently recomputing the full index.
 *
 * @param embedFn - Injectable embed function (defaults to module embedText; override in tests).
 */
export async function getInstructionEmbeddings(
  instructions: InstructionEntry[],
  indexHash: string,
  embeddingPath: string,
  modelName: string,
  cacheDir: string,
  device: string = 'cpu',
  localOnly: boolean = false,
  embedFn: EmbedFn = embedText,
  store?: IEmbeddingStore,
): Promise<Record<string, Float32Array>> {
  // Full cache hit: same index hash and model — return immediately without locking.
  const cached = store ? store.load() : loadCachedEmbeddings(embeddingPath);
  if (cached && !isStale(indexHash, cached.indexHash) && cached.modelName === modelName) {
    const entryCount = Object.keys(cached.embeddings).length;
    logInfo(`[embeddingService] Embedding cache HIT: ${entryCount} entries from ${embeddingPath} (model=${modelName})`);
    const result: Record<string, Float32Array> = {};
    for (const [id, vec] of Object.entries(cached.embeddings)) {
      result[id] = new Float32Array(vec);
    }
    return result;
  }

  // Concurrency lock: if another call is already computing, wait for it.
  if (indexEmbeddingComputing) {
    logInfo('[embeddingService] Embedding computation already in progress, waiting...');
    return await indexEmbeddingComputing;
  }

  // Model changed -> cannot reuse any cached entries.
  const modelChanged = !!cached && cached.modelName !== modelName;
  const existingEmbeddings: Record<string, number[]> = (!modelChanged && cached?.embeddings) ? cached.embeddings : {};
  const existingHashes: Record<string, string> = (!modelChanged && cached?.entryHashes) ? cached.entryHashes : {};

  // Determine which entries need (re)computation.
  const currentIds = new Set(instructions.map(i => i.id));
  const toCompute = instructions.filter(inst => {
    const cachedHash = existingHashes[inst.id];
    return !cachedHash || cachedHash !== inst.sourceHash || !existingEmbeddings[inst.id];
  });
  const reuseCount = instructions.length - toCompute.length;

  const missReason = !cached ? 'no cache'
    : modelChanged ? `model changed (${cached.modelName} -> ${modelName})`
    : toCompute.length === instructions.length ? 'index stale (no hashes to reuse)'
    : `incremental (${toCompute.length} new/changed, ${reuseCount} reused)`;
  logInfo(`[embeddingService] Embedding cache MISS (${missReason}). Computing embeddings for ${toCompute.length}/${instructions.length} instructions`);

  indexEmbeddingComputing = (async (): Promise<Record<string, Float32Array>> => {
    try {
      const embeddings: Record<string, number[]> = { ...existingEmbeddings };
      const entryHashes: Record<string, string> = { ...existingHashes };

      for (const inst of toCompute) {
        const text = `${inst.title} ${inst.semanticSummary || inst.body}`;
        embeddings[inst.id] = Array.from(await embedFn(text, modelName, cacheDir, device, localOnly)); // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
        if (inst.sourceHash) entryHashes[inst.id] = inst.sourceHash; // lgtm[js/remote-property-injection] — id is schema-validated before reaching index
      }

      // Prune deleted instructions from cache.
      for (const id of Object.keys(embeddings)) {
        if (!currentIds.has(id)) {
          delete embeddings[id];
          delete entryHashes[id];
        }
      }

      // Persist updated cache.
      try {
        const cacheData: EmbeddingCacheData = { indexHash, modelName, entryHashes, embeddings };
        if (store) {
          store.save(cacheData);
        } else {
          saveCachedEmbeddings(embeddingPath, cacheData);
        }
        logInfo('[embeddingService] Embeddings cached to disk');
      } catch (err) {
        logWarn(`[embeddingService] Failed to cache embeddings: ${err instanceof Error ? err.message : 'unknown'}`);
      }

      // Return as Float32Arrays.
      const result: Record<string, Float32Array> = {};
      for (const [id, vec] of Object.entries(embeddings)) {
        result[id] = new Float32Array(vec);
      }
      return result;
    } finally {
      indexEmbeddingComputing = null;
    }
  })();

  return await indexEmbeddingComputing;
}
