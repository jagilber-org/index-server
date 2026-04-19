# Publishing to Public Repository

This project uses a dual-repo pattern: private dev repo (`jagilber-dev/index-server`) for all development, and a public mirror (`jagilber-org/index-server`) as a read-only publication target.

Two scripts handle publication, each serving a different workflow:

## Scripts Overview

| Script | Default Behavior | When to Use |
|--------|-----------------|-------------|
| `Publish-ToPublicRepo.ps1` | Copies cleaned content to local path for review | **Start here** — safe review before any push |
| `publish-direct-to-remote.cjs` | Pushes directly to public remote with tag | Automated releases after content is verified |

## Recommended Workflow

### Step 1: Local Review (Publish-ToPublicRepo.ps1)

Copies a cleaned snapshot to a local directory for manual inspection. **No remote push occurs.**

```powershell
# Copies to C:\github\jagilber-org\index-server by default
.\scripts\Publish-ToPublicRepo.ps1 -RemoteUrl 'https://github.com/jagilber-org/index-server.git'

# Dry run — preview what would be copied
.\scripts\Publish-ToPublicRepo.ps1 -RemoteUrl 'https://github.com/jagilber-org/index-server.git' -DryRun
```

What it does:
1. Copies repo to temp directory
2. Strips paths from `.publish-exclude`
3. Removes blocked dotfiles (`.env`, `.specify`, `.instructions`, etc.)
4. Verifies no forbidden artifacts remain
5. Runs PII scan on cleaned content
6. Copies result to local path (default: derived from `-RemoteUrl`)

Review the output at the local path before proceeding to Step 2.

### Step 2: Direct Publish (publish-direct-to-remote.cjs)

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

What it does:
1. Copies repo to temp directory, strips `.publish-exclude` paths
2. Strips private dotfiles, verifies no forbidden artifacts
3. Scans ALL files for environment variable value leaks
4. Creates a clean git commit with tag
5. Force-pushes to `public` remote
6. Optionally creates a GitHub Release with CHANGELOG notes

### Options Reference

#### Publish-ToPublicRepo.ps1

| Parameter | Description |
|-----------|-------------|
| `-RemoteUrl` | Public mirror URL (used to derive local path) |
| `-LocalPath` | Override local copy destination |
| `-DryRun` | Preview without copying |
| `-DirectPublish` | Skip local copy, push directly (requires `-RemoteUrl`) |
| `-CreateReviewRepo` | Create private GitHub repo for team review |
| `-Tag` | Git tag to apply |
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

## Shared Configuration

Both scripts read `.publish-exclude` for paths to strip. Keep this file in sync when adding new private directories.

## Safety Guarantees

- **Pre-push hook**: Blocks direct pushes to public remotes; only publish scripts can bypass via SHA-256 token
- **Artifact verification**: Both scripts check for leaked private content (`.specify/`, `.env`, `logs/`, etc.)
- **Env-var leak scan**: `publish-direct-to-remote.cjs` scans all files against sensitive environment variable values
- **PII scan**: `Publish-ToPublicRepo.ps1` runs the pre-commit PII scanner on cleaned content
