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

  describe('testing article (TS-1 to TS-11)', () => {
    it('has a "testing" article', () => {
      const c = load();
      expect(c.articles.testing).toBeDefined();
    });

    it('contains all 11 testing rules TS-1 through TS-11', () => {
      const c = load();
      const ids = getRuleIds(c.articles.testing);
      for (let i = 1; i <= 11; i++) {
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

  describe('codeQuality article (CQ-1 to CQ-7)', () => {
    it('has a "codeQuality" article', () => {
      const c = load();
      expect(c.articles.codeQuality).toBeDefined();
    });

    it('contains all 7 code quality rules CQ-1 through CQ-7', () => {
      const c = load();
      const ids = getRuleIds(c.articles.codeQuality);
      for (let i = 1; i <= 7; i++) {
        expect(ids).toContain(`CQ-${i}`);
      }
    });
  });

  describe('delivery article (CD + PB rules)', () => {
    it('has a "delivery" article', () => {
      const c = load();
      expect(c.articles.delivery).toBeDefined();
    });

    it('contains delivery rules CD-1 through CD-4 and PB-6', () => {
      const c = load();
      const ids = getRuleIds(c.articles.delivery);
      for (let i = 1; i <= 4; i++) {
        expect(ids).toContain(`CD-${i}`);
      }
      expect(ids).toContain('PB-6');
    });
  });

  describe('dataIntegrity article (DI-1 to DI-3)', () => {
    it('has a "dataIntegrity" article', () => {
      const c = load();
      expect(c.articles.dataIntegrity).toBeDefined();
    });

    it('contains all 3 data-integrity rules DI-1 through DI-3', () => {
      const c = load();
      const ids = getRuleIds(c.articles.dataIntegrity);
      for (let i = 1; i <= 3; i++) {
        expect(ids).toContain(`DI-${i}`);
      }
    });
  });

  describe('security article includes SH-1 through SH-9', () => {
    it('has a "security" article with SH rules', () => {
      const c = load();
      expect(c.articles.security).toBeDefined();
      const ids = getRuleIds(c.articles.security);
      for (let i = 1; i <= 9; i++) {
        expect(ids).toContain(`SH-${i}`);
      }
    });
  });

  describe('PB-6 in delivery article', () => {
    it('PB-6 covers pre-push hook and public remote blocking', () => {
      const c = load();
      const pb6 = c.articles.delivery.rules.find(r => r.id === 'PB-6');
      expect(pb6).toBeDefined();
      expect(pb6!.rule.toLowerCase()).toMatch(/pre-push|public/i);
    });
  });

  describe('structural completeness', () => {
    it('has all expected article keys', () => {
      const c = load();
      const expected = [
        'security', 'architecture', 'governance',
        'testing', 'delivery', 'codeQuality',
        'dataIntegrity', 'documentation', 'validation',
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
