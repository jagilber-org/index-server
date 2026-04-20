# Template Adoption Workflow

Use this workflow when applying the template repo spec to an existing repository.

## Principles

1. Do not overwrite existing repos wholesale from the template.
2. Apply versioned deltas from the template instead.
3. Preserve repo-specific workflow, publish, and documentation behavior unless the template explicitly replaces it.
4. Record adoption state so later updates are `old-version -> new-version`, not a fresh audit.

## Required Metadata

Each adopted repository should commit a root-level `.template-adoption.json` file derived from `template-adoption.example.json`.

That file should record:

- template name
- adopted template version
- shared hook standard version
- adoption date
- intentional local deviations

## Update Procedure

1. Run `pwsh -File scripts/Compare-TemplateSpec.ps1 -TargetRepoPath <repo>` from the template repo.
2. Fix `ExactMatch` files first.
3. Reconcile `MergeReview` files next.
4. Review `RepoSpecific` files manually.
5. Choose the target repo's license explicitly, or document proprietary or internal-only status before public distribution or reuse. Do not assume the template repo's own `LICENSE` should be copied unchanged.
6. If the template source repo itself changes template-managed behavior, align `template-manifest.json`, `.template-adoption.json`, and `template-adoption.example.json` in the same change.
7. Resolve tracked-output and ignore-rule conflicts before validation. If the template expects a generated file to be committed, normal `git add` should work without force.
8. Run focused validation on touched files. In the canonical template repo, use `pwsh -File scripts/validate-template-metadata.ps1` when template metadata changes and `pwsh -File scripts/test-hook-regressions.ps1` when hook scripts change.
9. If the constitution changes, regenerate and verify `constitution.md` with `pwsh -File scripts/sync-constitution.ps1` and `pwsh -File scripts/sync-constitution.ps1 -Check`.
10. Run `pre-commit run --all-files`.
11. Run `pre-commit run --all-files --hook-stage pre-push` when the template-managed pre-push policy changes or when you need CI to replay the local push gate.
12. Update `.template-adoption.json` only after the migration is complete.
13. When adopting into a repo with runtime code, align logging and exception diagnostics with `.instructions/shared/observability-logging.md`, or document the stronger existing platform standard that already satisfies the same intent.
14. Align repo-local Git workflow and CI/CD rules with the constitution's branch, merge, cleanup, and release or deployment expectations, unless the target repo has a stronger documented standard.

## Strategy Definitions

- `ExactMatch`: should normally remain byte-for-byte aligned with the template.
- `MergeReview`: must adopt the template delta, but may contain repo-specific logic.
- `RepoSpecific`: should exist, but content is intentionally local.
- `AdoptionMarker`: records adoption metadata for future updates.

## Validation Order

1. `pwsh -File scripts/validate-template-metadata.ps1` when template metadata or adoption markers change
2. `pwsh -File scripts/test-hook-regressions.ps1` when canonical hook scripts change
3. `pwsh -File scripts/sync-constitution.ps1 -Check` when constitution source changes
4. `pre-commit run --files ...` on changed files
5. repo-local tests for modified hooks or scripts
6. `pre-commit run --all-files`
7. `pre-commit run --all-files --hook-stage pre-push` when pre-push policy is part of the adopted template delta
8. CI run with required secrets, including `GITGUARDIAN_API_KEY` when ggshield is enabled

## Common Adoption Pitfalls

- If the adopting repo already uses `instructions/` as a runtime catalog or product surface, keep `.instructions/` as the repo-local guidance layer rather than repurposing `instructions/`.
- If the template adds tracked generated files under paths that are currently ignored, update `.gitignore` as part of the migration so contributors do not need `git add -f` for normal template-managed outputs.
- If env-value leak scanning flags a public metadata token such as a GitHub owner slug embedded in a schema URL, prefer a narrowly documented allowlist entry or equivalent path-specific handling over disabling the scanner.
- If the target repo already has a structured logging platform, keep it and document the field mapping instead of forcing a second logging convention just to mirror the template wording.
- If the target repo already has a stronger branch protection, merge policy, or deployment gate, preserve it and document the equivalence rather than weakening it to match a simpler template example.
- Do not assume the template repo's MIT `LICENSE` should be copied blindly into an adopting repo. Make the license or proprietary-status decision explicitly for the target repo.

## Reporting Problems Back To The Template

If adoption work exposes a template defect, unclear template instruction, bad manifest expectation, incorrect promotion metadata, or a reusable workflow problem, report it in GitHub issues for `jagilber/template-repo`. <!-- env-leak-allowlist: public owner slug -->

Only keep the issue local to the adopting repo when the defect is truly repo-specific rather than a template problem.
