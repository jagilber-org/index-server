#!/usr/bin/env node
/**
 * Flip publishConfig.registry between GitHub Packages and npmjs.org.
 *
 * Usage:
 *   node scripts/set-registry.mjs github   # GitHub Packages (private)
 *   node scripts/set-registry.mjs npmjs     # npmjs.org (public)
 *   node scripts/set-registry.mjs status    # Show current registry
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', '..', 'package.json');

const REGISTRIES = {
  github: 'https://npm.pkg.github.com',
  npmjs: 'https://registry.npmjs.org',
};

const arg = process.argv[2]?.toLowerCase();

if (!arg || !['github', 'npmjs', 'status'].includes(arg)) {
  console.error('Usage: node scripts/set-registry.mjs <github|npmjs|status>');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.publishConfig?.registry ?? '(not set)';

if (arg === 'status') {
  const label = Object.entries(REGISTRIES).find(([, v]) => v === current)?.[0] ?? 'unknown';
  console.log(`Registry: ${current} (${label})`);
  process.exit(0);
}

const target = REGISTRIES[arg];
if (current === target) {
  console.log(`Already set to ${arg}: ${target}`);
  process.exit(0);
}

pkg.publishConfig = { ...pkg.publishConfig, registry: target };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Switched registry: ${current} → ${target} (${arg})`);
