<#
.SYNOPSIS
    Compatibility wrapper for scripts\build\Publish-ToMirror.ps1.
.DESCRIPTION
    Forwards all parameters to the canonical implementation under scripts/build/.
    Mirrors the target's parameter set so that named arguments (e.g. -SourcePath)
    bind cleanly when invoked directly or via splatting from other scripts.
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

    [Parameter(ParameterSetName = 'CreatePR')]
    [switch]$WaitForMerge,

    [Parameter(ParameterSetName = 'CreatePR')]
    [int]$WaitForMergeTimeoutMinutes = 60,

    [switch]$Force,

    [switch]$DryRun,

    [switch]$SkipHashCheck,

    [switch]$AllowTagOverwrite
)

$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'build\Publish-ToMirror.ps1'
& $target @PSBoundParameters
exit $LASTEXITCODE
