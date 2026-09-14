/**
 * Auto-compute embeddings after operations that mutate the loaded instruction set
 * (zip import, restore, bulk migrations).
 *
 * Behaviour:
 *  - No-op when semantic is disabled (`INDEX_SERVER_SEMANTIC_ENABLED` falsy).
 *  - No-op when explicitly opted out via `INDEX_SERVER_AUTO_EMBED_ON_IMPORT=0`.
 *  - Runs asynchronously (fire-and-forget) so the caller's request returns promptly.
 *  - Coalesces concurrent triggers via the existing in-flight lock inside
 *    `getInstructionEmbeddings`.
 *
 * Logs success / failure at INFO / WARN so events surface in the events panel
 * (constitution OB-3, OB-5).
 */

import { getRuntimeConfig } from '../config/runtimeConfig';
import { ensureLoaded, getIndexState } from './indexContext';
import { getEmbeddingStore } from './storage/factory.js';
import { getInstructionEmbeddings } from './embeddingService';
import { logInfo, logWarn } from './logger';

let lastTriggerAt = 0;

/** Whether auto-compute is enabled given current env / runtime config. */
export function autoEmbedEnabled(): boolean {
  const cfg = getRuntimeConfig();
  if (!cfg.semantic.enabled) return false;
  // Default ON when semantic is enabled; explicit '0' / 'false' opts out.
  // Parsed centrally via runtimeConfig (S-4): semantic.autoEmbedOnImport.
  return cfg.semantic.autoEmbedOnImport;
}

/**
 * Trigger an embedding compute pass after an import / restore.
 *
 * @param reason - Free-form context (e.g. `import-zip`, `restore`) used in logs.
 * @returns Promise resolving when compute finishes (or immediately if skipped).
 */
export async function triggerEmbeddingComputeAfterImport(reason: string): Promise<{ triggered: boolean; reason?: string; entries?: number; ms?: number }> {
  if (!autoEmbedEnabled()) {
    return { triggered: false, reason: 'auto-embed disabled or semantic disabled' };
  }
  // Light debounce — coalesce rapid back-to-back imports.
  const now = Date.now();
  if (now - lastTriggerAt < 1000) {
    return { triggered: false, reason: 'debounced' };
  }
  lastTriggerAt = now;

  const cfg = getRuntimeConfig();
  const sem = cfg.semantic;
  const start = Date.now();
  try {
    ensureLoaded();
    const state = getIndexState();
    if (!state.list || state.list.length === 0) {
      logInfo(`[embedding-trigger] Skipped (no instructions loaded) reason=${reason}`);
      return { triggered: false, reason: 'no instructions loaded' };
    }
    logInfo(`[embedding-trigger] Starting auto-compute reason=${reason} entries=${state.list.length}`);
    await getInstructionEmbeddings(
      state.list,
      state.hash,
      sem.embeddingPath,
      sem.model,
      sem.cacheDir,
      sem.device,
      sem.localOnly,
      undefined,
      // Issue #572: this is the ONLY automatic regeneration path. Omitting the
      // store here made every auto-recompute write embeddings.json even under
      // INDEX_SERVER_STORAGE_BACKEND=sqlite, so embeddings.db went stale the
      // moment someone stopped clicking the dashboard's Compute button.
      getEmbeddingStore(),
    );
    const ms = Date.now() - start;
    logInfo(`[embedding-trigger] Auto-compute complete reason=${reason} entries=${state.list.length} ms=${ms}`);
    return { triggered: true, entries: state.list.length, ms };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Use WARN (not ERROR) so we don't escalate transient model-load issues to ERROR-level paging.
    logWarn(`[embedding-trigger] Auto-compute failed reason=${reason}: ${msg}`);
    return { triggered: false, reason: `failed: ${msg}` };
  }
}

/**
 * Fire-and-forget variant — schedules the compute on the next tick and returns immediately.
 * Use this from request handlers so HTTP responses are not blocked on model warm-up.
 */
export function scheduleEmbeddingComputeAfterImport(reason: string): void {
  if (!autoEmbedEnabled()) return;
  setImmediate(() => {
    triggerEmbeddingComputeAfterImport(reason).catch(() => { /* already logged */ });
  });
}
