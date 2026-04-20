# Git Workflow Standard

This document defines the baseline git workflow for repositories aligned to the layered hook security template. It implements constitution articles GW-1, GW-2, and GW-3.

## Branch Model

### Default Branch

- `main` is the protected default branch.
- All substantive changes reach `main` through reviewed pull requests.
- The `no-commit-to-branch` pre-commit hook blocks direct commits to `main`.

### Topic Branches

- Every change uses a short-lived topic branch created from `main`.
- Branch names follow the pattern `<type>/<short-description>`:

  | Type | Use |
  |------|-----|
  | `feature/` | New capabilities, files, or surfaces |
  | `fix/` | Bug fixes, hook corrections, false-positive resolution |
  | `security/` | Scanner config, hook hardening, vulnerability response |
  | `docs/` | Documentation, instruction, or template metadata changes |
  | `chore/` | Dependency updates, CI config, tooling |
  | `release/` | Version bump and release preparation |

- Keep branches focused — one logical change per branch.
- Delete topic branches after merge (local and remote).

### Hotfix Pattern

For urgent fixes to `main`:

1. Create `fix/<issue>` from `main`.
2. Make the minimal fix.
3. Open PR with `[HOTFIX]` prefix in title.
4. Merge with standard review (or admin merge if blocking production adopters).
5. Clean up branch.

## Pull Request Workflow

### Opening a PR

1. Push topic branch to origin.
2. Open PR against `main`.
3. Fill in the PR template checklist completely.
4. Ensure all pre-push hooks pass (Semgrep, ggshield, public-repo guard).

### Review Requirements

- At least one review before merge (human or agent-assisted).
- Security-sensitive changes (hooks, scanners, allowlists, constitution) require explicit security review.
- Constitution amendments require rationale in the PR body.

### CI Must Pass

CI is a replay of local policy, not a weaker parallel path (CD-1):

- Pre-commit hooks (trailing whitespace, YAML/JSON, PII, env-leaks, gitleaks, detect-secrets)
- Semgrep (p/ci + p/github-actions + p/security-audit + .semgrep.yml)
- ggshield secret scanning
- gitleaks secret scanning

### Merge Strategy

- **Default: merge commit** — preserves branch ancestry for auditability (GW-2).
- **Squash merge**: only when the repository policy requires it or the PR author explicitly requests it.
- **Rebase merge**: avoid unless the branch has a clean linear history and the team agrees.
- Never force-push to `main`.

## Release Flow

### Version Markers

- `templateVersion` in `template-manifest.json` is the canonical version.
- `auto-tag.yml` creates git tags automatically when `templateVersion` changes on `main`.
- Tags are immutable — never delete or move tags after push.

### Release Process

1. Create `release/vX.Y.Z` branch from `main`.
2. Bump `templateVersion` in `template-manifest.json`.
3. Update `CHANGELOG.md` with release notes.
4. Run full validation: `pre-commit run --all-files` + `pwsh -File scripts/validate-template-metadata.ps1 -RequireRepoAdoptionMatch`.
5. Open PR, merge to `main`.
6. `auto-tag.yml` creates the tag.
7. Promote updated instructions to index-server.
8. Notify adopters via index-server `repo-sync` channel.

### Version Scheme

- **Major** (X.0.0): Breaking changes to constitution, hook model, or required file structure.
- **Minor** (0.X.0): New features, new required files, new CI workflows, scanner additions.
- **Patch** (0.0.X): Bug fixes, documentation updates, allowlist adjustments, dependency bumps.

## Rollback And Revert

### Reverting a Merged PR

1. Create `fix/revert-<original-branch>` from `main`.
2. Run `git revert -m 1 <merge-commit>` to revert the merge.
3. Open PR with `[REVERT]` prefix explaining why.
4. Merge through standard review.
5. If the reverted change needs to be re-applied later, create a new branch and `git revert` the revert commit.

### Emergency Rollback

- If a merged change breaks all adopters' hooks or CI:
  1. Revert immediately with admin merge.
  2. Open a post-mortem issue.
  3. Fix forward on a new branch.

## Adopter Workflow

Repositories adopting this template should:

1. Record their adopted version in `.template-adoption.json`.
2. Pull template changes as versioned deltas, not wholesale replacements (TG-1).
3. Use `scripts/Compare-TemplateSpec.ps1` to identify drift.
4. Apply template updates on a topic branch with a descriptive name like `chore/adopt-template-vX.Y.Z`.
5. Test locally before merging.

## Commit Messages

Use clear, descriptive commit messages:

```
<type>: <short summary>

<optional body explaining what and why>

Co-authored-by: <if applicable>
```

Types match branch prefixes: `feat`, `fix`, `security`, `docs`, `chore`, `release`.

## Validation Before Push

Run these checks before pushing:

1. `pre-commit run --files <changed-files>` — focused hook check.
2. `pwsh -File scripts/test-hook-regressions.ps1` — when hook scripts change.
3. `pwsh -File scripts/sync-constitution.ps1 -Check` — when constitution changes.
4. `pwsh -File scripts/validate-template-metadata.ps1` — when metadata changes.

Pre-push hooks run automatically: Semgrep, ggshield, public-repo guard.

## Provenance

This workflow implements GW-1, GW-2, GW-3 from the template constitution v2.4.0. It is promoted to index-server for cross-repo adoption.
