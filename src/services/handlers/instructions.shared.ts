// Shared utilities used across instruction handler submodules.
import crypto from 'crypto';
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

// ── Shared category normalization (#135) ──────────────────────────
// Extracted from groom handler to eliminate duplication across groom/normalize/repair.

/** Returns true if the category string is considered junk (numeric prefix, single char, case-ticket ID). */
export function isJunkCategory(cat: string): boolean {
  return /^\d/.test(cat) || cat.length <= 1 || /^case-\d{6,}$/.test(cat);
}

/** Normalize a categories array: deduplicate, lowercase, remove junk, remove plural duplicates, sort. */
export function normalizeCategories(cats: unknown[]): string[] {
  let normCats = Array.from(new Set(
    (cats || []).filter(c => typeof c === 'string').map(c => (c as string).toLowerCase())
  ));
  normCats = normCats.filter(c => !isJunkCategory(c));
  normCats = normCats.filter(cat => !(cat.endsWith('s') && normCats.includes(cat.slice(0, -1))));
  return normCats.sort();
}

// ── Shared source hash computation (#135) ─────────────────────────
/** Compute SHA-256 hash of an instruction body. */
export function computeSourceHash(body: string): string {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

// ── Shared version bump logic (#135) ──────────────────────────────
/** Bump a semver version string. Returns the new version string. */
export function bumpVersion(currentVersion: string | undefined, bump: 'patch' | 'minor' | 'major'): string {
  const parts = (currentVersion || '1.0.0').split('.').map(n => parseInt(n || '0', 10));
  while (parts.length < 3) parts.push(0);
  if (bump === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (bump === 'minor') { parts[1]++; parts[2] = 0; }
  else if (bump === 'patch') { parts[2]++; }
  return parts.join('.');
}

// ── Shared changelog entry creation (#135) ────────────────────────
/** Create a changelog entry object for an instruction version change. */
export function createChangeLogEntry(version: string, summary: string): { version: string; changedAt: string; summary: string } {
  return { version, changedAt: new Date().toISOString(), summary };
}

// ── Shared input-side category normalization (#135) ──────────────
/**
 * Normalize categories supplied as input to add/import handlers:
 * filter to non-empty strings, lowercase, deduplicate, and sort.
 *
 * Distinct from {@link normalizeCategories} (used by groom), which also
 * strips junk patterns and plural duplicates.
 */
export function normalizeInputCategories(cats: unknown): string[] {
  const arr = Array.isArray(cats) ? cats : [];
  return Array.from(new Set(
    arr
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map(c => c.toLowerCase())
  )).sort();
}

// ── Shared changelog repair (#135) ────────────────────────────────
type ChangeLogArr = NonNullable<InstructionEntry['changeLog']>;

export interface RepairChangeLogOptions {
  /** Final/expected version that the last entry must end with. */
  finalVersion: string;
  /** ISO timestamp to use as `now`. */
  now: string;
  /** Fallback entry pushed when the supplied changeLog is empty/invalid. */
  fallback: { version: string; changedAt: string; summary: string };
  /** Summary to use when appending a trailing entry to reach finalVersion. */
  trailingSummary: string;
}

/**
 * Repair a changelog array: drop malformed entries, ensure non-empty,
 * and ensure the last entry's version matches `finalVersion`.
 *
 * Used by the overwrite/merge and new-entry paths in `index_add` plus any
 * other handler that needs to normalize a user-supplied changeLog.
 */
export function repairChangeLog(cl: unknown, options: RepairChangeLogOptions): ChangeLogArr {
  interface CLRaw { version?: unknown; changedAt?: unknown; summary?: unknown }
  const out: ChangeLogArr = [];
  if (Array.isArray(cl)) {
    for (const entry of cl) {
      if (!entry || typeof entry !== 'object') continue;
      const { version: v, changedAt: ca, summary: sum } = entry as CLRaw;
      if (typeof v === 'string' && v.trim() && typeof sum === 'string' && sum.trim()) {
        const caIso = typeof ca === 'string' && /T/.test(ca) ? ca : options.now;
        out.push({ version: v.trim(), changedAt: caIso, summary: sum.trim() });
      }
    }
  }
  if (!out.length) {
    out.push({ ...options.fallback });
  }
  const lastVer = out[out.length - 1].version;
  if (lastVer !== options.finalVersion) {
    out.push({ version: options.finalVersion, changedAt: options.now, summary: options.trailingSummary });
  }
  return out;
}

// ── Shared governance key merge (#135) ────────────────────────────
/** Governance keys merged from input into the entry by `index_add`. */
export const ADD_GOVERNANCE_KEYS: readonly (keyof ImportEntry)[] = [
  'version', 'owner', 'status', 'priorityTier', 'classification',
  'lastReviewedAt', 'nextReviewDue', 'semanticSummary', 'contentType', 'extensions'
] as const;

/** Governance keys merged from input into the entry by `index_import`.
 * Differs from {@link ADD_GOVERNANCE_KEYS} by also including `changeLog`,
 * since import accepts changeLog directly without invoking repair logic.
 */
export const IMPORT_GOVERNANCE_KEYS: readonly (keyof ImportEntry)[] = [
  'version', 'owner', 'status', 'priorityTier', 'classification',
  'lastReviewedAt', 'nextReviewDue', 'changeLog', 'semanticSummary',
  'contentType', 'extensions'
] as const;

/** Copy defined governance fields from `source` into `target` for the given keys. */
export function applyGovernanceKeys(
  target: InstructionEntry,
  source: ImportEntry,
  keys: readonly (keyof ImportEntry)[]
): void {
  const t = target as unknown as Record<string, unknown>;
  for (const k of keys) {
    const v = source[k];
    if (v !== undefined) {
      t[k as string] = v as unknown;
    }
  }
}

export {};
