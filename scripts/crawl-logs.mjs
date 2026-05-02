#!/usr/bin/env node
/**
 * crawl-logs.mjs — NDJSON log crawler / hygiene gate.
 *
 * SYNOPSIS
 *   node scripts/crawl-logs.mjs [--dir <path>] [--pattern <glob>] [--top <n>]
 *                                [--max-repeat <n>] [--max-stack-warn <n>]
 *                                [--allowlist <file>] [--json] [--strict]
 *                                [--summary <file>]
 *
 * PURPOSE
 *   Parses NDJSON-formatted log files (the format emitted by
 *   src/services/logger.ts) and surfaces chronic issues:
 *     - Top WARN / ERROR messages by signature (fingerprinted on `msg`)
 *     - Same-signature WARN / ERROR repeated more than `--max-repeat`
 *       times (default 25) — a strong signal of an unbounded loop
 *     - WARN entries whose `detail` contains a JS stack trace
 *       (more than `--max-stack-warn` of them is an error budget breach)
 *     - Duplicate "exhausted" / "invariant-repair" messages per id
 *     - Free-text patterns like "EADDRINUSE", "EPIPE", "Auto-migration failed"
 *
 *   On `--strict`, any threshold violation exits with code 1 so CI fails
 *   loudly. Without `--strict`, the script always exits 0 (informational).
 *
 *   The script is dependency-free (Node ≥18) and matches the spirit of
 *   copilot-ui's scripts/crawl-logs.ps1.
 *
 * EXIT CODES
 *   0  — success, or violations found but `--strict` not set
 *   1  — `--strict` and one or more thresholds breached
 *   2  — fatal (no logs found, bad arg, etc.)
 *
 * ALLOWLIST FORMAT
 *   Plain-text file, one regex per line. Lines starting with '#' are
 *   comments. Matched WARN/ERROR signatures are excluded from BOTH
 *   the per-signature repeat threshold AND the WARN-with-stack-trace
 *   budget (still reported as "allowlisted" in the summary).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// ── CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  dir: 'logs',
  extra: [],            // additional files passed via --file
  pattern: '**/*.{log,jsonl,ndjson}',
  top: 25,
  maxRepeat: 25,
  maxStackWarn: 5,
  allowlist: null,
  json: false,
  strict: false,
  summary: null,
  since: null,
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => args[++i];
  switch (a) {
    case '--dir': opts.dir = next(); break;
    case '--file': opts.extra.push(next()); break;
    case '--pattern': opts.pattern = next(); break;
    case '--top': opts.top = parseInt(next(), 10) || 25; break;
    case '--max-repeat': opts.maxRepeat = parseInt(next(), 10) || 25; break;
    case '--max-stack-warn': opts.maxStackWarn = parseInt(next(), 10) || 5; break;
    case '--allowlist': opts.allowlist = next(); break;
    case '--json': opts.json = true; break;
    case '--strict': opts.strict = true; break;
    case '--summary': opts.summary = next(); break;
    case '--since': opts.since = next(); break;
    case '-h': case '--help':
      // eslint-disable-next-line no-console
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 38).join('\n'));
      process.exit(0);
      break;
    default:
      if (a.startsWith('--')) {
        process.stderr.write(`crawl-logs: unknown option ${a}\n`);
        process.exit(2);
      }
  }
}

// ── Known chronic patterns (free-text fallback when msg lacks structure) ─
const KNOWN_PATTERNS = [
  { tag: 'AUTO_MIGRATION_FAIL', regex: /\[storage\] Auto-migration failed/, hint: 'ensureLoaded() is retrying a failing migration on every reload tick. Check process-scoped latch in indexContext.ts.' },
  { tag: 'INVARIANT_REPAIR_EXHAUSTED', regex: /repair exhausted .* no source found/, hint: 'firstSeenTs unrecoverable. WARN must dedupe per-id (firstSeenExhaustedReported latch).' },
  { tag: 'SQLITE_EXPERIMENTAL', regex: /EXPERIMENTAL: SQLite (storage )?backend/, hint: 'SQLite warn-once latch fired. Should appear at most once per process.' },
  { tag: 'PORT_COLLISION', regex: /EADDRINUSE|address already in use/i, hint: 'Port already bound. Tests should use ephemeral ports or guard via PortReservation.' },
  { tag: 'BROKEN_PIPE', regex: /EPIPE|broken pipe/i, hint: 'Stderr/stdout pipe closed prematurely. Check stderr drain on child processes.' },
  { tag: 'UNCAUGHT_EXCEPTION', regex: /uncaught exception|unhandledRejection/i, hint: 'Top-level handler caught an error. Check the test that caused it.' },
  { tag: 'PERMISSION_ERROR', regex: /\bEPERM\b|\bEACCES\b|permission denied/i, hint: 'Filesystem permission error. Likely a Windows test cleanup issue (sqlite handle still open).' },
  { tag: 'OOM_HEAP', regex: /heap out of memory|JavaScript heap/i, hint: 'Memory pressure. Investigate caches and event-listener leaks.' },
  { tag: 'STACK_TRACE_IN_WARN', regex: /\n\s+at [^\n]+\([^\n]+:\d+:\d+\)/, hint: 'Stack trace at WARN level — only ERROR should carry traces.' },
];

// ── Allowlist ──────────────────────────────────────────────────────
const allowlistPatterns = [];
if (opts.allowlist && fs.existsSync(opts.allowlist)) {
  const text = fs.readFileSync(opts.allowlist, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    try { allowlistPatterns.push(new RegExp(t)); }
    catch (err) { process.stderr.write(`crawl-logs: bad allowlist regex "${t}": ${err.message}\n`); }
  }
}
function isAllowlisted(msg) {
  return allowlistPatterns.some(rx => rx.test(msg));
}

// ── File discovery ─────────────────────────────────────────────────
function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of ents) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (/\.(log|jsonl|ndjson)$/i.test(ent.name)) yield full;
  }
}

const files = [...walk(path.resolve(opts.dir)), ...opts.extra.filter(f => fs.existsSync(f))];
if (files.length === 0) {
  process.stderr.write(`crawl-logs: no log files found under ${opts.dir} (and no --file provided)\n`);
  process.exit(2);
}

// ── Signature: stable hash of msg + first id-ish token ─────────────
function fingerprint(msg) {
  if (typeof msg !== 'string') return '<non-string>';
  // Strip volatile substrings (timestamps, hex hashes, numbers) so
  // "[invariant-repair] firstSeenTs repair exhausted — no source found for foo"
  // collapses to one signature regardless of which id fired.
  return msg
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.Z+-]+\b/g, '<ts>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hash>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// ── Stack-trace detection (works on `detail` strings too) ─────────
function looksLikeStack(detail) {
  if (!detail || typeof detail !== 'string') return false;
  return /\n?\s*at\s+[^\n]+\([^\n]+:\d+:\d+\)/.test(detail);
}

// ── Scan ────────────────────────────────────────────────────────────
const counts = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, TRACE: 0, OTHER: 0 };
const sigBuckets = new Map();   // signature -> { level, count, samples[], allowlisted }
const stackWarnRecords = [];    // [{ file, line, signature, detailHead }]
const tagHits = new Map();      // tag -> count
const sinceTs = opts.since ? Date.parse(opts.since) : null;
let totalLines = 0;
let nonNdjsonLines = 0;

for (const file of files) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const raw of rl) {
    lineNo++;
    totalLines++;
    if (!raw) continue;

    let obj = null;
    try { obj = JSON.parse(raw); } catch { /* not NDJSON */ }
    if (!obj || typeof obj !== 'object') {
      nonNdjsonLines++;
      // Free-text known-pattern matching for non-NDJSON output (vitest console).
      for (const p of KNOWN_PATTERNS) {
        if (p.regex.test(raw)) tagHits.set(p.tag, (tagHits.get(p.tag) || 0) + 1);
      }
      continue;
    }

    const level = (obj.level || 'OTHER').toString().toUpperCase();
    if (level in counts) counts[level]++; else counts.OTHER++;

    if (sinceTs && obj.ts) {
      const t = Date.parse(obj.ts);
      if (!Number.isNaN(t) && t < sinceTs) continue;
    }

    if (level !== 'WARN' && level !== 'ERROR') continue;

    const msg = typeof obj.msg === 'string' ? obj.msg : JSON.stringify(obj.msg);
    const sig = fingerprint(msg);
    const allow = isAllowlisted(msg);
    let bucket = sigBuckets.get(sig);
    if (!bucket) {
      bucket = { level, count: 0, samples: [], allowlisted: allow };
      sigBuckets.set(sig, bucket);
    }
    bucket.count++;
    if (bucket.samples.length < 3) bucket.samples.push({ file: path.relative(process.cwd(), file), line: lineNo, msg });

    if (level === 'WARN' && !allow && looksLikeStack(obj.detail)) {
      const detailHead = String(obj.detail).split('\n').slice(0, 4).join(' / ').slice(0, 240);
      stackWarnRecords.push({ file: path.relative(process.cwd(), file), line: lineNo, signature: sig, detailHead });
    }
    for (const p of KNOWN_PATTERNS) {
      if (p.regex.test(msg) || (obj.detail && typeof obj.detail === 'string' && p.regex.test(obj.detail))) {
        tagHits.set(p.tag, (tagHits.get(p.tag) || 0) + 1);
      }
    }
  }
}

// ── Threshold evaluation ───────────────────────────────────────────
const violations = [];
const offenders = [];
for (const [sig, b] of sigBuckets) {
  if (b.allowlisted) continue;
  if (b.count > opts.maxRepeat) {
    offenders.push({ signature: sig, level: b.level, count: b.count, sample: b.samples[0] });
  }
}
if (offenders.length > 0) {
  violations.push({
    rule: 'max-repeat',
    threshold: opts.maxRepeat,
    detail: `${offenders.length} signature(s) exceeded the per-message repeat threshold`,
    offenders,
  });
}
if (stackWarnRecords.length > opts.maxStackWarn) {
  violations.push({
    rule: 'max-stack-warn',
    threshold: opts.maxStackWarn,
    detail: `${stackWarnRecords.length} WARN entries carry a JS stack trace (only ERROR should)`,
    samples: stackWarnRecords.slice(0, 5),
  });
}

// ── Top-N WARN / ERROR signatures ──────────────────────────────────
function topN(level, n) {
  return [...sigBuckets.entries()]
    .filter(([, b]) => b.level === level)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, n)
    .map(([sig, b]) => ({ signature: sig, count: b.count, allowlisted: b.allowlisted, sample: b.samples[0]?.msg }));
}

const report = {
  scannedFiles: files.length,
  totalLines,
  nonNdjsonLines,
  levelCounts: counts,
  uniqueWarnSignatures: [...sigBuckets.values()].filter(b => b.level === 'WARN').length,
  uniqueErrorSignatures: [...sigBuckets.values()].filter(b => b.level === 'ERROR').length,
  topErrors: topN('ERROR', opts.top),
  topWarns: topN('WARN', opts.top),
  knownPatternHits: [...tagHits.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => {
    const known = KNOWN_PATTERNS.find(p => p.tag === tag);
    return { tag, count, hint: known?.hint };
  }),
  stackTracesAtWarn: stackWarnRecords.length,
  violations,
  thresholds: {
    maxRepeatPerSignature: opts.maxRepeat,
    maxStackWarn: opts.maxStackWarn,
  },
};

// ── Output ─────────────────────────────────────────────────────────
if (opts.summary) {
  fs.mkdirSync(path.dirname(opts.summary), { recursive: true });
  fs.writeFileSync(opts.summary, JSON.stringify(report, null, 2));
}
if (opts.json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  const w = (s) => process.stdout.write(s + '\n');
  w('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  w(' Log hygiene report');
  w('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  w(` files: ${files.length}   lines: ${totalLines}   non-ndjson: ${nonNdjsonLines}`);
  w(` ERROR: ${counts.ERROR}   WARN: ${counts.WARN}   INFO: ${counts.INFO}   DEBUG: ${counts.DEBUG}`);
  w('');
  w(` Top WARN signatures (max ${opts.top}, dedup'd by msg shape):`);
  for (const e of report.topWarns) {
    const tag = e.allowlisted ? ' [allowlisted]' : '';
    w(`   ${String(e.count).padStart(6)}× ${e.signature.slice(0, 100)}${tag}`);
  }
  w('');
  w(` Top ERROR signatures:`);
  for (const e of report.topErrors) {
    const tag = e.allowlisted ? ' [allowlisted]' : '';
    w(`   ${String(e.count).padStart(6)}× ${e.signature.slice(0, 100)}${tag}`);
  }
  if (report.knownPatternHits.length) {
    w('');
    w(' Known chronic patterns:');
    for (const h of report.knownPatternHits) {
      w(`   ${String(h.count).padStart(6)}× ${h.tag}`);
      if (h.hint) w(`           hint: ${h.hint}`);
    }
  }
  if (violations.length) {
    w('');
    w(' ╔══════════════════════════════════════════════════════════╗');
    w(' ║  THRESHOLD VIOLATIONS                                    ║');
    w(' ╚══════════════════════════════════════════════════════════╝');
    for (const v of violations) {
      w(`   [${v.rule}] threshold=${v.threshold}: ${v.detail}`);
      if (v.offenders) {
        for (const o of v.offenders.slice(0, 5)) {
          w(`     ${o.count}× [${o.level}] ${o.signature.slice(0, 90)}`);
          if (o.sample) w(`        first at ${o.sample.file}:${o.sample.line}`);
        }
      }
      if (v.samples) {
        for (const s of v.samples) w(`     stack-warn at ${s.file}:${s.line}: ${s.detailHead.slice(0, 120)}`);
      }
    }
  } else {
    w('');
    w(' ✅ No threshold violations.');
  }
}

if (opts.strict && violations.length > 0) process.exit(1);
process.exit(0);
