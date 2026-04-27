/**
 * Unit tests for shared handler utilities extracted in #135.
 * Tests: isJunkCategory, normalizeCategories, computeSourceHash, bumpVersion, createChangeLogEntry
 */
import { describe, it, expect } from 'vitest';
import {
  isJunkCategory,
  normalizeCategories,
  computeSourceHash,
  bumpVersion,
  createChangeLogEntry,
} from '../../services/handlers/instructions.shared';
import crypto from 'crypto';

describe('#135: shared handler utilities', () => {
  describe('isJunkCategory', () => {
    it('rejects numeric-prefix categories', () => {
      expect(isJunkCategory('100-percent')).toBe(true);
      expect(isJunkCategory('35-tools')).toBe(true);
    });

    it('rejects single-char categories', () => {
      expect(isJunkCategory('a')).toBe(true);
      expect(isJunkCategory('x')).toBe(true);
    });

    it('rejects case-ticket IDs', () => {
      expect(isJunkCategory('case-2506250040010257')).toBe(true);
    });

    it('accepts valid categories', () => {
      expect(isJunkCategory('agent-workflow')).toBe(false);
      expect(isJunkCategory('azure')).toBe(false);
      expect(isJunkCategory('testing')).toBe(false);
    });
  });

  describe('normalizeCategories', () => {
    it('lowercases, deduplicates, removes junk, and sorts', () => {
      const result = normalizeCategories(['Azure', 'AZURE', '100-percent', 'a', 'testing']);
      expect(result).toEqual(['azure', 'testing']);
    });

    it('removes plural duplicates when singular exists', () => {
      const result = normalizeCategories(['agent', 'agents', 'workflow']);
      expect(result).toEqual(['agent', 'workflow']);
    });

    it('handles empty input', () => {
      expect(normalizeCategories([])).toEqual([]);
    });

    it('filters non-string entries', () => {
      const result = normalizeCategories([42, null, 'azure', undefined] as unknown[]);
      expect(result).toEqual(['azure']);
    });
  });

  describe('computeSourceHash', () => {
    it('returns SHA-256 hex of the body', () => {
      const expected = crypto.createHash('sha256').update('test body', 'utf8').digest('hex');
      expect(computeSourceHash('test body')).toBe(expected);
    });

    it('returns deterministic hash for same input', () => {
      expect(computeSourceHash('abc')).toBe(computeSourceHash('abc'));
    });
  });

  describe('bumpVersion', () => {
    it('bumps patch version', () => {
      expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
    });

    it('bumps minor version and resets patch', () => {
      expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    });

    it('bumps major version and resets minor+patch', () => {
      expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    });

    it('defaults to 1.0.0 when undefined', () => {
      expect(bumpVersion(undefined, 'patch')).toBe('1.0.1');
    });

    it('handles malformed version gracefully', () => {
      expect(bumpVersion('1', 'patch')).toBe('1.0.1');
    });
  });

  describe('createChangeLogEntry', () => {
    it('creates entry with version, timestamp, and summary', () => {
      const entry = createChangeLogEntry('2.0.0', 'major bump');
      expect(entry.version).toBe('2.0.0');
      expect(entry.summary).toBe('major bump');
      expect(entry.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
