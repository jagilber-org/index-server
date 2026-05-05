<#
.SYNOPSIS
    Load repo-root .env into the current process environment.

.DESCRIPTION
    Reads <repo-root>/.env (and optionally a path supplied via -Path) line by
    line. Sets $env:<KEY> = <VALUE> only when the key is not already defined
    in the process environment, so explicit shell exports always win over
    .env values.

    Format:
      - One KEY=VALUE per line.
      - Lines starting with '#' (after optional whitespace) are comments.
      - Blank lines are ignored.
      - Surrounding whitespace around KEY is trimmed; VALUE is taken verbatim
        up to the line terminator (no quote stripping, no expansion).

    Missing files are silently ignored (returns $false). Returns $true when a
    file was loaded.

.PARAMETER Path
    Optional explicit path. Default: <repo-root>/.env where repo-root is the
    parent of this script's directory.

.EXAMPLE
    . $PSScriptRoot/Load-RepoEnv.ps1
    # OR explicitly:
    pwsh -NoProfile -Command ". scripts/Load-RepoEnv.ps1; \$env:CLEANROOM_PATH"
#>
[CmdletBinding()]
param(
    [string]$Path
)

if (-not $Path) {
    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $Path = Join-Path $repoRoot '.env'
}

if (-not (Test-Path -LiteralPath $Path)) {
    return $false
}

$loaded = 0
foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    if ($trimmed.StartsWith('#')) { continue }

    $eq = $trimmed.IndexOf('=')
    if ($eq -lt 1) { continue }  # malformed or missing key

    $key   = $trimmed.Substring(0, $eq).Trim()
    $value = $trimmed.Substring($eq + 1)

    if (-not $key) { continue }

    $existing = [Environment]::GetEnvironmentVariable($key, 'Process')
    if ([string]::IsNullOrEmpty($existing)) {
        [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        $loaded++
    }
}

if ($VerbosePreference -ne 'SilentlyContinue') {
    Write-Verbose "[Load-RepoEnv] Loaded $loaded keys from $Path"
}

return $true
