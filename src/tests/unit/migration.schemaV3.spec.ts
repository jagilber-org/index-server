import { describe, it, expect } from 'vitest';
import { migrateInstructionRecord, SCHEMA_VERSION } from '../../versioning/schemaVersion';

describe('schema migration v3', () => {
  it('adds primaryCategory for v2 record with categories', () => {
    const rec: Record<string, unknown> = { id:'x', title:'x', categories:['alpha','beta'], schemaVersion:'2' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.schemaVersion).toBe(SCHEMA_VERSION);
    expect(rec.primaryCategory).toBe('alpha');
    expect((rec.categories as string[]).includes('alpha')).toBe(true);
  });

  it('normalizes categories to include existing primaryCategory if missing', () => {
    const rec: Record<string, unknown> = { id:'y', title:'y', categories:['beta'], primaryCategory:'alpha', schemaVersion:'2' };
    const result = migrateInstructionRecord(rec);
    expect(result.changed).toBe(true);
    expect(rec.schemaVersion).toBe(SCHEMA_VERSION);
    const cats = rec.categories as string[];
    expect(cats[0]).toBe('alpha');
    expect(cats.includes('beta')).toBe(true);
  });

  it('still bumps version even if already has primaryCategory', () => {
    const rec: Record<string, unknown> = { id:'z', title:'z', categories:['alpha','gamma'], primaryCategory:'alpha', schemaVersion:'2' };
    const result = migrateInstructionRecord(rec);
    expect(rec.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.changed).toBe(true);
  });
});
