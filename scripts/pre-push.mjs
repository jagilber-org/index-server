#!/usr/bin/env node
/**
 * Effective pre-push hook.
 *
 * 1. Public-repo push guard (always — blocks accidental pushes to the public mirror).
 * 2. pre-commit pre-push stage (runs semgrep, gitleaks, etc. configured in
 *    .pre-commit-config.yaml). Skipped silently if pre-commit is not installed.
 *
 * Without step 2, hooks declared with `stages: [pre-push]` in
 * .pre-commit-config.yaml are dead code locally and only catch issues in CI,
 * which is the failure mode that motivated wiring this through.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

console.log('[pre-push] Enforcing public-repo push guard + pre-commit pre-push stage.');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const guardPath = path.join(__dirname, 'pre-push-public-guard.cjs');
const guard = spawnSync(process.execPath, [guardPath, ...process.argv.slice(2)], {
	stdio: 'inherit',
	env: process.env,
});
if (typeof guard.status === 'number' && guard.status !== 0) {
	process.exit(guard.status);
}

// Invoke pre-commit pre-push stage so configured semgrep/gitleaks hooks actually run.
const preCommit = spawnSync('pre-commit', ['run', '--hook-stage', 'pre-push', '--all-files'], {
	stdio: 'inherit',
	env: process.env,
	shell: process.platform === 'win32',
});
if (preCommit.error && preCommit.error.code === 'ENOENT') {
	console.warn('[pre-push] pre-commit not installed; skipping pre-push hook stage.');
	process.exit(0);
}
if (typeof preCommit.status === 'number') {
	process.exit(preCommit.status);
}
process.exit(1);
