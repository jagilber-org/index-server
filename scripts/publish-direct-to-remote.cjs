#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Dual-Repo Publish Script
 *
 * Publishes a cleaned copy of the dev repo to the public publication repo.
 * Reads .publish-exclude for paths to strip. Uses the developer's normal
 * git credentials (no PAT required).
 * Scans ALL staged files for env-var value leaks before pushing.
 *
 * Usage:
 *   node scripts/publish-direct-to-remote.cjs --tag v1.7.0          # publish with tag
 *   node scripts/publish-direct-to-remote.cjs --dry-run              # preview only
 *   node scripts/publish-direct-to-remote.cjs --tag v1.7.0 --force   # skip dirty-tree check
 *
 * Prerequisites:
 *   - Git remote "public" configured:
 *     git remote add public https://github.com/jagilber-org/server-vault.git
 *   - .publish-exclude file in repo root
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ── CLI Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const createRelease = args.includes('--create-release');
const verifyOnly = args.includes('--verify-only');
const quiet = args.includes('--quiet');
const tagIdx = args.indexOf('--tag');
const tag = tagIdx !== -1 ? args[tagIdx + 1] : null;

if (!dryRun && !verifyOnly && !tag) {
  console.error('ERROR: --tag <version> is required (or use --dry-run / --verify-only).');
  console.error('Usage: node scripts/publish-direct-to-remote.cjs --tag v1.7.0 [--create-release]');
  console.error('       node scripts/publish-direct-to-remote.cjs --verify-only   # CI validation only');
  process.exit(1);
}

// Validate tag format to prevent command injection
if (tag && !/^v?\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(tag)) {
  console.error(`ERROR: Invalid tag format: "${tag}". Expected semver like v1.2.3`);
  process.exit(1);
}

// ── Paths ─────────────────────────────────────────────────────────────────────
const repoRoot = path.resolve(__dirname, '..');
const excludeFile = path.join(repoRoot, '.publish-exclude');

if (!fs.existsSync(excludeFile)) {
  console.error('ERROR: .publish-exclude not found at', excludeFile);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function runGit(args, opts = {}) {
  const defaults = { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' };
  return execFileSync('git', args, { ...defaults, ...opts }).trim();
}

function runGitShow(args, opts = {}) {
  const defaults = { cwd: repoRoot, stdio: 'inherit' };
  execFileSync('git', args, { ...defaults, ...opts });
}

function runGh(args, opts = {}) {
  const defaults = { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' };
  return execFileSync('gh', args, { ...defaults, ...opts }).trim();
}

function loadExcludeList() {
  const raw = fs.readFileSync(excludeFile, 'utf8');
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

// Root-level dotfiles/dirs to EXCLUDE from publish (private/dev-only).
// Everything else (including .eslintrc.json, .dockerignore, .nvmrc, etc.) passes through.
const PRIVATE_DOTFILES = new Set([
  '.certs', '.copilot', '.env', '.private', '.specify', '.squad',
  '.squad-templates', '.vscode', '.publish-exclude', '.secrets.baseline',
  '.pre-commit-config.yaml',
]);

function copyRecursive(src, dest, excludePaths) {
  const isRoot = path.resolve(src) === path.resolve(repoRoot);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = path.relative(repoRoot, srcPath).replace(/\\/g, '/');

    // Skip .git always
    if (entry.name === '.git') continue;

    // Strip private root-level dotfiles; keep all others (.eslintrc, .dockerignore, .github, etc.)
    if (isRoot && entry.name.startsWith('.') && PRIVATE_DOTFILES.has(entry.name)) {
      continue;
    }

    // Check exclusions (supports exact match, directory prefix with /, and glob prefix with *)
    const excluded = excludePaths.some(ex => {
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
      copyRecursive(srcPath, destPath, excludePaths);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function verifyNoLeakedArtifacts(dir) {
  const forbidden = [
    '.specify', 'specs', 'state', 'logs', 'backups',
    'feedback', 'governance', 'memory', 'metrics',
    'snapshots', 'tmp', 'test-results', 'coverage',
    'seed', '.secrets.baseline', '.pii-allowlist',
    'instructions', 'devinstructions', 'NVIDIA Corporation',
    '.private', '.env', '.certs', '.squad', '.squad-templates',
    'templates', 'data', 'node_modules'
  ];
  const found = [];
  for (const name of forbidden) {
    if (fs.existsSync(path.join(dir, name))) {
      found.push(name);
    }
  }
  // Also flag any private dotfile that survived
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.') && PRIVATE_DOTFILES.has(entry)) {
      found.push(entry);
    }
  }
  return found;
}

// ── Env-var leak scanning ─────────────────────────────────────────────────────
// Builds a map of sensitive env var values and scans all text files for matches.
// This catches subscription IDs, tenant IDs, API keys, tokens, etc. that the
// developer's shell profile has loaded.
const SENSITIVE_ENV_PREFIXES = [
  'AZURE_', 'ARM_', 'TF_VAR_', 'VITE_AZURE_', 'WEBVIEW_TEST_',
  'SUBSCRIPTION', 'TENANT', 'CLIENT', 'ADMIN_', 'SF_',
  'DEMO_', 'COST_', 'ADO_', 'AI_', 'USER_TENANT',
];
const SENSITIVE_ENV_EXACT = new Set([
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FIGMA_API_KEY', 'NPM_TOKEN',
  'CODECOV_TOKEN', 'GITHUB_APP_PRIVATE_KEY_FILE', 'GODADDY_API_KEY',
  'GODADDY_API_SECRET', 'KEY_VAULT_1', 'DEMO_KEY_VAULT_1',
]);
const VALUE_ALLOWLIST = new Set([
  'true', 'false', '0', '1', 'yes', 'no', 'null', 'undefined', '',
  'eastus', 'westus', 'eastus2', 'westus2', 'centralus',
  'jagilber', // public GitHub/org identifier used in package names and repo URLs
  'public', 'private', 'default',
  './exports', './export', // generic path values
  '00000000-0000-0000-0000-000000000000', // nil UUID placeholder
]);
const SCANNABLE_EXTENSIONS = new Set([
  '.ts', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml',
  '.txt', '.html', '.css', '.sh', '.ps1', '.psm1', '.psd1',
  '.xml', '.config', '.env', '.cfg', '.ini', '.toml',
]);

function buildEnvLeakMap() {
  const envLeakMap = new Map();
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 8) continue;
    if (VALUE_ALLOWLIST.has(value.toLowerCase())) continue;

    const isSensitivePrefix = SENSITIVE_ENV_PREFIXES.some(p => key.startsWith(p));
    const isSensitiveExact = SENSITIVE_ENV_EXACT.has(key);
    const isSensitiveKeyword = /SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|SAS|_PAT$|SUBSCRIPTION|TENANT|CLIENT_ID/i.test(key);

    if (isSensitivePrefix || isSensitiveExact || isSensitiveKeyword) {
      envLeakMap.set(value, key);
      if (value !== value.toLowerCase()) envLeakMap.set(value.toLowerCase(), key);
      if (value !== value.toUpperCase()) envLeakMap.set(value.toUpperCase(), key);
    }
  }
  return envLeakMap;
}

function scanDirForEnvLeaks(dir, envLeakMap) {
  const leaks = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) { walk(full); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCANNABLE_EXTENSIONS.has(ext)) continue;
      try {
        const content = fs.readFileSync(full, 'utf8');
        for (const [envValue, envName] of envLeakMap) {
          if (content.includes(envValue)) {
            const relPath = path.relative(dir, full).replace(/\\/g, '/');
            leaks.push({ file: relPath, envName, envValue: envValue.substring(0, 4) + '***' });
          }
        }
      } catch { /* skip unreadable */ }
    }
  }
  walk(dir);
  return leaks;
}

function listRemoteRefs(remoteName, refKind, cwd) {
  if (refKind !== 'heads' && refKind !== 'tags') {
    throw new Error(`Unsupported ref kind: ${refKind}`);
  }
  try {
    const output = runGit(['ls-remote', '--refs', `--${refKind}`, remoteName], { cwd });
    if (!output) return [];

    const prefix = refKind === 'heads' ? 'refs/heads/' : 'refs/tags/';
    return output
      .split(/\r?\n/)
      .map(line => line.trim().split(/\s+/)[1])
      .filter(Boolean)
      .filter(ref => ref.startsWith(prefix))
      .map(ref => ref.slice(prefix.length));
  } catch {
    return [];
  }
}

// Exported for testability
if (typeof module !== 'undefined') {
  module.exports = { PRIVATE_DOTFILES, verifyNoLeakedArtifacts, copyRecursive, loadExcludeList, buildEnvLeakMap, scanDirForEnvLeaks };
}

// ── Pre-flight Checks ─────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════╗');
console.log('║  Dual-Repo Publish — index-server          ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log();

// Check for public remote
if (!verifyOnly) {
  try {
    const remotes = runGit(['remote', '-v']);
    if (!remotes.includes('public')) {
      console.error('ERROR: Git remote "public" not configured.');
      console.error('Run: git remote add public https://github.com/jagilber-org/index-server.git');
      process.exit(1);
    }
  } catch {
    console.error('ERROR: Could not read git remotes.');
    process.exit(1);
  }
}

// Check for dirty tree
if (!force && !verifyOnly) {
  try {
    const status = runGit(['status', '--porcelain']);
    if (status) {
      console.error('ERROR: Working tree is dirty. Commit or stash changes first.');
      console.error('Use --force to skip this check.');
      console.error(status);
      process.exit(1);
    }
  } catch {
    console.error('WARNING: Could not check git status.');
  }
}

// ── Load Exclusions ───────────────────────────────────────────────────────────
const excludePaths = loadExcludeList();
console.log(`Loaded ${excludePaths.length} exclusion rules from .publish-exclude`);

// ── Create Temp Dir & Copy ────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-publish-'));
console.log(`Staging to: ${tmpDir}`);

try {
  copyRecursive(repoRoot, tmpDir, excludePaths);

  // ── Verify No Leaked Artifacts ────────────────────────────────────────────
  const leaked = verifyNoLeakedArtifacts(tmpDir);
  if (leaked.length > 0) {
    console.error('ERROR: Internal artifacts leaked into publication:');
    leaked.forEach(l => console.error(`  - ${l}`));
    console.error('Update .publish-exclude and retry.');
    process.exit(1);
  }

  // ── Scan ALL files for env-var value leaks ──────────────────────────────
  console.log('Scanning staged files for env-var value leaks...');
  const envLeakMap = buildEnvLeakMap();
  console.log(`  Monitoring ${envLeakMap.size} sensitive env var values`);
  const envLeaks = scanDirForEnvLeaks(tmpDir, envLeakMap);
  if (envLeaks.length > 0) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║  BLOCKED: Environment variable values found in files!       ║');
    console.error('╠══════════════════════════════════════════════════════════════╣');
    for (const leak of envLeaks) {
      console.error(`║  $${leak.envName} (${leak.envValue}) → ${leak.file}`);
    }
    console.error('║                                                              ║');
    console.error('║  These are sensitive values from your shell environment.     ║');
    console.error('║  Remove them from the source files before publishing.        ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    console.error('');
    process.exit(1);
  }
  console.log('  No env-var leaks detected.');

  // ── Count Files ─────────────────────────────────────────────────────────────
  let fileCount = 0;
  function countFiles(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) countFiles(path.join(dir, e.name));
      else fileCount++;
    }
  }
  countFiles(tmpDir);
  console.log(`Staged ${fileCount} files (${excludePaths.length} exclusion rules applied)`);

  // ── Verify Only ─────────────────────────────────────────────────────────────
  if (verifyOnly) {
    console.log('\n── VERIFY ONLY ──────────────────────────────────');
    console.log('Publish validation passed. No forbidden artifacts detected.');
    console.log(`Files that would be published: ${fileCount}`);

    if (!quiet) {
      function listVerifyFiles(dir, prefix = '') {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) listVerifyFiles(path.join(dir, e.name), rel);
          else console.log(`  ${rel}`);
        }
      }
      listVerifyFiles(tmpDir);
    }
    console.log(`\nTotal: ${fileCount} files`);
    console.log('✅ Verification passed — safe to publish.');
    process.exit(0);
  }

  // ── Dry Run ─────────────────────────────────────────────────────────────────
  if (dryRun) {
    console.log('\n── DRY RUN ──────────────────────────────────────');
    console.log('Files that WOULD be published:');

    if (!quiet) {
      function listFiles(dir, prefix = '') {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) listFiles(path.join(dir, e.name), rel);
          else console.log(`  ${rel}`);
        }
      }
      listFiles(tmpDir);
    }
    console.log(`\nTotal: ${fileCount} files`);
    console.log('No changes were made. Use --tag <version> to publish.');
    process.exit(0);
  }

  // ── Git Init & Commit ───────────────────────────────────────────────────────
  console.log('\nCreating clean git commit...');
  runGit(['init'], { cwd: tmpDir });
  runGit(['checkout', '-b', 'main'], { cwd: tmpDir });

  // Configure signing in temp repo (inherits global gpg.format + signingkey)
  // The commit and tag will be signed if user has SSH/GPG signing configured globally
  try {
    const sigFormat = runGit(['config', '--global', 'gpg.format']).trim();
    const sigKey = runGit(['config', '--global', 'user.signingkey']).trim();
    if (sigFormat && sigKey && /^[a-zA-Z0-9]+$/.test(sigFormat) && /^[a-zA-Z0-9/_.:~@+-]+$/.test(sigKey)) {
      runGit(['config', 'gpg.format', sigFormat], { cwd: tmpDir });
      runGit(['config', 'user.signingkey', sigKey], { cwd: tmpDir });
      runGit(['config', 'commit.gpgsign', 'true'], { cwd: tmpDir });
      runGit(['config', 'tag.gpgsign', 'true'], { cwd: tmpDir });
      console.log(`Signing enabled: ${sigFormat} (${sigKey.split('/').pop()})`);
    }
  } catch { /* signing not configured — continue unsigned */ }

  runGit(['add', '-A'], { cwd: tmpDir });

  const commitMsg = `Publish ${tag} from dev repo

Published by scripts/publish-direct-to-remote.cjs
Source: index-server-dev
Tag: ${tag}
Date: ${new Date().toISOString()}
Files: ${fileCount}`;

  runGit(['commit', '-m', commitMsg], { cwd: tmpDir });

  // ── Push to Public Remote ───────────────────────────────────────────────────
  const publicUrl = runGit(['remote', 'get-url', 'public']);
  console.log(`Pushing to public remote: ${publicUrl}`);
  runGit(['remote', 'add', 'public', publicUrl], { cwd: tmpDir });

  // Compute hardened bypass token: sha256("publish-<tag>-<YYYY-MM-DD>")
  const today = new Date().toISOString().split('T')[0];
  const publishToken = crypto.createHash('sha256').update(`publish-${tag}-${today}`).digest('hex');
  const publishEnv = { ...process.env, PUBLISH_OVERRIDE: publishToken, PUBLISH_TAG: tag };

  const staleBranches = listRemoteRefs('public', 'heads', tmpDir).filter(branchName => branchName !== 'main');
  if (staleBranches.length > 0) {
    console.log(`Removing ${staleBranches.length} stale remote branch(es)...`);
    for (const branchName of staleBranches) {
      console.log(`  - ${branchName}`);
      runGitShow(['push', 'public', '--delete', branchName], { cwd: tmpDir, env: publishEnv });
    }
  }

  const existingTags = listRemoteRefs('public', 'tags', tmpDir);
  if (existingTags.length > 0) {
    console.log(`Removing ${existingTags.length} existing remote tag(s)...`);
    for (const tagName of existingTags) {
      console.log(`  - ${tagName}`);
      runGitShow(['push', 'public', `:refs/tags/${tagName}`], { cwd: tmpDir, env: publishEnv });
    }
  }

  try {
    runGitShow(['push', '--force', 'public', 'main'], { cwd: tmpDir, env: publishEnv });
  } finally {
  }

  // ── Tag ─────────────────────────────────────────────────────────────────────
  console.log(`Tagging ${tag} on public remote...`);
  // Create signed annotated tag (falls back to annotated-only if signing unavailable)
  try {
    runGit(['tag', '-s', '-a', tag, '-m', `Release ${tag}`], { cwd: tmpDir });
    console.log(`Created signed tag ${tag}`);
  } catch {
    runGit(['tag', '-a', tag, '-m', `Release ${tag}`], { cwd: tmpDir });
    console.log(`Created annotated tag ${tag} (unsigned — no signing key configured)`);
  }
  runGitShow(['push', 'public', tag], { cwd: tmpDir, env: publishEnv });

  console.log('\n✅ Published successfully!');
  console.log(`   Remote: ${publicUrl}`);
  console.log(`   Tag:    ${tag}`);
  console.log(`   Files:  ${fileCount}`);

  // ── Create GitHub Release on public repo ─────────────────────────────────
  if (createRelease) {
    console.log('\nCreating GitHub Release on public repo...');
    try {
      // Extract release notes from CHANGELOG.md
      const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
      const version = tag.replace(/^v/, '');
      const match = changelog.match(new RegExp(`## \\[${version.replace(/\./g, '\\.')}\\][\\s\\S]*?(?=## \\[|$)`));
      const notes = match ? match[0].replace(/^## \[.*?\].*\n/, '').trim() : `Release ${tag}`;
      const notesFile = path.join(os.tmpdir(), 'release-notes.md');
      fs.writeFileSync(notesFile, notes);
      runGh(['release', 'create', tag, '--repo', 'jagilber-org/index-server', '--title', tag, '--notes-file', notesFile, '--latest']);
      fs.unlinkSync(notesFile);
      console.log(`   ✅ GitHub Release ${tag} created on public repo`);
    } catch (e) {
      console.warn(`   ⚠️ GitHub Release creation failed: ${e.message}`);
      console.warn('   Create manually: gh release create ' + tag + ' --repo jagilber-org/index-server');
    }
  }

} finally {
  // ── Cleanup ─────────────────────────────────────────────────────────────────
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('Cleaned up staging directory.');
  } catch {
    console.warn(`WARNING: Could not clean up ${tmpDir}`);
  }
}
