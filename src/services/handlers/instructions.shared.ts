// Shared utilities used across instruction handler submodules.
import { InstructionEntry } from '../../models/instruction';
import { ensureLoaded } from '../indexContext';
import { getRuntimeConfig } from '../../config/runtimeConfig';
import { emitTrace, traceEnabled } from '../tracing';

export function isMutationEnabled() {
  return getRuntimeConfig().mutation.enabled;
}

export function isCI(): boolean {
  const ctx = getRuntimeConfig().instructions.ciContext;
  return ctx.inCI || ctx.githubActions || ctx.tfBuild;
}

export function limitResponseSize<T extends Record<string, unknown>>(response: T): T {
  if (!isCI()) return response;

  const responseStr = JSON.stringify(response);
  if (responseStr.length <= 60000) return response;

  if ('items' in response && Array.isArray(response.items) && response.items.length > 3) {
    return {
      ...response,
      items: response.items.slice(0, 3),
      ciLimited: true,
      originalCount: response.items.length,
      message: 'Response limited in CI environment to prevent truncation'
    };
  }

  return response;
}

export interface ImportEntry {
  id: string; title: string; body: string; rationale?: string; priority: number;
  audience: InstructionEntry['audience']; requirement: InstructionEntry['requirement'];
  categories?: unknown[]; deprecatedBy?: string; riskScore?: number;
  version?: string; owner?: string; status?: InstructionEntry['status'];
  priorityTier?: InstructionEntry['priorityTier']; classification?: InstructionEntry['classification'];
  lastReviewedAt?: string; nextReviewDue?: string; changeLog?: InstructionEntry['changeLog'];
  semanticSummary?: string; contentType?: InstructionEntry['contentType'];
  extensions?: InstructionEntry['extensions']
}

export function guard<TParams, TResult>(name: string, fn: (p: TParams) => TResult) {
  return (p: TParams) => {
    const viaDispatcher = !!(p && typeof p === 'object' && (p as unknown as { _viaDispatcher?: boolean })._viaDispatcher);
    if (!isMutationEnabled() && !viaDispatcher) {
      throw { code: -32601, message: `Direct mutation calls are disabled by the current runtime override. Use index_dispatch with an action parameter instead of direct ${name} calls, or remove INDEX_SERVER_MUTATION=0 to re-enable direct calls.`, data: { method: name, alternative: 'index_dispatch', reason: 'mutation_disabled' } };
    }
    return fn(p);
  };
}

export function traceVisibility() { return traceEnabled(1); }

export function traceInstructionVisibility(id: string, phase: string, extra?: Record<string, unknown>) {
  if (!traceVisibility()) return;
  try {
    const st = ensureLoaded();
    const indexItem = st.byId.get(id) as Partial<InstructionEntry> | undefined;
    emitTrace('[trace:visibility]', {
      phase,
      id,
      now: new Date().toISOString(),
      indexHas: !!indexItem,
      indexSourceHash: indexItem?.sourceHash,
      indexUpdatedAt: indexItem?.updatedAt,
      serverHash: st.hash,
      listCount: st.list.length,
      sampleIds: st.list.slice(0, 3).map(e => e.id),
      ...extra
    });
  } catch { /* swallow tracing issues */ }
}

export function traceEnvSnapshot(phase: string, extra?: Record<string, unknown>) {
  if (!traceVisibility()) return;
  try {
    const cfg = getRuntimeConfig();
    const instructionsCfg = cfg.instructions;
    const indexCfg = cfg.index;
    emitTrace('[trace:env]', {
      phase,
      pid: process.pid,
      flags: {
        mutationEnabled: cfg.mutation.enabled,
        strictCreate: instructionsCfg.strictCreate,
        canonicalDisable: instructionsCfg.canonicalDisable,
        readRetries: indexCfg.readRetries.attempts,
        readBackoffMs: indexCfg.readRetries.backoffMs,
        requireCategory: instructionsCfg.requireCategory,
        instructionsDir: indexCfg.baseDir
      },
      ...extra
    });
  } catch { /* ignore env tracing errors */ }
}

export {};
