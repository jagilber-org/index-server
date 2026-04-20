<#
.SYNOPSIS
    Commit-msg hook: warns when agent-pattern commits lack attestation trailers.
.DESCRIPTION
    Inspects the commit message for signs of agent authorship (Co-authored-by
    containing known bot patterns) and warns if required Agent provenance
    trailers are missing.

    This is an advisory hook. It emits warnings but does not block commits,
    allowing human overrides while maintaining audit visibility.
.PARAMETER CommitMsgFile
    Path to the commit message file (passed by git commit-msg hook).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$CommitMsgFile
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $CommitMsgFile)) {
    Write-Error "Commit message file not found: $CommitMsgFile"
    exit 1
}

$content = Get-Content $CommitMsgFile -Raw

# Detect agent-pattern commits: Co-authored-by with known bot/agent patterns
$agentPatterns = @(
    'Copilot',
    'copilot',
    'bot@',
    'agent@',
    '\[bot\]',
    'noreply\.github\.com'
)

$isAgentCommit = $false
foreach ($pattern in $agentPatterns) {
    if ($content -match "Co-authored-by:.*$pattern") {
        $isAgentCommit = $true
        break
    }
}

if (-not $isAgentCommit) {
    exit 0
}

# Parse trailer section (lines after last blank line that match Key: Value)
$lines = ($content.TrimEnd()) -split "`n"
$lastBlankIdx = -1
for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ($lines[$i].Trim() -eq '') {
        $lastBlankIdx = $i
        break
    }
}

$trailerLines = @()
if ($lastBlankIdx -ge 0 -and $lastBlankIdx -lt ($lines.Count - 1)) {
    $candidates = $lines[($lastBlankIdx + 1)..($lines.Count - 1)]
    $allTrailers = $true
    foreach ($line in $candidates) {
        if ($line.Trim() -ne '' -and $line -notmatch '^\S+:\s') {
            $allTrailers = $false
            break
        }
    }
    if ($allTrailers) {
        $trailerLines = $candidates
    }
}

$hasAgent = $trailerLines | Where-Object { $_ -match '^Agent:\s' }
$hasTrust = $trailerLines | Where-Object { $_ -match '^Agent-Trust-Level:\s' }
$hasHash  = $trailerLines | Where-Object { $_ -match '^Instruction-Hash:\s' }

$warnings = @()
if (-not $hasAgent) { $warnings += "Missing 'Agent:' trailer" }
if (-not $hasTrust) { $warnings += "Missing 'Agent-Trust-Level:' trailer" }
if (-not $hasHash)  { $warnings += "Missing 'Instruction-Hash:' trailer" }

if ($warnings.Count -gt 0) {
    Write-Warning "AG-4: Agent-pattern commit detected but attestation trailers are incomplete:"
    foreach ($w in $warnings) {
        Write-Warning "  - $w"
    }
    Write-Warning "See .instructions/shared/agent-attestation.md for the required trailer format."
    Write-Warning "Use scripts/append-agent-provenance.ps1 to generate trailers."
}

exit 0
