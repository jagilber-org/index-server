<#
.SYNOPSIS
    Compatibility wrapper for scripts\Invoke-ReleaseWorkflow.ps1.

.DESCRIPTION
    The root scripts\Invoke-ReleaseWorkflow.ps1 is the maintained release/publish
    entrypoint. This file remains for callers that still use the
    pre-reorganization path.
#>
$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path -Parent $PSScriptRoot) 'Invoke-ReleaseWorkflow.ps1'
& $target @args
exit $LASTEXITCODE
