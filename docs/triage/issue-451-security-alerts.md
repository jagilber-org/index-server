# Security alert triage — #451

**Status**: reconciliation in progress. This document scopes each open alert reported on
the mirror repo `jagilber-org/index-server` (Security and quality: **30 alerts** — 3
Dependabot + 27 CodeQL) and records its disposition.

**Source of truth**: fixes land in `jagilber-dev/index-server`; the mirror clears on the
next publish + CodeQL/Dependabot re-scan. Code links refer to `jagilber-dev/index-server`
HEAD. Tracking issue: #451.

## Disposition summary

| # | Sev | Rule / Package | Location | Disposition |
|---|-----|----------------|----------|-------------|
| #94 | high | `js/polynomial-redos` | `src/services/schemaMigrationService.ts` (`normalizeLegacyId`) | **Fixed** — removed `$`-anchored `+` edge-trim regexes; replaced with linear index-scan trim. |
| #68–#93 (26) | medium | `actions/missing-workflow-permissions` | `.github/workflows/*.yml` | **Already remediated** in commit `a858240` — top-level `permissions: contents: read` present on all flagged workflows. Auto-clears on re-scan. |
| #26 | low | `dompurify` (transitive via `mermaid`) | `package-lock.json` | **Fixed** — `npm update dompurify` 3.4.2 → 3.4.11 (within `mermaid` `^3.3.1`). |
| #24 | low | `esbuild` dev-server file read (GHSA-g7r4-m6w7-qqqr) | `package-lock.json` | **Dismiss (dev-only, not exploitable)** — esbuild is transitive via `vite`→`vitest` (test runner only). No esbuild/vite dev server is ever invoked in this repo. Fix (0.28.1) is outside `vite`'s `^0.27.0` range; forcing an override risks toolchain churn for zero runtime benefit. |
| #25 | high | `esbuild` integrity verification (advisory **withdrawn**) | `package-lock.json` | **Dismiss (won't fix — withdrawn advisory)** — advisory withdrawn upstream; esbuild is dev/test-only and never shipped in the published package or runtime. |

## Detailed rationale

### #94 `js/polynomial-redos` — `schemaMigrationService.ts` `normalizeLegacyId`

A prior fix (#444, commit `a858240`) added a `.slice(0, 200)` length bound ahead of the
chained replaces, but CodeQL re-flagged the function (#94): the static analyzer follows the
regex shape, not the upstream length bound, and the `$`-anchored `+`-quantified edge-trim
patterns (`/^[^a-z0-9]+/`, `/[^a-z0-9]+$/`) are evaluated in O(n²) under an unanchored
search.

**Fix**: leading/trailing non-alphanumerics are now stripped by `trimNonAlphanumericEdges`,
a non-regex index scan that is unconditionally linear and ReDoS-proof. The remaining
regexes (`/[^a-z0-9_-]+/g`, `/[-_]{2,}/g`) are single-class global replaces (linear).
Behavior is unchanged — existing normalization outputs (`legacy-reference`,
`repair-legacy-reference`, 120-char cap) are preserved and covered by
`src/tests/schemaMigrationService.spec.ts` (`ReDoS-safe (#444, #94)`).

### #68–#93 `actions/missing-workflow-permissions` (26 medium)

Commit `a858240` ("fix(security): resolve #444 CodeQL alerts (workflow perms + ReDoS
hardening)") already added a top-level least-privilege `permissions: contents: read` block
to every flagged workflow. The mirror's open alerts predate the re-scan of that commit.
**Action**: no code change; trigger / await the next CodeQL re-scan to auto-close.

### Dependabot (3, all transitive in `package-lock.json`)

- **#26 dompurify** — transitive via `mermaid` (`^3.3.1`), used client-side to sanitize
  mermaid-rendered SVG in the dashboard graph view. Bumped 3.4.2 → 3.4.11 with
  `npm update dompurify` (no `package.json` change required). Re-scan auto-closes.
- **#24 esbuild** — GHSA-g7r4-m6w7-qqqr (arbitrary file read via the esbuild dev server on
  Windows) affects 0.27.3–0.28.0; we are on 0.27.7. esbuild is pulled only by
  `vite`→`vitest` (the test runner). This repo never starts an esbuild/vite dev server, so
  the vulnerable surface is not reachable. The patched 0.28.1 is outside `vite`'s
  `^0.27.0` range; a forced override would churn the test toolchain for no runtime gain.
  Dismiss as dev-only / not exploitable.
- **#25 esbuild** — advisory withdrawn upstream; esbuild is dev/test-only and never
  shipped. Dismiss as won't-fix (withdrawn).

## Out-of-scope observations (not part of #451)

`npm audit` on current HEAD additionally reports moderate advisories in other transitive
dev/build deps (`js-yaml`, `protobufjs`, `tar`). These are **not** among the 30 alerts in
#451 and may warrant a separate follow-up; they are intentionally not addressed here to
keep this reconciliation scoped.

## Definition of done

- [x] #94 ReDoS fixed (code + regression test) in `jagilber-dev/index-server`.
- [x] dompurify bumped (#26) via lockfile refresh.
- [x] Workflow-permission completeness confirmed (#68–#93 already in HEAD).
- [ ] Branch committed + pushed; PR opened (requires user approval — repo no-push rule).
- [ ] GHAS dismissals filed for #24 (dev-only) and #25 (withdrawn) with the rationale above.
- [ ] Mirror `jagilber-org/index-server` shows 0 open alerts after next publish + re-scan.

## GitHub-side actions pending user approval

These are intentionally **not** executed automatically (repo rule: no push without approval):

1. Create feature branch, commit the changes, and open a PR (`fix(security): resolve #451 …`).
2. Dismiss Dependabot #24 (dev-only) and #25 (withdrawn) on the mirror with the rationale above.
3. Update issue #451 checkboxes / post a reconciliation status comment.
