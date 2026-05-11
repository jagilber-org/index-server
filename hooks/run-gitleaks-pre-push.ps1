<#
.SYNOPSIS
    Run gitleaks as a pre-push commit-range gate.
#>
[CmdletBinding()]
param(
    [switch]$ForceFullScan
)

$ErrorActionPreference = 'Stop'

if ($env:SKIP_GITLEAKS -eq '1') {
    [Console]::Error.WriteLine('[gitleaks-pre-push] SKIPPED (SKIP_GITLEAKS=1) -- audit:' + (Get-Date -Format o))
    exit 0
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $gitleaks = Get-Command gitleaks -ErrorAction SilentlyContinue
    if (-not $gitleaks) {
        [Console]::Error.WriteLine('[gitleaks-pre-push] FAIL: gitleaks CLI not found. Install gitleaks or let pre-commit manage the hook environment.')
        exit 1
    }

    function Resolve-GitleaksRange {
        if ($env:BASE_SHA -and $env:HEAD_SHA) {
            return "$($env:BASE_SHA)..$($env:HEAD_SHA)"
        }
        if ($env:PRE_COMMIT_FROM_REF -and $env:PRE_COMMIT_TO_REF) {
            return "$($env:PRE_COMMIT_FROM_REF)..$($env:PRE_COMMIT_TO_REF)"
        }

        $upstream = git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
        if ($LASTEXITCODE -eq 0 -and $upstream) {
            $mergeBase = git merge-base HEAD '@{u}' 2>$null
            if ($LASTEXITCODE -eq 0 -and $mergeBase) {
                return "$mergeBase..HEAD"
            }
        }

        $parent = git rev-parse HEAD~1 2>$null
        if ($LASTEXITCODE -eq 0 -and $parent) {
            return "$parent..HEAD"
        }

        return $null
    }

    if ($ForceFullScan) {
        $range = $null
    }
    else {
        $range = Resolve-GitleaksRange
    }

    if ($range) {
        Write-Host "[gitleaks-pre-push] scanning commit range $range"
        & $gitleaks.Source git --config .gitleaks.toml --redact --no-banner --log-opts $range
    }
    else {
        Write-Host '[gitleaks-pre-push] no commit range available; scanning working tree'
        & $gitleaks.Source dir --config .gitleaks.toml . --redact --no-banner
    }
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
