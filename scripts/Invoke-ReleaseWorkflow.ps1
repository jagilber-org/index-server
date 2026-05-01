<#
.SYNOPSIS
    Run the index-server release workflow phases 2 and 3 end-to-end, then
    echo the exact human-only Phase 4 command to publish.

.DESCRIPTION
    Automates the deterministic, agent-safe portion of the release workflow
    documented in .instructions/local/release-workflow.md:

        Phase 2 step 6: npm run build
        Phase 2 step 7: scripts/deploy-local.ps1 -Both -Rebuild -Overwrite
        Phase 3 step 9: scripts/New-CleanRoomCopy.ps1 -LocalPath <path> -Force

    Phase 4 (Publish-ToMirror.ps1) is human-only and is NOT executed. The
    script prints the exact command for a human operator to run and exits.

    Halts on the first failure (PII scan, content hash, deploy error, etc.).
    No flag bypasses any security gate.

.PARAMETER CleanRoomPath
    Absolute path where the clean-room copy will be written. Defaults to
    'C:\github\jagilber-org\index-server' (the canonical clean-room
    location for this repo: the public-mirror sibling clone).
    Pass explicitly only when intentionally overriding.

.PARAMETER RemoteUrl
    Public mirror URL for the echoed Publish-ToMirror command. Defaults to
    the first entry of sanctionedRemotes in .publish-config.json.

.PARAMETER Tag
    Release tag to print in the Publish-ToMirror command. Defaults to
    "v<package.json version>".

.PARAMETER SkipBuild
    Skip Phase 2 step 6 (npm run build). Use only when dist/ is already
    current.

.PARAMETER SkipDeploy
    Skip Phase 2 step 7 (deploy-local). Use only when local instances are
    already up to date.

.EXAMPLE
    pwsh -File scripts/Invoke-ReleaseWorkflow.ps1
    # Uses the default CleanRoomPath 'C:\github\jagilber-org\index-server'.

.EXAMPLE
    pwsh -File scripts/Invoke-ReleaseWorkflow.ps1 `
        -CleanRoomPath 'C:\github\jagilber-org\index-server'

.NOTES
    Author: index-server release workflow automation.
    Agents may run Phases 2-3 via this script. Agents MUST NOT run Phase 4.
#>
[CmdletBinding()]
param(
    [string]$CleanRoomPath,
    [string]$RemoteUrl,
    [string]$Tag,
    [switch]$SkipBuild,
    [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Load repo-root .env (silent if missing). Existing $env values are not
# overwritten, so explicit shell exports always win.
. (Join-Path $PSScriptRoot 'Load-RepoEnv.ps1') | Out-Null

function Write-Phase {
    param([string]$Title)
    Write-Host ''
    Write-Host ('=' * 70) -ForegroundColor Cyan
    Write-Host (" $Title") -ForegroundColor Cyan
    Write-Host ('=' * 70) -ForegroundColor Cyan
}

function Invoke-Step {
    param(
        [string]$Label,
        [scriptblock]$Action
    )
    Write-Host ''
    Write-Host "[release] $Label" -ForegroundColor Yellow
    & $Action
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "[release] FAILED: $Label (exit $LASTEXITCODE)"
    }
}

# --- Resolve defaults --------------------------------------------------------

if (-not $Tag) {
    if ($env:RELEASE_TAG) {
        $Tag = $env:RELEASE_TAG
        Write-Host "[release] Tag defaulted to $Tag (.env RELEASE_TAG)"
    } else {
        $pkg = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
        $Tag = "v$($pkg.version)"
        Write-Host "[release] Tag defaulted to $Tag (package.json version)"
    }
}

if (-not $RemoteUrl) {
    if ($env:REMOTE_URL) {
        $RemoteUrl = $env:REMOTE_URL
        Write-Host "[release] RemoteUrl defaulted to $RemoteUrl (.env REMOTE_URL)"
    } else {
        $configPath = Join-Path $repoRoot '.publish-config.json'
        if (Test-Path $configPath) {
            $publishConfig = Get-Content $configPath -Raw | ConvertFrom-Json
            if ($publishConfig.sanctionedRemotes.Count -gt 0) {
                $RemoteUrl = $publishConfig.sanctionedRemotes[0]
                Write-Host "[release] RemoteUrl defaulted to $RemoteUrl (.publish-config.json)"
            }
        }
        if (-not $RemoteUrl) {
            throw "[release] RemoteUrl not provided and not found in .env / .publish-config.json"
        }
    }
}

if (-not $CleanRoomPath) {
    if ($env:CLEANROOM_PATH) {
        $CleanRoomPath = $env:CLEANROOM_PATH
        Write-Host "[release] CleanRoomPath defaulted to $CleanRoomPath (.env CLEANROOM_PATH)"
    } else {
        $CleanRoomPath = 'C:\github\jagilber-org\index-server'
        Write-Host "[release] CleanRoomPath defaulted to $CleanRoomPath (canonical clean-room location for this repo)"
    }
}

# --- Phase 2: Build & Deploy Locally ----------------------------------------

Write-Phase 'Phase 2: Build & Deploy Locally'

if ($SkipBuild) {
    Write-Host '[release] Skipping build (-SkipBuild specified)'
} else {
    Invoke-Step 'Phase 2 step 6 - npm run build' { npm run build }
}

if ($SkipDeploy) {
    Write-Host '[release] Skipping deploy-local (-SkipDeploy specified)'
} else {
    Invoke-Step 'Phase 2 step 7 - deploy-local.ps1 -Both -Rebuild -Overwrite' {
        pwsh -NoProfile -File (Join-Path $PSScriptRoot 'deploy-local.ps1') -Both -Rebuild -Overwrite
    }
}

# --- Phase 3: Clean Room ----------------------------------------------------

Write-Phase 'Phase 3: Prepare Clean Room (security gates run inside)'

Invoke-Step "Phase 3 step 9 - New-CleanRoomCopy.ps1 -LocalPath '$CleanRoomPath' -Force" {
    pwsh -NoProfile -File (Join-Path $PSScriptRoot 'New-CleanRoomCopy.ps1') -LocalPath $CleanRoomPath -Force
}

$manifestPath = Join-Path $CleanRoomPath '.publish-manifest.json'
if (-not (Test-Path $manifestPath)) {
    throw "[release] Clean room manifest missing at $manifestPath"
}
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$contentHash = $manifest.contentHash

# --- Phase 4 handoff (HUMAN ONLY) -------------------------------------------

Write-Phase 'Phase 4: Publish to Public Mirror (HUMAN ONLY)'

Write-Host ''
Write-Host 'Phases 2 and 3 complete. Agents MUST NOT run Phase 4.' -ForegroundColor Green
Write-Host ''
Write-Host 'Clean room ready:' -ForegroundColor Green
Write-Host "  Path        : $CleanRoomPath"
Write-Host "  Files       : $($manifest.fileCount)"
Write-Host "  Content hash: $contentHash"
Write-Host "  Manifest    : $manifestPath"
Write-Host ''
Write-Host 'Run this command (HUMAN, with publish token ready):' -ForegroundColor Yellow
Write-Host ''
Write-Host "    pwsh -File scripts/Publish-ToMirror.ps1 ``" -ForegroundColor White
Write-Host "        -SourcePath '$CleanRoomPath' ``" -ForegroundColor White
Write-Host "        -RemoteUrl '$RemoteUrl' ``" -ForegroundColor White
Write-Host "        -Tag $Tag ``" -ForegroundColor White
Write-Host "        -CreatePR" -ForegroundColor White
Write-Host ''
Write-Host 'Pre-push guard will prompt for a SHA-256 token of:' -ForegroundColor DarkGray
Write-Host "    publish-$Tag-<YYYYMMDD>" -ForegroundColor DarkGray
Write-Host ''
