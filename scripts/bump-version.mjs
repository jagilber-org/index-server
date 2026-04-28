#!/usr/bin/env node
/**
 * Cross-platform version bump script.
 * Usage: node scripts/bump-version.mjs <major|minor|patch> [changelog message]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const VALID_TYPES = ['major', 'minor', 'patch'];
const type = process.argv[2];
const changelogMessage = process.argv.slice(3).join(' ') || '';

if (!type || !VALID_TYPES.includes(type)) {
  console.error(`Usage: node scripts/bump-version.mjs <${VALID_TYPES.join('|')}> [changelog message]`);
  process.exit(1);
}

const root = join(import.meta.dirname, '..');

// Guard: clean working tree
const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
if (status) {
  console.error('Working tree not clean. Commit or stash before bumping version.');
  process.exit(1);
}

// Read and increment version
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;
const parts = current.split('.').map(Number);
if (parts.length !== 3) {
  console.error(`Unexpected version format: ${current}`);
  process.exit(1);
}

let [maj, min, pat] = parts;
switch (type) {
  case 'major': maj++; min = 0; pat = 0; break;
  case 'minor': min++; pat = 0; break;
  case 'patch': pat++; break;
}
const next = `${maj}.${min}.${pat}`;
console.log(`Current version: ${current} -> Next: ${next}`);

// Update package.json
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// Update server.json (MCP registry manifest) — versions must stay in sync with package.json
const serverJsonPath = join(root, 'server.json');
let serverJsonUpdated = false;
try {
  const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf8'));
  serverJson.version = next;
  if (Array.isArray(serverJson.packages)) {
    for (const p of serverJson.packages) {
      if (p && typeof p === 'object' && 'version' in p) p.version = next;
    }
  }
  writeFileSync(serverJsonPath, JSON.stringify(serverJson, null, 2) + '\n', 'utf8');
  serverJsonUpdated = true;
} catch (e) { if (e.code !== 'ENOENT') throw e; }

// Update CHANGELOG.md
const changelogPath = join(root, 'CHANGELOG.md');
let changelogUpdated = false;
try {
  const existing = readFileSync(changelogPath, 'utf8');
  const date = new Date().toISOString().slice(0, 10);
  let entry = `\n## [${next}] - ${date}\n`;
  if (changelogMessage) {
    entry += `\n### Added\n\n- ${changelogMessage}\n`;
  }
  writeFileSync(changelogPath, existing + entry, 'utf8');
  changelogUpdated = true;
} catch (e) { if (e.code !== 'ENOENT') throw e; }

// Commit and tag
execSync(`git add package.json${serverJsonUpdated ? ' server.json' : ''}${changelogUpdated ? ' CHANGELOG.md' : ''}`, { stdio: 'inherit' });
execSync(`git commit -m "chore(release): v${next}"`, { stdio: 'inherit' });
execSync(`git tag "v${next}"`, { stdio: 'inherit' });

console.log(`Version bumped to ${next} and tagged. Push with: git push --follow-tags`);
