/**
 * merge-activity-dbs.mjs — consolidate cwd-sharded activity databases.
 *
 * Before the activity DB path was anchored to the install root, it resolved to
 * `path.join(process.cwd(), 'metrics', 'activity.db')`. Because index-server
 * runs as an MCP stdio server it inherits its client's working directory, so
 * each spawning project accumulated a private shard of catalog telemetry.
 *
 * This merges those shards into the canonical database.
 *
 * Usage:
 *   node scripts/deploy/merge-activity-dbs.mjs --target <db> [--dry-run] <shard...>
 *
 * Dedupe key for `activity` is the full natural tuple
 * (ts, type, instruction_id, instance, correlation_id); `seq` is a per-shard
 * autoincrement and is deliberately NOT carried over, since the same logical
 * event can hold different seq values in different shards. `catalog_samples`
 * is keyed by ts and merged with INSERT OR IGNORE.
 *
 * Re-running is safe: the merge is idempotent.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const targetIdx = argv.indexOf('--target');
if (targetIdx === -1 || !argv[targetIdx + 1]) {
  console.error('error: --target <db> is required');
  process.exit(2);
}
const target = path.resolve(argv[targetIdx + 1]);
const shards = argv
  .filter((a, i) => !a.startsWith('--') && i !== targetIdx + 1)
  .map((p) => path.resolve(p))
  .filter((p) => p !== target);

if (!shards.length) {
  console.error('error: no shard databases supplied');
  process.exit(2);
}

const ACTIVITY_COLS = ['ts', 'type', 'instruction_id', 'signal', 'prev_signal', 'instance', 'correlation_id'];
const SAMPLE_COLS = [
  'ts', 'index_count', 'usage_total', 'signal_count', 'sig_applied', 'sig_helpful',
  'sig_not_relevant', 'sig_outdated', 'retrieved_only', 'never_used',
];

/** Create the canonical schema if the target does not exist yet. */
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL, type TEXT NOT NULL, instruction_id TEXT,
      signal TEXT, prev_signal TEXT, instance TEXT, correlation_id TEXT);
    CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);
    CREATE INDEX IF NOT EXISTS idx_activity_type_ts ON activity(type, ts);
    CREATE INDEX IF NOT EXISTS idx_activity_instance_ts ON activity(instance, ts);
    CREATE TABLE IF NOT EXISTS catalog_samples (
      ts INTEGER PRIMARY KEY, index_count INTEGER NOT NULL, usage_total INTEGER NOT NULL,
      signal_count INTEGER NOT NULL, sig_applied INTEGER NOT NULL DEFAULT 0,
      sig_helpful INTEGER NOT NULL DEFAULT 0, sig_not_relevant INTEGER NOT NULL DEFAULT 0,
      sig_outdated INTEGER NOT NULL DEFAULT 0, retrieved_only INTEGER NOT NULL DEFAULT 0,
      never_used INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_catalog_samples_ts ON catalog_samples(ts);
  `);
}

const key = (r) => ACTIVITY_COLS.filter((c) => c !== 'signal' && c !== 'prev_signal')
  .map((c) => String(r[c] ?? '')).join('\u0000');

if (dryRun) console.log('DRY RUN — no writes will be performed\n');
console.log(`target: ${target}`);

const targetExists = fs.existsSync(target);
if (!targetExists && !dryRun) fs.mkdirSync(path.dirname(target), { recursive: true });

let db = null;
const seen = new Set();
let baseline = 0;

if (dryRun && !targetExists) {
  console.log('        (does not exist yet — would be created)\n');
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  db = new DatabaseSync(target, dryRun ? { readOnly: targetExists } : {});
  if (!dryRun) ensureSchema(db);
  if (targetExists) {
    for (const r of db.prepare(`SELECT ${ACTIVITY_COLS.join(',')} FROM activity`).all()) seen.add(key(r));
    baseline = db.prepare('SELECT count(*) c FROM activity').get().c;
  }
  console.log(`        ${baseline} existing activity rows\n`);
}

const insertActivity = db && !dryRun
  ? db.prepare(`INSERT INTO activity (${ACTIVITY_COLS.join(',')}) VALUES (${ACTIVITY_COLS.map(() => '?').join(',')})`)
  : null;
const insertSample = db && !dryRun
  ? db.prepare(`INSERT OR IGNORE INTO catalog_samples (${SAMPLE_COLS.join(',')}) VALUES (${SAMPLE_COLS.map(() => '?').join(',')})`)
  : null;

let totalNew = 0;
let totalSamples = 0;

for (const shard of shards) {
  if (!fs.existsSync(shard)) { console.log(`skip  ${shard} (missing)`); continue; }
  let src;
  try {
    src = new DatabaseSync(shard, { readOnly: true });
  } catch (e) {
    console.log(`skip  ${shard} (${e.message})`);
    continue;
  }

  let rows = [];
  try {
    rows = src.prepare(`SELECT ${ACTIVITY_COLS.join(',')} FROM activity ORDER BY ts`).all();
  } catch { /* shard predates the table */ }

  const fresh = rows.filter((r) => !seen.has(key(r)));
  for (const r of fresh) {
    seen.add(key(r));
    if (insertActivity) insertActivity.run(...ACTIVITY_COLS.map((c) => r[c] ?? null));
  }

  let samples = [];
  try {
    samples = src.prepare(`SELECT ${SAMPLE_COLS.join(',')} FROM catalog_samples`).all();
  } catch { /* no samples table */ }
  for (const s of samples) {
    if (insertSample) insertSample.run(...SAMPLE_COLS.map((c) => s[c] ?? 0));
  }

  totalNew += fresh.length;
  totalSamples += samples.length;
  const dup = rows.length - fresh.length;
  console.log(`merge ${shard}\n      ${rows.length} activity (${fresh.length} new, ${dup} dup), ${samples.length} samples`);
  src.close();
}

console.log(`\n${dryRun ? 'would merge' : 'merged'} ${totalNew} new activity rows, ${totalSamples} samples`);

if (db) {
  if (!dryRun) {
    const final = db.prepare('SELECT count(*) c FROM activity').get().c;
    const range = db.prepare('SELECT min(ts) a, max(ts) b FROM activity').get();
    console.log(`target now holds ${final} activity rows`);
    if (final) {
      console.log(`range ${new Date(Number(range.a)).toISOString()} -> ${new Date(Number(range.b)).toISOString()}`);
    }
  }
  db.close();
}
