/**
 * Detect a published clean-room mirror.
 *
 * `New-CleanRoomCopy.ps1` strips everything listed in `.publish-exclude`
 * (`.instructions/`, `.specify/`, `.squad/`, `scripts/mappings/`,
 * `.github/copilot-instructions.md`, assorted internal docs) and then writes a
 * `.publish-manifest.json`. That manifest exists ONLY in the mirror — the
 * source repo does not track one — which makes it a reliable sentinel.
 *
 * Why this exists: three separate gates have now failed in the mirror for the
 * same reason, each one describing the mirror's own amputations as a defect.
 *
 *   - `npm run build` died on ENOENT reading `scripts/mappings/`.
 *   - `guard:constitution` reported ~50 missing enforcers and demoted 8 rules
 *     to "prose only" (ratchet 31 vs baseline 23).
 *   - `guard:docs` reported `docs/docs_index.md` stale, because the index is a
 *     derived artifact copied verbatim into a tree whose inputs changed.
 *
 * The shared rule: a gate whose inputs are deliberately stripped at publish
 * time has no jurisdiction in the mirror. It belongs to the source repo, where
 * it still runs in full and can still fail. Use this helper rather than adding
 * a fourth copy of the check.
 *
 * IMPORTANT: this must never be used to skip a gate that genuinely applies to
 * published content (security scanning, secret detection, build correctness).
 * It is only for gates that assert things about files the mirror is not
 * permitted to contain.
 */
import { existsSync } from 'fs';
import { join } from 'path';

/** @param {string} repoRoot @returns {boolean} */
export function isPublishedMirror(repoRoot) {
  return existsSync(join(repoRoot, '.publish-manifest.json'));
}

/**
 * Skip helper: prints why, then returns true if the caller should bail out.
 *
 * @param {string} repoRoot
 * @param {string} label   guard name, e.g. 'docs-index'
 * @param {string} reason  what cannot resolve here and why
 * @returns {boolean}
 */
export function skipOnPublishedMirror(repoRoot, label, reason) {
  if (!isPublishedMirror(repoRoot)) return false;
  console.log(`[${label}] .publish-manifest.json present — this is a published clean-room mirror, not the governed repo.`);
  console.log(`[${label}] ${reason}`);
  console.log(`[${label}] SKIPPED — this gate is enforced in the source repo.`);
  return true;
}
