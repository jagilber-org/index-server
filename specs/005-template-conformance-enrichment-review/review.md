# Drift Review: Index-Server vs Template-Repo

## Snapshot

Current comparison baseline:

- Template: `layered-hook-security-template` `v1.16.0`
- Adopted version recorded in this repo: `v1.16.0`
- Compare helper summary:
  - `ExactMatchFilesOutOfSync`: `15`
  - `MergeReviewFilesNeedingAttention`: `11`
  - `RepoSpecificFilesToReview`: `4`

Important caveat: the current template compare helper is itself a source of
drift noise. It still hardcodes an older comparison surface and does not fully
model the current `v1.16.0` template contract. That means the helper both:

- over-reports some intentional `scripts/` vs `hooks/` structural differences
- under-reports some newer template-managed additions that were added after the
  helper's hardcoded file list

This review therefore treats the helper as one signal, not the source of truth.

## Review Matrix

| Cluster | Current Evidence | Stronger Side Today | Classification | Next Step |
|---------|------------------|---------------------|----------------|-----------|
| Compare-helper and managed-surface modeling | `template-manifest.json` `v1.16.0` includes newer surfaces such as `git-workflow.md`, issue forms, `.semgrep.yml`, `promotion-freshness.yml`, and `auto-tag.yml`, while `scripts/Compare-TemplateSpec.ps1` still compares an older hardcoded file list and still expects canonical `hooks/*` entrypoints only. | Template manifest is current; compare helper is stale. | Enrich template first | Fix the template compare helper to derive or track the current managed surface accurately, including optional or profile-based files. |
| Hook entrypoint layout and orchestration | Template uses explicit `hooks/*.ps1` entrypoints via `.pre-commit-config.yaml`. Index-server consolidates forbidden-file, PII, and env-leak logic in `scripts/pre-commit.ps1`, uses `scripts/pre-push.ps1` for an extra slow suite, and uses `scripts/pre-push-public-guard.cjs` for push protection. | Mixed: template shape is cleaner; index-server behavior is richer. | Enrich template first, then converge | Design a canonical convergence path so mature repos can preserve stronger logic while still landing on a template-shaped hook surface. |
| Public publish and mirror guard semantics | Template `hooks/pre-push-public-guard.ps1` bypasses with `PUBLISH_OVERRIDE=1`. Index-server requires a hash token derived from `publish-<tag>-<date>`, sets `PUBLISH_TAG`, and blocks known publication mirrors directly. | Index-server | Enrich template first | Promote the stronger bypass contract and publication-mirror semantics into template-repo, then re-adopt downstream. |
| Semgrep pre-push wrapper policy | Template wrapper includes `p/security-audit` and `.semgrep.yml`. Current index-server `scripts/run-semgrep-pre-push.ps1` still runs only `p/ci` and `p/github-actions`. | Template | Adopt directly in index-server | Align the index-server Semgrep pre-push wrapper with the template policy; no upstream issue required. |
| Optional extra pre-push validation | Index-server adds `scripts/pre-push.ps1` with timeout control, docs-only skip logic, and a slow test suite. Template has no equivalent extension point. | Index-server for this repo only | Keep local, possibly document upstream | Treat this as a repo-specific extension unless a reusable template pattern emerges. |
| Auto-tag workflow | Template `auto-tag.yml` tags `templateVersion` changes. Index-server uses Git tags for product releases and public publish flow, not template-version milestones. | Repo-specific | Keep local for now; likely enrich template docs | Consider making auto-tag an optional or template-source-only profile in the canonical template. |
| Constitution sync implementation | Template uses a standalone PowerShell generator. Index-server uses `sync-constitution.cjs` as the source implementation and keeps `scripts/sync-constitution.ps1` as a wrapper. | Repo-specific | Keep local | Maintain as a local deviation unless the template later introduces a generalized wrapper model. |
| Runtime instruction catalog coexistence | Index-server already relies on `instructions/` as product surface and `.instructions/` as repo-local guidance. Template guidance now supports this. | Already aligned in intent | No issue | Keep current local structure; no upstream action required. |
| Metadata validation and adoption schema | Index-server had stale adoption schema (`adoptedTemplateVersion`) but now aligns to `templateVersion` and adopted the template metadata validator. | Template | Mostly resolved | Maintain alignment and use as baseline for future adoption passes. |

## Classification Summary

### Enrich Template First

These are the highest-value upstream candidates because they remove future drift
not just in this repo, but in every adopter:

1. Compare-helper parity with the actual template manifest and managed surface.
   Tracked upstream in `jagilber/template-repo#48`.
2. Hardened public publish guard and publish bypass contract.
   Tracked upstream in `jagilber/template-repo#49`.
3. Canonical hook convergence strategy for repos with stronger or consolidated
   local hook logic. Tracked upstream in `jagilber/template-repo#50`.
4. Auto-tag workflow scoping so product repos are not forced into a template-
   version tagging model that conflicts with release tags.
   Tracked upstream in `jagilber/template-repo#51`.

### Adopt Directly In Index-Server

These are cases where the template is already better and index-server should
just consume the delta:

1. Semgrep pre-push wrapper should add `p/security-audit` and `.semgrep.yml`.
   Status: completed on this review branch and validated with a successful
   execution of `scripts/run-semgrep-pre-push.ps1`.
2. Low-risk exact-match or merge-review doc/config cleanup after the upstream
   enrichment backlog is defined.

### Keep Local

These currently look like true or at least justified repo-specific deviations:

1. `sync-constitution.cjs` as the source implementation.
2. Product-release tag semantics instead of `templateVersion` auto-tagging.
3. Additional slow pre-push suite with repo-specific skip and timeout logic.
4. Product/runtime `instructions/` catalog coexistence with `.instructions/`.

## Working Hypothesis For Near-100% Conformance

Near-maximum conformance is still realistic, but only if the sequence is:

1. move reusable index-server improvements upstream into template-repo
2. update template comparison and adoption tooling so the signal is accurate
3. re-adopt those template changes in index-server
4. leave only product-specific deviations in `.template-adoption.json`

If the repo instead chases byte-level parity first, it will likely either weaken
local protections or force index-server-specific behavior to stay permanently
out-of-band.
