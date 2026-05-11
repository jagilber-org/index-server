<#
.SYNOPSIS
    Template-compatible hook entry point for repo-local dotenv/env leak scanning.
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Files
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$scanner = Join-Path $repoRoot 'scripts/hooks/pre-commit.ps1'

& $scanner @Files
exit $LASTEXITCODE
