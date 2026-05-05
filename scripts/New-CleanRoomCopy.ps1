<#
.SYNOPSIS
    Compatibility wrapper for scripts\deploy\New-CleanRoomCopy.ps1.
#>
$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'deploy\New-CleanRoomCopy.ps1'
& $target @args
exit $LASTEXITCODE
