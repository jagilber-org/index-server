#!/usr/bin/env node
/**
 * Changelog freshness gate (#575, mechanism asked for by #561).
 *
 * Fails when a `feat:` or `fix:` commit landed since the last release tag and
 * neither its issue number nor its PR number appears in the `[Unreleased]`
 * section of CHANGELOG.md.
 *
 * Why this exists: `docs/release-checklist.md` already required `[Unreleased]`
 * to cover every commit since the last release, but nothing enforced it, so the
 * requirement was advisory. #561 fixed one instance of the omission by hand and
 * asked for a gate; the gate did not land, and 1.41.2 shipped with an empty
 * changelog section above six commits and +3,840 lines.
 *
 * Deliberately narrow:
 *  - Only `feat` and `fix` commits are required to appear. `chore`, `docs`,
 *    `test`, `ci`, `build`, `refactor`, `perf` and `style` are exempt -- a
 *    changelog is for consumers, and a gate that demands an entry for every
 *    dependency bump gets bypassed rather than satisfied.
 *  - A commit passes if EITHER the issue number in its scope (`fix(571):`) or
 *    a trailing PR reference (`(#615)`) is cited. A squash merge carries the
 *    PR number while the changelog usually cites the issue, and requiring the
 *    wrong one of the two would make this unsatisfiable.
 *  - Commits carrying no number at all are reported as a warning rather than a
 *    failure. They cannot be matched, so failing on them would force a fake
 *    reference into the changelog.
 *
 * Exit codes: 0 = OK, 1 = undocumented commits found or the gate cannot run.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

const DOCUMENTED_TYPES = /^(feat|fix)(\(|!|:)/;

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function lastReleaseTag() {
  // --abbrev=0 gives the nearest tag; restrict to v* so a non-release tag
  // cannot silently shrink the range and make this gate pass by scanning
  // nothing -- the failure mode guard:env had (#579).
  try {
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v*']);
  } catch {
    return null;
  }
}

/** Extract the `## [Unreleased]` body, up to the next `## [` heading. */
function unreleasedSection(text) {
  const start = text.search(/^## \[Unreleased\]/m);
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const nextHeading = rest.search(/^## \[/m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

/**
 * Numbers referenced by a commit subject: the conventional-commit scope when
 * it is numeric (`fix(571):`) and any `(#123)` / `#123` reference.
 */
function referencedNumbers(subject) {
  const out = new Set();
  const scope = subject.match(/^[a-z]+\((\d+)\)/i);
  if (scope) out.add(scope[1]);
  for (const m of subject.matchAll(/#(\d+)/g)) out.add(m[1]);
  return [...out];
}

/**
 * Is `n` cited in the section, as an actual reference?
 *
 * Deliberately NOT a bare-number match. Changelog prose is full of incidental
 * numbers -- line references, file counts, percentages, byte sizes -- and this
 * section alone contains 127, 358, 363, 400, 449, 475, 500, 509, 521, 524, 560
 * and 684 as ordinary text. Matching bare digits would let "684 files scanned"
 * satisfy a requirement to document issue #684: a gate that passes for a reason
 * unrelated to what it checks, which is the failure this gate exists to catch.
 *
 * Accepted forms: `#123`, `issues/123`, `pull/123`.
 */
function cited(section, n) {
  return new RegExp(`(?:#|issues/|pull/)${n}(?![0-9])`).test(section);
}

const tag = lastReleaseTag();
if (!tag) {
  console.error('[changelog-freshness] FAIL no v* tag found; cannot determine the release range.');
  console.error('[changelog-freshness] This is a bug in the gate or an unexpected repo state, not a clean result.');
  process.exit(1);
}

if (!fs.existsSync(changelogPath)) {
  console.error(`[changelog-freshness] FAIL ${changelogPath} not found.`);
  process.exit(1);
}

const changelog = fs.readFileSync(changelogPath, 'utf8');
const section = unreleasedSection(changelog);
if (section === null) {
  console.error('[changelog-freshness] FAIL CHANGELOG.md has no `## [Unreleased]` heading.');
  process.exit(1);
}

const raw = git(['log', `${tag}..HEAD`, '--no-merges', '--format=%h%x1f%s']);
const commits = raw ? raw.split('\n').map(l => {
  const [hash, subject] = l.split('\x1f');
  return { hash, subject };
}) : [];

const relevant = commits.filter(c => DOCUMENTED_TYPES.test(c.subject));
const undocumented = [];
const unnumbered = [];

for (const c of relevant) {
  const nums = referencedNumbers(c.subject);
  if (nums.length === 0) { unnumbered.push(c); continue; }
  if (!nums.some(n => cited(section, n))) undocumented.push({ ...c, nums });
}

console.log(`[changelog-freshness] range ${tag}..HEAD — ${commits.length} commit(s), ${relevant.length} feat/fix requiring an entry.`);

if (unnumbered.length) {
  console.warn(`[changelog-freshness] WARN ${unnumbered.length} feat/fix commit(s) carry no issue or PR number, so they cannot be checked:`);
  for (const c of unnumbered) console.warn(`  ${c.hash} ${c.subject}`);
}

if (undocumented.length) {
  console.error(`\n[changelog-freshness] FAIL ${undocumented.length} feat/fix commit(s) since ${tag} are absent from [Unreleased]:\n`);
  for (const c of undocumented) {
    console.error(`  ${c.hash} ${c.subject}`);
    console.error(`    looked for: ${c.nums.map(n => `#${n}`).join(' or ')}\n`);
  }
  console.error('Add an entry citing the issue or PR number. A changelog that omits');
  console.error('the change consumers will notice is worse than no changelog, because');
  console.error('it looks complete.');
  process.exit(1);
}

if (relevant.length === 0) {
  console.log('[changelog-freshness] OK no feat/fix commits since the last release tag.');
} else {
  console.log(`[changelog-freshness] OK all ${relevant.length} feat/fix commit(s) are cited in [Unreleased].`);
}
