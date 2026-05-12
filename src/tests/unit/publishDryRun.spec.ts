/**
 * Publish dry-run scenario tests — exercise the --verify-only flag
 * and validate output format / forbidden item absence.
 *
 * Phase 4 TDD: Validates Phase 3 publish script hardening.
 *
 * Note: publishScripts.spec.ts already tests basic --verify-only behavior.
 * This file adds deeper scenario coverage: forbidden item scanning,
 * output format validation, and exit code guarantees.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { sanitizedPublishEnv } from '../helpers/publishEnv';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CJS_PATH = path.join(REPO_ROOT, 'scripts', 'build', 'publish-direct-to-remote.cjs');
const HAS_PUBLISH_EXCLUDE = fs.existsSync(path.join(REPO_ROOT, '.publish-exclude'));
const EXEC_OPTS = {
  cwd: REPO_ROOT,
  encoding: 'utf8' as const,
  stdio: 'pipe' as const,
  maxBuffer: 50 * 1024 * 1024,
  env: sanitizedPublishEnv(),
};

describe('publish --verify-only scenarios', () => {

  describe.skipIf(!HAS_PUBLISH_EXCLUDE)('exit code and basic output', () => {
    let output: string;

    beforeAll(() => {
      // Run once and cache — staging 15K+ files is expensive
      output = execSync(
        `node "${CJS_PATH}" --verify-only --quiet`,
        EXEC_OPTS
      );
    }, 120_000);

    it('exits with code 0 (no throw)', () => {
      expect(output).toBeTruthy();
    });

    it('output includes VERIFY ONLY banner', () => {
      expect(output).toContain('VERIFY ONLY');
    });

    it('output includes verification passed confirmation', () => {
      expect(output).toContain('Verification passed');
    });
  });

  describe.skipIf(!HAS_PUBLISH_EXCLUDE)('file count summary', () => {
    let output: string;

    beforeAll(() => {
      output = execSync(
        `node "${CJS_PATH}" --verify-only --quiet`,
        EXEC_OPTS
      );
    }, 120_000);

    it('reports "Files that would be published" with a count', () => {
      const match = output.match(/Files that would be published: (\d+)/);
      expect(match).not.toBeNull();
      const count = parseInt(match![1], 10);
      expect(count).toBeGreaterThan(0);
    });

    it('reports total file count', () => {
      expect(output).toMatch(/Total: \d+ files/);
    });
  });

  describe.skipIf(!HAS_PUBLISH_EXCLUDE)('no forbidden items in output', () => {
    // With --quiet, individual file lines are suppressed — the real forbidden-item
    // check is done internally by verifyNoLeakedArtifacts() which would cause a
    // non-zero exit (and execSync would throw) if any leaked artifacts were found.
    it('verify-only exits successfully (verifyNoLeakedArtifacts passed internally)', () => {
      const output = execSync(
        `node "${CJS_PATH}" --verify-only --quiet`,
        EXEC_OPTS
      );
      expect(output).toContain('Verification passed');
    }, 120_000);

    it('no git push or remote operations in output', () => {
      const output = execSync(
        `node "${CJS_PATH}" --verify-only --quiet`,
        EXEC_OPTS
      );
      expect(output).not.toContain('git push');
      expect(output).not.toContain('Pushing to');
      expect(output).not.toContain('git remote');
    }, 120_000);
  });

  describe('script file integrity', () => {
    it('publish-direct-to-remote.cjs exists', () => {
      expect(fs.existsSync(CJS_PATH)).toBe(true);
    });

    it('publish-direct-to-remote.cjs is not empty', () => {
      const stat = fs.statSync(CJS_PATH);
      expect(stat.size).toBeGreaterThan(1000);
    });

    it('publish-direct-to-remote.cjs contains --verify-only flag handler', () => {
      const src = fs.readFileSync(CJS_PATH, 'utf8');
      expect(src).toContain('--verify-only');
      expect(src).toContain('verifyNoLeakedArtifacts');
    });
  });
});
