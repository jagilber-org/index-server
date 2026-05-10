<#
.SYNOPSIS
    Template-compatible CodeQL pre-push hook entry point.
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$codeqlHook = Join-Path $repoRoot 'scripts/hooks/run-codeql-pre-push.ps1'

& $codeqlHook @Arguments
exit $LASTEXITCODE
