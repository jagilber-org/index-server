/**
 * Constitution validation tests — verify constitution.json has all required
 * articles and rules added in Phase 1 (enterprise expansion).
 *
 * Phase 4 TDD: These tests validate the Phase 1 constitution work.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONSTITUTION_PATH = path.join(REPO_ROOT, 'constitution.json');

interface ConstitutionRule {
  id: string;
  rule: string;
  severity: string;
}

interface ConstitutionArticle {
  title: string;
  rules: ConstitutionRule[];
}

interface Constitution {
  version: string;
  articles: Record<string, ConstitutionArticle>;
  thresholds: Record<string, number>;
}

describe('constitution.json validation', () => {
  let constitution: Constitution;

  it('loads and parses without error', () => {
    const raw = fs.readFileSync(CONSTITUTION_PATH, 'utf8');
    constitution = JSON.parse(raw);
    expect(constitution).toBeDefined();
    expect(constitution.articles).toBeDefined();
  });

  // Re-parse for each test to avoid ordering issues
  function load(): Constitution {
    return JSON.parse(fs.readFileSync(CONSTITUTION_PATH, 'utf8'));
  }

  function getRuleIds(article: ConstitutionArticle): string[] {
    return article.rules.map(r => r.id);
  }

  describe('version requirement', () => {
    it('version is >= 2.0.0', () => {
      const c = load();
      const [major] = c.version.split('.').map(Number);
      expect(major).toBeGreaterThanOrEqual(2);
    });
  });

  describe('testing article (TS-1 to TS-12)', () => {
    it('has a "testing" article', () => {
      const c = load();
      expect(c.articles.testing).toBeDefined();
    });

    it('contains all 12 testing rules TS-1 through TS-12', () => {
      const c = load();
      const ids = getRuleIds(c.articles.testing);
      for (let i = 1; i <= 12; i++) {
        expect(ids).toContain(`TS-${i}`);
      }
    });

    it('TS-7 enforces TDD red/green', () => {
      const c = load();
      const ts7 = c.articles.testing.rules.find(r => r.id === 'TS-7');
      expect(ts7).toBeDefined();
      expect(ts7!.rule.toLowerCase()).toMatch(/tdd|red.green/i);
    });
  });

  describe('code-quality article (CQ-1 to CQ-7)', () => {
    it('has a "code-quality" article', () => {
      const c = load();
      expect(c.articles['code-quality']).toBeDefined();
    });

    it('contains all 7 code quality rules CQ-1 through CQ-7', () => {
      const c = load();
      const ids = getRuleIds(c.articles['code-quality']);
      for (let i = 1; i <= 7; i++) {
        expect(ids).toContain(`CQ-${i}`);
      }
    });
  });

  describe('build-deploy article (BD-1 to BD-3)', () => {
    it('has a "build-deploy" article', () => {
      const c = load();
      expect(c.articles['build-deploy']).toBeDefined();
    });

    it('contains all 3 build-deploy rules BD-1 through BD-3', () => {
      const c = load();
      const ids = getRuleIds(c.articles['build-deploy']);
      for (let i = 1; i <= 3; i++) {
        expect(ids).toContain(`BD-${i}`);
      }
    });
  });

  describe('data-integrity article (DI-1 to DI-3)', () => {
    it('has a "data-integrity" article', () => {
      const c = load();
      expect(c.articles['data-integrity']).toBeDefined();
    });

    it('contains all 3 data-integrity rules DI-1 through DI-3', () => {
      const c = load();
      const ids = getRuleIds(c.articles['data-integrity']);
      for (let i = 1; i <= 3; i++) {
        expect(ids).toContain(`DI-${i}`);
      }
    });
  });

  describe('pii-precommit article (PH-1 to PH-3)', () => {
    it('has a "pii-precommit" article', () => {
      const c = load();
      expect(c.articles['pii-precommit']).toBeDefined();
    });

    it('contains all 3 PII/pre-commit rules PH-1 through PH-3', () => {
      const c = load();
      const ids = getRuleIds(c.articles['pii-precommit']);
      for (let i = 1; i <= 3; i++) {
        expect(ids).toContain(`PH-${i}`);
      }
    });
  });

  describe('publishing article includes PB-6', () => {
    it('has a "publishing" article with PB-6', () => {
      const c = load();
      expect(c.articles.publishing).toBeDefined();
      const ids = getRuleIds(c.articles.publishing);
      expect(ids).toContain('PB-6');
    });

    it('PB-6 covers pre-push hook and public remote blocking', () => {
      const c = load();
      const pb6 = c.articles.publishing.rules.find(r => r.id === 'PB-6');
      expect(pb6).toBeDefined();
      expect(pb6!.rule.toLowerCase()).toMatch(/pre-push|public/i);
    });
  });

  describe('structural completeness', () => {
    it('has all expected article keys', () => {
      const c = load();
      const expected = [
        'quality', 'security', 'architecture', 'governance',
        'publishing', 'testing', 'code-quality', 'build-deploy',
        'data-integrity', 'pii-precommit',
      ];
      for (const key of expected) {
        expect(c.articles).toHaveProperty(key);
      }
    });

    it('every rule has id, rule text, and severity', () => {
      const c = load();
      for (const [key, article] of Object.entries(c.articles)) {
        for (const rule of article.rules) {
          expect(rule.id, `${key} rule missing id`).toBeTruthy();
          expect(rule.rule, `${key}/${rule.id} missing rule text`).toBeTruthy();
          expect(rule.severity, `${key}/${rule.id} missing severity`).toBeTruthy();
        }
      }
    });

    it('thresholds are defined', () => {
      const c = load();
      expect(c.thresholds).toBeDefined();
      expect(c.thresholds.minTestCount).toBeGreaterThanOrEqual(1);
      expect(c.thresholds.minCoveragePercent).toBeGreaterThanOrEqual(70);
    });
  });
});
