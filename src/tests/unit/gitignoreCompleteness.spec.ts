/**
 * Gitignore completeness tests — verify .gitignore contains required
 * patterns added in Phase 2 (repo cleanup).
 *
 * Phase 4 TDD: These tests validate the Phase 2 gitignore work.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GITIGNORE_PATH = path.join(REPO_ROOT, '.gitignore');

describe('.gitignore completeness', () => {
  let lines: string[];

  function load(): string[] {
    return fs.readFileSync(GITIGNORE_PATH, 'utf8')
      .split(/\r?\n/)
      .map(l => l.trim());
  }

  it('.gitignore file exists and is non-empty', () => {
    lines = load();
    expect(lines.length).toBeGreaterThan(10);
  });

  describe('required patterns from Phase 2 cleanup', () => {
    const requiredPatterns = [
      '.test-run-complete.*',
      'health_response.json',
      'NVIDIA Corporation/',
      'PLAN.md',
    ];

    for (const pattern of requiredPatterns) {
      it(`contains pattern: ${pattern}`, () => {
        const content = load();
        expect(content).toContain(pattern);
      });
    }
  });

  describe('critical exclusion patterns', () => {
    const criticalPatterns = [
      'devinstructions/',
      'instructions/',
      'dist/',
      'node_modules/',
      '.certs/',
      '.private/',
      'tmp/',
      'data/',
      'memory/',
      'logs/',
      '/governance/',
      'backups/',
      'metrics/',
      'coverage/',
    ];

    for (const pattern of criticalPatterns) {
      it(`contains critical exclusion: ${pattern}`, () => {
        const content = load();
        expect(content).toContain(pattern);
      });
    }
  });

  describe('feedback exclusion patterns', () => {
    it('excludes feedback JSON files via glob pattern', () => {
      const content = load();
      const hasFeedbackPattern = content.some(l =>
        l.includes('feedback/') && !l.startsWith('#')
      );
      expect(hasFeedbackPattern).toBe(true);
    });
  });

  describe('test artifact safety net patterns', () => {
    it('excludes test-run sentinel markers', () => {
      const content = load();
      const hasTestRunPattern = content.some(l =>
        l.includes('.test-run-complete.') && !l.startsWith('#')
      );
      expect(hasTestRunPattern).toBe(true);
    });

    // `.baseline.sentinel` was asserted here until #582. It was the SHA-256 of
    // INTERNAL-BASELINE.md, a file that does not exist and has no commits, so
    // the sentinel could never be written. Ignoring a filename that can never
    // be produced is not a safety net; the whole baseline machinery is gone.
  });

  describe('no accidental negation of critical patterns', () => {
    it('does not un-ignore dist/ at root level', () => {
      const content = load();
      // Root dist output should stay ignored.
      const badNegation = content.some(l =>
        l === '!dist/' || l === '!dist'
      );
      expect(badNegation).toBe(false);
    });

    it('does not un-ignore node_modules/', () => {
      const content = load();
      const badNegation = content.some(l =>
        l === '!node_modules/' || l === '!node_modules'
      );
      expect(badNegation).toBe(false);
    });
  });
});
