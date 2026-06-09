#!/usr/bin/env node
/**
 * validate-npm-files.mjs — detect drift between `package.json#files` and the
 * actual file references made by shipped JS entrypoints.
 *
 * Closes the failure class tracked in issue #247: PR #240 was required
 * because `scripts/build/generate-certs.mjs` was missing from
 * `package.json#files`. The setup wizard invoked it via
 * `execFileSync(path.join(ROOT, 'scripts', 'build', 'generate-certs.mjs'), …)`,
 * a dynamic invocation that no static import analyzer would catch. The
 * omission was only surfaced during release smoke testing.
 *
 * Strategy
 * --------
 * 1. Resolve the **declared** shipped set from `package.json#files`: walk
 *    each pattern, expand directory entries, and apply `!` negations. This
 *    avoids relying on `npm pack --dry-run` output, which silently skips
 *    junction-linked directories on Windows worktrees and would produce
 *    false positives in dev sandboxes.
 * 2. For every shipped JS source (`.mjs` / `.cjs` / `.js` outside
 *    `node_modules/` and `dist/` itself), extract every **reference** to
 *    another in-repo file using three pattern families:
 *      - Relative ES-module / CommonJS imports (`import x from './a.mjs'`,
 *        `require('../b.cjs')`).
 *      - String-array forms of `path.join(…, 'scripts', 'build', 'x.mjs')`
 *        that resolve to a repo-relative path ending in a JS extension.
 *      - Bare literal references to `scripts/<…>.{mjs,cjs,js}` anywhere in
 *        source (covers diagnostic strings and dynamic invocations).
 * 3. Each reference must resolve to a path that is itself shipped. Any miss
 *    is a drift defect — the runtime path will fail with
 *    `MODULE_NOT_FOUND` / `ENOENT` once a user installs from the registry.
 *
 * Exit codes
 *   0  no drift
 *   1  drift detected (or unreadable inputs)
 *
 * Usage
 *   node scripts/governance/validate-npm-files.mjs
 *   node scripts/governance/validate-npm-files.mjs --json   (machine-readable
 *                                                            report on stdout;
 *                                                            still exits 1 on
 *                                                            drift so CI fails)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..');
const JS_EXTS = new Set(['.mjs', '.cjs', '.js']);

function toPosix(p) {
  return p.split(sep).join('/');
}

function parseArgs(argv) {
  const args = { json: false };
  for (const a of argv) {
    if (a === '--json') args.json = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/governance/validate-npm-files.mjs [--json]');
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Resolve declared shipped set from package.json#files
// ---------------------------------------------------------------------------

function listAllFilesUnder(absDir) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push(abs);
    }
  }
  walk(absDir);
  return out;
}

function buildShippedSet(pkg) {
  const include = new Set();
  const excludePrefixes = [];

  for (const pattern of pkg.files ?? []) {
    if (pattern.startsWith('!')) {
      // Treat `!dist/tests/` as "anything under dist/tests/". `package.json`
      // currently uses only directory-style negations; that's sufficient.
      const negated = pattern.slice(1);
      excludePrefixes.push(negated.replace(/\/+$/, '') + '/');
      continue;
    }
    const abs = join(REPO_ROOT, pattern);
    if (pattern.endsWith('/')) {
      // Directory entry — expand recursively.
      for (const f of listAllFilesUnder(abs)) {
        include.add(toPosix(relative(REPO_ROOT, f)));
      }
    } else if (existsSync(abs)) {
      try {
        const st = statSync(abs);
        if (st.isDirectory()) {
          for (const f of listAllFilesUnder(abs)) {
            include.add(toPosix(relative(REPO_ROOT, f)));
          }
        } else {
          include.add(toPosix(pattern));
        }
      } catch {
        include.add(toPosix(pattern));
      }
    } else {
      // Declared but missing — treat as declared; the existence check happens
      // separately when we follow references. (We don't want to suppress drift
      // reports just because a declaration is stale.)
      include.add(toPosix(pattern));
    }
  }

  // npm always includes these regardless of `files`.
  for (const always of ['package.json', 'README.md', 'LICENSE']) {
    const abs = join(REPO_ROOT, always);
    if (existsSync(abs)) include.add(always);
  }

  // Apply negations.
  const result = new Set();
  for (const f of include) {
    if (excludePrefixes.some((p) => f.startsWith(p))) continue;
    result.add(f);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reference extraction
// ---------------------------------------------------------------------------

/**
 * Return repo-relative paths referenced by `src` (a JS source file). Three
 * pattern families — see header doc.
 */
function extractReferences(srcRelPath, srcText) {
  const refs = new Set();
  const srcAbs = join(REPO_ROOT, srcRelPath);
  const srcDirAbs = dirname(srcAbs);

  // 1. Relative import/require: `import … from './a.mjs'` / `require('../b')`.
  const importRe = /(?:from|require\s*\()\s*['"]((?:\.\.?\/)[^'"]+)['"]/g;
  for (const m of srcText.matchAll(importRe)) {
    let spec = m[1];
    let candidates = [];
    if (JS_EXTS.has(extname(spec))) {
      candidates.push(spec);
    } else {
      // Bareword import — try common JS extensions plus /index.*.
      for (const ext of JS_EXTS) candidates.push(spec + ext);
      for (const ext of JS_EXTS) candidates.push(spec + '/index' + ext);
    }
    for (const c of candidates) {
      const abs = resolve(srcDirAbs, c);
      const rel = toPosix(relative(REPO_ROOT, abs));
      if (rel.startsWith('..')) continue; // outside repo (e.g. node:fs)
      if (existsSync(abs)) {
        refs.add(rel);
        break;
      }
    }
  }

  // 2. `path.join(<base>, 'scripts', 'a', 'b', 'x.<ext>')` — synthesize the
  //    repo-relative path from the string-literal tail.
  //    Match the whole call, then peel off string-literal segments.
  const joinRe = /path\.join\s*\(([^)]*)\)/g;
  for (const m of srcText.matchAll(joinRe)) {
    const inner = m[1];
    // Extract only the string-literal arguments in order.
    const litRe = /['"]([^'"]+)['"]/g;
    const lits = [...inner.matchAll(litRe)].map((x) => x[1]);
    if (lits.length === 0) continue;
    const last = lits[lits.length - 1];
    if (!JS_EXTS.has(extname(last))) continue;
    // Only consider chains that start with a known shipped top-level dir to
    // avoid matching arbitrary user-input paths.
    if (lits[0] !== 'scripts' && lits[0] !== 'dist' && lits[0] !== 'schemas' && lits[0] !== 'templates') continue;
    refs.add(toPosix(lits.join('/')));
  }

  // 3. Bare literal `scripts/...\.<ext>` anywhere in source — catches
  //    diagnostic strings, README snippets, dynamic invocations.
  const literalRe = /['"`](scripts\/[A-Za-z0-9_\-./]+\.(?:mjs|cjs|js))['"`]/g;
  for (const m of srcText.matchAll(literalRe)) {
    refs.add(m[1]);
  }

  return refs;
}

function extname(p) {
  const i = p.lastIndexOf('.');
  if (i < 0) return '';
  return p.slice(i);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkgPath = join(REPO_ROOT, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (e) {
    console.error(`validate-npm-files: cannot read ${pkgPath}: ${e.message}`);
    process.exit(1);
  }

  const shipped = buildShippedSet(pkg);

  // Always ALSO honor the `bin` entry as an entrypoint to scan, even when its
  // target lives under a directory that's already in `files`.
  const entrypoints = new Set();
  if (pkg.bin && typeof pkg.bin === 'object') {
    for (const v of Object.values(pkg.bin)) entrypoints.add(toPosix(v));
  }

  // Defensive sanity: if no shipped files were discovered at all, the script
  // is misconfigured — fail loudly rather than reporting a vacuous OK.
  if (shipped.size === 0) {
    console.error('validate-npm-files: declared shipped set is empty — refusing to validate');
    process.exit(1);
  }

  const missing = [];
  const sources = new Set();
  for (const f of shipped) sources.add(f);
  for (const ep of entrypoints) sources.add(ep);

  for (const rel of sources) {
    if (!JS_EXTS.has(extname(rel))) continue;
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) continue;
    let text;
    try { text = readFileSync(abs, 'utf8'); } catch { continue; }
    const refs = extractReferences(rel, text);
    for (const ref of refs) {
      // Refs that point into `dist/` are covered by the `dist/` directory
      // entry (we already expanded it). Same for any other directory entry.
      // The shipped set is the source of truth.
      if (shipped.has(ref)) continue;
      // Tolerate refs that DON'T exist on disk at all — those are dead string
      // matches (e.g. error messages with example paths). Drift means: the
      // reference resolves to a real file that isn't shipped.
      if (!existsSync(join(REPO_ROOT, ref))) continue;
      missing.push({ from: rel, ref });
    }
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ ok: missing.length === 0, shippedCount: shipped.size, missing }, null, 2) + '\n');
  } else if (missing.length === 0) {
    console.log(`validate-npm-files: OK — ${shipped.size} files declared shipped, no drift detected`);
  } else {
    console.error(`validate-npm-files: ${missing.length} reference(s) point at file(s) NOT covered by package.json#files:`);
    for (const m of missing) console.error(`  ${m.from} -> ${m.ref}`);
    console.error('');
    console.error('Either add the referenced file to `package.json#files`, OR remove the');
    console.error('reference if it is dead code. This drift class caused PR #240 (issue #247):');
    console.error('a script in `files` invoked `scripts/build/generate-certs.mjs` via');
    console.error('execFileSync, but that file was not itself in `files`, so npm-installed');
    console.error('consumers got `ENOENT` at runtime.');
  }

  process.exit(missing.length === 0 ? 0 : 1);
}

main();
