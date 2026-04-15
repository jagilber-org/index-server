/**
 * Shared governance hashing utilities for storage backends.
 *
 * Both JsonFileStore and SqliteStore must produce identical governance hashes
 * for the same set of entries. This module ensures that.
 */

import crypto from 'crypto';
import { InstructionEntry } from '../../models/instruction.js';

/** @internal Governance projection for deterministic hashing. */
export function projectGovernance(e: InstructionEntry): Record<string, unknown> {
  return {
    id: e.id,
    title: e.title,
    version: e.version ?? '0.0.0',
    owner: e.owner ?? 'unowned',
    priorityTier: e.priorityTier ?? 'P4',
    nextReviewDue: e.nextReviewDue ?? '',
    semanticSummarySha256: e.semanticSummary
      ? crypto.createHash('sha256').update(e.semanticSummary).digest('hex')
      : '',
    changeLogLength: e.changeLog?.length ?? 0,
  };
}

/** Compute deterministic governance hash from an array of entries. */
export function computeGovernanceHashFromEntries(entries: InstructionEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const projection = sorted.map(e => JSON.stringify(projectGovernance(e)));
  return crypto.createHash('sha256').update(projection.join('\n')).digest('hex');
}
