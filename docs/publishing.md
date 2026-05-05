# Publishing to Public Repository

This project uses a dual-repo pattern: an internal development repository for all development, and a public mirror (`jagilber-org/index-server`) as a read-only publication target.

Publication uses a **two-step safety workflow** to separate content preparation from remote delivery.

## MCP Registry release auth

The GitHub Actions release workflow normally runs from the **internal development repository**.

- In that context, MCP Registry publish must use **`MCP_GITHUB_TOKEN` PAT fallback**
- **GitHub OIDC** is only expected when the release workflow runs from the **public mirror** (`jagilber-org/index-server`)
- The workflow now fails fast if neither auth path is available, rather than silently skipping MCP Registry publication
- Scope `MCP_GITHUB_TOKEN` as narrowly as possible for MCP Registry publication; do not grant broader repository access than the publish step needs
- **Required PAT permissions for `MCP_GITHUB_TOKEN`:** `contents:write` on the public mirror (`jagilber-org/index-server`) to push registry metadata. No other scopes are needed. Use a fine-grained PAT scoped to only the public mirror repository when possible.

Treat PAT fallback as the current canonical path for internal-repo-driven releases until the public mirror owns the release execution context end-to-end.

## MCP marketplace migration status

This repository is in a staged migration from the legacy VSIX distribution story to an MCP-native install and registry model.

### Current status

| Area | Status | Notes |
|------|--------|-------|
| npm package distribution | Complete for Stage 1 | Root package is publishable and MCP-native install docs are the default path. |
| MCP Registry metadata | Complete for Stage 1 | `package.json#mcpName` and root `server.json` are now part of the release surface. |
| Release workflow auth | Complete for current internal-repo model | Internal-repo-driven releases must assume `MCP_GITHUB_TOKEN` PAT fallback until release execution moves to the public mirror. |
| VSIX distribution | Deprecated fallback | Keep the legacy VSIX path available only as a fallback while MCP-native publishing and install flow are proven. |
| MCP prompts/resources | Deferred | Stage 2 follow-up is tracked in issue #108. |
| Broader release hardening | In progress | Pre-existing `build:verify` failures remain tracked separately in issue #109. |

### Follow-up guidance

1. Treat the MCP-native package + registry path as the primary install story in docs and release notes.
2. Do **not** retire the VSIX fallback until marketplace listing, install reproducibility, and any required feature parity are verified.
3. Keep release messaging explicit: VSIX is legacy fallback only, not the recommended path for new installs.
4. Use PAT-authenticated MCP Registry publishing from the internal release context today; revisit OIDC only when the public mirror owns release execution end-to-end.
5. Land Stage 2 work as follow-up changes instead of reopening Stage 1 scope:
   - internal tracker #108 — prompts/resources decision and implementation
   - internal tracker #109 — triage pre-existing `build:verify` failures outside the migration surface

## Scripts Overview

| Script | Role | Who Can Run |
|--------|------|-------------|
| `Invoke-ReleaseWorkflow.ps1` | Canonical release/publish front door. Loads `.env`, runs preflight, optionally pushes/verifies internal release refs and checks, runs build + deploy + cleanroom, and prints or invokes mirror delivery. | Agents for prepare-only mode; humans for delivery modes |
| `Load-RepoEnv.ps1` | Sources `<repo-root>/.env` into the current process env (only sets unset keys). | Helper, sourced by other scripts |
| `New-CleanRoomCopy.ps1` | Safe content preparation — no remote operations | Agents or humans |
| `Publish-ToMirror.ps1` | Remote delivery with sanctioned-remote enforcement | **Humans only** (`ConfirmImpact=High`) |
| `publish-direct-to-remote.cjs` | Direct push to public remote with tag | Automated releases |

## Recommended Workflow

### Step 0 (one-time per clone): Configure `.env`

Repo-local paths and secrets live in a gitignored `.env`. Bootstrap from the committed template:

```powershell
Copy-Item .env.example .env
# edit .env to set CLEANROOM_PATH, deploy roots, INDEX_SERVER_ADMIN_API_KEY, etc.
```

`.env` is excluded from commits (`.gitignore` + `pre-commit.ps1`) and from cleanroom copies (`New-CleanRoomCopy.ps1`).

### Step 1: Run the release/publish front door (recommended)

For most releases, invoke the front door instead of calling individual scripts. It loads `.env`, resolves release defaults, runs preflight checks, optionally pushes the internal branch/tags with `-PushInternal`, verifies the pushed branch/tag refs, waits for internal GitHub Actions checks, runs `npm run build` + `deploy-local.ps1`, then `New-CleanRoomCopy.ps1`, then prints the exact human-only mirror delivery command:

```powershell
pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1
```

Use `-DryRun` at the start of release/publish to verify resolved inputs and planned commands without running checks, build, deploy, clean-room copy, push, or public delivery.

Resolution precedence (highest → lowest): CLI arg → shell env → `.env` → repo config → hardcoded canonical default. Override via `-CleanRoomPath`, `-RemoteUrl`, `-Tag`, `-SkipPreflight`, `-SkipBuild`, `-SkipDeploy`, or `-SkipCleanRoom` only when intentionally deviating.

### Step 1 (manual): Prepare Clean Content (New-CleanRoomCopy.ps1)

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

#### Invoke-ReleaseWorkflow.ps1

| Parameter | Description |
|-----------|-------------|
| `-DryRun` | Print resolved inputs and planned commands without executing release/publish steps |
| `-PushInternal` | Push the internal release branch and tags after preflight, verify refs, and wait for internal checks |
| `-SkipInternalChecks` | Intentional manual-check handoff after internal branch/tag verification |
| `-InternalChecksTimeoutMinutes` | Timeout for waiting on internal GitHub Actions checks after `-PushInternal` |
| `-CreatePR` | Human-only: prepare and invoke `Publish-ToMirror.ps1 -CreatePR` |
| `-WaitForMerge` | Human-only with `-CreatePR`: wait for merge, then tag the public mirror merge commit |
| `-DirectPublish` | Human-only: force-push mirror delivery, subject to `.publish-config.json` |
| `-CreateReviewRepo` | Human-only: create a restricted review repo instead of publishing |
| `-SkipPreflight` / `-SkipBuild` / `-SkipDeploy` / `-SkipCleanRoom` | Intentional deviation switches for already-completed steps |

#### Publish-ToMirror.ps1

| Parameter | Description |
|-----------|-------------|
| `-SourcePath` | Path to clean-room directory from Step 1 |
| `-RemoteUrl` | Target remote URL (validated against `.publish-config.json`) |
| `-DirectPublish` | Force-push to remote |
| `-CreateReviewRepo` | Create restricted GitHub repo for team review |
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

### Scanner blocking vs advisory behavior

Public publication has two classes of scanner outcomes:

| Check | Where it runs | Blocks publication? | Notes |
|-------|---------------|---------------------|-------|
| Forbidden artifact check | `New-CleanRoomCopy.ps1`, `publish-direct-to-remote.cjs` | Yes | Fails if internal-only paths such as `.specify`, `instructions`, `feedback`, `data`, `logs`, or `.env` survive the clean-room copy. |
| Clean-room PII scan | `New-CleanRoomCopy.ps1` | Yes when a scanner script is found and reports findings | If no scanner script is present, the manifest records `piiScanPassed: false` and the publish output labels the scan as skipped; operators must treat that as a manual review gate. |
| Ambient env-value leak scan | `New-CleanRoomCopy.ps1`, `publish-direct-to-remote.cjs` | Yes | Scans publishable text files for sensitive values loaded in the operator environment. The clean-room path points the pre-commit scanner at the repo-root `.env` instead of disabling ambient env scanning. |
| Release validate job | `.github/workflows/release.yml` | Yes | Typecheck, lint, build, unit tests, and log hygiene must pass before publish jobs run. |
| Secret scanner workflow uploads | `.github/workflows/gitleaks-secret-scans.yml` | Yes | SARIF upload failures are visible failures, not hidden green runs. SARIF processing wait is disabled where repository tokens cannot read workflow-run status; the upload itself and artifact capture remain visible. |
| ggshield quota and scanner failures | `.github/workflows/ggshield-secret-scans.yml`, `scripts/ci/ggshield-with-retry.sh` | Mostly | PR commit-range quota exhaustion is explicitly advisory because it depends on external GitGuardian quota availability. Manual and scheduled GGShield scans still fail closed, and non-quota scanner errors remain blocking. |
| Release Trivy image scan | `.github/workflows/release.yml` | No | Runs with `exit-code: 0`; findings are advisory release artifacts and must be triaged separately. |
| Tier 2 ZAP and Trivy scans | `.github/workflows/security-tier2.yml` | No | Both are advisory (`continue-on-error` or `exit-code: 0`) and upload reports for review. |
| Tier 3 DAST/TLS tools | `.github/workflows/security-tier3.yml` | Mostly advisory | Deep scanners run under manual workflow dispatch and use `|| true` / `continue-on-error`; header validation and server startup remain hard failures. |

## Removed Scripts

`Publish-ToPublicRepo.ps1` has been removed. Use `New-CleanRoomCopy.ps1` + `Publish-ToMirror.ps1` directly.
