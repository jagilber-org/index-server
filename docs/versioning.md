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

- `origin` - private development repository (`jagilber-dev/index-server`)
- `public` - public mirror repository (`jagilber-org/index-server`)

The canonical release flow is:

1. Start from a clean local `main` synced with `origin/main`.
2. Decide increment: patch | minor | major.
3. Update `package.json` and `CHANGELOG.md`.
   - Preferred bump helper: `node scripts/bump-version.mjs patch` (or `minor` / `major`).
   - The helper creates the private release commit and local tag.
4. Validate the release candidate before publishing.
   - Minimum release checks: focused `pre-commit`, `npm run typecheck`, `npm run build`, `npm run test:fast`.
5. Push the private release to `origin`.
   - `git push origin main --follow-tags`
6. Publish the public mirror from the private repo source.
   - `node scripts/publish-direct-to-remote.cjs --tag vX.Y.Z --create-release`
   - This stages a clean-room copy using `.publish-exclude`, verifies no forbidden artifacts leaked, scans for environment-value leaks, force-pushes `public/main`, pushes the public tag, and creates a GitHub release on `jagilber-org/index-server`.
7. Verify both sides.
   - Confirm `origin` and `public` both contain `vX.Y.Z`.
   - Confirm the public GitHub release exists and the local repo is back on clean `main`.

### Canonical Commands

```bash
git checkout main
git pull --ff-only origin main
node scripts/bump-version.mjs patch
pre-commit run --all-files
npm run typecheck
npm run build
npm run test:fast
git push origin main --follow-tags
node scripts/publish-direct-to-remote.cjs --tag vX.Y.Z --create-release
```

Replace `X.Y.Z` with the version created by the bump step.

### Public Publish Alternatives

The two-step PowerShell workflow remains available for manual review-oriented publication flows:

1. `scripts/New-CleanRoomCopy.ps1` — safe content preparation with `-DryRun` to inspect what would be published
2. `scripts/Publish-ToMirror.ps1` — remote delivery with `-CreateReviewRepo` for team review or `-DirectPublish` for direct mirror publication

Use this PowerShell path when you explicitly need a manual review or review-repo workflow. For the standard release path, prefer `scripts/publish-direct-to-remote.cjs`.

### Removed Legacy Path

`Publish-ToPublicRepo.ps1` has been removed. Use the two-step workflow above (`New-CleanRoomCopy.ps1` + `Publish-ToMirror.ps1`) directly.

### Scope Note

The canonical release process documented here covers the private GitHub repo and the public mirror repo. If npm package publication is added as part of release, document that flow separately with its required credentials, validation gates, and rollback steps.

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

All supplied `version` values on `index_add` (create or overwrite) must match full SemVer `MAJOR.MINOR.PATCH` optionally with pre-release/build metadata. Malformed versions (e.g., `1.0`, `2`, `1.0.0.1`) are rejected with `error: invalid_semver`.

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
