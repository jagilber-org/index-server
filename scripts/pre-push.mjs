#!/usr/bin/env node
/**
 * Effective pre-push hook.
 *
 * Slow test gating moved to CI, but public-repo push protection must still run
 * locally to prevent accidental pushes to the public mirror.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('[pre-push] Slow test gate removed; enforcing public-repo push guard.');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const guardPath = path.join(__dirname, 'pre-push-public-guard.cjs');
const result = spawnSync(process.execPath, [guardPath, ...process.argv.slice(2)], {
	stdio: 'inherit',
	env: process.env,
});

if (typeof result.status === 'number') {
	process.exit(result.status);
}

process.exit(1);
