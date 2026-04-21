#!/usr/bin/env node
/**
 * Cross-platform commit-msg hook (replaces commit-msg-baseline.ps1).
 * Enforces BASELINE-CR: marker when INTERNAL-BASELINE.md is modified.
 * Usage: node scripts/commit-msg-baseline.mjs <commit-msg-file>
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const messageFile = process.argv[2];
if (!messageFile) process.exit(0);

// Check if INTERNAL-BASELINE.md is in the staged changes
let diff = '';
try {
  diff = execSync('git diff --cached --name-only', { encoding: 'utf8' });
} catch {
  process.exit(0);
}

if (!diff.includes('INTERNAL-BASELINE.md')) process.exit(0);

// Read commit message and check for BASELINE-CR: marker
let message = '';
try {
  message = readFileSync(messageFile, 'utf8');
} catch { /* empty message */ }

if (!message.includes('BASELINE-CR:')) {
  console.error('Commit blocked: INTERNAL-BASELINE.md modified without BASELINE-CR: marker in commit message.');
  process.exit(1);
}
