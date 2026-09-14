/**
 * Shared link/reachability model for the documentation index (#586).
 *
 * Both the generator (`scripts/build/generate-docs-index.mjs`) and the gate
 * (`scripts/governance/check-docs-reachability.mjs`) read the doc set through
 * this module, so the file that gets written and the file that gets checked
 * cannot disagree about what counts as a reference.
 *
 * Case sensitivity is the whole point. `docs_index.md` accumulated 28 dead
 * SCREAMING-KEBAB references (`TOOLS.md` for `tools.md`) that every
 * `fs.existsSync` on Windows answers `true` for, which is why the rot went
 * unnoticed for months. Every resolution here goes through the exact-case set
 * returned by `git ls-files`, never through the filesystem.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/** Exact-case set of tracked repo paths, POSIX-separated, relative to root. */
export function trackedFiles(repoRoot) {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return new Set(out.split('\0').filter(Boolean));
}

/** Extensions that make a backticked token a path claim rather than prose. */
const DOC_EXT = /\.(md|html|json|mjs|cjs|ts|ps1|yml|yaml)$/;

/**
 * Relative path references in a markdown file.
 *
 * Always counted: inline links `[x](path)` and reference definitions `[x]: p`.
 *
 * With `codeSpans: true`, backticked tokens that look like paths are counted
 * too. That option is on for `docs_index.md` and off everywhere else, and the
 * asymmetry is deliberate: an index entry written as `` `TOOLS.md` `` is making
 * exactly the same promise as `[TOOLS.md](TOOLS.md)` and is how 24 of the 28
 * dead references got in, whereas ordinary prose in other docs legitimately
 * names files that were deleted on purpose. Restricting code-span checking to
 * the one generated file keeps the gate strict where it matters without making
 * it unsatisfiable elsewhere.
 *
 * Fenced code blocks are skipped in both modes.
 */
export function markdownRefs(absFile, { codeSpans = false } = {}) {
  const lines = fs.readFileSync(absFile, 'utf8').split(/\r?\n/);
  const refs = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const push = (raw, kind) => {
      const target = raw.trim().replace(/^<|>$/g, '');
      if (!target) return;
      if (/^(https?:|mailto:|#)/i.test(target)) return;
      refs.push({
        target: target.split('#')[0],
        line: i + 1,
        raw: target,
        kind,
      });
    };
    // `(?:\\.|[^\]\\])*` rather than `[^\]]*`: a label may contain escaped
    // brackets (`\[warning\]`), and a naive class stops at the backslash-
    // escaped `]`, making a perfectly good link invisible to the gate.
    for (const m of line.matchAll(/\[(?:\\.|[^\]\\])*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g))
      push(m[1], 'link');
    for (const m of line.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)) push(m[1], 'linkdef');
    if (codeSpans) {
      for (const m of line.matchAll(/`([^`\s]+)`/g)) {
        const tok = m[1];
        // File extensions only. A bare `docs/` in a sentence is naming a
        // directory, not promising a link, and firing on it would make the
        // gate red for correct prose -- which is how gates get disabled.
        if (!DOC_EXT.test(tok)) continue;
        if (tok.includes('*')) continue; // glob, not a path claim
        push(tok, 'code');
      }
    }
  });
  return refs.filter((r) => r.target);
}

/**
 * Resolve a reference found in `fromFile` to a repo-relative POSIX path.
 * Returns null when it escapes the repo.
 */
export function resolveRef(repoRoot, fromFile, target) {
  const abs = path.resolve(path.dirname(fromFile), decodeURIComponent(target));
  const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
  return rel.startsWith('..') ? null : rel;
}

/** True when `rel` is a tracked file, or a directory containing tracked files. */
export function existsTracked(tracked, rel) {
  if (tracked.has(rel)) return true;
  const asDir = rel.replace(/\/$/, '') + '/';
  for (const f of tracked) if (f.startsWith(asDir)) return true;
  return false;
}

/** Every tracked markdown file under docs/. */
export function docFiles(tracked) {
  return [...tracked].filter((f) => f.startsWith('docs/') && f.endsWith('.md')).sort();
}

/** Title (first `# ` heading) and one-line summary of a doc. */
export function docSummary(absFile) {
  const lines = fs.readFileSync(absFile, 'utf8').split(/\r?\n/);
  let title = null;
  let inFence = false;
  const para = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!title) {
      const h = line.match(/^#\s+(.+?)\s*$/);
      if (h) title = h[1];
      continue;
    }
    const t = line.trim();
    // Collect the whole first prose paragraph, not just its first physical
    // line: several docs hard-wrap at ~100 columns, and taking one line gives
    // a summary cut mid-clause ("...with the").
    if (para.length === 0) {
      if (!t || t.startsWith('#') || t.startsWith('|') || t.startsWith('>') || t.startsWith('<!--'))
        continue;
      para.push(t);
      continue;
    }
    if (!t) break;
    para.push(t);
  }
  let summary = para.join(' ');
  // Strip markdown emphasis/links/code so the cell stays a single readable line.
  summary = summary
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\|/g, '\\|')
    .trim();
  const firstSentence = summary.match(/^(.*?[.!?])(\s|$)/);
  if (firstSentence) summary = firstSentence[1];
  if (summary.length > 160) summary = summary.slice(0, 157).replace(/\s+\S*$/, '') + '…';
  return { title, summary };
}
