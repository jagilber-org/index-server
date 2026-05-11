<#
.SYNOPSIS
    Load repo-root .env values into the current PowerShell process.
#>
[CmdletBinding()]
param(
    [string]$Path,
    [switch]$Override
)

$ErrorActionPreference = 'Stop'

if (-not $Path) {
    $Path = Join-Path (Split-Path -Parent $PSScriptRoot) '.env'
}

if (-not (Test-Path -LiteralPath $Path)) {
    return
}

foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*$' -or $line -match '^\s*#') {
        continue
    }

    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
        continue
    }

    $name = $matches[1]
    $value = $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not $Override -and (Test-Path "env:$name")) {
        continue
    }

    Set-Item -Path "env:$name" -Value $value
}
