// Tests for shared utilities extracted as part of issue #135:
//   normalizeInputCategories / repairChangeLog / applyGovernanceKeys.
import { describe, it, expect } from 'vitest';
import {
  normalizeInputCategories,
  repairChangeLog,
  applyGovernanceKeys,
  ADD_GOVERNANCE_KEYS,
  IMPORT_GOVERNANCE_KEYS,
  ImportEntry
} from '../../services/handlers/instructions.shared';
import type { InstructionEntry } from '../../models/instruction';

describe('normalizeInputCategories (#135)', () => {
  it('lowercases, dedupes, and sorts', () => {
    expect(normalizeInputCategories(['B', 'a', 'A', 'b'])).toEqual(['a', 'b']);
  });
  it('drops non-strings and blank strings', () => {
    expect(normalizeInputCategories(['ok', '', '   ', 1, null, undefined, 'OK'])).toEqual(['ok']);
  });
  it('returns [] for non-array input', () => {
    expect(normalizeInputCategories(undefined)).toEqual([]);
    expect(normalizeInputCategories('not-array')).toEqual([]);
    expect(normalizeInputCategories(null)).toEqual([]);
  });
  it('matches the legacy inline expression used by add/import', () => {
    const raw: unknown[] = [' Foo ', 'foo', 'Bar', '', 42, 'baz'];
    const legacy = Array.from(new Set(
      (Array.isArray(raw) ? raw : [])
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map(c => c.toLowerCase())
    )).sort();
    expect(normalizeInputCategories(raw)).toEqual(legacy);
  });
});

describe('repairChangeLog (#135)', () => {
  const now = '2025-01-01T00:00:00.000Z';
  const fallback = { version: '1.0.0', changedAt: '2024-01-01T00:00:00.000Z', summary: 'initial' };

  it('drops malformed entries and keeps valid ones', () => {
    const result = repairChangeLog([
      { version: '1.0.0', changedAt: '2024-06-01T00:00:00Z', summary: 'first' },
      { version: 1, summary: 'bad version' },
      null,
      { version: '1.1.0', summary: '' },
      { version: '1.1.0', changedAt: 'not-iso', summary: 'second' }
    ], { finalVersion: '1.1.0', now, fallback, trailingSummary: 'bump' });
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ version: '1.0.0', changedAt: '2024-06-01T00:00:00Z', summary: 'first' });
    // changedAt without 'T' falls back to now
    expect(result[1]).toEqual({ version: '1.1.0', changedAt: now, summary: 'second' });
  });

  it('uses fallback when input is empty/invalid', () => {
    const r1 = repairChangeLog(undefined, { finalVersion: '1.0.0', now, fallback, trailingSummary: 'bump' });
    expect(r1).toEqual([fallback]);
    const r2 = repairChangeLog([], { finalVersion: '1.0.0', now, fallback, trailingSummary: 'bump' });
    expect(r2).toEqual([fallback]);
  });

  it('appends trailing entry when last version != finalVersion', () => {
    const result = repairChangeLog(
      [{ version: '1.0.0', changedAt: now, summary: 'first' }],
      { finalVersion: '1.1.0', now, fallback, trailingSummary: 'auto bump' }
    );
    expect(result.length).toBe(2);
    expect(result[1]).toEqual({ version: '1.1.0', changedAt: now, summary: 'auto bump' });
  });

  it('does not append trailing entry when last version matches finalVersion', () => {
    const result = repairChangeLog(
      [{ version: '1.1.0', changedAt: now, summary: 'matches' }],
      { finalVersion: '1.1.0', now, fallback, trailingSummary: 'unused' }
    );
    expect(result.length).toBe(1);
  });
});

describe('applyGovernanceKeys (#135)', () => {
  const baseTarget = (): InstructionEntry => ({
    id: 'x', title: 't', body: 'b', priority: 50, audience: 'all',
    requirement: 'mandatory', categories: ['c'], primaryCategory: 'c',
    sourceHash: 'h', schemaVersion: 1, createdAt: 'now', updatedAt: 'now'
  } as unknown as InstructionEntry);

  it('copies only defined fields from source for the given keys', () => {
    const target = baseTarget();
    const src: ImportEntry = {
      id: 'x', title: 't', body: 'b', priority: 50, audience: 'all', requirement: 'mandatory',
      version: '2.0.0', owner: 'team-a', status: 'approved'
    };
    applyGovernanceKeys(target, src, ADD_GOVERNANCE_KEYS);
    expect((target as unknown as Record<string, unknown>).version).toBe('2.0.0');
    expect((target as unknown as Record<string, unknown>).owner).toBe('team-a');
    expect((target as unknown as Record<string, unknown>).status).toBe('approved');
    // not in source -> remains undefined
    expect((target as unknown as Record<string, unknown>).priorityTier).toBeUndefined();
  });

  it('IMPORT keys include changeLog; ADD keys do not', () => {
    expect(IMPORT_GOVERNANCE_KEYS.includes('changeLog' as never)).toBe(true);
    expect(ADD_GOVERNANCE_KEYS.includes('changeLog' as never)).toBe(false);
  });

  it('ignores undefined fields without overwriting existing target values', () => {
    const target = baseTarget();
    (target as unknown as Record<string, unknown>).owner = 'pre-existing';
    const src: ImportEntry = {
      id: 'x', title: 't', body: 'b', priority: 50, audience: 'all', requirement: 'mandatory'
      // owner intentionally omitted
    };
    applyGovernanceKeys(target, src, ADD_GOVERNANCE_KEYS);
    expect((target as unknown as Record<string, unknown>).owner).toBe('pre-existing');
  });
});
