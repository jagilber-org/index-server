<#
.SYNOPSIS
    Publishes a cleaned copy of a private dev repository to a public publication repository.

.DESCRIPTION
    Implements the dual-repo publishing pattern: copies the current repository to a temp
    directory, strips internal artifacts based on a .publish-exclude file, verifies no
    sensitive content leaked, then force-pushes to a configured public git remote.

    This script uses the developer's normal git credentials (no PAT required).

    The .publish-exclude file supports three pattern types:
    - Directory (ends with /):     "instructions/"   -> excludes all files under instructions/
    - Exact file:                  "build-output.txt" -> excludes that specific file
    - Prefix glob (ends with *):   ".test-run-complete.*" -> excludes files starting with that prefix

.PARAMETER Tag
    The version tag to apply (e.g., v1.0.0). Required unless -DryRun is specified.

.PARAMETER DryRun
    Preview what files would be published without making any changes.

.PARAMETER Force
    Skip the dirty-tree check. Useful when runtime artifacts are modified.

.PARAMETER RemoteName
    The git remote name for the public repository. Default: "public".

.PARAMETER ExcludeFile
    Path to the exclusion list file. Default: ".publish-exclude" in the repo root.

.PARAMETER ForbiddenItems
    Array of top-level names that must NOT appear in the staged output.
    Acts as a safety net beyond .publish-exclude. Default includes common internal
    artifact directories.

.PARAMETER Public
    When auto-creating the publication repo, make it public instead of private.
    By default, new repos are created as PRIVATE for safety.

.EXAMPLE
    .\Publish-DualRepo.ps1 -Tag v1.0.0
    Publishes a clean copy tagged v1.0.0 to the "public" remote.

.EXAMPLE
    .\Publish-DualRepo.ps1 -DryRun
    Lists all files that would be published without making changes.

.EXAMPLE
    .\Publish-DualRepo.ps1 -Tag v2.1.0 -Force
    Publishes even if the working tree is dirty.

.EXAMPLE
    .\Publish-DualRepo.ps1 -Tag v1.0.0 -Public
    Publishes and creates the target repo as public if it does not exist yet.

.EXAMPLE
    .\Publish-DualRepo.ps1 -Tag v1.0.0 -RemoteName "github-public" -ExcludeFile ".my-excludes"
    Publishes using a custom remote name and exclusion list file.
    Publishes to a custom remote using a custom exclusion file.

.NOTES
    Author: jagilber-org
    Version: 1.0.0
    Requires: git CLI, PowerShell 5.1+
    Repository: https://github.com/jagilber-org/scripts
    Related: https://github.com/jagilber-org/scripts/blob/main/docs/Publish-DualRepo.md
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $false)]
    [string]$Tag,

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$Force,

    [Parameter()]
    [string]$RemoteName = 'public',

    [Parameter()]
    [switch]$Public,

    [Parameter()]
    [string]$ExcludeFile = '.publish-exclude',

    [Parameter()]
    [string[]]$ForbiddenItems = @(
        '.specify', 'specs', 'state', 'logs', 'backups',
        'feedback', 'governance', 'memory', 'metrics',
        'snapshots', 'tmp', 'test-results', 'coverage',
        'seed', '.secrets.baseline', '.pii-allowlist',
        'instructions', 'devinstructions', 'NVIDIA Corporation',
        '.private', '.env', '.certs', '.squad', '.squad-templates',
        'templates', 'data', 'node_modules'
    )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

#region Validation
if (-not $DryRun -and -not $Tag) {
    Write-Error "ERROR: -Tag <version> is required (or use -DryRun).`nUsage: .\Publish-DualRepo.ps1 -Tag v1.0.0"
    return
}

# Locate repo root (walk up from script location or current dir)
$repoRoot = $PSScriptRoot
if (-not $repoRoot) { $repoRoot = (Get-Location).Path }
while ($repoRoot -and -not (Test-Path (Join-Path $repoRoot '.git'))) {
    $repoRoot = Split-Path $repoRoot -Parent
}
if (-not $repoRoot -or -not (Test-Path (Join-Path $repoRoot '.git'))) {
    Write-Error 'ERROR: Could not find git repository root.'
    return
}

$excludePath = Join-Path $repoRoot $ExcludeFile
if (-not (Test-Path $excludePath)) {
    Write-Error "ERROR: Exclusion file not found: $excludePath"
    return
}
#endregion

#region Helpers
function Get-ExcludeList {
    param([string]$Path)
    $lines = Get-Content $Path -Encoding UTF8
    $result = @()
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed -and -not $trimmed.StartsWith('#')) {
            $result += $trimmed
        }
    }
    return $result
}

function Test-Excluded {
    param(
        [string]$RelativePath,
        [string[]]$ExcludePaths
    )
    $normalized = $RelativePath.Replace('\', '/')
    foreach ($ex in $ExcludePaths) {
        $exNorm = $ex.Replace('\', '/')
        if ($exNorm.EndsWith('/')) {
            if ($normalized.StartsWith($exNorm) -or "$normalized/" -eq $exNorm) {
                return $true
            }
        }
        elseif ($exNorm.EndsWith('*')) {
            if ($normalized.StartsWith($exNorm.Substring(0, $exNorm.Length - 1))) {
                return $true
            }
        }
        else {
            if ($normalized -eq $exNorm) {
                return $true
            }
        }
    }
    return $false
}

function Copy-RepoContent {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$Root,
        [string[]]$ExcludePaths
    )
    $entries = Get-ChildItem -Path $Source -Force
    foreach ($entry in $entries) {
        if ($entry.Name -eq '.git') { continue }

        # Strip private root-level dotfiles; keep all others (.eslintrc, .dockerignore, .github, etc.)
        $privateDots = @('.certs', '.copilot', '.env', '.private', '.specify', '.squad',
                         '.squad-templates', '.vscode', '.publish-exclude', '.secrets.baseline',
                         '.pre-commit-config.yaml')
        if ($Source -eq $Root -and $entry.Name.StartsWith('.') -and $entry.Name -in $privateDots) { continue }

        $relPath = $entry.FullName.Substring($Root.Length + 1)
        if (Test-Excluded -RelativePath $relPath -ExcludePaths $ExcludePaths) {
            continue
        }

        $destPath = Join-Path $Destination $entry.Name
        if ($entry.PSIsContainer) {
            New-Item -ItemType Directory -Path $destPath -Force | Out-Null
            Copy-RepoContent -Source $entry.FullName -Destination $destPath -Root $Root -ExcludePaths $ExcludePaths
        }
        else {
            Copy-Item -Path $entry.FullName -Destination $destPath -Force
        }
    }
}

function Test-LeakedArtifacts {
    param(
        [string]$Directory,
        [string[]]$Forbidden
    )
    $found = @()
    foreach ($name in $Forbidden) {
        if (Test-Path (Join-Path $Directory $name)) {
            $found += $name
        }
    }
    # Also fail if ANY dotfile/dotfolder exists
    $dotItems = Get-ChildItem -Path $Directory -Force | Where-Object { $_.Name.StartsWith('.') }
    foreach ($item in $dotItems) {
        $found += $item.Name
    }
    return $found
}

function Get-FileCount {
    param([string]$Directory)
    return @(Get-ChildItem -Path $Directory -Recurse -File).Count
}

function Get-RelativeFileList {
    param([string]$Directory)
    $files = Get-ChildItem -Path $Directory -Recurse -File
    foreach ($file in $files) {
        $file.FullName.Substring($Directory.Length + 1).Replace('\', '/')
    }
}
#endregion

#region Pre-flight
Write-Host ''
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host '  Dual-Repo Publish' -ForegroundColor Cyan
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host ''

# Verify remote exists — auto-create if missing
try {
    $remotes = (git -C $repoRoot remote -v 2>&1) -join "`n"
    if ($remotes -notmatch [regex]::Escape($RemoteName)) {
        Write-Host "Git remote '$RemoteName' not configured. Attempting to auto-create publication repo..." -ForegroundColor Yellow

        $ghCmd = Get-Command 'gh' -ErrorAction SilentlyContinue
        if (-not $ghCmd) {
            Write-Error ("ERROR: Git remote '$RemoteName' not configured and GitHub CLI (gh) is not installed.`n" +
                "Either add the remote manually:`n" +
                "  git remote add $RemoteName <public-repo-url>`n" +
                "Or install gh: https://cli.github.com")
            return
        }

        # Derive org and repo name from origin URL (strip -dev suffix)
        $originUrl = (git -C $repoRoot remote get-url origin 2>&1).Trim()
        if ($originUrl -match '[:/](?<org>[^/]+)/(?<repo>[^/.]+?)(?:\.git)?$') {
            $org = $Matches['org']
            $pubRepoName = $Matches['repo'] -replace '-dev$', ''
        }
        else {
            Write-Error "ERROR: Could not parse org/repo from origin URL: $originUrl"
            return
        }

        $visibility = if ($Public) { '--public' } else { '--private' }
        $visibilityLabel = if ($Public) { 'PUBLIC' } else { 'PRIVATE' }

        if (-not $DryRun) {
            if (-not $Force) {
                $confirm = Read-Host "Create $visibilityLabel repo '$org/$pubRepoName' and add as '$RemoteName' remote? (y/N)"
                if ($confirm -ne 'y') {
                    Write-Host 'Aborted.'
                    return
                }
            }

            Write-Host "Creating $visibilityLabel repo: $org/$pubRepoName"
            $createOutput = & gh repo create "$org/$pubRepoName" $visibility --confirm 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) {
                Write-Error "ERROR: Failed to create repo '$org/$pubRepoName'.`n$createOutput`nVerify: gh auth status"
                return
            }

            $pubUrl = "https://github.com/$org/$pubRepoName.git"
            git -C $repoRoot remote add $RemoteName $pubUrl
            Write-Host "Created $visibilityLabel repo and added remote '$RemoteName' -> $pubUrl" -ForegroundColor Green
        }
        else {
            $pubUrl = "https://github.com/$org/$pubRepoName.git"
            Write-Host "[DRY RUN] Would create $visibilityLabel repo '$org/$pubRepoName' and add remote '$RemoteName' -> $pubUrl" -ForegroundColor Yellow
        }
    }
}
catch {
    Write-Error 'ERROR: Could not read git remotes.'
    return
}

# Dirty tree check
if (-not $Force -and -not $DryRun) {
    $status = git -C $repoRoot status --porcelain 2>&1
    if ($status) {
        Write-Error "ERROR: Working tree is dirty. Commit or stash changes first.`nUse -Force to skip this check.`n$status"
        return
    }
}

# Pre-commit hook verification
$preCommitConfig = Join-Path $repoRoot '.pre-commit-config.yaml'
$hasPreCommit = $false
if (Test-Path $preCommitConfig) {
    $pcCmd = Get-Command 'pre-commit' -ErrorAction SilentlyContinue
    if (-not $pcCmd) {
        Write-Error ("ERROR: .pre-commit-config.yaml found but 'pre-commit' is not installed.`n" +
            "Pre-commit is required to scan for secrets and PII before publishing.`n`n" +
            "Install:  pip install pre-commit`n" +
            "Then:     pre-commit install`n" +
            "Docs:     https://pre-commit.com/#install")
        return
    }
    $hasPreCommit = $true
    Write-Host "Pre-commit found: $($pcCmd.Source)"
}
else {
    Write-Warning 'No .pre-commit-config.yaml found - skipping pre-commit content scan.'
}
#endregion

#region Stage
$excludeList = Get-ExcludeList -Path $excludePath
Write-Host "Loaded $($excludeList.Count) exclusion rules from $ExcludeFile"

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "publish-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
Write-Host "Staging to: $tmpDir"

try {
    Copy-RepoContent -Source $repoRoot -Destination $tmpDir -Root $repoRoot -ExcludePaths @($excludeList)

    # Verify no leaked artifacts
    $leaked = @(Test-LeakedArtifacts -Directory $tmpDir -Forbidden $ForbiddenItems)
    if ($leaked.Count -gt 0) {
        Write-Error "ERROR: Internal artifacts leaked into publication:`n  - $($leaked -join "`n  - ")`nUpdate $ExcludeFile and retry."
        return
    }

    # ── Env-var value leak scan ─────────────────────────────────────────
    # Scans ALL text files in staging dir for env var values loaded into this session.
    Write-Host 'Scanning staged files for env-var value leaks...'
    $envSensitivePrefixes = @('AZURE_','ARM_','TF_VAR_','VITE_AZURE_','WEBVIEW_TEST_',
      'SUBSCRIPTION','TENANT','CLIENT','ADMIN_','SF_','DEMO_','COST_','ADO_','AI_','USER_TENANT')
    $envSensitiveExact = @('ANTHROPIC_API_KEY','OPENAI_API_KEY','FIGMA_API_KEY','NPM_TOKEN',
      'CODECOV_TOKEN','GITHUB_APP_PRIVATE_KEY_FILE','GODADDY_API_KEY','GODADDY_API_SECRET',
      'KEY_VAULT_1','DEMO_KEY_VAULT_1')
    $envSensitiveKeywords = @('SECRET','KEY','TOKEN','PASSWORD','CREDENTIAL','SAS','SUBSCRIPTION','TENANT','CLIENT_ID')
    $envValueAllowlist = @('true','false','0','1','yes','no','null','undefined','',
            'eastus','westus','eastus2','westus2','centralus','jagilber','public','private','default',
      './exports','./export',
      '00000000-0000-0000-0000-000000000000')
    $scannableExtensions = @('.ts','.js','.mjs','.cjs','.json','.md','.yml','.yaml',
      '.txt','.html','.css','.sh','.ps1','.psm1','.psd1','.xml','.config','.env','.cfg','.ini','.toml')

    $envLeakMap = @{}
    foreach ($item in (Get-ChildItem env:)) {
        $k = $item.Name; $v = $item.Value
        if (-not $v -or $v.Length -lt 8) { continue }
        if ($envValueAllowlist -contains $v.ToLower()) { continue }
        $isSensitive = $false
        foreach ($p in $envSensitivePrefixes) { if ($k.StartsWith($p)) { $isSensitive = $true; break } }
        if (-not $isSensitive) { if ($envSensitiveExact -contains $k) { $isSensitive = $true } }
        if (-not $isSensitive) {
            foreach ($kw in $envSensitiveKeywords) { if ($k -match $kw) { $isSensitive = $true; break } }
        }
        if ($isSensitive) { $envLeakMap[$v] = $k }
    }
    Write-Host "  Monitoring $($envLeakMap.Count) sensitive env var values"

    $envLeaks = @()
    $scanFiles = Get-ChildItem -Path $tmpDir -Recurse -File | Where-Object {
        $scannableExtensions -contains $_.Extension.ToLower()
    }
    foreach ($sf in $scanFiles) {
        $content = Get-Content -Raw -Path $sf.FullName -ErrorAction SilentlyContinue
        if (-not $content) { continue }
        foreach ($entry in $envLeakMap.GetEnumerator()) {
            if ($content.Contains($entry.Key)) {
                $relPath = $sf.FullName.Substring($tmpDir.Length + 1).Replace('\','/')
                $envLeaks += [PSCustomObject]@{ File = $relPath; EnvName = $entry.Value; Preview = $entry.Key.Substring(0,4) + '***' }
            }
        }
    }

    if ($envLeaks.Count -gt 0) {
        Write-Host ''
        Write-Host '╔══════════════════════════════════════════════════════════════╗' -ForegroundColor Red
        Write-Host '║  BLOCKED: Environment variable values found in files!       ║' -ForegroundColor Red
        Write-Host '╠══════════════════════════════════════════════════════════════╣' -ForegroundColor Red
        foreach ($leak in $envLeaks) {
            Write-Host "║  `$$($leak.EnvName) ($($leak.Preview)) -> $($leak.File)" -ForegroundColor Red
        }
        Write-Host '║                                                              ║' -ForegroundColor Red
        Write-Host '║  These are sensitive values from your shell environment.     ║' -ForegroundColor Red
        Write-Host '║  Remove them from the source files before publishing.        ║' -ForegroundColor Red
        Write-Host '╚══════════════════════════════════════════════════════════════╝' -ForegroundColor Red
        Write-Host ''
        Write-Error "ERROR: $($envLeaks.Count) env-var value leak(s) detected. Cannot publish."
        return
    }
    Write-Host '  No env-var leaks detected.' -ForegroundColor Green

    # Initialize git in staging directory for pre-commit scanning
    # Git emits informational messages (branch switch, CRLF warnings) to stderr;
    # under $ErrorActionPreference='Stop' these become NativeCommandError.
    # Use 'Continue' for all staging git operations.
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    git -C $tmpDir init
    git -C $tmpDir checkout -b main

    # Run pre-commit content scan
    if ($hasPreCommit) {
        Write-Host 'Running pre-commit content scan...'
        Copy-Item $preCommitConfig (Join-Path $tmpDir '.pre-commit-config.yaml') -Force
        $secretsBaseline = Join-Path $repoRoot '.secrets.baseline'
        if (Test-Path $secretsBaseline) {
            Copy-Item $secretsBaseline (Join-Path $tmpDir '.secrets.baseline') -Force
        }
        git -C $tmpDir add -A

        Push-Location $tmpDir
        # Skip branch-protection hook (irrelevant in staging dir — we commit to main for publishing)
        $savedSkip = $env:SKIP
        $env:SKIP = 'no-commit-to-branch'
        try {
            $hookOutput = & pre-commit run --all-files 2>&1 | Out-String
            $hookExit = $LASTEXITCODE

            # Auto-fixers (end-of-file, trailing-whitespace) modify files and return exit 1.
            # Re-run to verify all hooks pass with the corrected content.
            if ($hookExit -ne 0) {
                Write-Host 'Pre-commit hooks modified files; re-staging and re-running to verify...'
                git -C $tmpDir add -A
                $hookOutput = & pre-commit run --all-files 2>&1 | Out-String
                $hookExit = $LASTEXITCODE
            }
        }
        finally {
            if ($savedSkip) { $env:SKIP = $savedSkip } else { Remove-Item Env:\SKIP -ErrorAction SilentlyContinue }
            Pop-Location
        }

        # Remove scan-only config files from staging
        Remove-Item (Join-Path $tmpDir '.pre-commit-config.yaml') -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $tmpDir '.secrets.baseline') -Force -ErrorAction SilentlyContinue

        if ($hookExit -ne 0) {
            $ErrorActionPreference = $savedEAP
            Write-Host ''
            Write-Host 'Pre-commit scan FAILED:' -ForegroundColor Red
            Write-Host $hookOutput -ForegroundColor Yellow
            Write-Error ("ERROR: Pre-commit hooks detected issues in staged content.`n" +
                "This means secrets, PII, or other sensitive content may be present in files to be published.`n`n" +
                "To investigate:`n" +
                "  1. Review the failures above`n" +
                "  2. Fix the flagged files in your dev repo`n" +
                "  3. Re-run: .\Publish-DualRepo.ps1 -DryRun`n`n" +
                "To run pre-commit manually:`n" +
                "  pre-commit run --all-files")
            return
        }
        Write-Host 'Pre-commit scan passed.' -ForegroundColor Green
    }

    git -C $tmpDir add -A
    $ErrorActionPreference = $savedEAP
    $fileCount = Get-FileCount -Directory $tmpDir
    Write-Host "Staged $fileCount files ($($excludeList.Count) exclusion rules applied)"

    # Dry run
    if ($DryRun) {
        Write-Host ''
        Write-Host '-- DRY RUN ------------------------------------------' -ForegroundColor Yellow
        Write-Host 'Files that WOULD be published:'
        $files = Get-RelativeFileList -Directory $tmpDir
        foreach ($f in $files) {
            Write-Host "  $f"
        }
        Write-Host ''
        Write-Host "Total: $fileCount files"
        Write-Host 'No changes were made. Use -Tag <version> to publish.'
        return
    }

    # Commit and push (git already initialized above)
    # Git writes informational messages to stderr (CRLF warnings, branch-switch, progress).
    # Under $ErrorActionPreference='Stop' this triggers NativeCommandError in PS 7.
    # Use 'Continue' for all git operations so stderr is displayed but non-terminating.
    if ($PSCmdlet.ShouldProcess($RemoteName, "Force-push $fileCount files tagged $Tag")) {
        $savedEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'

        Write-Host ''
        Write-Host 'Creating clean git commit...'
        git -C $tmpDir add -A
        $commitMsg = "Publish $Tag from dev repo`n`nPublished by Publish-DualRepo.ps1`nTag: $Tag`nDate: $(Get-Date -Format 'o')`nFiles: $fileCount"
        git -C $tmpDir commit -m $commitMsg

        # Push to public remote
        $publicUrl = (git -C $repoRoot remote get-url $RemoteName).Trim()
        Write-Host "Pushing to $RemoteName remote: $publicUrl"
        git -C $tmpDir remote add $RemoteName $publicUrl

        # Compute hardened bypass token: sha256("publish-<tag>-<YYYY-MM-DD>")
        $todayStr = (Get-Date -Format 'yyyy-MM-dd')
        $tokenInput = "publish-$Tag-$todayStr"
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($tokenInput))
        $publishToken = ($hashBytes | ForEach-Object { $_.ToString('x2') }) -join ''

        $env:PUBLISH_OVERRIDE = $publishToken
        $env:PUBLISH_TAG = $Tag
        try {
            $staleBranches = @(
                (git -C $tmpDir ls-remote --refs --heads $RemoteName 2>$null) |
                    ForEach-Object {
                        $parts = $_ -split "\s+"
                        if ($parts.Count -ge 2 -and $parts[1].StartsWith('refs/heads/')) {
                            $parts[1].Substring('refs/heads/'.Length)
                        }
                    } |
                    Where-Object { $_ -and $_ -ne 'main' }
            )
            if ($staleBranches.Count -gt 0) {
                Write-Host "Removing $($staleBranches.Count) stale remote branch(es)..."
                foreach ($branchName in $staleBranches) {
                    Write-Host "  - $branchName"
                    git -C $tmpDir push $RemoteName ":refs/heads/$branchName"
                }
            }

            $existingTags = @(
                (git -C $tmpDir ls-remote --refs --tags $RemoteName 2>$null) |
                    ForEach-Object {
                        $parts = $_ -split "\s+"
                        if ($parts.Count -ge 2 -and $parts[1].StartsWith('refs/tags/')) {
                            $parts[1].Substring('refs/tags/'.Length)
                        }
                    } |
                    Where-Object { $_ }
            )
            if ($existingTags.Count -gt 0) {
                Write-Host "Removing $($existingTags.Count) existing remote tag(s)..."
                foreach ($tagName in $existingTags) {
                    Write-Host "  - $tagName"
                    git -C $tmpDir push $RemoteName ":refs/tags/$tagName"
                }
            }

            git -C $tmpDir push --force $RemoteName main
            if ($LASTEXITCODE -ne 0) {
                $ErrorActionPreference = $savedEAP
                Write-Error "ERROR: git push failed with exit code $LASTEXITCODE"
                return
            }
        }
        finally {
            Remove-Item Env:\PUBLISH_OVERRIDE -ErrorAction SilentlyContinue
            Remove-Item Env:\PUBLISH_TAG -ErrorAction SilentlyContinue
        }

        # Tag
        Write-Host "Tagging $Tag on $RemoteName remote..."
        git -C $tmpDir tag $Tag
        $env:PUBLISH_OVERRIDE = $publishToken
        $env:PUBLISH_TAG = $Tag
        try {
            git -C $tmpDir push $RemoteName $Tag
            if ($LASTEXITCODE -ne 0) {
                Write-Host "WARNING: Tag push failed (exit $LASTEXITCODE). Push tag manually: git push $RemoteName $Tag" -ForegroundColor Yellow
            }
        }
        finally {
            Remove-Item Env:\PUBLISH_OVERRIDE -ErrorAction SilentlyContinue
            Remove-Item Env:\PUBLISH_TAG -ErrorAction SilentlyContinue
        }

        $ErrorActionPreference = $savedEAP

        Write-Host ''
        Write-Host 'Published successfully!' -ForegroundColor Green
        Write-Host "  Remote: $publicUrl"
        Write-Host "  Tag:    $Tag"
        Write-Host "  Files:  $fileCount"
    }
}
finally {
    # Cleanup
    if (Test-Path $tmpDir) {
        Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host 'Cleaned up staging directory.'
    }
}
#endregion
