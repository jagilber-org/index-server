<#
.SYNOPSIS
    Compatibility wrapper for scripts\build\Publish-ToMirror.ps1.
#>
$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot 'build\Publish-ToMirror.ps1'
& $target @args
exit $LASTEXITCODE
