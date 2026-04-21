# Publishing to Public Repository

This project uses a dual-repo pattern: private dev repo (`jagilber-dev/index-server`) for all development, and a public mirror (`jagilber-org/index-server`) as a read-only publication target.

Publication uses a **two-step safety workflow** to separate content preparation from remote delivery.

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
# Deliver to mirror (verifies content hash, enforces sanctioned remote)
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
