#!/usr/bin/env node
// scripts/pre-push-public-guard.cjs
// Pre-push hook: blocks pushes to public GitHub repositories.
// Enforces PB-6: dev repos MUST have a pre-push hook that blocks pushes to public remotes.
//
// How it works:
//   1. Reads the remote name and URL from pre-push hook args
//   2. Extracts owner/repo from the URL
//   3. Queries GitHub API via `gh` CLI for repo visibility
//   4. Blocks the push if the repo is public
//
// Bypass: PUBLISH_OVERRIDE must be set to the SHA-256 of "publish-<tag>-<iso-date>"
//         This is set ONLY by Publish-DualRepo.ps1 and publish.cjs during real publishes.
//         Setting PUBLISH_OVERRIDE=1 alone is NOT sufficient.
// Install: pre-commit framework handles installation via .pre-commit-config.yaml

'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');

// Allow publish script to bypass — requires a hash token, not just "1"
// The publish scripts compute: sha256("publish-<tag>-<YYYY-MM-DD>")
// This prevents casual `$env:PUBLISH_OVERRIDE='1'` bypasses
const override = process.env.PUBLISH_OVERRIDE || '';
if (override && override.length === 64 && /^[0-9a-f]{64}$/.test(override)) {
  // Verify the token matches today's expected pattern
  const today = new Date().toISOString().split('T')[0];
  const publishTag = process.env.PUBLISH_TAG || '';
  if (publishTag) {
    const expected = crypto.createHash('sha256').update(`publish-${publishTag}-${today}`).digest('hex');
    if (override === expected) {
      process.exit(0);
    }
  }
  // If no tag or mismatch, fall through to block
  console.error('PUBLISH_OVERRIDE token invalid or expired. Use the publish scripts.');
}

const remote = process.argv[2] || '';
const url = process.argv[3] || '';

// Extract owner/repo from GitHub URL
// Handles: https://github.com/owner/repo.git, git@github.com:owner/repo.git
let ownerRepo = '';
if (url.includes('github.com')) {
  const match = url.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
  if (match) ownerRepo = match[1];
}

if (!ownerRepo) {
  // Not a GitHub URL — allow (e.g. local remotes)
  process.exit(0);
}

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ownerRepo)) {
  console.log(`WARNING: Could not validate GitHub owner/repo path '${ownerRepo}'. Push allowed (unverified).`);
  process.exit(0);
}

const blockedMirrorRepos = new Set([
  'jagilber-org/index-server',
]);

const isPublicationRemote = remote === 'public' || blockedMirrorRepos.has(ownerRepo);

if (isPublicationRemote) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  BLOCKED: Direct push to publication mirror detected!      ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Remote:  ${remote}`);
  console.log(`║  Repo:    ${ownerRepo}`);
  console.log('║                                                            ║');
  console.log('║  This mirror must only be updated by the publish scripts.  ║');
  console.log('║  Use: node scripts/publish.cjs --tag vX.Y.Z               ║');
  console.log('║  Or:  pwsh scripts/Publish-DualRepo.ps1 -Tag vX.Y.Z       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  process.exit(1);
}

// Query GitHub API for repo visibility
let visibility = '';
try {
  visibility = execFileSync('gh', ['api', `repos/${ownerRepo}`, '--jq', '.visibility'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  }).trim();
} catch (e) {
  const msg = e.stderr ? e.stderr.toString() : e.message;
  if (msg.includes('not found') || msg.includes('ENOENT') || msg.includes('is not recognized')) {
    console.log("WARNING: 'gh' CLI not found — cannot verify repo visibility.");
    console.log('Install gh CLI to enforce public-repo push protection.');
    console.log('Push allowed (unverified).');
    process.exit(0);
  }
  // API error (e.g. 404 for deleted repo, network issue) — allow with warning
  console.log(`WARNING: Could not verify repo visibility for ${ownerRepo}: ${msg.trim()}`);
  console.log('Push allowed (unverified).');
  process.exit(0);
}

if (visibility === 'public') {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  BLOCKED: Push to public repository detected!              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Remote:  ${remote}`);
  console.log(`║  Repo:    ${ownerRepo} (visibility: public)`);
  console.log('║                                                            ║');
  console.log('║  Dev repos must not push directly to public repos.         ║');
  console.log('║  Use: node scripts/publish.cjs --tag vX.Y.Z               ║');
  console.log('║  See: constitution.json rule PB-2, PB-6                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  process.exit(1);
}

process.exit(0);
