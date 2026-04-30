<#
.SYNOPSIS
    Publish a prepared clean-room copy to a public mirror remote.

.DESCRIPTION
    Takes a directory prepared by New-CleanRoomCopy.ps1 and delivers it to a
    remote Git repository via force-push (DirectPublish), private review repo
    (CreateReviewRepo), or pull request (CreatePR).

    SAFETY CONTROLS:
    - Validates .publish-manifest.json exists and content hash matches
    - Enforces sanctioned remote list from .publish-config.json
    - Requires ConfirmImpact=High (PowerShell prompts by default)
    - Agents MUST NOT invoke this script

    This script is intended for human-supervised release workflows only.

.PARAMETER SourcePath
    Path to the clean-room directory prepared by New-CleanRoomCopy.ps1.
    Must contain a valid .publish-manifest.json.

.PARAMETER RemoteUrl
    URL of the public mirror remote. Must be in the sanctioned remote list
    defined in .publish-config.json.

.PARAMETER Tag
    Git tag to apply to the published commit.

.PARAMETER DirectPublish
    Force-push directly to the public mirror.

.PARAMETER CreateReviewRepo
    Create a private review repo on GitHub for inspection (requires gh CLI).

.PARAMETER ReviewOrg
    GitHub organization for private review repos.

.PARAMETER Force
    Skips confirmation prompts. Use with extreme caution.

.PARAMETER DryRun
    Performs all validation but skips the actual push or repo creation.

.PARAMETER SkipHashCheck
    Skip content hash verification. NOT RECOMMENDED ΓÇö use only when you have
    intentionally modified the prepared content after clean-room creation.

.PARAMETER CreatePR
    Push to a publish/<tag> branch on the public remote and open a pull request
    against main via gh CLI. The user reviews and merges manually.

    The branch is created from the public remote's main (shallow clone) so that
    the PR shares ancestry with main and `gh pr create` can compute a diff. The
    prepared snapshot from $SourcePath is then committed on top, replacing all
    tracked files. The published commit is therefore a single diff against main.

.PARAMETER PrBranch
    Branch name for the PR. Defaults to publish/<Tag> (or publish/latest if no tag).

.PARAMETER AllowTagOverwrite
    Break-glass switch that allows overwriting an existing local or remote tag.
    By default, existing tags are treated as immutable and publish aborts.

.EXAMPLE
    .\Publish-ToMirror.ps1 -SourcePath ..\org\repo -RemoteUrl 'https://github.com/org/repo.git' -CreatePR -Tag v1.0.0

.EXAMPLE
    .\Publish-ToMirror.ps1 -SourcePath ..\org\repo -RemoteUrl 'https://github.com/org/repo.git' -DirectPublish

.EXAMPLE
    .\Publish-ToMirror.ps1 -SourcePath ..\org\repo -RemoteUrl 'https://github.com/org/repo.git' -CreateReviewRepo
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High', DefaultParameterSetName = 'CreatePR')]
param(
    [Parameter(Mandatory)]
    [string]$SourcePath,

    [Parameter(Mandatory)]
    [string]$RemoteUrl,

    [string]$Tag,

    [Parameter(ParameterSetName = 'DirectPublish')]
    [switch]$DirectPublish,

    [Parameter(ParameterSetName = 'CreateReviewRepo')]
    [switch]$CreateReviewRepo,

    [Parameter(ParameterSetName = 'CreateReviewRepo')]
    [string]$ReviewOrg,

    [Parameter(ParameterSetName = 'CreatePR')]
    [switch]$CreatePR,

    [Parameter(ParameterSetName = 'CreatePR')]
    [string]$PrBranch,

    [switch]$Force,

    [switch]$DryRun,

    [switch]$SkipHashCheck,

    [switch]$AllowTagOverwrite
)

$ErrorActionPreference = 'Stop'

# --- URL normalization: SSH ↔ HTTPS, trailing slash, .git suffix ---
function Normalize-GitUrl {
    param([string]$Url)
    $u = $Url.Trim()
    if ($u -match '^git@github\.com:(.+)$') {
        $u = "https://github.com/$($Matches[1])"
    }
    $u = $u.TrimEnd('/')
    $u = $u -replace '\.git$', ''
    return $u
}

function Copy-PreparedContent {
    param(
        [Parameter(Mandatory)]
        [string]$SourceRoot,

        [Parameter(Mandatory)]
        [string]$CurrentSource,

        [Parameter(Mandatory)]
        [string]$DestinationRoot
    )

    foreach ($entry in Get-ChildItem -LiteralPath $CurrentSource -Force) {
        if ($entry.Name -eq '.git') {
            continue
        }

        $relativePath = [System.IO.Path]::GetRelativePath($SourceRoot, $entry.FullName)
        $destinationPath = Join-Path $DestinationRoot $relativePath
        if ($entry.PSIsContainer) {
            New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
            Copy-PreparedContent -SourceRoot $SourceRoot -CurrentSource $entry.FullName -DestinationRoot $DestinationRoot
            continue
        }

        $destinationParent = Split-Path $destinationPath -Parent
        if ($destinationParent -and -not (Test-Path $destinationParent)) {
            New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        }
        Copy-Item -LiteralPath $entry.FullName -Destination $destinationPath -Force
    }
}

function Invoke-Git {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [Parameter(Mandatory)]
        [string]$WorkingDirectory,

        [hashtable]$Environment = @{},

        [switch]$CaptureOutput
    )

    Push-Location $WorkingDirectory
    $originalValues = @{}
    try {
        foreach ($key in $Environment.Keys) {
            $originalValues[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
            [System.Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
        }

        if ($CaptureOutput) {
            $output = & git @Arguments 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Error "git $($Arguments -join ' ') failed.`n$($output | Out-String)"
                return
            }
            return ($output | Out-String).Trim()
        }

        & git @Arguments
        if ($LASTEXITCODE -ne 0) {
            Write-Error "git $($Arguments -join ' ') failed."
            return
        }
    }
    finally {
        foreach ($key in $Environment.Keys) {
            [System.Environment]::SetEnvironmentVariable($key, $originalValues[$key], 'Process')
        }
        Pop-Location
    }
}

function Get-RemoteRefs {
    param(
        [Parameter(Mandatory)]
        [string]$RemoteName,

        [Parameter(Mandatory)]
        [ValidateSet('heads', 'tags')]
        [string]$RefKind,

        [Parameter(Mandatory)]
        [string]$WorkingDirectory
    )

    $output = Invoke-Git -Arguments @('ls-remote', '--refs', "--$RefKind", $RemoteName) -WorkingDirectory $WorkingDirectory -CaptureOutput
    if (-not $output) {
        return @()
    }

    $prefix = if ($RefKind -eq 'heads') { 'refs/heads/' } else { 'refs/tags/' }
    return $output -split "`r?`n" |
        ForEach-Object { ($_ -split '\s+')[1] } |
        Where-Object { $_ -and $_.StartsWith($prefix) } |
        ForEach-Object { $_.Substring($prefix.Length) }
}

# --- Validate source path ---
if (-not (Test-Path $SourcePath)) {
    Write-Error "Source path does not exist: $SourcePath"
    return
}

$manifestPath = Join-Path $SourcePath '.publish-manifest.json'
if (-not (Test-Path $manifestPath)) {
    Write-Error "No .publish-manifest.json found in $SourcePath. Run New-CleanRoomCopy.ps1 first."
    return
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
Write-Host "Manifest loaded: source=$($manifest.sourceRepo), prepared=$($manifest.preparedAt), files=$($manifest.fileCount)"

# --- Verify content hash integrity ---
if (-not $SkipHashCheck) {
    Write-Host 'Verifying content hash integrity...'
    $allFiles = Get-ChildItem -Path $SourcePath -Recurse -File |
        Where-Object { $_.Name -ne '.publish-manifest.json' } |
        Sort-Object { $_.FullName.Substring($SourcePath.Length) }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $hashStream = [System.IO.MemoryStream]::new()

    foreach ($file in $allFiles) {
        $relativePath = $file.FullName.Substring($SourcePath.Length).TrimStart('\', '/').Replace('\', '/')
        $pathBytes = [System.Text.Encoding]::UTF8.GetBytes($relativePath)
        $hashStream.Write($pathBytes, 0, $pathBytes.Length)
        $fileBytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $hashStream.Write($fileBytes, 0, $fileBytes.Length)
    }

    $hashStream.Position = 0
    $computedHashBytes = $sha256.ComputeHash($hashStream)
    $computedHash = [BitConverter]::ToString($computedHashBytes).Replace('-', '').ToLowerInvariant()
    $hashStream.Dispose()
    $sha256.Dispose()

    if ($computedHash -ne $manifest.contentHash) {
        Write-Error @"
Content hash mismatch!
  Expected : $($manifest.contentHash)
  Computed : $computedHash

The prepared content has been modified since New-CleanRoomCopy.ps1 ran.
Re-run New-CleanRoomCopy.ps1 to regenerate a valid clean-room copy.
Use -SkipHashCheck only if you intentionally modified the content.
"@
        return
    }
    Write-Host "Content hash verified: $computedHash" -ForegroundColor Green
}
else {
    Write-Warning 'Content hash verification SKIPPED. Integrity of prepared content is not guaranteed.'
}

# --- Enforce sanctioned remote list ---
# Resolve config from script's repo root (not CWD) to prevent bypass via working directory
$repoRoot = (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path $repoRoot)) {
    # Fallback to git if script is not in expected location
    $repoRoot = & git rev-parse --show-toplevel 2>$null
    if ($repoRoot) { $repoRoot = $repoRoot.Trim() }
}

$publishConfigPath = if ($repoRoot) { Join-Path $repoRoot '.publish-config.json' } else { $null }
$publishConfig = $null

if ($publishConfigPath -and (Test-Path $publishConfigPath)) {
    $publishConfig = Get-Content $publishConfigPath -Raw | ConvertFrom-Json
    Write-Host "Publish config loaded: $publishConfigPath"

    # Check sanctioned remotes
    $normalizedUrl = Normalize-GitUrl $RemoteUrl

    # Validate sanctionedRemotes type
    if ($publishConfig.PSObject.Properties['sanctionedRemotes']) {
        if ($publishConfig.sanctionedRemotes -isnot [array]) {
            Write-Error 'sanctionedRemotes in .publish-config.json must be a JSON array, not a string.'
            return
        }
    }

    $sanctioned = @()
    if ($publishConfig.sanctionedRemotes) {
        $sanctioned = $publishConfig.sanctionedRemotes | ForEach-Object { Normalize-GitUrl $_ }
    }

    if ($sanctioned.Count -eq 0) {
        Write-Error @"
No sanctioned remotes configured in .publish-config.json.
Add at least one remote to sanctionedRemotes to authorize publish targets.
"@
        return
    }

    if ($normalizedUrl -notin $sanctioned) {
        Write-Error @"
Remote URL is not in the sanctioned remote list.
  Provided : $RemoteUrl
  Allowed  : $($publishConfig.sanctionedRemotes -join ', ')

Add the remote to .publish-config.json sanctionedRemotes to authorize it.
"@
        return
    }

    # Check DirectPublish policy — validate boolean type to prevent string coercion bypass
    if ($DirectPublish -and $publishConfig.PSObject.Properties['allowDirectPublish']) {
        if ($publishConfig.allowDirectPublish -isnot [bool]) {
            Write-Error 'allowDirectPublish in .publish-config.json must be boolean true or false, not a string.'
            return
        }
        if (-not $publishConfig.allowDirectPublish) {
            Write-Error @"
Direct publish is disabled in .publish-config.json.
Set "allowDirectPublish": true to enable force-push delivery.
Use -CreateReviewRepo for a private review workflow instead.
"@
            return
        }
    }
}
else {
    Write-Error @"
No .publish-config.json found at $publishConfigPath.
Sanctioned remote enforcement requires this file. Create it with sanctionedRemotes to authorize publish targets.
Publish cannot proceed without a sanctioned remote configuration (fail-closed).
"@
    return
}

# --- Default review org from RemoteUrl ---
if (-not $ReviewOrg -and $RemoteUrl -match 'github\.com[/:]([^/]+)/') {
    $ReviewOrg = $matches[1]
}

# --- Require at least one delivery mode ---
if (-not $DirectPublish -and -not $CreateReviewRepo -and -not $CreatePR) {
    Write-Error 'Specify -DirectPublish, -CreateReviewRepo, or -CreatePR to choose a delivery mode.'
    return
}

# --- DryRun checkpoint ---
if ($DryRun) {
    if ($DirectPublish) {
        Write-Host "[DRY RUN] Would force-push to $RemoteUrl"
    }
    elseif ($CreatePR) {
        $dryBranch = if ($PrBranch) { $PrBranch } elseif ($Tag) { "publish/$Tag" } else { 'publish/latest' }
        Write-Host "[DRY RUN] Would push branch '$dryBranch' to $RemoteUrl and open a PR"
    }
    else {
        Write-Host "[DRY RUN] Would create private review repo under $ReviewOrg"
    }
    return
}

# --- Delivery ---
$publishWorkspace = Join-Path ([System.IO.Path]::GetTempPath()) "publish-mirror-$([System.Guid]::NewGuid().ToString('n'))"

try {
    if ($CreatePR) {
        # Clone main from the public remote so the publish branch shares ancestry
        # with main. Without a common merge base, `gh pr create` fails with
        # "No commits between main and <branch>" because GitHub cannot compute a diff.
        # The remote is named 'public' to match the rest of the script.
        $branchName = if ($PrBranch) { $PrBranch } elseif ($Tag) { "publish/$Tag" } else { 'publish/latest' }

        & git clone --origin public --branch main --single-branch --depth 1 -- $RemoteUrl $publishWorkspace 2>&1 |
            ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $publishWorkspace '.git'))) {
            Write-Error "Failed to clone '$RemoteUrl' (branch main). Verify the remote exists, 'main' is the default branch, and you have read access."
            return
        }

        Invoke-Git -Arguments @('checkout', '-b', $branchName) -WorkingDirectory $publishWorkspace

        # Replace tracked content with the prepared snapshot. Use --ignore-unmatch
        # so an empty index does not fail the run, and clear stragglers from the
        # working tree so the commit reflects exactly $SourcePath.
        Invoke-Git -Arguments @('rm', '-rf', '--ignore-unmatch', '--quiet', '.') -WorkingDirectory $publishWorkspace
        Get-ChildItem -LiteralPath $publishWorkspace -Force |
            Where-Object { $_.Name -ne '.git' } |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

        Copy-PreparedContent -SourceRoot $SourcePath -CurrentSource $SourcePath -DestinationRoot $publishWorkspace
        Invoke-Git -Arguments @('add', '-A') -WorkingDirectory $publishWorkspace
    }
    else {
        # Orphan-init flow for DirectPublish and CreateReviewRepo: the published
        # branch intentionally has no shared history (clean-room snapshot).
        New-Item -ItemType Directory -Path $publishWorkspace -Force | Out-Null
        Copy-PreparedContent -SourceRoot $SourcePath -CurrentSource $SourcePath -DestinationRoot $publishWorkspace
        Invoke-Git -Arguments @('init') -WorkingDirectory $publishWorkspace
        Invoke-Git -Arguments @('checkout', '-b', 'main') -WorkingDirectory $publishWorkspace
        Invoke-Git -Arguments @('add', '-A') -WorkingDirectory $publishWorkspace
    }

    $commitMsg = "Publish from $($manifest.sourceRepo)"
    if ($Tag) { $commitMsg += " ($Tag)" }
    $commitMsg += "`n`nContent-Hash: $($manifest.contentHash)"
    Invoke-Git -Arguments @('commit', '-m', $commitMsg, '--allow-empty') -WorkingDirectory $publishWorkspace

    if ($DirectPublish) {
        if (-not $PSCmdlet.ShouldProcess($RemoteUrl, 'Force-push to public mirror')) {
            Write-Host 'Aborted.'
            return
        }

        # Compute SHA-256 bypass token matching pre-push-public-guard.cjs expectations
        $publishTag = if ($Tag) { $Tag } else { 'untagged' }
        $today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
        $tokenInput = "publish-$publishTag-$today"
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($tokenInput))
        $publishToken = ($hashBytes | ForEach-Object { $_.ToString('x2') }) -join ''
        $publishEnv = @{
            PUBLISH_OVERRIDE = $publishToken
            PUBLISH_TAG      = $publishTag
        }
        $existingRemote = Invoke-Git -Arguments @('remote') -WorkingDirectory $publishWorkspace -CaptureOutput
        if ($existingRemote -split "`r?`n" | Where-Object { $_ -eq 'public' }) {
            Invoke-Git -Arguments @('remote', 'remove', 'public') -WorkingDirectory $publishWorkspace
        }
        Invoke-Git -Arguments @('remote', 'add', 'public', $RemoteUrl) -WorkingDirectory $publishWorkspace

        $staleBranches = Get-RemoteRefs -RemoteName 'public' -RefKind 'heads' -WorkingDirectory $publishWorkspace |
            Where-Object { $_ -ne 'main' }
        foreach ($branchName in $staleBranches) {
            Invoke-Git -Arguments @('push', 'public', '--delete', $branchName) `
                -WorkingDirectory $publishWorkspace `
                -Environment $publishEnv
        }

        # Only remove the specific tag being published when -AllowTagOverwrite is set.
        # Existing remote tags are preserved to avoid orphaning GitHub Releases.
        # See: https://github.com/jagilber-dev/template-repo/issues/47

        if ($Tag) {
            $remoteTagRef = Invoke-Git -Arguments @('ls-remote', '--tags', 'public', "refs/tags/$Tag") `
                -WorkingDirectory $publishWorkspace `
                -CaptureOutput
            if ($remoteTagRef -and -not $AllowTagOverwrite) {
                Write-Error "Tag '$Tag' already exists on the remote. Re-run with -AllowTagOverwrite to replace it."
                return
            }

            if ($AllowTagOverwrite) {
                Write-Warning "Overwriting tag '$Tag' because -AllowTagOverwrite was provided."
                if ($remoteTagRef) {
                    Invoke-Git -Arguments @('push', 'public', ":refs/tags/$Tag") `
                        -WorkingDirectory $publishWorkspace `
                        -Environment $publishEnv
                }
                Invoke-Git -Arguments @('tag', '-f', '-a', $Tag, '-m', "Release $Tag") -WorkingDirectory $publishWorkspace
            }
            else {
                Invoke-Git -Arguments @('tag', '-a', $Tag, '-m', "Release $Tag") -WorkingDirectory $publishWorkspace
            }
        }

        Invoke-Git -Arguments @('push', 'public', 'HEAD:main', '--force') `
            -WorkingDirectory $publishWorkspace `
            -Environment $publishEnv

        if ($Tag) {
            $tagPushArgs = @('push', 'public')
            if ($AllowTagOverwrite) { $tagPushArgs += '--force' }
            $tagPushArgs += "refs/tags/$Tag"
            Invoke-Git -Arguments $tagPushArgs `
                -WorkingDirectory $publishWorkspace `
                -Environment $publishEnv
        }
        Write-Host "Published directly to $RemoteUrl" -ForegroundColor Green
    }
    elseif ($CreatePR) {
        # CreatePR mode
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            Write-Error 'GitHub CLI (gh) is required for -CreatePR. Install from https://cli.github.com.'
            return
        }

        # $branchName was set above when the workspace was cloned from main.

        if (-not $PSCmdlet.ShouldProcess("$RemoteUrl (branch: $branchName)", 'Push branch and open PR')) {
            Write-Host 'Aborted.'
            return
        }

        # Compute SHA-256 bypass token matching pre-push-public-guard.cjs expectations
        $publishTag = if ($Tag) { $Tag } else { 'untagged' }
        $today = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
        $tokenInput = "publish-$publishTag-$today"
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($tokenInput))
        $publishToken = ($hashBytes | ForEach-Object { $_.ToString('x2') }) -join ''
        $publishEnv = @{
            PUBLISH_OVERRIDE = $publishToken
            PUBLISH_TAG      = $publishTag
        }

        # The 'public' remote was set up by `git clone --origin public` above.
        # Reset it defensively in case anything mutated it.
        $existingRemote = Invoke-Git -Arguments @('remote') -WorkingDirectory $publishWorkspace -CaptureOutput
        if ($existingRemote -split "`r?`n" | Where-Object { $_ -eq 'public' }) {
            Invoke-Git -Arguments @('remote', 'set-url', 'public', $RemoteUrl) -WorkingDirectory $publishWorkspace
        }
        else {
            Invoke-Git -Arguments @('remote', 'add', 'public', $RemoteUrl) -WorkingDirectory $publishWorkspace
        }

        # Push to the PR branch (not main)
        Invoke-Git -Arguments @('push', 'public', "HEAD:refs/heads/$branchName", '--force') `
            -WorkingDirectory $publishWorkspace `
            -Environment $publishEnv

        # Extract org/repo from RemoteUrl for gh pr create
        $normalizedPrUrl = Normalize-GitUrl $RemoteUrl
        $prRepo = $normalizedPrUrl -replace '^https://github\.com/', ''

        $prTitle = "Publish from $($manifest.sourceRepo)"
        if ($Tag) { $prTitle += " ($Tag)" }
        $prBody = "Content-Hash: $($manifest.contentHash)`nSource: $($manifest.sourceRepo)`nPrepared: $($manifest.preparedAt)"

        $prUrl = & gh pr create --repo $prRepo --base main --head $branchName --title $prTitle --body $prBody 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Branch pushed but PR creation via gh failed: $prUrl"
            # Surface any existing PR for this branch so the operator does not duplicate it.
            $existingPr = & gh pr list --repo $prRepo --head $branchName --state open --json url,number 2>$null
            if ($LASTEXITCODE -eq 0 -and $existingPr -and $existingPr -ne '[]') {
                Write-Host "An open PR already exists for branch '$branchName':" -ForegroundColor Yellow
                try {
                    $parsedPrs = $existingPr | ConvertFrom-Json
                    foreach ($pr in $parsedPrs) {
                        Write-Host "  PR #$($pr.number): $($pr.url)" -ForegroundColor Yellow
                    }
                }
                catch {
                    # Fall back to raw output if parsing ever fails so operators still see something useful.
                    Write-Host $existingPr -ForegroundColor Yellow
                }
            }
            else {
                Write-Host "Create the PR manually at: $normalizedPrUrl/compare/main...$($branchName)?expand=1" -ForegroundColor Yellow
            }
        }
        else {
            Write-Host ''
            Write-Host '============================================================' -ForegroundColor Cyan
            Write-Host ' PULL REQUEST CREATED' -ForegroundColor Cyan
            Write-Host '============================================================' -ForegroundColor Cyan
            Write-Host "  PR     : $prUrl" -ForegroundColor Yellow
            Write-Host "  Branch : $branchName" -ForegroundColor Yellow
            Write-Host '  Review the PR, then merge via GitHub web UI.' -ForegroundColor White
            Write-Host '============================================================' -ForegroundColor Cyan
            Write-Host ''
        }
    }
    else {
        # CreateReviewRepo mode
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            Write-Error 'GitHub CLI (gh) is required for -CreateReviewRepo. Install from https://cli.github.com.'
            return
        }

        if (-not $ReviewOrg) {
            Write-Error 'Cannot determine review org. Specify -ReviewOrg or ensure -RemoteUrl contains a GitHub org.'
            return
        }

        $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
        $reviewRepoName = "$($manifest.sourceRepo)-review-$timestamp"

        if (-not $PSCmdlet.ShouldProcess("$ReviewOrg/$reviewRepoName", 'Create private review repo')) {
            Write-Host 'Aborted.'
            return
        }

        & gh repo create "$ReviewOrg/$reviewRepoName" --private --confirm 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Failed to create review repo '$ReviewOrg/$reviewRepoName'. Verify gh auth status."
            return
        }

        $reviewUrl = "https://github.com/$ReviewOrg/$reviewRepoName.git"
        Invoke-Git -Arguments @('remote', 'add', 'review', $reviewUrl) -WorkingDirectory $publishWorkspace
        Invoke-Git -Arguments @('push', 'review', 'HEAD:main') -WorkingDirectory $publishWorkspace

        Write-Host ''
        Write-Host '============================================================' -ForegroundColor Cyan
        Write-Host ' PRIVATE REVIEW REPO CREATED' -ForegroundColor Cyan
        Write-Host '============================================================' -ForegroundColor Cyan
        Write-Host "  Repo : https://github.com/$ReviewOrg/$reviewRepoName" -ForegroundColor Yellow
        Write-Host '  Scope: Private - only org members can view.' -ForegroundColor Yellow
        Write-Host ''
        Write-Host '  Review the content, then either:' -ForegroundColor White
        Write-Host "    1. Run: Publish-ToMirror.ps1 -SourcePath '$SourcePath' -RemoteUrl '$RemoteUrl' -DirectPublish" -ForegroundColor White
        Write-Host "    2. Delete review repo: gh repo delete $ReviewOrg/$reviewRepoName --yes" -ForegroundColor White
        Write-Host '============================================================' -ForegroundColor Cyan
        Write-Host ''
    }
}
finally {
    Remove-Item $publishWorkspace -Recurse -Force -ErrorAction SilentlyContinue
}
