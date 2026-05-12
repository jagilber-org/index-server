/**
 * Import migration ordering tests (issue #346).
 *
 * Bug: `instructions.import.ts` calls `validateInstructionInputSurface()`
 * BEFORE `migrateInstructionRecord()`. Legacy entries with enum drift
 * (e.g., audience: "team", requirement: "SHOULD", status: "active") are
 * rejected instead of being migrated.
 *
   * Fix: Call the import schema migration service before surface validation in import.
 *
 * Test categories:
 *   SE-01..SE-04: Import accepts legacy enum values after migration
 *   SE-05..SE-06: Combined legacy drift and audit trail
 *   SE-07:        Structural guard — import handler calls migrate before validate
 *   SE-08..SE-09: Backward compat — valid entries still accepted, invalid still rejected
 *   SE-10:        Missing required fields still rejected (id, title, body)
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { migrateInstructionRecord } from '../../versioning/schemaVersion';
import { AUDIENCES, REQUIREMENTS } from '../../models/instruction';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function legacyEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `se-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Legacy test entry',
    body: 'Body for migration ordering test.',
    priority: 50,
    audience: AUDIENCES[2],
    requirement: REQUIREMENTS[3],
    categories: ['testing'],
    contentType: 'instruction',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SE-01..SE-04: Individual legacy enum values accepted via import
// ---------------------------------------------------------------------------
describe('Import migration ordering — legacy enum acceptance (#346)', () => {
    // These tests verify that schema migration correctly normalizes
  // legacy enum values. The bug is that import calls validation BEFORE
  // migration, so these values are rejected. After fix, migration runs first,
  // normalizing the values before validation sees them.

  it('SE-01: audience "team" is migrated to "group"', () => {
    const rec = legacyEntry({ audience: 'team' });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.audience).toBe(AUDIENCES[1]);
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('corrected invalid audience "team"')])
    );
  });

  it('SE-01b: audience "developers" is migrated to "group"', () => {
    const rec = legacyEntry({ audience: 'developers' });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.audience).toBe(AUDIENCES[1]);
  });

  it('SE-01c: audience "developer" is migrated to "individual"', () => {
    const rec = legacyEntry({ audience: 'developer' });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.audience).toBe(AUDIENCES[0]);
  });

  it('SE-01d: audience "system" is migrated to "all"', () => {
    const rec = legacyEntry({ audience: 'system' });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.audience).toBe(AUDIENCES[2]);
  });

  it('SE-02: requirement "SHOULD" is migrated to "recommended"', () => {
    const rec = legacyEntry({ requirement: 'SHOULD' });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.requirement).toBe(REQUIREMENTS[2]);
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('corrected invalid requirement "SHOULD"')])
    );
  });

  it('SE-02b: requirement "MUST" is migrated to "mandatory"', () => {
    const rec = legacyEntry({ requirement: 'MUST' });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.requirement).toBe(REQUIREMENTS[0]);
  });

  it('SE-02c: requirement "MAY" is migrated to "optional"', () => {
    const rec = legacyEntry({ requirement: 'MAY' });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.requirement).toBe(REQUIREMENTS[3]);
  });

  it('SE-03: status "active" is migrated to "approved"', () => {
    const rec = legacyEntry({ status: 'active' });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.status).toBe('approved');
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('corrected invalid status "active"')])
    );
  });

  it('SE-04: missing contentType defaults to "instruction"', () => {
    const rec = legacyEntry();
    delete rec.contentType;
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.contentType).toBe('instruction');
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('added contentType')])
    );
  });
});

// ---------------------------------------------------------------------------
// SE-05..SE-06: Combined legacy drift + audit notes
// ---------------------------------------------------------------------------
describe('Import migration ordering — combined legacy drift (#346)', () => {
  it('SE-05: entry with multiple legacy enums is fully migrated in one pass', () => {
    const rec = legacyEntry({
      audience: 'teams',
      requirement: 'CRITICAL',
      status: 'active',
    });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.audience).toBe(AUDIENCES[1]);
    expect(rec.requirement).toBe(REQUIREMENTS[1]);
    expect(rec.status).toBe('approved');
  });

  it('SE-06: migration notes provide audit trail for each corrected field', () => {
    const rec = legacyEntry({
      audience: 'admins',
      requirement: 'REQUIRED',
      status: 'active',
      classification: 'top-secret',
    });
    const result = migrateInstructionRecord(rec);
    const notes = result.notes ?? [];
    // Must have a correction note for each invalid field
    expect(notes.filter(n => n.includes('corrected invalid audience'))).toHaveLength(1);
    expect(notes.filter(n => n.includes('corrected invalid requirement'))).toHaveLength(1);
    expect(notes.filter(n => n.includes('corrected invalid status'))).toHaveLength(1);
    expect(notes.filter(n => n.includes('corrected invalid classification'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SE-07: Structural guard — import handler migration ordering
// ---------------------------------------------------------------------------
describe('Import migration ordering — structural guard (#346)', () => {
  it('SE-07: import handler calls the schema migration service before validateInstructionInputSurface', () => {
    // Read the import handler source and verify call ordering.
    // This is the core structural assertion for issue #346.
    const importHandlerPath = path.resolve(
      __dirname, '../../services/handlers/instructions.import.ts'
    );
    const src = fs.readFileSync(importHandlerPath, 'utf8');
    const lines = src.split(/\r?\n/);

    // Find the line indices for the key calls within the per-entry loop
    let migrateLineIdx = -1;
    let validateLineIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip imports
      if (/^\s*import\b/.test(line)) continue;
      if (/\bmigrateLegacyInstructionEntry\s*\(/.test(line) && migrateLineIdx === -1) {
        migrateLineIdx = i;
      }
      if (/\bvalidateInstructionInputSurface\s*\(/.test(line) && validateLineIdx === -1) {
        validateLineIdx = i;
      }
    }

    expect(migrateLineIdx).toBeGreaterThan(-1);
    expect(validateLineIdx).toBeGreaterThan(-1);
    expect(migrateLineIdx).toBeLessThan(validateLineIdx);
  });
});

// ---------------------------------------------------------------------------
// SE-08..SE-09: Backward compatibility
// ---------------------------------------------------------------------------
describe('Import migration ordering — backward compat (#346)', () => {
  it('SE-08: valid current-schema entry passes migration unchanged', () => {
    const rec = legacyEntry({ schemaVersion: '6' });
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(false);
    // All fields remain valid
    expect(rec.audience).toBe(AUDIENCES[2]);
    expect(rec.requirement).toBe(REQUIREMENTS[3]);
    expect(rec.contentType).toBe('instruction');
  });

  it('SE-09: invalid contentType is NOT silently coerced (still fails validation)', () => {
    // migrateInstructionRecord intentionally does NOT coerce invalid contentType.
    // This ensures new invalid values aren't silently accepted.
    const rec = legacyEntry({ contentType: 'blog-post' });
    migrateInstructionRecord(rec);
    // contentType should remain 'blog-post' (not coerced)
    expect(rec.contentType).toBe('blog-post');
  });
});

// ---------------------------------------------------------------------------
// SE-10: Missing required fields still rejected
// ---------------------------------------------------------------------------
describe('Import migration ordering — required field rejection (#346)', () => {
  it('SE-10a: entry missing id is not salvageable by migration', () => {
    const rec = legacyEntry();
    delete rec.id;
    // Migration doesn't add an id — it's truly required
    migrateInstructionRecord(rec);
    expect(rec.id).toBeUndefined();
  });

  it('SE-10b: entry missing title is not salvageable by migration', () => {
    const rec = legacyEntry();
    delete rec.title;
    migrateInstructionRecord(rec);
    expect(rec.title).toBeUndefined();
  });

  it('SE-10c: entry missing body is not salvageable by migration', () => {
    const rec = legacyEntry();
    delete rec.body;
    migrateInstructionRecord(rec);
    expect(rec.body).toBeUndefined();
  });

  it('SE-10d: missing priority IS defaulted by migration to 50', () => {
    const rec = legacyEntry();
    delete rec.priority;
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.priority).toBe(50);
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('added required field priority')])
    );
  });

  it('SE-10e: missing audience IS defaulted by migration to the all-audience value', () => {
    const rec = legacyEntry();
    delete rec.audience;
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.audience).toBe(AUDIENCES[2]);
  });

  it('SE-10f: missing requirement IS defaulted by migration to the recommended value', () => {
    const rec = legacyEntry();
    delete rec.requirement;
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.requirement).toBe(REQUIREMENTS[2]);
  });
});
