/**
 * Negative tests for enum validation across create, update, and migration paths.
 *
 * Ensures that:
 * 1. Invalid enum values are rejected on create (index_add)
 * 2. Invalid enum values are rejected on update (overwrite)
 * 3. Invalid enum values are corrected during migration (migrateInstructionRecord)
 * 4. Each enum field is individually validated
 */

import { describe, expect, it } from 'vitest';
import { validateInstructionInputEnumMembership } from '../../services/instructionRecordValidation';
import { migrateInstructionRecord } from '../../versioning/schemaVersion';

// Valid baseline entry for mutation
function validEntry(): Record<string, unknown> {
  return {
    id: 'test-enum-entry',
    title: 'Test Entry',
    body: 'Test body content',
    priority: 50,
    audience: 'all',
    requirement: 'optional',
    categories: ['testing'],
    contentType: 'instruction',
    status: 'draft',
    priorityTier: 'P3',
    classification: 'internal',
  };
}

describe('Enum validation — input surface (create/update)', () => {
  it('rejects invalid audience value', () => {
    const entry = { ...validEntry(), audience: 'everyone' };
    const errs = validateInstructionInputEnumMembership(entry);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('/audience');
    expect(errs[0]).toContain('individual, group, all');
  });

  it('rejects invalid requirement value', () => {
    const entry = { ...validEntry(), requirement: 'must-have' };
    const errs = validateInstructionInputEnumMembership(entry);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('/requirement');
  });

  it('rejects invalid contentType value', () => {
    const entry = { ...validEntry(), contentType: 'guide' };
    const errs = validateInstructionInputEnumMembership(entry);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('/contentType');
  });

  it('rejects removed contentType values without compatibility coercion', () => {
    for (const contentType of ['reference', 'example', 'chat-session']) {
      const entry = { ...validEntry(), contentType };
      const errs = validateInstructionInputEnumMembership(entry);
      expect(errs).toEqual([
        '/contentType: must be one of agent, skill, instruction, prompt, workflow, knowledge, template, integration',
      ]);
    }
  });

  it('rejects invalid status value', () => {
    const entry = { ...validEntry(), status: 'published' };
    const errs = validateInstructionInputEnumMembership(entry);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('/status');
  });

  it('rejects invalid priorityTier value', () => {
    const entry = { ...validEntry(), priorityTier: 'P5' };
    const errs = validateInstructionInputEnumMembership(entry);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('/priorityTier');
  });

  it('rejects invalid classification value', () => {
    const entry = { ...validEntry(), classification: 'secret' };
    const errs = validateInstructionInputEnumMembership(entry);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toContain('/classification');
  });

  it('accepts all valid enum values without error', () => {
    const entry = validEntry();
    const errs = validateInstructionInputEnumMembership(entry);
    expect(errs).toHaveLength(0);
  });

  it('skips validation for absent optional enum fields', () => {
    const entry = { id: 'minimal', title: 'Min', body: 'b', priority: 50, audience: 'all', requirement: 'optional', categories: [] };
    const errs = validateInstructionInputEnumMembership(entry);
    expect(errs).toHaveLength(0);
  });

  it('rejects multiple invalid enums simultaneously', () => {
    const entry = { ...validEntry(), audience: 'robots', status: 'published', classification: 'top-secret' };
    const errs = validateInstructionInputEnumMembership(entry);
    expect(errs.length).toBe(3);
    expect(errs.some(e => e.includes('/audience'))).toBe(true);
    expect(errs.some(e => e.includes('/status'))).toBe(true);
    expect(errs.some(e => e.includes('/classification'))).toBe(true);
  });
});

describe('Enum validation — migration path (migrateInstructionRecord)', () => {
  it('corrects invalid audience during migration', () => {
    const rec: Record<string, unknown> = { ...validEntry(), audience: 'robots', schemaVersion: '3' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.audience).toBe('all');
    expect(result.notes).toEqual(expect.arrayContaining([expect.stringContaining('corrected invalid audience')]));
  });

  it('corrects invalid requirement during migration', () => {
    const rec: Record<string, unknown> = { ...validEntry(), requirement: 'nice-to-have', schemaVersion: '3' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.requirement).toBe('optional');
    expect(result.notes).toEqual(expect.arrayContaining([expect.stringContaining('corrected invalid requirement')]));
  });

  it('does not correct invalid contentType during migration', () => {
    const rec: Record<string, unknown> = { ...validEntry(), contentType: 'blog-post', schemaVersion: '3' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.contentType).toBe('blog-post');
  });

  it('does not migrate removed contentType "chat-session" to "workflow"', () => {
    const rec: Record<string, unknown> = { ...validEntry(), contentType: 'chat-session', schemaVersion: '4' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.contentType).toBe('chat-session');
    expect(rec.schemaVersion).toBe('6');
    expect(result.notes ?? []).not.toEqual(expect.arrayContaining([expect.stringContaining('chat-session')]));
  });

  it('corrects invalid status during migration', () => {
    const rec: Record<string, unknown> = { ...validEntry(), status: 'published', schemaVersion: '3' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.status).toBe('draft');
  });

  it('corrects invalid priorityTier during migration', () => {
    const rec: Record<string, unknown> = { ...validEntry(), priorityTier: 'P0', schemaVersion: '3' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.priorityTier).toBe('P3');
  });

  it('corrects invalid classification during migration', () => {
    const rec: Record<string, unknown> = { ...validEntry(), classification: 'top-secret', schemaVersion: '3' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.classification).toBe('internal');
  });

  it('leaves valid enum values untouched during migration', () => {
    const rec: Record<string, unknown> = { ...validEntry(), schemaVersion: '3' };
    const originalAudience = rec.audience;
    const originalReq = rec.requirement;
    migrateInstructionRecord(rec);
    expect(rec.audience).toBe(originalAudience);
    expect(rec.requirement).toBe(originalReq);
  });

  it('corrects multiple invalid enums in a single migration pass', () => {
    const rec: Record<string, unknown> = {
      ...validEntry(),
      audience: 'bots',
      requirement: 'ABSOLUTE',
      status: 'live',
      classification: 'confidential',
      schemaVersion: '2',
    };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.audience).toBe('all');
    expect(rec.requirement).toBe('optional');
    expect(rec.status).toBe('draft');
    expect(rec.classification).toBe('internal');
  });

  it('reports correction notes for each fixed enum', () => {
    const rec: Record<string, unknown> = { ...validEntry(), audience: 'xyz', status: 'unknown', schemaVersion: '4' };
    const result = migrateInstructionRecord(rec);
    const notes = result.notes ?? [];
    expect(notes.filter(n => n.includes('corrected invalid'))).toHaveLength(2);
  });

  it('does not mark as changed when all enums are already valid', () => {
    // Already at current schema with valid enums — no change expected
    const rec: Record<string, unknown> = { ...validEntry(), schemaVersion: '6' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(false);
  });
});
