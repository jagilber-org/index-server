/**
 * Schema contract tests for spec 006-archive-lifecycle Phase A (REQ-3, REQ-13, REQ-25).
 *
 * Verifies:
 *  1. v6 records still load / migrate without error (lax-accept on read).
 *  2. The first write of a v6 record promotes schemaVersion to '7'.
 *  3. Out-of-enum archiveReason / archiveSource values are rejected by AJV
 *     when validating a full record (write-path validation).
 *  4. Active governance hash is invariant for an unchanged active set across
 *     the v6 → v7 bump — the archive metadata fields are not part of the
 *     governance projection, so adding them to one copy must not perturb the
 *     hash. This is the REQ-13 hash invariance assertion.
 */

import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION, migrateInstructionRecord } from '../../../versioning/schemaVersion';
import { validateRecord } from '../../../schemas/instructionSchema';
import { computeGovernanceHashFromEntries } from '../../../services/storage/hashUtils';
import type { InstructionEntry } from '../../../models/instruction';

function makeV6Record(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'sample-v6',
    title: 'Sample v6 record',
    body: 'body',
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['general'],
    contentType: 'instruction',
    schemaVersion: '6',
    sourceHash: 'a'.repeat(64),
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeActiveEntry(id: string, overrides: Partial<InstructionEntry> = {}): InstructionEntry {
  return {
    id,
    title: `Title for ${id}`,
    body: 'body content',
    priority: 50,
    audience: 'all',
    requirement: 'recommended',
    categories: ['general'],
    contentType: 'instruction',
    schemaVersion: SCHEMA_VERSION,
    sourceHash: 'b'.repeat(64),
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    version: '1.0.0',
    owner: 'team-x',
    priorityTier: 'P2',
    semanticSummary: 'summary',
    changeLog: [{ version: '1.0.0', changedAt: '2025-01-01T00:00:00.000Z', summary: 'init' }],
    ...overrides,
  };
}

describe('archive lifecycle schema (Phase A, spec 006)', () => {
  describe('REQ-25: schema version bump', () => {
    it('SCHEMA_VERSION constant is "7"', () => {
      expect(SCHEMA_VERSION).toBe('7');
    });

    it('loader path (migrate) accepts a v6 record without throwing', () => {
      const rec = makeV6Record();
      expect(() => migrateInstructionRecord(rec)).not.toThrow();
    });

    it('first write of a v6 record promotes schemaVersion to "7"', () => {
      const rec = makeV6Record();
      const result = migrateInstructionRecord(rec);
      expect(result.changed).toBe(true);
      expect(rec.schemaVersion).toBe('7');
      expect(result.notes?.some(n => /v6.*v7|schemaVersion updated 6.*7/.test(n))).toBe(true);
    });

    it('a v6 record migrated then validated against the canonical schema passes', () => {
      const rec = makeV6Record();
      migrateInstructionRecord(rec);
      const ok = validateRecord(rec);
      if (!ok) {
        // surface AJV errors for easier debugging when this test ever fails
        console.error('validateRecord errors:', validateRecord.errors);
      }
      expect(ok).toBe(true);
    });
  });

  describe('REQ-3: archive enum guardrails', () => {
    it('a record with a valid archiveReason + archiveSource passes record validation', () => {
      const rec = makeV6Record({
        schemaVersion: '7',
        archivedAt: '2025-06-01T00:00:00.000Z',
        archivedBy: 'agent-x',
        archiveReason: 'deprecated',
        archiveSource: 'groom',
        restoreEligible: true,
      });
      const ok = validateRecord(rec);
      expect(ok).toBe(true);
    });

    it('rejects out-of-enum archiveReason on write', () => {
      const rec = makeV6Record({
        schemaVersion: '7',
        archiveReason: 'totally-bogus-reason',
      });
      const ok = validateRecord(rec);
      expect(ok).toBe(false);
      const errors = validateRecord.errors ?? [];
      expect(errors.some(e => typeof e.instancePath === 'string' && e.instancePath.includes('archiveReason'))).toBe(true);
    });

    it('rejects out-of-enum archiveSource on write', () => {
      const rec = makeV6Record({
        schemaVersion: '7',
        archiveSource: 'made-up-source',
      });
      const ok = validateRecord(rec);
      expect(ok).toBe(false);
      const errors = validateRecord.errors ?? [];
      expect(errors.some(e => typeof e.instancePath === 'string' && e.instancePath.includes('archiveSource'))).toBe(true);
    });

    it('restoreEligible must be boolean', () => {
      const rec = makeV6Record({
        schemaVersion: '7',
        // intentionally wrong type — must be boolean per schema
        restoreEligible: 'yes' as unknown as boolean,
      });
      const ok = validateRecord(rec);
      expect(ok).toBe(false);
    });
  });

  describe('REQ-13: governance hash invariance across v6 → v7', () => {
    it('hash is unchanged for an unchanged active set after the schema bump', () => {
      // Two identical active entries except for the new optional archive
      // metadata fields. Per REQ-13 the active governance hash must remain
      // byte-identical for unchanged active state; the archive metadata is
      // not part of the governance projection.
      const baseA = makeActiveEntry('alpha');
      const baseB = makeActiveEntry('beta');

      const enrichedA: InstructionEntry = {
        ...baseA,
        // Archive metadata exists in the record but the entry is still active
        // (no archivedAt). The hash projection must ignore these fields.
        archivedBy: 'agent-x',
        archiveReason: 'manual',
        archiveSource: 'archive',
        restoreEligible: true,
      };

      const hashBefore = computeGovernanceHashFromEntries([baseA, baseB]);
      const hashAfter = computeGovernanceHashFromEntries([enrichedA, baseB]);

      expect(hashAfter).toBe(hashBefore);
    });
  });
});
