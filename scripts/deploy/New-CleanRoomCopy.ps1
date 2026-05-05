<#
.SYNOPSIS
    Prepare a clean-room copy of a repository for public mirror review.

.DESCRIPTION
    Copies the repository to a temporary directory, strips private paths listed in
    .publish-exclude, removes known-sensitive dotfiles (preserving essential ones like
    .gitignore and .gitattributes), verifies no forbidden artifacts remain, runs the
    PII hook on cleaned content, and copies the result to a local directory for review.

    This script performs NO remote operations. It is safe for agents and automation
    to invoke. The output directory can then be reviewed manually or passed to
    Publish-ToMirror.ps1 for remote delivery.

    Emits a .publish-manifest.json in the output directory containing a content hash,
    file inventory, and scan results for integrity verification by downstream tools.

.PARAMETER LocalPath
    Local directory to copy cleaned content to. Defaults to ../repo-name-public or
    a path derived from -RemoteUrl if provided.

.PARAMETER RemoteUrl
    Optional URL of the intended public mirror. Used only to derive a default LocalPath
    (e.g., ../org/repo). No remote operations are performed.

.PARAMETER Tag
    Git tag to record in the publish manifest (e.g., 'v1.0.0').

.PARAMETER DryRun
    Performs all steps except the final copy to LocalPath. Temp directory is preserved.

.PARAMETER Force
    Skips confirmation prompts for local operations.

.PARAMETER ForbiddenPaths
    Additional paths to verify are absent after stripping. Merged with built-in defaults.

.EXAMPLE
    .\New-CleanRoomCopy.ps1
    # Copies cleaned content to ../repo-name-public

.EXAMPLE
    .\New-CleanRoomCopy.ps1 -RemoteUrl 'https://github.com/org/repo.git' -Tag v1.0.0
    # Copies cleaned content to ../org/repo with tag recorded in manifest

.EXAMPLE
    .\New-CleanRoomCopy.ps1 -DryRun
    # Runs all checks but skips final copy; temp dir preserved for inspection
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$LocalPath,

    [string]$RemoteUrl,

    [string]$Tag,

    [switch]$DryRun,

    [switch]$Force,

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

function Test-PublishExcludeMatch {
    param(
        [Parameter(Mandatory)]
        [string]$RelativePath,

        [Parameter(Mandatory)]
        [string[]]$ExcludePatterns
    )

    $normalizedPath = $RelativePath.Replace('\', '/')
    if ($normalizedPath.StartsWith('./')) {
        $normalizedPath = $normalizedPath.Substring(2)
    }
    foreach ($pattern in $ExcludePatterns) {
        $normalizedPattern = $pattern.Replace('\', '/')
        if ($normalizedPattern.EndsWith('/')) {
            if ($normalizedPath.StartsWith($normalizedPattern) -or "$normalizedPath/" -eq $normalizedPattern) {
                return $true
            }
            continue
        }

        if ($normalizedPattern.EndsWith('*')) {
            if ($normalizedPath.StartsWith($normalizedPattern.Substring(0, $normalizedPattern.Length - 1))) {
                return $true
            }
            continue
        }

        if ($normalizedPath -eq $normalizedPattern) {
            return $true
        }
    }

    return $false
}

function Copy-PublishContent {
    param(
        [Parameter(Mandatory)]
        [string]$SourceRoot,

        [Parameter(Mandatory)]
        [string]$CurrentSource,

        [Parameter(Mandatory)]
        [string]$DestinationRoot,

        [Parameter(Mandatory)]
        [string[]]$ExcludePatterns,

        [Parameter(Mandatory)]
        [string[]]$PrivateRootDotItems
    )

    $isRoot = [System.IO.Path]::GetFullPath($CurrentSource) -eq [System.IO.Path]::GetFullPath($SourceRoot)
    foreach ($entry in Get-ChildItem -LiteralPath $CurrentSource -Force) {
        if ($entry.Name -eq '.git') {
            continue
        }

        if ($isRoot -and $entry.Name.StartsWith('.') -and $entry.Name -in $PrivateRootDotItems) {
            continue
        }

        $relativePath = [System.IO.Path]::GetRelativePath($SourceRoot, $entry.FullName).Replace('\', '/')
        if (Test-PublishExcludeMatch -RelativePath $relativePath -ExcludePatterns $ExcludePatterns) {
            continue
        }

        $destinationPath = Join-Path $DestinationRoot $relativePath
        if ($entry.PSIsContainer) {
            New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
            Copy-PublishContent -SourceRoot $SourceRoot `
                -CurrentSource $entry.FullName `
                -DestinationRoot $DestinationRoot `
                -ExcludePatterns $ExcludePatterns `
                -PrivateRootDotItems $PrivateRootDotItems
            continue
        }

        $destinationParent = Split-Path $destinationPath -Parent
        if ($destinationParent -and -not (Test-Path $destinationParent)) {
            New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        }
        Copy-Item -LiteralPath $entry.FullName -Destination $destinationPath -Force
    }
}

function Get-LeakedPublishArtifacts {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string[]]$ForbiddenItems,

        [Parameter(Mandatory)]
        [string[]]$PrivateRootDotItems
    )

    $found = @()
    foreach ($name in $ForbiddenItems) {
        if (Test-Path (Join-Path $Path $name)) {
            $found += $name
        }
    }

    foreach ($entry in Get-ChildItem -LiteralPath $Path -Force) {
        if ($entry.Name.StartsWith('.') -and $entry.Name -in $PrivateRootDotItems) {
            $found += $entry.Name
        }
    }

    return $found | Sort-Object -Unique
}

# Resolve current commit SHA for manifest
$commitSha = (& git rev-parse HEAD 2>$null)
if ($commitSha) { $commitSha = $commitSha.Trim() }

# Default local path: derive from RemoteUrl org/repo when available
if (-not $LocalPath) {
    if ($RemoteUrl -match 'github\.com[/:]([^/]+)/([^/.]+)') {
        $urlOrg = $matches[1]
        $urlRepo = $matches[2]
        $grandParent = Split-Path (Split-Path $repoRoot -Parent) -Parent
        $LocalPath = Join-Path $grandParent $urlOrg $urlRepo
    }
    else {
        $LocalPath = Join-Path (Split-Path $repoRoot -Parent) "$repoName-public"
    }
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
$script:cleanRoomTempDir = $tempDir
$script:preserveCleanRoomTemp = $false
trap {
    if ($script:cleanRoomTempDir -and -not $script:preserveCleanRoomTemp -and (Test-Path $script:cleanRoomTempDir)) {
        Remove-Item $script:cleanRoomTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
}

# Copy repo to temp using the same include/exclude semantics as publish-direct-to-remote.cjs:
# strip only known private root dot-items and defer all other selection to .publish-exclude.
$privateRootDotItems = @(
    '.certs', '.codeql', '.copilot', '.env', '.private', '.specify', '.squad',
    '.squad-templates', '.vscode', '.publish-exclude'
)
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
Copy-PublishContent -SourceRoot $repoRoot `
    -CurrentSource $repoRoot `
    -DestinationRoot $tempDir `
    -ExcludePatterns $excludePatterns `
    -PrivateRootDotItems $privateRootDotItems

# --- Verify no forbidden artifacts remain ---
$builtinForbidden = @(
    '.specify', 'specs', 'state', 'logs', 'backups',
    'feedback', 'governance', 'memory', 'metrics',
    'snapshots', 'tmp', 'test-results', 'coverage',
    'seed', 'instructions', 'devinstructions', 'NVIDIA Corporation',
    '.private', '.env', '.certs', '.squad', '.squad-templates',
    'templates', 'data', 'node_modules', 'scripts/.env',
    'scripts/.env.generated', 'scripts/.vscode'
)
$allForbidden = $builtinForbidden
if ($ForbiddenPaths) {
    $allForbidden += $ForbiddenPaths
}

$leaked = @(Get-LeakedPublishArtifacts -Path $tempDir -ForbiddenItems $allForbidden -PrivateRootDotItems $privateRootDotItems)

if ($leaked.Count -gt 0) {
    Write-Error "Leaked forbidden artifacts detected: $($leaked -join ', '). Aborting."
    Remove-Item $tempDir -Recurse -Force
    return
}

Write-Host 'Verify complete: no leaked artifacts or dotfiles found.'

# --- Run PII scan on cleaned content ---
$piiScanPassed = $false
$piiCandidates = @(
    (Join-Path $repoRoot 'hooks' 'check-pii.ps1'),
    (Join-Path $repoRoot 'scripts' 'check-pii.ps1'),
    (Join-Path $repoRoot 'scripts' 'pre-commit.ps1'),
    (Join-Path $repoRoot 'scripts' 'hooks' 'pre-commit.ps1'),
    (Join-Path $repoRoot 'scripts' 'hooks' 'pre-commit.mjs')
)
$piiScript = $piiCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($piiScript) {
    Write-Host "Running PII scan on cleaned content ($piiScript)..."
    $stagedFiles = Get-ChildItem -Path $tempDir -Recurse -File | Where-Object {
        $_.Extension -in '.ps1', '.md', '.json', '.yml', '.yaml', '.txt', '.xml', '.csv',
                         '.js', '.ts', '.cs', '.csproj', '.sln', '.bicep', '.tf'
    } | Where-Object {
        # Skip vendor/minified files
        $_.Name -notmatch '\.(min|bundled)\.(js|css)$'
    } | Select-Object -ExpandProperty FullName
    if ($stagedFiles) {
        $previousDotenv = $env:INDEX_SERVER_PRECOMMIT_DOTENV
        $env:INDEX_SERVER_PRECOMMIT_DOTENV = Join-Path $repoRoot '.env'
        try {
            if ([System.IO.Path]::GetExtension($piiScript) -eq '.mjs') {
                $piiResult = & node $piiScript @stagedFiles 2>&1
            }
            else {
                $piiResult = & $piiScript @stagedFiles 2>&1
            }
        }
        finally {
            if ($null -eq $previousDotenv) {
                Remove-Item Env:INDEX_SERVER_PRECOMMIT_DOTENV -ErrorAction SilentlyContinue
            }
            else {
                $env:INDEX_SERVER_PRECOMMIT_DOTENV = $previousDotenv
            }
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Error "PII scan FAILED. Fix flagged content before publishing.`n$($piiResult | Out-String)"
            Remove-Item $tempDir -Recurse -Force
            return
        }
        $piiScanPassed = $true
        Write-Host 'PII scan passed.' -ForegroundColor Green
    }
    else {
        $piiScanPassed = $true
        Write-Host 'No scannable files found ΓÇö PII scan skipped.'
    }
}
else {
    $searchedPaths = $piiCandidates | ForEach-Object { $_.Substring($repoRoot.Length + 1) -replace '\\', '/' }
    Write-Warning "PII scan script not found. Searched: $($searchedPaths -join ', ') - skipping."
}

# --- Compute content hash for integrity verification ---
Write-Host 'Computing content hash...'
$allFiles = @(Get-ChildItem -Path $tempDir -Recurse -File | Sort-Object { $_.FullName.Substring($tempDir.Length) })
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$hashStream = [System.IO.MemoryStream]::new()

foreach ($file in $allFiles) {
    $relativePath = $file.FullName.Substring($tempDir.Length).TrimStart('\', '/').Replace('\', '/')
    # Hash: relative path + file bytes
    $pathBytes = [System.Text.Encoding]::UTF8.GetBytes($relativePath)
    $hashStream.Write($pathBytes, 0, $pathBytes.Length)
    $fileBytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $hashStream.Write($fileBytes, 0, $fileBytes.Length)
}

$hashStream.Position = 0
$contentHashBytes = $sha256.ComputeHash($hashStream)
$contentHash = [BitConverter]::ToString($contentHashBytes).Replace('-', '').ToLowerInvariant()
$hashStream.Dispose()
$sha256.Dispose()

Write-Host "Content hash: $contentHash"

# --- Write publish manifest ---
$manifest = @{
    manifestVersion        = 2
    sourceRepo             = $repoName
    preparedAt             = (Get-Date).ToUniversalTime().ToString('o')
    commitSha              = $commitSha
    tag                    = if ($Tag) { $Tag } else { $null }
    fileCount              = $allFiles.Count
    contentHash            = $contentHash
    piiScanPassed          = $piiScanPassed
    forbiddenArtifactCheck = 'passed'
}

$manifestJson = $manifest | ConvertTo-Json -Depth 4
$manifestPath = Join-Path $tempDir '.publish-manifest.json'
Set-Content -Path $manifestPath -Value $manifestJson -Encoding utf8

# --- Delivery: local copy only ---
if ($DryRun) {
    Write-Host "[DRY RUN] Would copy cleaned content to $LocalPath"
    Write-Host "[DRY RUN] Temp directory preserved at: $tempDir"
    Write-Host "[DRY RUN] Manifest: $manifestPath"
    $script:preserveCleanRoomTemp = $true
    return
}

if (-not (Test-Path $LocalPath)) {
    New-Item -ItemType Directory -Path $LocalPath -Force | Out-Null
    Write-Host "Created local target directory: $LocalPath"
}

if (Get-Command robocopy -ErrorAction SilentlyContinue) {
    $robocopyOutput = & robocopy $tempDir $LocalPath /MIR /XD .git /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) {
        Write-Error "Robocopy failed with exit code $LASTEXITCODE`n$($robocopyOutput | Out-String)"
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        return
    }
    $global:LASTEXITCODE = 0
}
else {
    Copy-Item -Path "$tempDir\*" -Destination $LocalPath -Recurse -Force
    # Copy manifest explicitly (dotfile may be missed by wildcard)
    Copy-Item -Path $manifestPath -Destination $LocalPath -Force
}

Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
$script:cleanRoomTempDir = $null

Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ' CLEAN-ROOM COPY COMPLETE' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host "  Path     : $LocalPath" -ForegroundColor Yellow
Write-Host "  Files    : $($allFiles.Count)" -ForegroundColor Yellow
Write-Host "  Hash     : $contentHash" -ForegroundColor Yellow
$piiScanLabel = if ($piiScanPassed) { 'Passed' } else { 'Skipped' }
Write-Host "  PII Scan : $piiScanLabel" -ForegroundColor Yellow
Write-Host ''
Write-Host '  Review the content, then either:' -ForegroundColor White
Write-Host "    1. Manually push from $LocalPath" -ForegroundColor White
Write-Host '    2. Run Publish-ToMirror.ps1 -SourcePath <path> -RemoteUrl <url>' -ForegroundColor White
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
