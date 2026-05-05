#!/usr/bin/env node
/**
 * adhoc-disk-state-monitor.mjs — External disk state snapshot & comparison utility
 *
 * Captures the state of an instructions directory (file count, sizes, SHA-256 hashes)
 * and computes diffs between snapshots to detect spurious writes.
 *
 * Usage:
 *   import { snapshot, diff } from './adhoc-disk-state-monitor.mjs';
 *   const before = snapshot('./instructions');
 *   // ... perform mutation ...
 *   const after = snapshot('./instructions');
 *   const changes = diff(before, after);
 *
 * Standalone:
 *   node scripts/adhoc-disk-state-monitor.mjs --dir ./instructions
 *   node scripts/adhoc-disk-state-monitor.mjs --watch --dir ./instructions --interval 1000
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Infrastructure files written by the server as side effects (not instruction data).
// These are filtered out by default so mutation-integrity tests focus on instruction files.
const INFRASTRUCTURE_FILES = new Set([
  '_manifest.json',
  '_skipped.json',
  '.index-version',
  'bootstrap.confirmed.json',
]);

/**
 * Capture a snapshot of all .json files in a directory (non-recursive).
 * Ignores temp files (.*.tmp), non-json files, and infrastructure files by default.
 * @param {string} dir - Directory to snapshot
 * @param {{ includeInfra?: boolean }} [opts] - Options
 * @returns {{ ts: string, dir: string, fileCount: number, files: Map<string, { size: number, mtimeMs: number, sha256: string }> }}
 */
export function snapshot(dir, opts = {}) {
  const includeInfra = opts.includeInfra ?? false;
  const files = new Map();
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return { ts: new Date().toISOString(), dir, fileCount: 0, files, error: e.message };
  }

  for (const name of entries) {
    // Skip temp files from atomic writes and non-json
    if (name.startsWith('.') || !name.endsWith('.json')) continue;
    // Skip infrastructure files unless explicitly included
    if (!includeInfra && INFRASTRUCTURE_FILES.has(name)) continue;
    const filePath = path.join(dir, name);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const content = fs.readFileSync(filePath);
      const sha256 = crypto.createHash('sha256').update(content).digest('hex');
      files.set(name, { size: stat.size, mtimeMs: stat.mtimeMs, sha256 });
    } catch {
      // File may have been removed between readdir and stat
    }
  }

  return { ts: new Date().toISOString(), dir, fileCount: files.size, files };
}

/**
 * Compare two snapshots and return the differences.
 * @param {{ files: Map<string, { sha256: string }> }} before
 * @param {{ files: Map<string, { sha256: string }> }} after
 * @returns {{ added: string[], removed: string[], modified: string[], unchanged: string[] }}
 */
export function diff(before, after) {
  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];

  // Files in after but not in before → added
  for (const [name, info] of after.files) {
    if (!before.files.has(name)) {
      added.push(name);
    } else if (before.files.get(name).sha256 !== info.sha256) {
      modified.push(name);
    } else {
      unchanged.push(name);
    }
  }

  // Files in before but not in after → removed
  for (const name of before.files.keys()) {
    if (!after.files.has(name)) {
      removed.push(name);
    }
  }

  return { added, removed, modified, unchanged };
}

/**
 * Pretty-print a diff summary.
 * @param {{ added: string[], removed: string[], modified: string[], unchanged: string[] }} d
 */
export function formatDiff(d) {
  const lines = [];
  if (d.added.length) lines.push(`  + Added (${d.added.length}): ${d.added.join(', ')}`);
  if (d.removed.length) lines.push(`  - Removed (${d.removed.length}): ${d.removed.join(', ')}`);
  if (d.modified.length) lines.push(`  ~ Modified (${d.modified.length}): ${d.modified.join(', ')}`);
  lines.push(`  = Unchanged: ${d.unchanged.length}`);
  return lines.join('\n');
}

// ── Standalone CLI ──────────────────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))) {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : './instructions';
  const watchMode = args.includes('--watch');
  const intervalIdx = args.indexOf('--interval');
  const interval = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1], 10) : 2000;

  const includeInfra = args.includes('--include-infra');
  const snapOpts = { includeInfra };

  if (watchMode) {
    console.log(`[disk-monitor] Watching ${path.resolve(dir)} every ${interval}ms — Ctrl+C to stop`);
    let prev = snapshot(dir, snapOpts);
    console.log(`[disk-monitor] Baseline: ${prev.fileCount} files`);

    setInterval(() => {
      const curr = snapshot(dir, snapOpts);
      const d = diff(prev, curr);
      const changed = d.added.length + d.removed.length + d.modified.length;
      if (changed > 0) {
        console.log(`[disk-monitor] ${new Date().toISOString()} — ${changed} change(s):`);
        console.log(formatDiff(d));
      }
      prev = curr;
    }, interval);
  } else {
    const s = snapshot(dir, snapOpts);
    console.log(JSON.stringify({
      ts: s.ts,
      dir: path.resolve(dir),
      fileCount: s.fileCount,
      files: Object.fromEntries(s.files),
    }, null, 2));
  }
}
