# Release Checklist

Use this checklist before every versioned release of index-server.

## Pre-Release Gates

### Quality Gates
- [ ] `npm run typecheck` passes (zero TypeScript errors)
- [ ] `npm run lint` passes (zero ESLint errors)
- [ ] `npm run build` completes without error
- [ ] `npm run test:fast` passes (all non-skipped tests green)
- [ ] `npm run build:verify` exits 0 (typecheck + build + test:fast + guard:env + guard:decl)

### Content Gates
- [ ] `CHANGELOG.md` `[Unreleased]` section stamped to `[X.Y.Z] - YYYY-MM-DD`
- [ ] New empty `## [Unreleased]` placeholder added above the stamped entry
- [ ] `package.json` `version` field updated to match the release version
- [ ] `CHANGELOG.md` entries cover all merged PRs and commits since last release

### Security Gates
- [ ] `pre-commit run --all-files` passes (no PII, secrets, or forbidden artifacts)
- [ ] `ggshield` secret scan clean on staged files
- [ ] `CODE_SECURITY_REVIEW.md` reviewed for any open items in the release

## Release Process

### Orchestrated Release (preferred)

Run the front-door release orchestrator. It handles steps 1–6 below automatically:

```powershell
# Dry run first — resolves defaults and prints the plan without executing
pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1 -DryRun

# Full run — pushes internal tag, builds clean-room, opens mirror PR (default: CreatePR)
pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1 -PushInternal
```

- [ ] Dry run output reviewed — tag, remote, and clean-room path are correct
- [ ] Full run exits 0 (version parity validated, clean-room built, mirror PR opened)
- [ ] Mirror PR reviewed and merged

### Manual Steps (if not using Invoke-ReleaseWorkflow.ps1)

#### Clean-Room Build
- [ ] Run `scripts/deploy/New-CleanRoomCopy.ps1` to produce a sanitized artifact
- [ ] Verify artifact contains no dev-only files (`.env`, `tmp/`, test snapshots)
- [ ] Verify `dist/` contents are complete (server entry, dashboard assets)

#### GitHub Release
- [ ] Create release tag: `git tag v<VERSION>` on the release commit
- [ ] Push tag: `git push origin v<VERSION>`
- [ ] Draft GitHub Release from the tag with CHANGELOG content as release notes
- [ ] Attach the clean-room artifact `.tgz` to the release

#### Mirror Push
- [ ] Push to mirror remote via `scripts/Publish-ToMirror.ps1`
- [ ] Confirm mirror CI passes

## Post-Release Verification

### Smoke Tests
- [ ] Install from npm (if published): `npm install @jagilber-dev/index-server@<VERSION>`
- [ ] Confirm MCP server starts: `node dist/server/index-server.js` responds to `initialize`
- [ ] Confirm `health_check` tool returns `{ status: "ok" }`

### Registry / Discovery (if applicable)
- [ ] Update MCP registry entry with new version
- [ ] Confirm `server.json` `version` field reflects the release version

## Rollback Criteria

Revert the release and create a hotfix if any of the following occur within 24 hours:
- MCP `initialize` handshake fails
- `health_check` returns non-ok status
- Any data-loss report from index operations
- Security vulnerability disclosed in the release

---

*Last updated: 2026-05-10 for v1.28.14*
