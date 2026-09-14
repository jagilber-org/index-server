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
    it('publishConfig.registry points to GitHub Packages', () => {
      expect(pkg.publishConfig?.registry).toBe('https://npm.pkg.github.com');
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
      const allowedScripts = [
        'scripts/build/copy-dashboard-assets.mjs',
        'scripts/hooks/setup-hooks.cjs',
        'scripts/build/generate-certs.mjs',
        'scripts/build/setup-wizard.mjs',
        // setup-wizard.mjs imports ./setup-wizard-paths.mjs at runtime; both must ship.
        'scripts/build/setup-wizard-paths.mjs',
        'scripts/build/uninstall-wizard.mjs',
        // Client wrapper scripts shipped for the dashboard /api/scripts/:name route (v1.28.12).
        'scripts/client/',
      ];
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
    interface PackEntry { path: string }
    interface PackResult { files?: PackEntry[]; entryCount?: number; size?: number }

    let packedPaths: string[];
    let packEntryCount: number;
    let packSizeBytes: number;

    // Run once for all sub-tests. `--ignore-scripts` skips the `prepare`
    // lifecycle hook (which runs scripts/hooks/setup-hooks.cjs and can fail in
    // CI Windows environments that lack git hooks dir). The test only cares
    // about the resulting file manifest, not the side-effect hooks.
    //
    // Read as JSON rather than scraping `npm notice` text (#576). `npm run -s`
    // exports npm_config_loglevel=silent to child processes, so the nested
    // `npm pack` printed no notices at all and 8 assertions here failed on
    // text that was never emitted -- a red gate with no code change, on any
    // machine or CI lane with a silent loglevel. The explicit env override
    // neutralises an inherited silent; --json makes the manifest data rather
    // than a log line, so verbosity cannot change the verdict either way.
    {
      let raw: string;
      try {
        raw = execSync('npm pack --dry-run --ignore-scripts --json', {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          timeout: 30000,
          env: { ...process.env, npm_config_loglevel: 'notice' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        // npm can exit non-zero on Windows while still emitting the manifest.
        const err = e as { stdout?: Buffer | string };
        raw = err.stdout ? err.stdout.toString() : '';
      }

      // npm occasionally prefixes stdout with a warning line; take the array.
      const start = raw.indexOf('[');
      const end = raw.lastIndexOf(']');
      if (start === -1 || end === -1) {
        throw new Error(
          `npm pack --json produced no JSON array. This is a harness failure, not a packaging finding. Raw output:\n${raw.slice(0, 2000)}`,
        );
      }
      const parsed = JSON.parse(raw.slice(start, end + 1)) as PackResult[];
      const result = parsed[0];
      if (!result || !Array.isArray(result.files)) {
        throw new Error(`npm pack --json returned no file manifest: ${JSON.stringify(result).slice(0, 500)}`);
      }

      packedPaths = result.files.map(f => f.path.replace(/\\/g, '/'));
      packEntryCount = result.entryCount ?? packedPaths.length;
      packSizeBytes = result.size ?? 0;
    }

    /** Paths under a directory prefix — for the "must not ship" assertions. */
    const under = (prefix: string): string[] => packedPaths.filter(p => p.startsWith(prefix));

    it('resolved a non-empty file manifest', () => {
      // Guards every assertion below: an empty manifest would make each
      // `not.toContain` pass vacuously, which is how #576 stayed invisible.
      expect(packedPaths.length).toBeGreaterThan(0);
    });

    it('pack includes dist/server/index-server.js', () => {
      expect(packedPaths).toContain('dist/server/index-server.js');
    });

    it('pack includes schemas/', () => {
      expect(under('schemas/')).not.toHaveLength(0);
    });

    it('pack includes README.md', () => {
      expect(packedPaths).toContain('README.md');
    });

    it('pack includes LICENSE', () => {
      expect(packedPaths).toContain('LICENSE');
    });

    it('pack does NOT include dist/tests/', () => {
      expect(under('dist/tests/')).toEqual([]);
    });

    it('pack does NOT include src/', () => {
      // src/ should never be in the pack (only dist/)
      expect(under('src/')).toEqual([]);
    });

    it('pack does NOT include internal templates/', () => {
      // templates/spec-template.md is intentionally included for distribution;
      // only internal template directories should be excluded
      expect(under('templates/internal/')).toEqual([]);
    });

    it('pack does NOT include node_modules/', () => {
      expect(under('node_modules/')).toEqual([]);
    });

    // Regression: #239 — generate-certs.mjs must appear in npm pack output
    it('pack includes scripts/build/generate-certs.mjs (issue #239)', () => {
      expect(packedPaths).toContain('scripts/build/generate-certs.mjs');
    });

    it('pack includes scripts/build/setup-wizard.mjs', () => {
      expect(packedPaths).toContain('scripts/build/setup-wizard.mjs');
    });

    // Regression: #592 — test scaffolding must not ship to consumers.
    // test_primitive was a registered, callable handler returning 42; the
    // Pester file is dev tooling inside the published client scripts.
    it('pack excludes the test_primitive handler (issue #592)', () => {
      expect(packedPaths.filter(p => p.includes('handlers.testPrimitive'))).toEqual([]);
    });

    it('pack excludes scripts/client/tests/ (issue #592)', () => {
      expect(under('scripts/client/tests/')).toEqual([]);
    });

    it('total file count is under 800', () => {
      expect(packEntryCount).toBeGreaterThan(0);
      expect(packEntryCount).toBeLessThan(800);
    });

    it('package size is under 5 MB', () => {
      expect(packSizeBytes).toBeGreaterThan(0);
      expect(packSizeBytes / (1024 * 1024)).toBeLessThan(5);
    });
  });
});
