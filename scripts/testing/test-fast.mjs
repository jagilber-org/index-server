#!/usr/bin/env node
/**
 * Executes ONLY the fast test suites by enumerating all spec files and excluding slowTests list.
 * This is more reliable than multiple --exclude flags (which can be brittle with path resolution).
 */
import { readdirSync, statSync } from 'fs';
import { spawn } from 'child_process';
import { slowTests, isSlowTest, normalizeSpecPath } from './slow-tests.mjs';
import path from 'path';

function walk(dir) {
  const entries = readdirSync(dir);
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (e.endsWith('.spec.ts')) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

const allSpecs = walk('src/tests');
const fastSpecs = allSpecs.filter(f => !isSlowTest(f));

if (fastSpecs.length === 0) {
  console.error('No fast tests discovered (unexpected)');
  process.exit(1);
}

// Provide summary output
console.log(`Discovered ${allSpecs.length} spec files; excluding ${slowTests.length} slow => running ${fastSpecs.length} fast specs.`);

// Safety net: ensure none of the enumerated fast specs are actually tagged slow (defensive in case list drift)
const leaked = fastSpecs.filter(f => slowTests.includes(normalizeSpecPath(f)));
if (leaked.length) {
  console.error('[test:fast] Detected slow tests leaking into fast set:', leaked);
  process.exit(1);
}

const childEnv = {
  ...process.env,
  INDEX_SERVER_MUTATION: '1',
  INDEX_SERVER_DASHBOARD: '0',
  INDEX_SERVER_AUTO_BACKUP: '0',
};
const vitestBin = path.resolve('node_modules', 'vitest', 'vitest.mjs');
const child = spawn(process.execPath, [vitestBin, 'run', ...fastSpecs], { stdio: 'inherit', env: childEnv });
child.on('exit', code => process.exit(code));
