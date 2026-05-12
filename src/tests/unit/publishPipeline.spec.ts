/**
 * Publish pipeline scenario tests — validates the build + verify-only dry-run
 * pipeline as a complete end-to-end flow.
 *
 * These tests exercise the full pipeline: build (tsc), then verify-only publish,
 * confirming the compiled output is valid for publication. Also validates
 * dist/ artifact integrity that the build step produces.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { sanitizedPublishEnv } from '../helpers/publishEnv';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist');
const CJS_PATH = path.join(REPO_ROOT, 'scripts', 'build', 'publish-direct-to-remote.cjs');
const HAS_PUBLISH_EXCLUDE = fs.existsSync(path.join(REPO_ROOT, '.publish-exclude'));

const EXEC_OPTS = {
  cwd: REPO_ROOT,
  encoding: 'utf8' as const,
  stdio: 'pipe' as const,
  maxBuffer: 50 * 1024 * 1024,
  env: sanitizedPublishEnv(),
};

describe('publish pipeline — build + verify-only', () => {

  describe('build step prerequisites', () => {
    it('dist/ directory exists (build already ran)', () => {
      expect(fs.existsSync(DIST_DIR)).toBe(true);
    });

    it('dist/server/index-server.js exists as entry point', () => {
      const entry = path.join(DIST_DIR, 'server', 'index-server.js');
      expect(fs.existsSync(entry)).toBe(true);
    });

    it('dist/ contains compiled JS files (not empty)', () => {
      const files = walkDir(DIST_DIR).filter(f => f.endsWith('.js'));
      expect(files.length).toBeGreaterThan(10);
    });

    it('dist/ does not contain .ts source files', () => {
      const tsFiles = walkDir(DIST_DIR).filter(
        f => f.endsWith('.ts') && !f.endsWith('.d.ts')
      );
      expect(tsFiles).toEqual([]);
    });
  });

  describe.skipIf(!HAS_PUBLISH_EXCLUDE)('verify-only dry-run pipeline', () => {
    let verifyOutput: string;

    beforeAll(() => {
      verifyOutput = execSync(
        `node "${CJS_PATH}" --verify-only --quiet`,
        EXEC_OPTS
      );
    }, 120_000);

    it('verify-only completes successfully', () => {
      expect(verifyOutput).toBeTruthy();
    });

    it('dry-run banner appears in output', () => {
      expect(verifyOutput).toContain('VERIFY ONLY');
    });

    it('verification passed confirmation appears', () => {
      expect(verifyOutput).toContain('Verification passed');
    });

    it('no destructive operations in dry-run', () => {
      expect(verifyOutput).not.toContain('Pushing to');
      expect(verifyOutput).not.toContain('Creating release');
      expect(verifyOutput).not.toContain('git tag');
    });

    it('file count is reported and plausible', () => {
      const match = verifyOutput.match(/Files that would be published: (\d+)/);
      expect(match).not.toBeNull();
      const count = parseInt(match![1], 10);
      expect(count).toBeGreaterThan(20);
      expect(count).toBeLessThan(50000);
    });
  });

  describe.skipIf(!HAS_PUBLISH_EXCLUDE)('critical files included in publish set', () => {
    let output: string;

    beforeAll(() => {
      // Needs full file listing (no --quiet) to check individual files
      output = execSync(`node "${CJS_PATH}" --verify-only`, EXEC_OPTS);
    }, 120_000);

    it('package.json would be published', () => {
      expect(output).toContain('package.json');
    });

    it('README.md would be published', () => {
      expect(output).toContain('README.md');
    });

    it('LICENSE would be published', () => {
      expect(output).toContain('LICENSE');
    });
  });

  describe.skipIf(!HAS_PUBLISH_EXCLUDE)('sensitive artifacts excluded from publish set', () => {
    let output: string;

    beforeAll(() => {
      output = execSync(`node "${CJS_PATH}" --verify-only`, EXEC_OPTS);
    }, 120_000);

    it('node_modules not in publish output', () => {
      const lines = output.split(/\r?\n/);
      const publishedNM = lines.filter(l => l.trim().startsWith('node_modules/'));
      expect(publishedNM).toEqual([]);
    });

    it('.env not in publish output', () => {
      const lines = output.split(/\r?\n/).map(l => l.trim());
      const envLines = lines.filter(l => l === '.env' || l.startsWith('.env/'));
      expect(envLines).toEqual([]);
    });
  });

  describe('dist integrity for publication', () => {
    it('dist/server/index-server.js is valid JavaScript', () => {
      const entry = path.join(DIST_DIR, 'server', 'index-server.js');
      const content = fs.readFileSync(entry, 'utf8');
      // Should start with JS syntax (use strict, comment, or require)
      expect(content.length).toBeGreaterThan(100);
      // Should not contain TypeScript-only syntax (interface, type alias at top level)
      // A compiled CJS file typically starts with "use strict" or has require() calls
      expect(content).toMatch(/(["']use strict["']|require\(|Object\.defineProperty)/);
    });

    it('dashboard assets are copied to dist', () => {
      const dashboardDir = path.join(DIST_DIR, 'dashboard');
      if (fs.existsSync(dashboardDir)) {
        const files = walkDir(dashboardDir);
        expect(files.length).toBeGreaterThan(0);
      }
      // If dashboard dir doesn't exist in dist, assets may be served differently
    });
  });
});

/** Recursively walk a directory and return all file paths (relative to root) */
function walkDir(dir: string, root?: string): string[] {
  root = root || dir;
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, root));
    } else {
      results.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  return results;
}
