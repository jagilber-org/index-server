# Publishing to Public Repository

This project uses a dual-repo pattern: private dev repo (`jagilber-dev/index-server`) for all development, and a public mirror (`jagilber-org/index-server`) as a read-only publication target.

Publication uses a **two-step safety workflow** to separate content preparation from remote delivery.

## MCP Registry release auth

The GitHub Actions release workflow in this repository normally runs from the **private dev repo** (`jagilber-dev/index-server`).

- In that context, MCP Registry publish must use **`MCP_GITHUB_TOKEN` PAT fallback**
- **GitHub OIDC** is only expected when the release workflow runs from the **public mirror** (`jagilber-org/index-server`)
- The workflow now fails fast if neither auth path is available, rather than silently skipping MCP Registry publication
- Scope `MCP_GITHUB_TOKEN` as narrowly as possible for MCP Registry publication; do not grant broader repository access than the publish step needs
- **Required PAT permissions for `MCP_GITHUB_TOKEN`:** `contents:write` on the public mirror (`jagilber-org/index-server`) to push registry metadata. No other scopes are needed. Use a fine-grained PAT scoped to only the public mirror repository when possible.

Treat PAT fallback as the current canonical path for private-repo-driven releases until the public mirror owns the release execution context end-to-end.

## MCP marketplace migration status

This repository is in a staged migration from the legacy VSIX distribution story to an MCP-native install and registry model.

### Current status

| Area | Status | Notes |
|------|--------|-------|
| npm package distribution | Complete for Stage 1 | Root package is publishable and MCP-native install docs are the default path. |
| MCP Registry metadata | Complete for Stage 1 | `package.json#mcpName` and root `server.json` are now part of the release surface. |
| Release workflow auth | Complete for current private-repo model | Private-repo-driven releases must assume `MCP_GITHUB_TOKEN` PAT fallback until release execution moves to the public mirror. |
| VSIX distribution | Deprecated fallback | Keep the legacy VSIX path available only as a fallback while MCP-native publishing and install flow are proven. |
| MCP prompts/resources | Deferred | Stage 2 follow-up is tracked in issue #108. |
| Broader release hardening | In progress | Pre-existing `build:verify` failures remain tracked separately in issue #109. |

### Follow-up guidance

1. Treat the MCP-native package + registry path as the primary install story in docs and release notes.
2. Do **not** retire the VSIX fallback until marketplace listing, install reproducibility, and any required feature parity are verified.
3. Keep release messaging explicit: VSIX is legacy fallback only, not the recommended path for new installs.
4. Use PAT-authenticated MCP Registry publishing from the private repo today; revisit OIDC only when the public mirror owns release execution end-to-end.
5. Land Stage 2 work as follow-up changes instead of reopening Stage 1 scope:
   - issue #108 — prompts/resources decision and implementation
   - issue #109 — triage pre-existing `build:verify` failures outside the migration surface

## Scripts Overview

| Script | Role | Who Can Run |
|--------|------|-------------|
| `New-CleanRoomCopy.ps1` | Safe content preparation — no remote operations | Agents or humans |
| `Publish-ToMirror.ps1` | Remote delivery with sanctioned-remote enforcement | **Humans only** (`ConfirmImpact=High`) |
| `publish-direct-to-remote.cjs` | Direct push to public remote with tag | Automated releases |
| `Publish-ToPublicRepo.ps1` | **Deprecated** wrapper — forwards to new scripts | Backward compatibility only |

## Recommended Workflow

### Step 1: Prepare Clean Content (New-CleanRoomCopy.ps1)

Creates a cleaned snapshot with integrity manifest. **No remote operations occur.** Safe for agents to invoke.

```powershell
# Prepare clean-room copy (output path derived from RemoteUrl)
.\scripts\New-CleanRoomCopy.ps1 -RemoteUrl 'https://github.com/jagilber-org/index-server.git'

# Dry run — preview what would be copied
.\scripts\New-CleanRoomCopy.ps1 -RemoteUrl 'https://github.com/jagilber-org/index-server.git' -DryRun
```

What it does:
1. Copies repo to temp directory
2. Applies the same include/exclude rules as `publish-direct-to-remote.cjs`
3. Strips paths from `.publish-exclude` while preserving approved public workflows under `.github/workflows`
4. Verifies no forbidden artifacts remain
5. Runs PII scan on cleaned content
6. Computes SHA-256 content hash
7. Emits `.publish-manifest.json` for integrity verification
8. Copies result to local path (default: derived from `-RemoteUrl`)

Review the output at the local path before proceeding to Step 2.

### Step 2a: Mirror Delivery (Publish-ToMirror.ps1) — Human-Only

Delivers prepared content to the public mirror with content-hash verification. **Requires human confirmation.**

```powershell
# Default: open a publish/<tag> PR against the public mirror's main (recommended)
.\scripts\Publish-ToMirror.ps1 -SourcePath ..\jagilber-org\index-server -RemoteUrl 'https://github.com/jagilber-org/index-server.git' -CreatePR -Tag v1.0.0

# Force-push directly to the public mirror (opt-in, requires explicit -DirectPublish)
.\scripts\Publish-ToMirror.ps1 -SourcePath ..\jagilber-org\index-server -RemoteUrl 'https://github.com/jagilber-org/index-server.git' -DirectPublish

# Create review repo instead of direct publish
.\scripts\Publish-ToMirror.ps1 -SourcePath ..\jagilber-org\index-server -RemoteUrl 'https://github.com/jagilber-org/index-server.git' -CreateReviewRepo
```

What it does:
1. Reads `.publish-manifest.json` from the source directory
2. Verifies content hash matches (detects post-preparation tampering)
3. Validates remote URL against `.publish-config.json` sanctioned remotes
4. Stages the reviewed content into an isolated temporary git workspace
5. Delivers content via force-push or review repo creation without mutating the clean-room source path

### Step 2b: Direct Publish (publish-direct-to-remote.cjs) — Alternative

Pushes a cleaned, tagged commit directly to the public remote. **This modifies the public repo.**

```bash
# Publish with tag (required)
node scripts/publish-direct-to-remote.cjs --tag v1.21.0

# Dry run — list files that would be published
node scripts/publish-direct-to-remote.cjs --dry-run

# Verify only — CI validation without publishing
node scripts/publish-direct-to-remote.cjs --verify-only

# Publish with GitHub Release
node scripts/publish-direct-to-remote.cjs --tag v1.21.0 --create-release
```

### Options Reference

#### New-CleanRoomCopy.ps1

| Parameter | Description |
|-----------|-------------|
| `-RemoteUrl` | Public mirror URL (used to derive local output path) |
| `-LocalPath` | Override local copy destination |
| `-DryRun` | Preview without copying |
| `-Tag` | Git tag to record in manifest |
| `-Force` | Skip confirmation prompts |

#### Publish-ToMirror.ps1

| Parameter | Description |
|-----------|-------------|
| `-SourcePath` | Path to clean-room directory from Step 1 |
| `-RemoteUrl` | Target remote URL (validated against `.publish-config.json`) |
| `-DirectPublish` | Force-push to remote |
| `-CreateReviewRepo` | Create private GitHub repo for team review |
| `-Tag` | Git tag to apply on remote |
| `-Force` | Skip confirmation prompts |

#### publish-direct-to-remote.cjs

| Flag | Description |
|------|-------------|
| `--tag <version>` | Required semver tag (e.g., `v1.21.0`) |
| `--dry-run` | List files without publishing |
| `--verify-only` | CI validation only |
| `--create-release` | Create GitHub Release on public repo |
| `--force` | Skip dirty-tree check |
| `--quiet` | Suppress file listings |

## Configuration

| File | Purpose |
|------|---------|
| `.publish-exclude` | Paths to strip from clean-room copy (shared by all scripts) |
| `.publish-config.json` | Sanctioned remote URLs and `allowDirectPublish` flag |

## Safety Guarantees

- **Two-step separation**: Content preparation (agent-safe) is decoupled from remote delivery (human-only)
- **Consistent publish surface**: The PowerShell clean-room path now preserves the same approved public files as `publish-direct-to-remote.cjs`
- **Content-hash verification**: `Publish-ToMirror.ps1` verifies SHA-256 hash from `New-CleanRoomCopy.ps1` manifest
- **Sanctioned-remote enforcement**: `Publish-ToMirror.ps1` validates target URL against `.publish-config.json`
- **Pre-push hook**: Blocks direct pushes to public remotes; only publish scripts can bypass via SHA-256 token
- **Artifact verification**: All scripts check for leaked private content (`.specify/`, `.env`, `logs/`, etc.)
- **Env-var leak scan**: `publish-direct-to-remote.cjs` scans all files against sensitive environment variable values
- **PII scan**: `New-CleanRoomCopy.ps1` runs the pre-commit PII scanner on cleaned content

## Removed Scripts

`Publish-ToPublicRepo.ps1` has been removed. Use `New-CleanRoomCopy.ps1` + `Publish-ToMirror.ps1` directly.
