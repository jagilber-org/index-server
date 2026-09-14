/**
 * RED-GREEN tests for audience-array crash bug.
 *
 * Constitution refs:
 *   Q-1: All exported functions/handlers must have unit tests
 *   DI-1/DI-4: Data integrity & persistence
 *
 * Bug: When entry.audience is an array (e.g. ["individual","group"]),
 *   - schemaMigrationService.migrateAudience() silently returns without fixing it
 *   - sqliteStore.write() passes the array to a SQLite bind param → TypeError crash
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrateLegacyInstructionEntry } from '../../../services/schemaMigrationService.js';
import { SqliteStore } from '../../../services/storage/sqliteStore.js';
import { AUDIENCES, type InstructionEntry } from '../../../models/instruction.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function baseEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test-audience-array',
    title: 'Test entry',
    body: 'Body text for testing audience array normalization.',
    categories: ['testing'],
    primaryCategory: 'testing',
    audience: ['individual', 'group'],
    priority: 50,
    requirement: 'recommended',
    contentType: 'instruction',
    sourceHash: 'abc123',
    schemaVersion: '4',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('migrateAudience – array normalization', () => {
  it('should normalize array audience to first valid enum value', () => {
    const entry = baseEntry();
    const result = migrateLegacyInstructionEntry(entry, { source: 'index_import' });

    expect(typeof result.entry.audience).toBe('string');
    expect(AUDIENCES as readonly string[]).toContain(result.entry.audience);
    expect(result.changed).toBe(true);
  });

  // PINS the array arm. The previous suite passed with the array arm deleted
  // from either coercion, so it was silent about which member gets picked.
  // 'bogus' is first by POSITION, 'group' is first by ENUM MEMBERSHIP.
  it('picks the first enum-valid member, not the first element', () => {
    const entry = baseEntry({ audience: ['bogus', 'group'] });
    const result = migrateLegacyInstructionEntry(entry, { source: 'index_import' });

    expect(result.entry.audience).toBe('group');
  });

  it('should normalize array audience with no valid values to "all"', () => {
    const entry = baseEntry({ audience: ['bogus', 'invalid'] });
    const result = migrateLegacyInstructionEntry(entry, { source: 'index_import' });

    expect(result.entry.audience).toBe('all');
    expect(result.changed).toBe(true);
  });

  it('should normalize numeric audience to "all"', () => {
    const entry = baseEntry({ audience: 42 });
    const result = migrateLegacyInstructionEntry(entry, { source: 'index_import' });

    expect(result.entry.audience).toBe('all');
    expect(result.changed).toBe(true);
  });

  it('should normalize object audience to "all"', () => {
    const entry = baseEntry({ audience: { scope: 'team' } });
    const result = migrateLegacyInstructionEntry(entry, { source: 'index_import' });

    expect(result.entry.audience).toBe('all');
    expect(result.changed).toBe(true);
  });

  it('should leave valid string audience unchanged', () => {
    const entry = baseEntry({ audience: 'group' });
    const result = migrateLegacyInstructionEntry(entry, { source: 'index_import' });

    expect(result.entry.audience).toBe('group');
  });
});

describe('SqliteStore.write – audience array crash prevention', () => {
  let store: SqliteStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audience-test-'));
    store = new SqliteStore(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should not crash when audience is an array', () => {
    const entry = baseEntry() as unknown as InstructionEntry;

    expect(() => store.write(entry)).not.toThrow();

    const retrieved = store.get('test-audience-array');
    expect(retrieved).not.toBeNull();
    expect(typeof retrieved!.audience).toBe('string');
    expect(AUDIENCES as readonly string[]).toContain(retrieved!.audience);
  });

  // PINS the storage layer, and is the regression test for the real defect:
  // the crash was fixed, but an out-of-enum value was still reaching the store.
  // Pre-fix this wrote 'bogus'; the assertion below went red.
  it('never persists an audience outside the enum', () => {
    const entry = baseEntry({
      id: 'test-out-of-enum-audience',
      audience: ['bogus', 'group'],
    }) as unknown as InstructionEntry;

    expect(() => store.write(entry)).not.toThrow();

    const retrieved = store.get('test-out-of-enum-audience');
    expect(retrieved!.audience).toBe('group');
    expect(AUDIENCES as readonly string[]).toContain(retrieved!.audience);
  });

  // The two coercions are separate implementations of one concept. This pins
  // that they AGREE, so neither can drift without a test going red.
  it('agrees with migrateLegacyInstructionEntry on every audience shape', () => {
    const shapes: unknown[] = [
      ['bogus', 'group'],
      ['individual', 'group'],
      ['bogus', 'invalid'],
      [],
      42,
      { scope: 'team' },
      null,
    ];

    for (const audience of shapes) {
      const id = `parity-${JSON.stringify(audience)}`;
      const migrated = migrateLegacyInstructionEntry(baseEntry({ audience }), {
        source: 'index_import',
      });

      store.write(baseEntry({ id, audience }) as unknown as InstructionEntry);
      const stored = store.get(id);

      expect(stored!.audience, `disagreement on ${JSON.stringify(audience)}`).toBe(
        migrated.entry.audience,
      );
    }
  });

  it('should not crash when audience is a number', () => {
    const entry = baseEntry({ id: 'test-numeric-audience', audience: 99 }) as unknown as InstructionEntry;

    expect(() => store.write(entry)).not.toThrow();

    const retrieved = store.get('test-numeric-audience');
    expect(retrieved).not.toBeNull();
    expect(typeof retrieved!.audience).toBe('string');
  });

  it('should not crash when audience is an object', () => {
    const entry = baseEntry({ id: 'test-object-audience', audience: { x: 1 } }) as unknown as InstructionEntry;

    expect(() => store.write(entry)).not.toThrow();

    const retrieved = store.get('test-object-audience');
    expect(retrieved).not.toBeNull();
    expect(typeof retrieved!.audience).toBe('string');
  });
});
