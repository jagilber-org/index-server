/**
 * npm pack readiness tests (TDD red → green).
 * Validates package.json is correctly configured for public npm publishing.
 *
 * Tests:
 * 1. publishConfig points to npmjs.org (not GitHub Packages)
 * 2. bin entry exists and points to a file with a shebang
 * 3. files array excludes test artifacts and internal templates
 * 4. npm pack --dry-run includes required files and excludes unwanted ones
 * 5. Package is not marked private
 * 6. engines.node is reasonable
 * 7. Entry point (main) exists in dist/
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

describe('npm publish readiness', () => {

  describe('package.json configuration', () => {
    it('publishConfig.registry points to npmjs.org', () => {
      expect(pkg.publishConfig?.registry).toBe('https://registry.npmjs.org/');
    });

    it('package is not marked private', () => {
      expect(pkg.private).not.toBe(true);
    });

    it('has a bin entry pointing to dist/server/index-server.js', () => {
      expect(pkg.bin).toBeDefined();
      expect(pkg.bin['index-server']).toBe('dist/server/index-server.js');
    });

    it('main field points to dist/server/index-server.js', () => {
      expect(pkg.main).toBe('dist/server/index-server.js');
    });

    it('engines.node specifies a minimum version', () => {
      expect(pkg.engines?.node).toBeDefined();
      expect(pkg.engines.node).toMatch(/>=\d+/);
    });

    it('version follows semver', () => {
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('has a description for npmjs listing', () => {
      expect(pkg.description).toBeTruthy();
      expect(pkg.description.length).toBeGreaterThan(10);
    });

    it('has repository field for npm page linking', () => {
      expect(pkg.repository).toBeDefined();
    });

    it('has a license field', () => {
      expect(pkg.license).toBeDefined();
      expect(pkg.license).toBe('MIT');
    });
  });

  describe('bin entry point', () => {
    const binPath = path.join(REPO_ROOT, pkg.bin['index-server']);

    it('bin target file exists in dist/', () => {
      expect(fs.existsSync(binPath)).toBe(true);
    });

    it('bin target has Node.js shebang', () => {
      const firstLine = fs.readFileSync(binPath, 'utf8').split('\n')[0];
      expect(firstLine).toMatch(/^#!.*node/);
    });

    it('bin setup launcher points to the packed setup wizard path', () => {
      const bin = fs.readFileSync(binPath, 'utf8');
      expect(bin).toContain("'scripts', 'build', 'setup-wizard.mjs'");
      expect(bin).not.toContain("'scripts', 'setup-wizard.mjs'");
    });
  });

  describe('files field (what npm pack includes)', () => {
    it('files array includes dist/', () => {
      expect(pkg.files).toContain('dist/');
    });

    it('files array includes schemas/', () => {
      expect(pkg.files).toContain('schemas/');
    });

    it('files array does NOT include internal templates/', () => {
      // templates/ may be in files for npm distribution; only check that
      // internal-only paths like 'templates/internal/' are absent
      const hasInternalTemplates = pkg.files.some((f: string) => f.startsWith('templates/internal'));
      expect(hasInternalTemplates).toBe(false);
    });

    it('files array does NOT include scripts/ build helpers (except allowed helpers)', () => {
      const allowedScripts = ['scripts/build/copy-dashboard-assets.mjs', 'scripts/hooks/setup-hooks.cjs', 'scripts/build/generate-certs.mjs', 'scripts/build/setup-wizard.mjs'];
      const hasDisallowedScripts = pkg.files.some(
        (f: string) => f.startsWith('scripts/') && !allowedScripts.includes(f)
      );
      expect(hasDisallowedScripts).toBe(false);
    });

    it('files array does NOT include src/', () => {
      expect(pkg.files).not.toContain('src/');
    });

    // Regression: #239 — generate-certs.mjs must ship so npx --setup TLS works
    it('files array includes scripts/build/generate-certs.mjs (issue #239)', () => {
      expect(pkg.files).toContain('scripts/build/generate-certs.mjs');
    });

    it('files array includes scripts/build/setup-wizard.mjs', () => {
      expect(pkg.files).toContain('scripts/build/setup-wizard.mjs');
    });
  });

  describe('npm pack output', () => {
    let packOutput: string;

    // Run once for all sub-tests
    try {
      packOutput = execSync('npm pack --dry-run 2>&1', {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 30000,
      });
    } catch (e) {
      packOutput = (e as { stdout?: string }).stdout ?? '';
    }

    it('pack includes dist/server/index-server.js', () => {
      expect(packOutput).toContain('dist/server/index-server.js');
    });

    it('pack includes schemas/', () => {
      expect(packOutput).toContain('schemas/');
    });

    it('pack includes README.md', () => {
      expect(packOutput).toContain('README.md');
    });

    it('pack includes LICENSE', () => {
      expect(packOutput).toContain('LICENSE');
    });

    it('pack does NOT include dist/tests/', () => {
      expect(packOutput).not.toMatch(/dist\/tests\//);
    });

    it('pack does NOT include src/', () => {
      // src/ should never be in the pack (only dist/)
      expect(packOutput).not.toMatch(/\bsrc\//);
    });

    it('pack does NOT include internal templates/', () => {
      // templates/spec-template.md is intentionally included for distribution;
      // only internal template directories should be excluded
      expect(packOutput).not.toMatch(/\btemplates\/internal\//);
    });

    it('pack does NOT include node_modules/', () => {
      expect(packOutput).not.toMatch(/\bnode_modules\//);
    });

    // Regression: #239 — generate-certs.mjs must appear in npm pack output
    it('pack includes scripts/build/generate-certs.mjs (issue #239)', () => {
      expect(packOutput).toContain('scripts/build/generate-certs.mjs');
    });

    it('pack includes scripts/build/setup-wizard.mjs', () => {
      expect(packOutput).toContain('scripts/build/setup-wizard.mjs');
    });

    it('total file count is under 800', () => {
      const match = packOutput.match(/total files:\s*(\d+)/);
      expect(match).not.toBeNull();
      const count = parseInt(match![1], 10);
      expect(count).toBeLessThan(800);
    });

    it('package size is under 5 MB', () => {
      const match = packOutput.match(/package size:\s*([\d.]+)\s*(MB|kB)/);
      expect(match).not.toBeNull();
      const size = parseFloat(match![1]);
      const unit = match![2];
      const sizeMB = unit === 'kB' ? size / 1024 : size;
      expect(sizeMB).toBeLessThan(5);
    });
  });
});
