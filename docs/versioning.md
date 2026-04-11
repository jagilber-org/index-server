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

## Release Workflow (Manual)

1. Ensure working tree clean & CI green (typecheck, lint, tests).
2. Decide increment: patch | minor | major.
3. Run bump script: `pwsh ./scripts/bump-version.ps1 patch` (or minor/major).
4. Review CHANGELOG.md entry auto-appended; revise details if needed.
5. Push commit & tag: script handles commit + tag; then `git push --follow-tags`.
6. (Optional) Create GitHub Release: `gh release create vX.Y.Z -F CHANGELOG.md` or curated notes.

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

## Initial State

Current version: 0.1.0 (experimental phase; core read-only tools + prompt governance).

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
|----------|------------------|---------------|---------|
| First create | Optional (default 1.0.0) | Required | Created 1.0.0 |
| Body edit, no version | Omitted | New body | Auto bump PATCH |
| Body edit, same version | Same | New body | Error: version_not_bumped |
| Metadata-only change, higher version | Higher | Omitted | Hydrate + overwrite |
| Metadata-only change, no version | Omitted | Omitted | No version bump; governance fields updated (no ChangeLog append) |
| Malformed version | Invalid | Any | Error: invalid_semver |
