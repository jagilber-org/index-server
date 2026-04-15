/**
 * Tests for dual-repo publish script hardening:
 * - Forbidden list consistency between CJS and PS1 scripts
 * - Root-level dotfile stripping behavior
 * - --verify-only flag exits without push
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CJS_PATH = path.join(REPO_ROOT, 'scripts', 'publish.cjs');
const PS1_PATH = path.join(REPO_ROOT, 'scripts', 'Publish-DualRepo.ps1');
const HAS_PUBLISH_EXCLUDE = fs.existsSync(path.join(REPO_ROOT, '.publish-exclude'));
const HAS_PS1_SCRIPT = fs.existsSync(PS1_PATH);

// ── Helpers to extract forbidden lists from both scripts ──────────────────

function extractCjsForbiddenList(): string[] {
  const src = fs.readFileSync(CJS_PATH, 'utf8');
  // Match the forbidden array inside verifyNoLeakedArtifacts
  const match = src.match(/function verifyNoLeakedArtifacts[\s\S]*?const forbidden = \[([\s\S]*?)\];/);
  if (!match) throw new Error('Could not find forbidden list in publish.cjs');
  return match[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(s => s.length > 0);
}

function extractPs1ForbiddenList(): string[] {
  const src = fs.readFileSync(PS1_PATH, 'utf8');
  // Match the ForbiddenItems default array
  const match = src.match(/\[string\[\]\]\$ForbiddenItems = @\(([\s\S]*?)\)/);
  if (!match) throw new Error('Could not find ForbiddenItems in Publish-DualRepo.ps1');
  return match[1]
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(s => s.length > 0);
}

// ── Helpers for dotfile / staging tests ───────────────────────────────────

const STAGING_DIR = path.join(REPO_ROOT, 'tmp', 'publish-test-staging');

function setupStagingDir() {
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  // Create a fake repo root with dotfiles and normal files
  const fakeRoot = path.join(STAGING_DIR, 'fake-repo');
  fs.mkdirSync(fakeRoot, { recursive: true });

  // Normal files that should survive
  fs.writeFileSync(path.join(fakeRoot, 'README.md'), '# test');
  fs.writeFileSync(path.join(fakeRoot, 'package.json'), '{}');

  // Essential dotfiles that should survive
  fs.writeFileSync(path.join(fakeRoot, '.gitignore'), 'node_modules');
  fs.writeFileSync(path.join(fakeRoot, '.npmignore'), 'test');
  fs.writeFileSync(path.join(fakeRoot, '.npmrc'), 'registry=https://registry.npmjs.org');

  // Non-essential dotfiles that should be stripped
  fs.mkdirSync(path.join(fakeRoot, '.specify'), { recursive: true });
  fs.writeFileSync(path.join(fakeRoot, '.specify', 'data.json'), '{}');
  fs.mkdirSync(path.join(fakeRoot, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(fakeRoot, '.vscode', 'settings.json'), '{}');
  fs.writeFileSync(path.join(fakeRoot, '.env'), 'SECRET=abc');
  fs.writeFileSync(path.join(fakeRoot, '.eslintrc.json'), '{}');

  // Subdirectory with dotfiles (should NOT be stripped — only root-level)
  fs.mkdirSync(path.join(fakeRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fakeRoot, 'src', '.hidden'), 'nested dotfile');

  // .git should always be skipped
  fs.mkdirSync(path.join(fakeRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(fakeRoot, '.git', 'HEAD'), 'ref: refs/heads/main');

  return fakeRoot;
}

function cleanupStagingDir() {
  if (fs.existsSync(STAGING_DIR)) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('publish script hardening', () => {

  describe.skipIf(!HAS_PS1_SCRIPT || !HAS_PUBLISH_EXCLUDE)('forbidden list consistency', () => {
    let cjsList: string[];
    let ps1List: string[];

    beforeAll(() => {
      cjsList = extractCjsForbiddenList();
      ps1List = extractPs1ForbiddenList();
    });

    it('CJS and PS1 forbidden lists contain the same items', () => {
      const cjsSorted = [...cjsList].sort();
      const ps1Sorted = [...ps1List].sort();
      expect(cjsSorted).toEqual(ps1Sorted);
    });

    it('both lists include critical internal artifact names', () => {
      const critical = [
        '.specify', '.private', '.env', '.certs',
        '.squad', '.squad-templates', '.secrets.baseline',
        'instructions', 'devinstructions', 'logs',
        'backups', 'governance', 'memory', 'feedback',
        'NVIDIA Corporation', 'data', 'node_modules',
      ];
      for (const item of critical) {
        expect(cjsList).toContain(item);
        expect(ps1List).toContain(item);
      }
    });

    it('neither list is empty', () => {
      expect(cjsList.length).toBeGreaterThan(10);
      expect(ps1List.length).toBeGreaterThan(10);
    });
  });

  describe('dotfile stripping behavior', () => {
    let fakeRoot: string;
    let outputDir: string;

    beforeAll(() => {
      fakeRoot = setupStagingDir();
      outputDir = path.join(STAGING_DIR, 'output');
      fs.mkdirSync(outputDir, { recursive: true });

      // Use the local copy function that mirrors publish.cjs algorithm
      copyRecursiveLocal(fakeRoot, outputDir, fakeRoot, []);
    });

    afterAll(() => {
      cleanupStagingDir();
    });

    it('preserves essential dotfiles (.gitignore, .npmignore, .npmrc)', () => {
      expect(fs.existsSync(path.join(outputDir, '.gitignore'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, '.npmignore'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, '.npmrc'))).toBe(true);
    });

    it('strips private root dotfiles (.env, .vscode, .specify)', () => {
      expect(fs.existsSync(path.join(outputDir, '.env'))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, '.vscode'))).toBe(false);
      expect(fs.existsSync(path.join(outputDir, '.specify'))).toBe(false);
    });

    it('preserves non-private root dotfiles (.eslintrc.json)', () => {
      expect(fs.existsSync(path.join(outputDir, '.eslintrc.json'))).toBe(true);
    });

    it('always strips .git directory', () => {
      expect(fs.existsSync(path.join(outputDir, '.git'))).toBe(false);
    });

    it('preserves normal files', () => {
      expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'package.json'))).toBe(true);
    });

    it('preserves dotfiles in subdirectories (only root is stripped)', () => {
      expect(fs.existsSync(path.join(outputDir, 'src', '.hidden'))).toBe(true);
    });
  });

  describe.skipIf(!HAS_PUBLISH_EXCLUDE)('--verify-only flag', () => {
    let verifyOutput: string;

    beforeAll(() => {
      verifyOutput = execSync(
        `node "${CJS_PATH}" --verify-only --quiet`,
        { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 }
      );
    }, 120_000);

    it('exits with code 0 and does not push when validation passes', () => {
      expect(verifyOutput).toContain('VERIFY ONLY');
      expect(verifyOutput).toContain('Verification passed');
      expect(verifyOutput).not.toContain('Pushing to');
      expect(verifyOutput).not.toContain('git push');
    });

    it('prints file count in summary', () => {
      expect(verifyOutput).toMatch(/Files that would be published: \d+/);
      expect(verifyOutput).toMatch(/Total: \d+ files/);
    });
  });
});

// ── Local copy function mirroring publish.cjs logic ──────────────────────
// Duplicated here to test the algorithm without module-level side effects

const PRIVATE_DOTFILES = new Set([
  '.certs', '.copilot', '.env', '.private', '.specify', '.squad',
  '.squad-templates', '.vscode', '.publish-exclude', '.secrets.baseline',
  '.pre-commit-config.yaml',
]);

function copyRecursiveLocal(
  src: string,
  dest: string,
  root: string,
  excludePaths: string[]
) {
  const isRoot = path.resolve(src) === path.resolve(root);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = path.relative(root, srcPath).replace(/\\/g, '/');

    if (entry.name === '.git') continue;

    if (isRoot && entry.name.startsWith('.') && PRIVATE_DOTFILES.has(entry.name)) {
      continue;
    }

    const excluded = excludePaths.some((ex: string) => {
      const exNorm = ex.replace(/\\/g, '/');
      if (exNorm.endsWith('/')) {
        return relPath.startsWith(exNorm) || relPath + '/' === exNorm;
      }
      if (exNorm.endsWith('*')) {
        return relPath.startsWith(exNorm.slice(0, -1));
      }
      return relPath === exNorm;
    });
    if (excluded) continue;

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursiveLocal(srcPath, destPath, root, excludePaths);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
