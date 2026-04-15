---
id: 005-template-conformance-enrichment-review
version: 0.1.0
status: proposed
priority: P1
category: governance
created: 2026-04-15
updated: 2026-04-15
author: system
lineage: none
summary: Deep review of index-server drift against template-repo to identify direct adoptions, canonical template enrichments, and true long-term deviations
---

# Feature: Template Conformance And Enrichment Review

## Summary

Perform a deep, evidence-based review of `jagilber-dev/index-server` against
`jagilber/template-repo` now that the template repo is the canonical parent.
The outcome is not just a drift report. The real goal is to identify which
improvements made in index-server should be promoted back into template-repo so
all descendant repos can inherit them, and then reduce index-server to only the
smallest justified set of remaining deviations.

## Problem Statement

Index-server predates template-repo and therefore accumulated security,
workflow, CI, publish, and governance behavior that diverged from the later
canonical template. Some of that drift is accidental or legacy. Some of it is a
genuine improvement over the template baseline. If this is not reviewed early,
maintenance cost increases in two ways:

- index-server keeps carrying repo-specific drift that every future template bump
  must reconcile by hand
- template-repo fails to learn from hard-won improvements already validated in
  index-server, so every new repo starts from a weaker or less complete base

The review must therefore classify drift into three buckets:

1. adopt directly from template-repo
2. enrich template-repo first, then adopt downstream
3. retain as explicit, durable deviation with rationale

## Requirements

- [REQ-1] Produce a complete inventory of template-managed and adjacent
  surfaces where index-server differs from template-repo.
- [REQ-2] Classify each difference as direct adoption, template enrichment
  candidate, or true repo-specific deviation.
- [REQ-3] For each template enrichment candidate, capture concrete evidence of
  why index-server's version is better, safer, or more maintainable.
- [REQ-4] For each template enrichment candidate, define the minimal reusable
  change that could apply to other repos without pulling in index-server-only
  behavior.
- [REQ-5] Produce a backlog of GitHub issues to create in
  `jagilber/template-repo`, each with scope, rationale, affected files, rollout
  impact, and recommended version-bump class.
- [REQ-6] Identify which current local deviations in `.template-adoption.json`
  can disappear after template enrichment.
- [REQ-7] Identify which remaining deviations should stay local even after
  template enrichment and document why.
- [REQ-8] Prioritize the resulting work so security and governance-critical
  template enrichments happen before cosmetic or low-value alignment work.
- [REQ-9] Preserve the current repo's stronger behavior during review; the
  review must not weaken existing security or publication controls just to
  improve byte-level parity.
- [REQ-10] Leave a tracked plan in this repo so the conformance campaign can be
  executed incrementally rather than in one risky migration.

## Success Criteria

- [ ] Every major drift surface is cataloged with one owner classification:
      adopt, enrich-template, or keep-local.
- [ ] A concrete issue backlog exists for `jagilber/template-repo` enrichment
      work, ready to create.
- [ ] At least the high-value candidates are isolated clearly enough that work
      can begin in template-repo without redoing discovery.
- [ ] `.template-adoption.json` deviations are split into temporary deviations
      awaiting template enrichment versus expected long-term differences.
- [ ] The review gives a credible path toward near-100% conformance without
      forcing weaker behavior into index-server.

## Non-Goals

- Immediate full migration of all drift in one change.
- Blind byte-for-byte replacement of repo surfaces with template versions.
- Creating or merging template-repo changes as part of this planning step.
- Weakening index-server publish protections, slow pre-push validation, or other
  stronger local controls just to satisfy the current compare helper.

## Technical Considerations

- **Canonical parent**: `jagilber/template-repo` is the source of truth for the
  baseline starting point.
- **Current repo role**: index-server is both an adopter and a source of mature
  patterns that may deserve promotion back to the template.
- **Comparison tooling**: `scripts/Compare-TemplateSpec.ps1` from the template
  repo is useful but incomplete; the review must also inspect template additions
  not yet modeled there.
- **Primary drift clusters** likely include:
  - hook orchestration and entrypoint layout
  - publish and public-repo guard behavior
  - pre-push validation scope and slow-suite handling
  - Semgrep and scanner policy surfaces
  - constitution sync and metadata tooling
  - CI workflow pinning, issue templates, and governance docs
- **Promotion principle**: if index-server has a stronger pattern that is safe to
  generalize, enrich template-repo first and then re-adopt it here.
- **Deviation principle**: only keep a local deviation when it is truly product-
  specific, environment-specific, or incompatible with a reusable template base.

## Dependencies

- `jagilber/template-repo` current template manifest and managed surfaces
- `jagilber-dev/index-server` current adoption metadata and local deviations
- existing compare tooling and focused validation scripts
- GitHub issue creation in `jagilber/template-repo` after the review is complete

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Treating all drift as bad drift | High | Classify improvements separately from accidental divergence |
| Over-generalizing index-server-specific behavior into template-repo | High | Require reusable scope and adopter impact analysis for each enrichment issue |
| Missing unmodeled template surfaces | Medium | Review compare-helper output plus manual template version notes and file inventory |
| Weakening local protections in pursuit of parity | Critical | Preserve stronger local behavior until the template can absorb it safely |
| Issue backlog too vague to execute | Medium | Require file-level evidence, rationale, and migration notes per candidate |

## References

- `template-manifest.json`
- `.template-adoption.json`
- `.instructions/shared/template-adoption-workflow.md`
- `.instructions/shared/repository-security-hooks.md`
- `c:\github\jagilber\template-repo\template-manifest.json`
- `c:\github\jagilber\template-repo\scripts\Compare-TemplateSpec.ps1`
