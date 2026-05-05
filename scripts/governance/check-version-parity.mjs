#!/usr/bin/env node
/**
 * check-version-parity.mjs — assert package.json and server.json agree on version.
 *
 * Catches the failure mode tracked in issues #236 / #248: a release script
 * updates one manifest but not the other, producing a silently broken publish.
 * Run pre-commit, pre-push, and in CI before any release artifact is built.
 *
 * Usage:
 *   node scripts/check-version-parity.mjs            # checks <repo-root>
 *   node scripts/check-version-parity.mjs --root DIR # checks DIR/package.json + DIR/server.json
 *
 * Exit codes:
 *   0  versions match
 *   1  versions diverge (or files unreadable)
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = { root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' && argv[i + 1]) { args.root = argv[++i]; }
    else if (a.startsWith('--root=')) { args.root = a.slice('--root='.length); }
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/check-version-parity.mjs [--root DIR]');
      process.exit(0);
    }
  }
  return args;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    console.error(`check-version-parity: cannot read ${path}: ${e.message}`);
    process.exit(1);
  }
}

const { root: rootArg } = parseArgs(process.argv.slice(2));
const root = rootArg
  ? resolve(rootArg)
  : resolve(import.meta.dirname, '..', '..');

const pkgPath = join(root, 'package.json');
const serverPath = join(root, 'server.json');
const pkg = readJson(pkgPath);
const server = readJson(serverPath);

const failures = [];
if (pkg.version !== server.version) {
  failures.push(
    `package.json version ${JSON.stringify(pkg.version)} != server.json version ${JSON.stringify(server.version)}`
  );
}
if (Array.isArray(server.packages)) {
  for (const [i, p] of server.packages.entries()) {
    if (p && typeof p === 'object' && 'version' in p && p.version !== pkg.version) {
      failures.push(
        `server.json packages[${i}].version ${JSON.stringify(p.version)} != package.json version ${JSON.stringify(pkg.version)}`
      );
    }
  }
}

if (failures.length > 0) {
  console.error('check-version-parity: VERSION SKEW DETECTED');
  for (const f of failures) console.error('  - ' + f);
  console.error('\nFix: re-run `npm run bump-version <patch|minor|major>` so all manifests update atomically.');
  process.exit(1);
}

console.log(`check-version-parity: OK (version=${pkg.version})`);
