<#
.SYNOPSIS
    Template-compatible hook setup entry point.
#>
[CmdletBinding()]
param(
    [switch]$Validate
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $repoRoot 'scripts/hooks/setup-hooks.ps1'

& $setup @PSBoundParameters
exit $LASTEXITCODE
