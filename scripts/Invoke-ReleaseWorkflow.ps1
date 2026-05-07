<#
.SYNOPSIS
    Front-door release/publish orchestrator for the dual-repo workflow.

.DESCRIPTION
    Runs the release/publish gates in their intended order:

      1. Load repo-local .env defaults.
      2. Resolve release tag, sanctioned public remote, and clean-room path.
      3. Validate version parity and, unless skipped, release preflight checks.
      4. Optionally push the internal release branch and tags, then verify
         internal refs and GitHub Actions checks.
      5. Build, deploy locally, and prepare the clean-room public snapshot.
      6. Either print the human-only publish command or, when explicitly
         requested by a human operator, invoke Publish-ToMirror.ps1.

    The default mode is agent-safe: it prepares the clean-room copy and prints
    the Phase 5 command, but does not publish to the public mirror. Supplying a
    delivery mode (-CreatePR, -DirectPublish, or -CreateReviewRepo) makes this a
    human-only publish invocation.

.PARAMETER CleanRoomPath
    Absolute path where the clean-room copy will be written. Defaults to
    CLEANROOM_PATH when set, otherwise a derived public-mirror sibling clone
    path for this repo.

.PARAMETER RemoteUrl
    Public mirror URL. Defaults to REMOTE_URL when set, otherwise the first
    sanctionedRemotes entry in .publish-config.json.

.PARAMETER Tag
    Release tag. Defaults to RELEASE_TAG when set, otherwise
    "v<package.json version>".

.PARAMETER PushInternal
    After preflight checks, push the internal release branch and tags to
    -ReleaseRemote, verify the remote branch/tag refs, and wait for internal
    GitHub Actions checks unless -SkipInternalChecks is supplied. This is opt-in
    because local validation and review often happen before the final push.

.PARAMETER DryRun
    Resolve defaults and print the planned commands without running expensive
    checks, build/deploy, clean-room copy, push, or public delivery.

.PARAMETER SkipInternalChecks
    With -PushInternal, verify the pushed branch/tag refs but skip waiting for
    internal GitHub Actions checks. Use only when checks are verified manually
    before public mirror delivery.

.PARAMETER InternalChecksTimeoutMinutes
    Maximum time to wait for internal GitHub Actions checks after -PushInternal.

.EXAMPLE
    pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1 -DryRun

.EXAMPLE
    pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1

.EXAMPLE
    pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1 -PushInternal

.EXAMPLE
    pwsh -NoProfile -File scripts\Invoke-ReleaseWorkflow.ps1 -CreatePR -WaitForMerge
#>
[CmdletBinding(DefaultParameterSetName = 'Prepare')]
param(
    [string]$CleanRoomPath,
    [string]$RemoteUrl,
    [string]$Tag,
    [string]$ReleaseRemote = 'origin',
    [string]$ReleaseBranch = 'main',

    [switch]$SkipPreflight,
    [switch]$SkipBuild,
    [switch]$SkipDeploy,
    [switch]$SkipCleanRoom,
    [switch]$PushInternal,
    [switch]$SkipInternalChecks,
    [int]$InternalChecksTimeoutMinutes = 45,
    [switch]$DryRun,

    # Promotion channel for the public release. Default 'gh-only' produces a
    # GitHub Release with the tarball attached but does NOT publish to npmjs.
    # Promote to 'next' or 'latest' later by re-dispatching release.yml on the
    # mirror with `release_channel=<value>` (this script prints the command).
    [ValidateSet('gh-only','next','latest','auto')]
    [string]$Channel = 'gh-only',

    [Parameter(ParameterSetName = 'CreatePR')]
    [switch]$CreatePR,

    [Parameter(ParameterSetName = 'CreatePR')]
    [switch]$WaitForMerge,

    [Parameter(ParameterSetName = 'CreatePR')]
    [int]$WaitForMergeTimeoutMinutes = 60,

    [Parameter(ParameterSetName = 'DirectPublish')]
    [switch]$DirectPublish,

    [Parameter(ParameterSetName = 'CreateReviewRepo')]
    [switch]$CreateReviewRepo,

    [Parameter(ParameterSetName = 'CreateReviewRepo')]
    [string]$ReviewOrg
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

. (Join-Path $PSScriptRoot 'deploy\Load-RepoEnv.ps1') | Out-Null

function Write-Phase {
    param([Parameter(Mandatory)][string]$Title)

    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor Cyan
    Write-Host (" $Title") -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor Cyan
}

function Invoke-Step {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][scriptblock]$Action,
        [switch]$SkipWhenDryRun
    )

    Write-Host ''
    if ($DryRun -and $SkipWhenDryRun) {
        Write-Host "[publish] DRY RUN: would run $Label" -ForegroundColor DarkYellow
        return
    }

    Write-Host "[publish] $Label" -ForegroundColor Yellow
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "[publish] FAILED: $Label (exit $LASTEXITCODE)"
    }
}

function Invoke-PreCommitReleasePreflight {
    $previousSkip = $env:SKIP
    try {
        $skipHooks = @()
        if ($previousSkip) {
            $skipHooks += $previousSkip -split ',' | Where-Object { $_ }
        }
        if ($skipHooks -notcontains 'no-commit-to-branch') {
            $skipHooks += 'no-commit-to-branch'
        }

        $env:SKIP = ($skipHooks | Select-Object -Unique) -join ','
        pre-commit run --all-files
    } finally {
        if ($null -eq $previousSkip) {
            Remove-Item Env:\SKIP -ErrorAction SilentlyContinue
        } else {
            $env:SKIP = $previousSkip
        }
    }
}

function Get-RequiredJson {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path $Path)) {
        throw "[publish] Required file not found: $Path"
    }
    return Get-Content $Path -Raw | ConvertFrom-Json
}

function Get-DeliveryMode {
    if ($CreatePR) { return 'CreatePR' }
    if ($DirectPublish) { return 'DirectPublish' }
    if ($CreateReviewRepo) { return 'CreateReviewRepo' }
    return 'PrepareOnly'
}

function Test-CleanGitTree {
    $currentBranch = git branch --show-current
    if ($LASTEXITCODE -ne 0) {
        throw '[publish] Unable to inspect current git branch.'
    }
    if ($currentBranch -ne $ReleaseBranch) {
        throw "[publish] Current branch is '$currentBranch', but release/publish must run from '$ReleaseBranch'. Use -ReleaseBranch only for an intentional alternate release branch."
    }

    $status = git status --porcelain=v1 --untracked-files=normal
    if ($LASTEXITCODE -ne 0) {
        throw '[publish] Unable to inspect git status.'
    }

    if ($status) {
        throw @"
[publish] Working tree is not clean. Commit, stash, or remove local changes before release/publish.

$($status -join "`n")
"@
    }
}

function Get-RemoteRef {
    param(
        [Parameter(Mandatory)][string]$RemoteName,
        [Parameter(Mandatory)][string]$RefPattern
    )

    $result = git ls-remote $RemoteName $RefPattern
    if ($LASTEXITCODE -ne 0) {
        throw "[publish] Unable to inspect remote ref '$RefPattern' on '$RemoteName'."
    }
    return @($result | Where-Object { $_ })
}

function Get-RemoteRefSha {
    param(
        [Parameter(Mandatory)][string]$RemoteName,
        [Parameter(Mandatory)][string]$RefPattern
    )

    $refs = @(Get-RemoteRef -RemoteName $RemoteName -RefPattern $RefPattern)
    if ($refs.Count -eq 0) {
        return $null
    }
    if ($refs.Count -gt 1) {
        throw "[publish] Remote ref '$RefPattern' on '$RemoteName' resolved to multiple refs."
    }
    $parts = $refs[0] -split '\s+'
    if ($parts.Count -lt 2 -or -not $parts[0]) {
        throw "[publish] Unable to parse remote ref '$RefPattern' on '$RemoteName': $($refs[0])"
    }
    return $parts[0].Trim()
}

function Get-LocalRefSha {
    param([Parameter(Mandatory)][string]$RefName)

    $sha = git rev-parse $RefName
    if ($LASTEXITCODE -ne 0 -or -not $sha) {
        throw "[publish] Unable to resolve local ref '$RefName'."
    }
    return $sha.Trim()
}

function Confirm-InternalPush {
    param(
        [Parameter(Mandatory)][string]$RemoteName,
        [Parameter(Mandatory)][string]$BranchName,
        [Parameter(Mandatory)][string]$ReleaseTag
    )

    Invoke-Step "verify $RemoteName/$BranchName matches local SHA" {
        $remoteBranchSha = Get-RemoteRefSha -RemoteName $RemoteName -RefPattern "refs/heads/$BranchName"
        if (-not $remoteBranchSha) {
            throw "[publish] Internal push verification failed: refs/heads/$BranchName not found on $RemoteName."
        }
        $localBranchSha = Get-LocalRefSha -RefName "refs/heads/$BranchName"
        if ($remoteBranchSha -ne $localBranchSha) {
            throw "[publish] Internal push verification failed: refs/heads/$BranchName on $RemoteName is $remoteBranchSha, expected local $localBranchSha."
        }
        Write-Host "[publish] Verified internal branch ref SHA: $remoteBranchSha" -ForegroundColor Green
    } -SkipWhenDryRun

    Invoke-Step "verify $RemoteName tag $ReleaseTag matches local SHA" {
        $remoteTagSha = Get-RemoteRefSha -RemoteName $RemoteName -RefPattern "refs/tags/$ReleaseTag"
        if (-not $remoteTagSha) {
            throw "[publish] Internal push verification failed: refs/tags/$ReleaseTag not found on $RemoteName."
        }
        $localTagSha = Get-LocalRefSha -RefName "refs/tags/$ReleaseTag"
        if ($remoteTagSha -ne $localTagSha) {
            throw "[publish] Internal push verification failed: refs/tags/$ReleaseTag on $RemoteName is $remoteTagSha, expected local $localTagSha."
        }
        Write-Host "[publish] Verified internal tag ref SHA: $remoteTagSha" -ForegroundColor Green
    } -SkipWhenDryRun
}

function Wait-InternalChecks {
    param(
        [Parameter(Mandatory)][string]$BranchName,
        [Parameter(Mandatory)][string]$CommitSha,
        [Parameter(Mandatory)][int]$TimeoutMinutes
    )

    Invoke-Step "wait for internal GitHub Actions checks on $CommitSha" {
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            throw '[publish] gh CLI is required to wait for internal checks. Install gh, authenticate, or use -SkipInternalChecks for an intentional manual check handoff.'
        }

        $repo = gh repo view --json nameWithOwner --jq '.nameWithOwner'
        if ($LASTEXITCODE -ne 0 -or -not $repo) {
            throw '[publish] Unable to resolve GitHub repository with gh repo view.'
        }
        $repo = $repo.Trim()
        $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
        $seenRun = $false

        while ((Get-Date) -lt $deadline) {
            $runsJson = gh run list --repo $repo --branch $BranchName --commit $CommitSha --limit 50 --json databaseId,conclusion,name,status,url
            if ($LASTEXITCODE -ne 0) {
                throw '[publish] Unable to list GitHub Actions runs for the internal release commit.'
            }

            $runs = @()
            if ($runsJson) {
                $runs = @($runsJson | ConvertFrom-Json)
            }

            if ($runs.Count -eq 0) {
                Write-Host '[publish] Waiting for internal GitHub Actions runs to appear...' -ForegroundColor DarkYellow
                Start-Sleep -Seconds 30
                continue
            }

            $seenRun = $true
            $active = @($runs | Where-Object { $_.status -in @('queued', 'in_progress', 'waiting', 'requested', 'pending') })
            $failed = @($runs | Where-Object { $_.status -eq 'completed' -and $_.conclusion -notin @('success', 'skipped', 'neutral') })

            if ($failed.Count -gt 0) {
                $summary = ($failed | ForEach-Object { "$($_.name): $($_.conclusion) $($_.url)" }) -join "`n"
                throw "[publish] Internal GitHub Actions checks failed:`n$summary"
            }

            if ($active.Count -eq 0) {
                Write-Host "[publish] Internal GitHub Actions checks completed for $CommitSha." -ForegroundColor Green
                return
            }

            Write-Host "[publish] Waiting for $($active.Count) internal check run(s) to complete..." -ForegroundColor DarkYellow
            Start-Sleep -Seconds 30
        }

        if (-not $seenRun) {
            throw "[publish] Timed out after $TimeoutMinutes minute(s) waiting for internal GitHub Actions runs to appear."
        }
        throw "[publish] Timed out after $TimeoutMinutes minute(s) waiting for internal GitHub Actions checks to complete."
    } -SkipWhenDryRun
}

function Write-PublishCommand {
    param(
        [Parameter(Mandatory)][string]$SourcePath,
        [Parameter(Mandatory)][string]$TargetRemote,
        [Parameter(Mandatory)][string]$ReleaseTag
    )

    Write-Host ''
    Write-Host 'Human-only publish command:' -ForegroundColor Yellow
    Write-Host ''
    Write-Host "    pwsh -NoProfile -File scripts\Publish-ToMirror.ps1 ``" -ForegroundColor White
    Write-Host "        -SourcePath '$SourcePath' ``" -ForegroundColor White
    Write-Host "        -RemoteUrl '$TargetRemote' ``" -ForegroundColor White
    Write-Host "        -Tag $ReleaseTag ``" -ForegroundColor White
    Write-Host "        -CreatePR ``" -ForegroundColor White
    Write-Host "        -WaitForMerge" -ForegroundColor White
}

function Invoke-HumanPublish {
    $publishArgs = @(
        '-SourcePath', $CleanRoomPath,
        '-RemoteUrl', $RemoteUrl,
        '-Tag', $Tag
    )

    if ($CreatePR) {
        $publishArgs += '-CreatePR'
        if ($WaitForMerge) {
            $publishArgs += '-WaitForMerge'
            $publishArgs += '-WaitForMergeTimeoutMinutes'
            $publishArgs += $WaitForMergeTimeoutMinutes
        }
    } elseif ($DirectPublish) {
        $publishArgs += '-DirectPublish'
    } elseif ($CreateReviewRepo) {
        $publishArgs += '-CreateReviewRepo'
        if ($ReviewOrg) {
            $publishArgs += '-ReviewOrg'
            $publishArgs += $ReviewOrg
        }
    }

    Invoke-Step "HUMAN ONLY - Publish-ToMirror.ps1 ($((Get-DeliveryMode)))" ({
        & (Join-Path $PSScriptRoot 'Publish-ToMirror.ps1') @publishArgs
    }.GetNewClosure()) -SkipWhenDryRun
}

Write-Phase 'Phase 0: Resolve release/publish inputs'

if (-not $Tag) {
    if ($env:RELEASE_TAG) {
        $Tag = $env:RELEASE_TAG
        Write-Host "[publish] Tag defaulted to $Tag (.env RELEASE_TAG)"
    } else {
        $packageJson = Get-RequiredJson (Join-Path $repoRoot 'package.json')
        $Tag = "v$($packageJson.version)"
        Write-Host "[publish] Tag defaulted to $Tag (package.json version)"
    }
}

if (-not $RemoteUrl) {
    if ($env:REMOTE_URL) {
        $RemoteUrl = $env:REMOTE_URL
        Write-Host "[publish] RemoteUrl defaulted to $RemoteUrl (.env REMOTE_URL)"
    } else {
        $publishConfigPath = Join-Path $repoRoot '.publish-config.json'
        $publishConfig = Get-RequiredJson $publishConfigPath
        if ($publishConfig.sanctionedRemotes.Count -gt 0) {
            $RemoteUrl = $publishConfig.sanctionedRemotes[0]
            Write-Host "[publish] RemoteUrl defaulted to $RemoteUrl (.publish-config.json)"
        }
        if (-not $RemoteUrl) {
            throw '[publish] RemoteUrl not provided and not found in .env / .publish-config.json'
        }
    }
}

if (-not $CleanRoomPath) {
    if ($env:CLEANROOM_PATH) {
        $CleanRoomPath = $env:CLEANROOM_PATH
        Write-Host "[publish] CleanRoomPath defaulted to $CleanRoomPath (.env CLEANROOM_PATH)"
    } else {
        $workspaceParent = Split-Path -Parent $repoRoot
        $workspaceGrandparent = Split-Path -Parent $workspaceParent
        $CleanRoomPath = Join-Path (Join-Path $workspaceGrandparent 'jagilber-org') 'index-server'
        Write-Host "[publish] CleanRoomPath defaulted to $CleanRoomPath (canonical clean-room location for this repo)"
    }
}

$deliveryMode = Get-DeliveryMode
Write-Host "[publish] Delivery mode: $deliveryMode"

$packageManifest = Get-RequiredJson (Join-Path $repoRoot 'package.json')
$serverManifest = Get-RequiredJson (Join-Path $repoRoot 'server.json')
$expectedVersion = $Tag -replace '^v', ''
if ($packageManifest.version -ne $expectedVersion) {
    throw "[publish] package.json version ($($packageManifest.version)) does not match -Tag $Tag (expected $expectedVersion)."
}
if ($serverManifest.version -ne $expectedVersion) {
    throw "[publish] server.json version ($($serverManifest.version)) does not match -Tag $Tag (expected $expectedVersion)."
}
Write-Host "[publish] Version parity OK: package.json=$($packageManifest.version) server.json=$($serverManifest.version) tag=$Tag" -ForegroundColor Green

if (-not $DryRun) {
    Test-CleanGitTree
}

Write-Phase 'Phase 1: Release preflight'

if ($SkipPreflight) {
    Write-Host '[publish] Skipping preflight (-SkipPreflight specified)'
} else {
    if (-not (Get-Command pre-commit -ErrorAction SilentlyContinue)) {
        if ($DryRun) {
            Write-Host '[publish] pre-commit not on PATH; skipping availability check in -DryRun mode.' -ForegroundColor DarkYellow
        } else {
            throw '[publish] pre-commit is required for release preflight but was not found on PATH.'
        }
    }

    Invoke-Step 'pre-commit run --all-files (skip no-commit-to-branch)' { Invoke-PreCommitReleasePreflight } -SkipWhenDryRun
    Invoke-Step 'npm run check:version-parity' { npm run check:version-parity } -SkipWhenDryRun
    Invoke-Step 'npm run typecheck' { npm run typecheck } -SkipWhenDryRun
    Invoke-Step 'npm run test:fast' { npm run test:fast } -SkipWhenDryRun
}

Write-Phase 'Phase 2: Internal release push'

if ($PushInternal) {
    Invoke-Step "git push $ReleaseRemote $ReleaseBranch --follow-tags" {
        git push $ReleaseRemote $ReleaseBranch --follow-tags
    } -SkipWhenDryRun

    Confirm-InternalPush -RemoteName $ReleaseRemote -BranchName $ReleaseBranch -ReleaseTag $Tag

    if ($SkipInternalChecks) {
        Write-Host '[publish] Skipping internal GitHub Actions wait (-SkipInternalChecks specified). Verify internal checks manually before public delivery.' -ForegroundColor DarkYellow
    } else {
        $headSha = git rev-parse HEAD
        if ($LASTEXITCODE -ne 0 -or -not $headSha) {
            throw '[publish] Unable to resolve HEAD SHA for internal check wait.'
        }
        Wait-InternalChecks -BranchName $ReleaseBranch -CommitSha $headSha.Trim() -TimeoutMinutes $InternalChecksTimeoutMinutes
    }
} else {
    Write-Host "[publish] Internal push not requested. Add -PushInternal after review to push $ReleaseBranch and tags to $ReleaseRemote, verify refs, and wait for internal checks."
}

Write-Phase 'Phase 3: Build and deploy locally'

if ($SkipBuild) {
    Write-Host '[publish] Skipping build (-SkipBuild specified)'
} else {
    Invoke-Step 'npm run build' { npm run build } -SkipWhenDryRun
}

if ($SkipDeploy) {
    Write-Host '[publish] Skipping deploy-local (-SkipDeploy specified)'
} else {
    Invoke-Step 'deploy-local.ps1 -Both -Rebuild -Overwrite' {
        pwsh -NoProfile -File (Join-Path $PSScriptRoot 'deploy\deploy-local.ps1') -Both -Rebuild -Overwrite
    } -SkipWhenDryRun
}

Write-Phase 'Phase 4: Prepare clean-room public snapshot'

if ($SkipCleanRoom) {
    Write-Host '[publish] Skipping clean-room generation (-SkipCleanRoom specified)'
} else {
    Invoke-Step "New-CleanRoomCopy.ps1 -LocalPath '$CleanRoomPath' -RemoteUrl '$RemoteUrl' -Tag $Tag -Force" {
        pwsh -NoProfile -File (Join-Path $PSScriptRoot 'New-CleanRoomCopy.ps1') `
            -LocalPath $CleanRoomPath `
            -RemoteUrl $RemoteUrl `
            -Tag $Tag `
            -Force
    } -SkipWhenDryRun
}

$manifestPath = Join-Path $CleanRoomPath '.publish-manifest.json'
if (-not $DryRun) {
    if (-not (Test-Path $manifestPath)) {
        throw "[publish] Clean-room manifest missing at $manifestPath"
    }

    $manifest = Get-RequiredJson $manifestPath
    Write-Host ''
    Write-Host 'Clean room ready:' -ForegroundColor Green
    Write-Host "  Path        : $CleanRoomPath"
    Write-Host "  Files       : $($manifest.fileCount)"
    Write-Host "  Content hash: $($manifest.contentHash)"
    Write-Host "  Manifest    : $manifestPath"
}

Write-Phase 'Phase 5: Public mirror delivery'

if ($deliveryMode -eq 'PrepareOnly') {
    Write-Host 'Public delivery was not requested. Agents stop here; a human operator reviews the clean room and runs Phase 5.' -ForegroundColor Green
    Write-PublishCommand -SourcePath $CleanRoomPath -TargetRemote $RemoteUrl -ReleaseTag $Tag
} else {
    Write-Host 'A public delivery mode was requested. This phase is human-only and still relies on Publish-ToMirror.ps1 safety gates.' -ForegroundColor Yellow
    Invoke-HumanPublish
}

if ($DryRun) {
    Write-Host ''
    Write-Host '[publish] Dry run complete. No checks, build, deploy, clean-room copy, push, or public delivery was executed.' -ForegroundColor Green
}

# ----------------------------------------------------------------
# Phase 6: Promotion guidance
# ----------------------------------------------------------------
Write-Phase 'Phase 6: Promotion channel summary'

$mirrorRepo = $null
if ($RemoteUrl -match 'github\.com[:/]+([^/]+/[^/.]+)') {
    $mirrorRepo = $Matches[1]
}

Write-Host "Channel        : $Channel" -ForegroundColor Cyan
if ($mirrorRepo) {
    Write-Host "Mirror repo    : $mirrorRepo" -ForegroundColor Cyan
}
Write-Host "Tag            : $Tag" -ForegroundColor Cyan
Write-Host ''

switch ($Channel) {
    'gh-only' {
        Write-Host 'gh-only: tag push will produce a GitHub Release with the tarball attached.' -ForegroundColor Green
        Write-Host 'No npmjs publish will occur. Testers install via:' -ForegroundColor Green
        if ($mirrorRepo) {
            Write-Host "  npm install -g https://github.com/$mirrorRepo/releases/download/$Tag/jagilber-org-index-server-$($Tag.TrimStart('v')).tgz" -ForegroundColor White
        }
        Write-Host ''
        Write-Host 'When ready to promote to npmjs, run on the mirror:' -ForegroundColor Yellow
        if ($mirrorRepo) {
            Write-Host "  gh workflow run release.yml -R $mirrorRepo -f release_channel=next   # → publishes @next" -ForegroundColor White
            Write-Host "  gh workflow run release.yml -R $mirrorRepo -f release_channel=latest # → publishes @latest" -ForegroundColor White
        }
    }
    'next' {
        Write-Host 'next: release will publish to npmjs with --tag next (does NOT touch @latest).' -ForegroundColor Green
        Write-Host 'Users opt in via:' -ForegroundColor Green
        Write-Host '  npm install -g @jagilber-org/index-server@next' -ForegroundColor White
    }
    'latest' {
        Write-Host 'latest: release will publish to npmjs with --tag latest (default channel).' -ForegroundColor Green
        Write-Host 'Users install via:' -ForegroundColor Green
        Write-Host '  npm install -g @jagilber-org/index-server' -ForegroundColor White
    }
    'auto' {
        Write-Host 'auto: release.yml will infer channel from version (prerelease => next, clean semver => latest).' -ForegroundColor Green
    }
}

if ($Channel -ne 'gh-only' -and $mirrorRepo) {
    Write-Host ''
    Write-Host 'NOTE: tag push triggers release.yml in gh-only mode by default. To run with this channel, dispatch explicitly:' -ForegroundColor Yellow
    Write-Host "  gh workflow run release.yml -R $mirrorRepo -f release_channel=$Channel" -ForegroundColor White
}
