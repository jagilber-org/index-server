#!/usr/bin/env node
/**
 * Cross-platform pretest script (replaces pretest-build-or-skip.ps1).
 * Checks env flags, optionally runs build, and creates legacy dist shim.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const force = process.env.INDEX_SERVER_FORCE_REBUILD === '1';
const skip = process.env.SKIP_PRETEST_BUILD === '1' && !force;

if (skip) {
  console.log('[pretest] Skipping build (SKIP_PRETEST_BUILD=1)');
} else {
  if (force) console.log('[pretest] Forcing rebuild due to INDEX_SERVER_FORCE_REBUILD=1');
  else console.log('[pretest] Performing build (no SKIP_PRETEST_BUILD flag)');
  try {
    execSync('npm run build', { stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status || 1);
  }
}

// Create legacy shim: some tests expect dist/server/index-server.js while tsc outputs dist/src/server/index-server.js
const legacyDir = join(process.cwd(), 'dist', 'server');
const legacyEntry = join(legacyDir, 'index-server.js');
const modernEntry = join(process.cwd(), 'dist', 'src', 'server', 'index-server.js');

if (existsSync(modernEntry)) {
  if (!existsSync(legacyEntry)) {
    console.log('[pretest] Creating legacy dist/server/index-server.js shim -> src/server/index-server.js');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(legacyEntry, "// auto-generated shim for backward compatibility\nmodule.exports = require('../src/server/index-server.js');\n", 'utf8');
  } else {
    console.log('[pretest] Legacy shim already present');
  }
} else {
  console.log('[pretest] Modern entry not found yet (dist/src/server/index-server.js); build may be in progress');
}
