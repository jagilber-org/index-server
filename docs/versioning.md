# Versioning & Release Strategy

## Semantic Versioning

This project follows Semantic Versioning (SemVer): MAJOR.MINOR.PATCH

- MAJOR: Backward-incompatible protocol or contract changes (tool method response shape, removed fields).
- MINOR: Backward-compatible feature additions (new tools, new optional response fields) or performance improvements.
- PATCH: Backward-compatible bug fixes; documentation-only changes may share a patch bump when releasing other fixes; docs-only can aggregate until next functional release.

Pre-1.0.0 Policy:

- MINOR increments can include limited breaking changes with strong justification; avoid when possible.
- PATCH increments never introduce breaking changes.

## Tool Contract Stability Labels

- experimental: Subject to change; no stability guarantee (default pre-1.0 tools unless promoted).
- stable: Version-locked; breaking changes require MAJOR bump (or MINOR while <1.0 with deprecation notice).

Promotion Path: experimental -> stable (after: test coverage, schema, documented examples, usage in at least 1 integration).

## Changelog Conventions

CHANGELOG.md entries grouped per version with date (UTC) and categories:

- Added
- Changed
- Fixed
- Deprecated
- Removed
- Security

Example skeleton:

```markdown
## [0.2.0] - 2025-08-24
### Added
- New tool: usage_track

### Fixed
- Handle invalid JSON gracefully in loader.
```

## Release Workflow (Canonical Private/Public Flow)

This repository has two distinct Git remotes:

- `origin` - internal development repository
- `public` - public mirror repository (`jagilber-org/index-server`)

The canonical release flow is:

1. Start from a clean local `main` synced with `origin/main`.
2. Decide increment: patch | minor | major.
3. Update `package.json` and `CHANGELOG.md`.
   - Preferred bump helper: `node scripts/build/bump-version.mjs patch` (or `minor` / `major`).
   - The helper creates the internal release commit and local tag.
4. Start the canonical release/publish front door.
   - `pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1 -DryRun`
   - Review the resolved tag, sanctioned public remote, clean-room path, and planned delivery command.
5. Run the release/publish front door for the actual release preparation.
   - `pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1 -PushInternal`
   - This runs preflight checks, pushes the internal release branch/tags, verifies refs, waits for internal GitHub Actions checks, builds, deploys locally, prepares the clean-room public snapshot, and prints the human-only public mirror command.
6. Publish the public mirror after human review.
    - Preferred: run the printed `scripts\Publish-ToMirror.ps1 -CreatePR -WaitForMerge` command, or have a human rerun `scripts\Invoke-ReleaseWorkflow.ps1 -CreatePR -WaitForMerge`.
    - If `-WaitForMerge` times out but the PR is merged later, rerun the same command. The script reuses the existing merged PR for the publish branch when the content hash matches and resumes tag creation.
    - Alternative: `node scripts/publish-direct-to-remote.cjs --tag vX.Y.Z --create-release`
7. Verify both sides.
    - Confirm `origin` and `public` both contain `vX.Y.Z`.
    - Confirm the public GitHub release exists and the local repo is back on clean `main`.

### MCP Registry auth note

The release workflow executes from the **internal** repo context, so MCP Registry publish should currently be treated as a **PAT-authenticated** step there via `MCP_GITHUB_TOKEN`.

GitHub OIDC is only the expected path when the workflow itself runs from the **public mirror** (`jagilber-org/index-server`). Until that execution model changes, do not assume OIDC will activate for internal-repo tag releases.

When PAT fallback is required, keep `MCP_GITHUB_TOKEN` scoped only to the MCP Registry publish action rather than broader repository administration.

### Canonical Commands

```bash
git checkout main
git pull --ff-only origin main
node scripts/build/bump-version.mjs patch
pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1 -DryRun
pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1 -PushInternal
# Human-only after clean-room review:
pwsh -NoProfile -File scripts\Publish-ToMirror.ps1 -SourcePath '<clean-room-path>' -RemoteUrl '<public-mirror-url>' -Tag vX.Y.Z -CreatePR -WaitForMerge
```

Replace `X.Y.Z` with the version created by the bump step.

For the PR-based path, the public Release workflow is triggered by creating `refs/tags/vX.Y.Z` on the public mirror. Do not separately run `gh release create` for that tag; `.github/workflows/release.yml` owns GitHub Release creation.

### Public Publish Alternatives

The underlying two-step PowerShell workflow remains available for manual review-oriented publication flows:

1. `scripts/New-CleanRoomCopy.ps1` — safe content preparation with `-DryRun` to inspect what would be published
2. `scripts/Publish-ToMirror.ps1` — remote delivery with `-CreateReviewRepo` for team review or `-DirectPublish` for direct mirror publication

Use `scripts\Invoke-ReleaseWorkflow.ps1` for the standard release path so preflight, internal push/check verification, local deploy, clean-room preparation, and public handoff stay ordered consistently.

### Removed Legacy Path

`Publish-ToPublicRepo.ps1` has been removed. Use the two-step workflow above (`New-CleanRoomCopy.ps1` + `Publish-ToMirror.ps1`) directly.

### Scope Note

The canonical release process documented here covers the internal GitHub repo and the public mirror repo. If npm package publication is added as part of release, document that flow separately with its required credentials, validation gates, and rollback steps.

### MCP marketplace migration tracking

Marketplace migration remains a staged release-governance effort rather than a one-shot cutover:

1. **Stage 1 (current baseline)** — publishable npm package, MCP Registry metadata, MCP-native-first docs, release workflow support, and a clearly deprecated VSIX fallback.
2. **Stage 2 (follow-up)** — only remove the VSIX path after registry installation, release flow, and any required parity work are validated.

Current guidance:

- Assume internal-repo releases use `MCP_GITHUB_TOKEN` PAT fallback for MCP Registry publication.
- Keep the legacy VSIX path documented only as a fallback, not as the default release/install story.
- Track remaining migration follow-ups in issue #108 (prompts/resources) and issue #109 (pre-existing `build:verify` failures).

## Automation Roadmap

- Validate no uncommitted changes before bump.
- Auto-generate changelog section from conventional commit messages since last tag.
- Pre-release channels (alpha, beta, rc) using metadata suffixes.
- GitHub Action: publish on tag push, attach build artifacts.

## Breaking Change Process (Pre-1.0)

1. Mark field/tool as deprecated in documentation & responses (e.g., add `deprecated: true`).
2. Provide alternative for at least one MINOR release window.
3. Remove in subsequent MINOR (pre-1.0) or next MAJOR (post-1.0).

## Integrity with Version Bumps

- Integrity / diff algorithms must maintain backward compatibility for at least one MINOR after upgrade.
- Provide dual-mode diff output behind feature flag before promoting to default.

## Version Source of Truth

`package.json` "version" key is canonical. Scripts or runtime may emit this in health_check.

## Current Release Line

Use `package.json` and `CHANGELOG.md` as the live release sources of truth. Do not hardcode the current version in this document.

## Governance Version Semantics (Post 1.1.0 Enhancements)

### Strict SemVer Enforcement (Create & Update)

All supplied `version` values on `index_add` (create or overwrite) must match full SemVer `MAJOR.MINOR.PATCH` optionally with pre-release/build metadata. Malformed versions (e.g., `1.0`, `2`, `1.0.0+bad+extra`) are rejected with `error: invalid_semver`.

Rationale:

- Prevents non-linear version lineage that complicates deterministic governance hashing.
- Ensures changeLog entries map 1:1 to a valid semantic version.

### Auto Patch Bump Logic

If body content changes and caller omits a `version`, server auto-increments PATCH. ChangeLog entry summary includes an auto-bump note. Body change with same or lower explicit version -> `version_not_bumped` error.

### Metadata-Only Overwrite Hydration

When `overwrite:true` and the caller omits `body` (and optionally `title`), server hydrates existing body/title from the on-disk record **before** validation. This allows governance-only edits (priority, owner, classification, version bump) without resending full content.

Implications:

- Returned flags: `overwritten:true` when existing record modified even if body unchanged.
- Clients should still supply an explicit higher version for metadata-only semantic changes; omission defers bump logic to body change rules.

### Instruction Schema v5 Content-Type Migration

Instruction schema v5 renames the legacy persisted/API content type `chat-session` to `workflow`. The loader and write compatibility layer accept `chat-session` as a legacy alias and normalize it to `workflow` before schema validation, preserving workflow/runbook semantics for existing records. New clients should send `workflow`; `chat-session` remains compatibility input only and is not emitted in persisted v5 records.

### ChangeLog Repair & Normalization

Malformed `changeLog` arrays (wrong shapes, missing fields) are silently repaired:

- Invalid entries dropped.
- Missing initial entry synthesized from current version.
- Ensures final element corresponds to authoritative version.

### Overwrite Flag Accuracy

`overwritten:true` now reflects any successful overwrite intent where the record existed pre-call (including metadata-only version increments). This improves mutation telemetry reliability for governance analytics.

### Client Guidance Summary

| Scenario | Provide Version? | Provide Body? | Outcome |
| ---------- | ------------------ | --------------- | --------- |
| First create | Optional (default 1.0.0) | Required | Created 1.0.0 |
| Body edit, no version | Omitted | New body | Auto bump PATCH |
| Body edit, same version | Same | New body | Error: version_not_bumped |
| Metadata-only change, higher version | Higher | Omitted | Hydrate + overwrite |
| Metadata-only change, no version | Omitted | Omitted | No version bump; governance fields updated (no ChangeLog append) |
| Malformed version | Invalid | Any | Error: invalid_semver |
