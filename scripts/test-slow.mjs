#!/usr/bin/env node
/**
 * Executes the designated "slow / pre-push" test suites.
 * These are correctness / regression detection suites that are
 * intentionally heavier (multi‑client coordination, large sampling,
 * persistence divergence reproduction, or performance exploration).
 *
 * Usage: node scripts/test-slow.mjs
 *   (internally spawns vitest with explicit file list)
 *
 * Customize by editing the slowTests array below. Keep list small
 * and focused on high-signal scenarios that are safe to run locally
 * before pushing but not needed on every build:verify cycle.
 */
import { spawn } from 'child_process';
import path from 'path';
import { slowTests } from './slow-tests.mjs';

// Quarantine support (previously used to exclude flaky suites).
// All prior unstable suites have passed multiple consecutive runs (see PR body for metrics),
// so the quarantine list is now intentionally empty. If future instability arises, add
// specific spec paths back here temporarily with a tracking issue reference.
const unstable = [];

const selected = slowTests.filter(t => !unstable.includes(t) || process.env.INCLUDE_UNSTABLE_SLOW === '1');
if (!selected.length) {
	console.warn('[test-slow] No slow tests selected (all quarantined?). Set INCLUDE_UNSTABLE_SLOW=1 to force run.');
}
if (process.env.INCLUDE_UNSTABLE_SLOW === '1' && unstable.length) {
	console.log('[test-slow] INCLUDE_UNSTABLE_SLOW=1 => running unstable set:', unstable);
} else if (unstable.length) {
	const skipped = unstable.filter(u => slowTests.includes(u));
	if (skipped.length) console.log('[test-slow] Quarantined (skipped) unstable tests:', skipped);
}
const vitestArgs = ['run', '--bail', '1', '--reporter', 'verbose', ...selected];

const childEnv = { ...process.env, INDEX_SERVER_MUTATION: '1' };
const vitestBin = path.resolve('node_modules', 'vitest', 'vitest.mjs');
const child = spawn(process.execPath, [vitestBin, ...vitestArgs], { stdio: 'inherit', env: childEnv });
child.on('exit', code => process.exit(code));
