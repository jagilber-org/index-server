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
import { getInstructionEmbeddings } from './embeddingService';
import { logInfo, logWarn } from './logger';
import { getBooleanEnv } from '../utils/envUtils';

let lastTriggerAt = 0;

/** Whether auto-compute is enabled given current env / runtime config. */
export function autoEmbedEnabled(): boolean {
  const cfg = getRuntimeConfig();
  if (!cfg.semantic.enabled) return false;
  const raw = process.env.INDEX_SERVER_AUTO_EMBED_ON_IMPORT;
  // Default ON when semantic is enabled; explicit '0' / 'false' opts out.
  if (raw === undefined) return true;
  return getBooleanEnv('INDEX_SERVER_AUTO_EMBED_ON_IMPORT', true);
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
