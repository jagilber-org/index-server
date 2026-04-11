/**
 * Package.json enterprise fields tests — verify package.json is
 * correctly configured for enterprise dual-publish.
 *
 * Phase 4 TDD: Validates Phase 3 package.json configuration.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

interface PackageJson {
  name: string;
  version: string;
  engines?: { node?: string };
  files?: string[];
  main?: string;
  private?: boolean;
  scripts?: Record<string, string>;
}

describe('package.json enterprise fields', () => {
  function load(): PackageJson {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  }

  describe('engines constraint', () => {
    it('engines.node requires Node 22+', () => {
      const pkg = load();
      expect(pkg.engines).toBeDefined();
      expect(pkg.engines!.node).toBe('>=22');
    });
  });

  describe('files field', () => {
    it('files array exists', () => {
      const pkg = load();
      expect(pkg.files).toBeDefined();
      expect(Array.isArray(pkg.files)).toBe(true);
    });

    it('files includes "dist/"', () => {
      const pkg = load();
      expect(pkg.files).toContain('dist/');
    });

    it('files includes essential documentation', () => {
      const pkg = load();
      expect(pkg.files).toContain('README.md');
      expect(pkg.files).toContain('LICENSE');
      expect(pkg.files).toContain('CHANGELOG.md');
    });

    it('files does NOT include internal artifacts', () => {
      const pkg = load();
      const forbidden = ['src/', 'tests/', 'tmp/', '.specify/', 'instructions/', 'data/'];
      for (const pattern of forbidden) {
        expect(pkg.files).not.toContain(pattern);
      }
    });
  });

  describe('main entry point', () => {
    it('main field is defined', () => {
      const pkg = load();
      expect(pkg.main).toBeDefined();
    });

    it('main points to a valid file', () => {
      const pkg = load();
      const mainPath = path.join(REPO_ROOT, pkg.main!);
      expect(fs.existsSync(mainPath)).toBe(true);
    });

    it('main is in dist/ directory', () => {
      const pkg = load();
      expect(pkg.main).toMatch(/^dist\//);
    });
  });

  describe('essential scripts', () => {
    it('has build script', () => {
      const pkg = load();
      expect(pkg.scripts).toBeDefined();
      expect(pkg.scripts!.build).toBeDefined();
    });

    it('has test script', () => {
      const pkg = load();
      expect(pkg.scripts!.test).toBeDefined();
    });

    it('has typecheck script', () => {
      const pkg = load();
      expect(pkg.scripts!.typecheck).toBeDefined();
    });
  });
});
