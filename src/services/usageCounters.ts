// Usage counter classification + derivation helpers (issue #418).
//
// Single source of truth for translating a usage_track action/signal pair into
// the counter that should be advanced. Extracted from indexContext.ts so the
// classification rules live in one cohesive, independently testable unit
// (constitution CQ-2 single responsibility).
//
// Counter model:
//   retrievedCount — instruction surfaced to a caller (search/get/query/export/list).
//   appliedCount   — instruction explicitly used / cited by a caller.
//   usageCount     — DERIVED total = retrievedCount + appliedCount (kept for one
//                    minor version for backwards compatibility; deprecated).

export type UsageKind = 'retrieved' | 'applied' | 'none';

// Canonical usage action/signal enums live in protocolEnums.ts (single source
// of truth, drift-guarded by contentTypeSourceOfTruth.spec.ts). Import the
// tuples and classify them here; this module is the decision-branch consumer
// that maps a usage_track action/signal onto the counter to advance.
import { USAGE_ACTIONS, USAGE_SIGNALS, type UsageAction, type UsageSignal } from './protocolEnums.js';

// The canonical retrieval marker (first usage action) and applied signal. Both
// are referenced symbolically below so the literal set stays in protocolEnums.
const RETRIEVAL_ACTION: UsageAction = 'retrieved';
const APPLIED_SIGNAL: UsageSignal = 'applied';

// Usage actions that represent an explicit application / citation: every
// canonical usage action other than the retrieval marker.
const APPLIED_ACTIONS = new Set<string>(USAGE_ACTIONS.filter(a => a !== RETRIEVAL_ACTION));

// Feedback signals that are pure quality signals and must NOT advance a counter:
// every canonical usage signal except the applied marker.
const NO_INCREMENT_SIGNALS = new Set<string>(USAGE_SIGNALS.filter(s => s !== APPLIED_SIGNAL));

// Dispatch action names (NOT usage-protocol actions) that surface an entry and
// therefore count as a retrieval, plus the canonical retrieval marker.
const RETRIEVED_ACTIONS = new Set<string>([
  'search', 'get', 'query', 'export', 'list', 'listScoped',
  RETRIEVAL_ACTION,
]);

/**
 * Resolve which usage counter (if any) an action/signal pair should advance.
 *
 * Precedence (first match wins):
 *  1. An applied usage action, or the applied signal, advances the applied
 *     counter — even when combined with a feedback signal.
 *  2. A pure feedback signal (no applied/retrieved action) advances NOTHING
 *     (records the signal only).
 *  3. Everything else (retrieval actions, comment-only, or missing
 *     action+signal) advances the retrieved counter (safe default).
 */
export function resolveUsageKind(action?: string, signal?: string): UsageKind {
  const a = action?.trim();
  const s = signal?.trim();
  if ((a && APPLIED_ACTIONS.has(a)) || s === APPLIED_SIGNAL) return 'applied';
  if (a && RETRIEVED_ACTIONS.has(a)) return 'retrieved';
  if (s && NO_INCREMENT_SIGNALS.has(s)) return 'none';
  // No recognised action and no recognised signal → treat as a retrieval.
  return 'retrieved';
}

/** Shape carrying the split usage counters (subset of InstructionEntry / snapshot record). */
export interface UsageCounters {
  retrievedCount?: number;
  appliedCount?: number;
  usageCount?: number;
}

/** Derive the deprecated total usageCount = retrievedCount + appliedCount. */
export function deriveUsageCount(c: UsageCounters): number {
  return (c.retrievedCount ?? 0) + (c.appliedCount ?? 0);
}

/**
 * Backfill split counters for a legacy record that only carries usageCount.
 * Legacy single-counter usage is interpreted as retrievals (appliedCount=0).
 * Mutates and returns the same object for convenience. Idempotent: if either
 * split field is already present it is left untouched.
 */
export function backfillLegacyCounters<T extends UsageCounters>(c: T): T & { retrievedCount: number; appliedCount: number; usageCount: number } {
  const out = c as T & { retrievedCount: number; appliedCount: number; usageCount: number };
  const hasSplit = c.retrievedCount != null || c.appliedCount != null;
  let retrieved = c.retrievedCount ?? 0;
  let applied = c.appliedCount ?? 0;
  if (!hasSplit) {
    // Legacy single-counter record: all historical usage is attributed to retrievals.
    retrieved = c.usageCount ?? 0;
    applied = 0;
  }
  // Honor an explicit (legacy/total) usageCount as a monotonic floor: attribute
  // any surplus over the known split to retrievals — the only safe default when
  // the breakdown is unknown. Keeps usageCount non-regressing across loads.
  const explicit = c.usageCount;
  const sum = retrieved + applied;
  if (explicit != null && explicit > sum) retrieved += explicit - sum;
  out.retrievedCount = retrieved;
  out.appliedCount = applied;
  out.usageCount = deriveUsageCount(out);
  return out;
}
