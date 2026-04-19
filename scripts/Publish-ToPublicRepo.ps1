<#
.SYNOPSIS
    Publish a private repository to a public mirror with clean-room content stripping.

.DESCRIPTION
    Copies the repository to a temporary directory, strips private paths listed in
    .publish-exclude, removes known-sensitive dotfiles (preserving essential ones like
    .gitignore and .gitattributes), verifies no forbidden artifacts remain, runs the
    PII hook on cleaned content, and then delivers the result via one of three modes:

    - Default: copies cleaned content to a local directory for manual review.
    - -CreateReviewRepo: creates a private GitHub review repo (requires gh CLI).
    - -DirectPublish: force-pushes directly to the public mirror.

    Requires .publish-exclude in the repository root. Copy .publish-exclude.example
    to .publish-exclude and customize for your repo.

.PARAMETER Tag
    Git tag to apply to the published commit (e.g., 'v1.0.0').

.PARAMETER DryRun
    Performs all steps except the final delivery (push or copy).

.PARAMETER Force
    Skips confirmation prompts.

.PARAMETER DirectPublish
    Bypass review and force-push directly to the public mirror. Requires -RemoteUrl.

.PARAMETER CreateReviewRepo
    Create a private review repo on GitHub for inspection (requires gh CLI and -RemoteUrl).

.PARAMETER LocalPath
    Local directory to copy cleaned content to. When -RemoteUrl is provided, defaults
    to a sibling directory matching the URL org/repo (e.g., ../org/repo). Otherwise
    defaults to ../repo-name-public.

.PARAMETER RemoteUrl
    URL of the public mirror remote. Required for -DirectPublish and -CreateReviewRepo.
    Optional for local-only mode.

.PARAMETER ReviewOrg
    GitHub organization for private review repos. Used with -CreateReviewRepo.

.PARAMETER ForbiddenPaths
    Additional paths to verify are absent after stripping. Merged with built-in defaults.

.EXAMPLE
    .\Publish-ToPublicRepo.ps1 -RemoteUrl 'https://github.com/org/repo.git' -DryRun

.EXAMPLE
    .\Publish-ToPublicRepo.ps1 -RemoteUrl 'https://github.com/org/repo.git' -DirectPublish -Force
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Tag,

    [switch]$DryRun,

    [switch]$Force,

    [switch]$DirectPublish,

    [switch]$CreateReviewRepo,

    [string]$LocalPath,

    [string]$RemoteUrl,

    [string]$ReviewOrg,

    [string[]]$ForbiddenPaths
)

$ErrorActionPreference = 'Stop'

# Resolve repo root via git
$repoRoot = & git rev-parse --show-toplevel 2>$null
if (-not $repoRoot -or $LASTEXITCODE -ne 0) {
    Write-Error 'Not inside a git repository. Run this script from within the source repo.'
    return
}
$repoRoot = $repoRoot.Trim()
$repoName = Split-Path $repoRoot -Leaf

# Default local path: derive from RemoteUrl org/repo when available
if (-not $LocalPath) {
    if ($RemoteUrl -match 'github\.com[/:]([^/]+)/([^/.]+)') {
        $urlOrg = $matches[1]
        $urlRepo = $matches[2]
        $LocalPath = Join-Path (Split-Path $repoRoot -Parent) $urlOrg $urlRepo
    }
    else {
        $LocalPath = Join-Path (Split-Path $repoRoot -Parent) "$repoName-public"
    }
}

# Default review org: extract from RemoteUrl
if (-not $ReviewOrg -and $RemoteUrl -and $RemoteUrl -match 'github\.com[/:]([^/]+)/') {
    $ReviewOrg = $matches[1]
}

# --- Read .publish-exclude ---
$excludeFile = Join-Path $repoRoot '.publish-exclude'
if (-not (Test-Path $excludeFile)) {
    Write-Error ".publish-exclude not found at $excludeFile. Copy .publish-exclude.example and customize."
    return
}

$excludePatterns = Get-Content $excludeFile |
    Where-Object { $_ -and -not $_.StartsWith('#') } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }

Write-Host "Exclusion patterns: $($excludePatterns -join ', ')"

# --- Create temp directory ---
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "publish-$repoName-$(Get-Date -Format 'yyyyMMddHHmmss')"
Write-Host "Copying repo to $tempDir ..."

# Build robocopy exclusion list from .publish-exclude directories and known heavy dirs
$xdDirs = @('.git')
foreach ($pattern in $excludePatterns) {
    $fullPath = Join-Path $repoRoot $pattern
    if (Test-Path $fullPath -PathType Container) {
        $xdDirs += $pattern
    }
}
$heavyDirs = @('node_modules', '.next', 'packages')
foreach ($dir in $heavyDirs) {
    if ((Test-Path (Join-Path $repoRoot $dir)) -and $dir -notin $xdDirs) {
        $xdDirs += $dir
    }
}

# Copy repo to temp (excluding directories upfront for performance)
if (Get-Command robocopy -ErrorAction SilentlyContinue) {
    $robocopyArgs = @($repoRoot, $tempDir, '/MIR', '/NJH', '/NJS', '/NP')
    foreach ($dir in $xdDirs) { $robocopyArgs += '/XD'; $robocopyArgs += $dir }
    & robocopy @robocopyArgs | Out-Null
}
else {
    # Cross-platform fallback
    Copy-Item -Path $repoRoot -Destination $tempDir -Recurse -Force
    foreach ($dir in $xdDirs) {
        $dirPath = Join-Path $tempDir $dir
        if (Test-Path $dirPath) {
            Remove-Item $dirPath -Recurse -Force
        }
    }
}

# --- Remove excluded paths ---
foreach ($pattern in $excludePatterns) {
    $targetPath = Join-Path $tempDir $pattern
    if (Test-Path $targetPath) {
        Remove-Item $targetPath -Recurse -Force
        Write-Host "Removed excluded: $pattern"
    }
}

# --- Remove blocked dotfiles/dotfolders (preserve essential ones like .gitignore) ---
$dotfileBlocklist = @(
    '.env', '.env.example', '.env.local',
    '.specify', '.instructions',
    '.ggshield.yml',
    '.template-adoption.json', '.publish-exclude',
    '.private', '.certs'
)
$dotItems = Get-ChildItem -Path $tempDir -Force | Where-Object { $_.Name.StartsWith('.') }
foreach ($item in $dotItems) {
    $blocked = $dotfileBlocklist | Where-Object { $item.Name -like $_ }
    if ($blocked) {
        Remove-Item $item.FullName -Recurse -Force
        Write-Host "Removed blocked dotfile: $($item.Name)"
    }
    else {
        Write-Host "Preserved dotfile: $($item.Name)"
    }
}

# --- Verify no forbidden artifacts remain ---
$builtinForbidden = @(
    '.env', '.env.example', '.env.local',
    '.specify', '.instructions',
    '.ggshield.yml',
    '.template-adoption.json'
)
$allForbidden = $builtinForbidden
if ($ForbiddenPaths) {
    $allForbidden += $ForbiddenPaths
}

$leaked = @()
foreach ($forbidden in $allForbidden) {
    $checkPath = Join-Path $tempDir $forbidden
    if (Test-Path $checkPath) {
        $leaked += $forbidden
    }
}

if ($leaked.Count -gt 0) {
    Write-Error "Leaked forbidden artifacts detected: $($leaked -join ', '). Aborting."
    Remove-Item $tempDir -Recurse -Force
    return
}

Write-Host 'Verify complete: no leaked artifacts or dotfiles found.'

# --- Run PII scan on cleaned content ---
$piiCandidates = @(
    (Join-Path $repoRoot 'scripts' 'pre-commit.ps1'),
    (Join-Path $repoRoot 'hooks' 'check-pii.ps1'),
    (Join-Path $repoRoot 'scripts' 'check-pii.ps1')
)
$piiScript = $piiCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($piiScript) {
    Write-Host "Running PII scan on cleaned content ($piiScript)..."
    $stagedFiles = Get-ChildItem -Path $tempDir -Recurse -File | Where-Object {
        $_.Extension -in '.ps1', '.md', '.json', '.yml', '.yaml', '.txt', '.xml', '.csv',
                         '.js', '.ts', '.cs', '.csproj', '.sln', '.bicep', '.tf'
    } | Select-Object -ExpandProperty FullName
    if ($stagedFiles) {
        $piiResult = & $piiScript -Files $stagedFiles 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "PII scan FAILED. Fix flagged content before publishing.`n$($piiResult | Out-String)"
            Remove-Item $tempDir -Recurse -Force
            return
        }
        Write-Host 'PII scan passed.' -ForegroundColor Green
    }
}
else {
    Write-Warning 'PII scan script not found at scripts/pre-commit.ps1, hooks/check-pii.ps1, or scripts/check-pii.ps1 - skipping.'
}

# --- Delivery ---
if ($DryRun) {
    if ($DirectPublish) {
        Write-Host "[DRY RUN] Would force-push directly to $RemoteUrl"
    }
    elseif ($CreateReviewRepo) {
        Write-Host '[DRY RUN] Would create private review repo for inspection.'
    }
    else {
        Write-Host "[DRY RUN] Would copy cleaned content to $LocalPath"
    }
    Write-Host "[DRY RUN] Temp directory preserved at: $tempDir"
    return
}

if ($DirectPublish -or $CreateReviewRepo) {
    if (-not $RemoteUrl) {
        Write-Error '-RemoteUrl is required for -DirectPublish and -CreateReviewRepo modes.'
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        return
    }
    Push-Location $tempDir
    try {
        & git init | Out-Null
        & git add -A | Out-Null
        $commitMsg = "Publish from $repoName"
        if ($Tag) { $commitMsg += " ($Tag)" }
        & git commit -m $commitMsg | Out-Null

        if ($Tag) {
            & git tag $Tag
        }

        if ($DirectPublish) {
            if (-not $Force) {
                $confirm = Read-Host "Push DIRECTLY to public mirror at $RemoteUrl? (y/N)"
                if ($confirm -ne 'y') {
                    Write-Host 'Aborted.'
                    return
                }
            }
            & git remote add public $RemoteUrl
            & git push public HEAD:main --force
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Push to $RemoteUrl failed."
                return
            }
            Write-Host "Published directly to $RemoteUrl" -ForegroundColor Green
        }
        else {
            $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
            $reviewRepoName = "$repoName-review-$timestamp"

            if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
                Write-Error 'GitHub CLI (gh) is required for -CreateReviewRepo. Install from https://cli.github.com or use -DirectPublish.'
                return
            }

            if (-not $ReviewOrg) {
                Write-Error 'Cannot determine review org. Specify -ReviewOrg or ensure -RemoteUrl contains a GitHub org.'
                return
            }

            if (-not $Force) {
                $confirm = Read-Host "Create private review repo '$ReviewOrg/$reviewRepoName'? (y/N)"
                if ($confirm -ne 'y') {
                    Write-Host 'Aborted.'
                    return
                }
            }

            & gh repo create "$ReviewOrg/$reviewRepoName" --private --confirm 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to create review repo '$ReviewOrg/$reviewRepoName'. Verify gh auth status."
                return
            }

            $reviewUrl = "https://github.com/$ReviewOrg/$reviewRepoName.git"
            & git remote add review $reviewUrl
            & git push review HEAD:main

            Write-Host ''
            Write-Host '============================================================' -ForegroundColor Cyan
            Write-Host ' PRIVATE REVIEW REPO CREATED' -ForegroundColor Cyan
            Write-Host '============================================================' -ForegroundColor Cyan
            Write-Host "  Repo : https://github.com/$ReviewOrg/$reviewRepoName" -ForegroundColor Yellow
            Write-Host '  Scope: Private - only org members can view.' -ForegroundColor Yellow
            Write-Host ''
            Write-Host '  Review the content, then either:' -ForegroundColor White
            Write-Host "    1. Run this script with -DirectPublish -Force" -ForegroundColor White
            Write-Host "    2. Delete the review repo:  gh repo delete $ReviewOrg/$reviewRepoName --yes" -ForegroundColor White
            Write-Host '============================================================' -ForegroundColor Cyan
            Write-Host ''
        }
    }
    finally {
        Pop-Location
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
else {
    # Default: copy cleaned content to local directory
    if (-not (Test-Path $LocalPath)) {
        New-Item -ItemType Directory -Path $LocalPath -Force | Out-Null
        Write-Host "Created local target directory: $LocalPath"
    }

    if (Get-Command robocopy -ErrorAction SilentlyContinue) {
        & robocopy $tempDir $LocalPath /MIR /XD .git /NJH /NJS /NP | Out-Null
    }
    else {
        Copy-Item -Path "$tempDir\*" -Destination $LocalPath -Recurse -Force
    }

    Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ' LOCAL COPY COMPLETE' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host "  Path : $LocalPath" -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Review the content, then:' -ForegroundColor White
    Write-Host "    cd $LocalPath" -ForegroundColor White
    Write-Host '    git add -A' -ForegroundColor White
    Write-Host '    git commit -m "Update from dev repo"' -ForegroundColor White
    Write-Host '    git push' -ForegroundColor White
    Write-Host ''
    Write-Host '  Or re-run with -DirectPublish to push directly.' -ForegroundColor White
    Write-Host '  Or re-run with -CreateReviewRepo for a private review.' -ForegroundColor White
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ''
}
