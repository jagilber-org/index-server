#!/usr/bin/env node
/**
 * purge-test-activity — remove test-fixture rows from an activity database.
 *
 * Why this exists:
 *
 * Before the guard in src/services/activityLog.ts was tightened, servers
 * spawned by the test suite with a scrubbed environment (no VITEST) enabled
 * activity telemetry and, with no INDEX_SERVER_ACTIVITY_DB set, wrote to the
 * installation's own metrics/activity.db. The result was a dashboard whose
 * Catalog Activity chart rendered the test suite: in one real database, 902 of
 * 907 rows referenced ids that exist nowhere in the catalog.
 *
 * The leak is fixed, but the rows it already wrote are still there and still
 * on the chart. This removes them.
 *
 * SAFETY — how rows are selected:
 *
 * "id is not in the catalog" is NOT a safe criterion and is deliberately not
 * used. A genuine `removed` event is *supposed* to reference an id that no
 * longer exists; purging on absence would erase exactly the real history this
 * chart is for. Rows are matched against an explicit list of fixture id
 * patterns instead, and any row whose id IS present in the catalog is refused
 * outright even if it somehow matches a pattern.
 *
 * Dry run by default. Pass --apply to write.
 *
 * Usage:
 *   node scripts/diagnostics/purge-test-activity.mjs [options]
 *
 *   --db <path>       activity database (default: <install>/metrics/activity.db,
 *                     or $INDEX_SERVER_ACTIVITY_DB)
 *   --catalog <path>  index.db used to protect real ids (default: <install>/data/index.db).
 *                     Optional — omit it and the pattern list alone governs.
 *   --samples         also remove corrupt catalog samples (isolated mid-import dips)
 *   --apply           actually delete (default: report only)
 *   --json            machine-readable output
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_ROOT = path.resolve(HERE, '..', '..');

/**
 * Fixture id patterns, anchored. Each entry names the spec that produces it so
 * a future reader can confirm the pattern still corresponds to a test rather
 * than guessing from the shape.
 */
const FIXTURE_PATTERNS = [
  { re: /^ci-test-[0-9a-f]+-c\d+-op\d+$/i, source: 'concurrent/* CRUD stress specs' },
  { re: /^issue-\d+-\d+$/, source: 'mcpConfigIssue317 / mcpConfigCrudRoundTrip boot test' },
  { re: /^bulk-rm-\d+$/, source: 'unit/negativeTests — bulk remove guard' },
  { re: /^limit-rm-\d+$/, source: 'unit/negativeTests — remove limit guard' },
  { re: /^test-remove-target$/, source: 'unit/negativeTests' },
  { re: /^overwrite-test$/, source: 'unit/negativeTests — add overwrite' },
  { re: /^nonexistent-id-xyz$/, source: 'unit/negativeTests — remove missing id' },
  { re: /^idempotent-test$/, source: 'unit/importNegative' },
  { re: /^import-skip-existing$/, source: 'unit/importNegative' },
  { re: /^reload-stable$/, source: 'unit/importNegative' },
  { re: /^content-verify$/, source: 'import/verify specs' },
  { re: /^dryrun-target$/, source: 'import dry-run spec' },
  { re: /^test-single-add$/, source: 'add-path specs' },
  { re: /^e2e-activity-proof$/, source: 'activity telemetry e2e proof' },
];

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const APPLY = process.argv.includes('--apply');
const AS_JSON = process.argv.includes('--json');
const SAMPLES = process.argv.includes('--samples');

const dbPath = path.resolve(
  arg('db') ?? process.env.INDEX_SERVER_ACTIVITY_DB ?? path.join(INSTALL_ROOT, 'metrics', 'activity.db'),
);
const catalogArg = arg('catalog');
const catalogPath = catalogArg === undefined
  ? path.join(INSTALL_ROOT, 'data', 'index.db')
  : (catalogArg === true ? null : path.resolve(catalogArg));

function fail(msg) {
  if (AS_JSON) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.error(`error: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(dbPath)) fail(`activity database not found: ${dbPath}`);

// Protected ids — anything the catalog still knows about, live or archived.
const protectedIds = new Set();
if (catalogPath && fs.existsSync(catalogPath)) {
  const idx = new DatabaseSync(catalogPath, { readOnly: true });
  for (const t of ['instructions', 'instructions_archive']) {
    try {
      for (const r of idx.prepare(`select id from ${t}`).all()) protectedIds.add(r.id);
    } catch { /* table absent on older schemas */ }
  }
  idx.close();
}

const db = new DatabaseSync(dbPath, { readOnly: !APPLY });
const before = db.prepare('select count(*) n from activity').get().n;

const rows = db.prepare('select rowid as rid, instruction_id as id from activity').all();
const doomed = [];
const perPattern = new Map();
let protectedHits = 0;

for (const row of rows) {
  if (row.id === null || row.id === undefined) continue;
  const hit = FIXTURE_PATTERNS.find((p) => p.re.test(row.id));
  if (!hit) continue;
  // A fixture pattern that matches a real catalog id means the pattern is too
  // broad. Refuse the row and report it rather than trusting the pattern.
  if (protectedIds.has(row.id)) { protectedHits++; continue; }
  doomed.push(row.rid);
  perPattern.set(hit.source, (perPattern.get(hit.source) ?? 0) + 1);
}

let deleted = 0;
let vacuumed = false;
if (APPLY && doomed.length) {
  db.exec('begin');
  const stmt = db.prepare('delete from activity where rowid = ?');
  for (const rid of doomed) { stmt.run(rid); deleted++; }
  db.exec('commit');
  // Reclaiming space is a nicety; a running server holding the database open
  // will refuse VACUUM. The delete is already committed at this point, so a
  // failure here must not read as a failed purge.
  try { db.exec('vacuum'); vacuumed = true; } catch { vacuumed = false; }
}

// ── Corrupt catalog samples ───────────────────────────────────────────────
//
// Separate problem, same database. Before the bulk-mutation guard existed, a
// sampler tick landing mid-import recorded the partially-rebuilt index size —
// e.g. index_count=2 and 112 against a real catalog of 284. Those render as
// full-height vertical spikes on the index-composition chart forever.
//
// Detected as an ISOLATED COLLAPSE rather than by absolute value: a sample
// whose count drops far below BOTH neighbours and recovers immediately. A
// catalog is file-backed and persistent, so it cannot lose 280 entries and get
// them all back five minutes later — but it can legitimately shrink and stay
// shrunk, which this rule deliberately leaves alone.
const SPIKE_DROP_RATIO = 0.5; // must be below half of both neighbours

let sampleReport = null;
if (SAMPLES) {
  const samples = db.prepare('select rowid as rid, ts, index_count as c from catalog_samples order by ts').all();
  const bad = [];
  for (let i = 1; i < samples.length - 1; i++) {
    const prev = samples[i - 1].c, cur = samples[i].c, next = samples[i + 1].c;
    const floor = Math.min(prev, next) * SPIKE_DROP_RATIO;
    if (cur < floor) bad.push(samples[i]);
  }
  let removed = 0;
  if (APPLY && bad.length) {
    db.exec('begin');
    const del = db.prepare('delete from catalog_samples where rowid = ?');
    for (const s of bad) { del.run(s.rid); removed++; }
    db.exec('commit');
  }
  sampleReport = {
    total: samples.length,
    matched: bad.length,
    removed,
    detail: bad.map((s) => ({ ts: new Date(Number(s.ts)).toISOString(), indexCount: s.c })),
  };
}

const after = db.prepare('select count(*) n from activity').get().n;
const remainingSample = db.prepare(
  'select instruction_id id, type, count(*) n from activity group by instruction_id, type order by n desc limit 10',
).all();
db.close();

const report = {
  ok: true,
  applied: APPLY,
  db: dbPath,
  catalog: catalogPath && fs.existsSync(catalogPath) ? catalogPath : null,
  protectedIds: protectedIds.size,
  before,
  matched: doomed.length,
  deleted,
  vacuumed,
  after,
  bySource: Object.fromEntries(perPattern),
  samples: sampleReport,
  remainingSample,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`activity db : ${dbPath}`);
  console.log(`catalog     : ${report.catalog ?? '(none — pattern list only)'} (${protectedIds.size} protected ids)`);
  console.log(`rows before : ${before}`);
  console.log(`matched     : ${doomed.length} fixture rows`);
  for (const [source, n] of [...perPattern].sort((a, b) => b[1] - a[1])) {
    console.log(`              ${String(n).padStart(4)}  ${source}`);
  }
  if (protectedHits) console.log(`refused     : ${protectedHits} (id still present in catalog)`);
  console.log(APPLY ? `deleted     : ${deleted}` : 'deleted     : 0 (dry run — pass --apply to write)');
  console.log(`rows after  : ${after}`);
  if (remainingSample.length) {
    console.log('\nremaining, most frequent first:');
    for (const r of remainingSample) {
      console.log(`  ${String(r.n).padStart(3)}  ${r.type.padEnd(9)} ${r.id ?? '(none)'}`);
    }
  }
  if (sampleReport) {
    console.log(`\ncatalog samples : ${sampleReport.total}`);
    console.log(`corrupt (isolated mid-import dips) : ${sampleReport.matched}`);
    for (const d of sampleReport.detail) {
      console.log(`  ${d.ts}  index_count=${d.indexCount}`);
    }
    console.log(APPLY ? `removed : ${sampleReport.removed}` : 'removed : 0 (dry run)');
  }
}
