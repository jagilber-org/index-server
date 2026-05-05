<#
.SYNOPSIS
    Append agent attestation trailers to a commit message.
.DESCRIPTION
    Generates structured provenance trailers for agent-authored commits.
    Can be used standalone or as a commit-msg hook helper.

    When called with -CommitMsgFile, appends trailers to the file in place
    (suitable for use from a commit-msg hook).

    When called without -CommitMsgFile, writes trailers to stdout for manual use.
.PARAMETER AgentName
    Name of the authoring agent (required).
.PARAMETER AgentModel
    Model or version identifier of the agent.
.PARAMETER TrustLevel
    Agent trust level: restricted, standard, or elevated.
.PARAMETER InstructionHash
    SHA-256 hash of the guiding instruction or spec. Defaults to a placeholder
    with a warning when omitted.
.PARAMETER AuthorizedBy
    Human who authorized or requested the agent action.
.PARAMETER CommitMsgFile
    Path to the commit message file. When provided, trailers are appended in place.
.EXAMPLE
    pwsh -File scripts/append-agent-provenance.ps1 -AgentName "doc-generator" -TrustLevel "standard" -AuthorizedBy "alice@example.com"
.EXAMPLE
    pwsh -File scripts/append-agent-provenance.ps1 -AgentName "security-reviewer" -CommitMsgFile ".git/COMMIT_EDITMSG"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$AgentName,

    [string]$AgentModel,

    [ValidateSet('restricted', 'standard', 'elevated')]
    [string]$TrustLevel = 'restricted',

    [string]$InstructionHash,

    [string]$AuthorizedBy,

    [string]$CommitMsgFile
)

$ErrorActionPreference = 'Stop'

# Default InstructionHash to placeholder with warning when not provided
if (-not $InstructionHash) {
    $InstructionHash = 'sha256:none'
    Write-Warning "No InstructionHash provided; using placeholder 'sha256:none'. Supply a real hash for full traceability."
}

# Build trailer lines
$trailers = @()
$trailers += "Agent: $AgentName"

if ($AgentModel) {
    $trailers += "Agent-Model: $AgentModel"
}

$trailers += "Agent-Trust-Level: $TrustLevel"
$trailers += "Instruction-Hash: $InstructionHash"

if ($AuthorizedBy) {
    $trailers += "Authorized-By: $AuthorizedBy"
}

$trailerBlock = $trailers -join "`n"

if ($CommitMsgFile) {
    if (-not (Test-Path $CommitMsgFile)) {
        Write-Error "Commit message file not found: $CommitMsgFile"
        exit 1
    }

    $content = Get-Content $CommitMsgFile -Raw
    $content = $content.TrimEnd()

    # Parse the trailer section: lines after the last blank line that match
    # "Key: Value" format. Only inspect the actual trailer block to avoid
    # matching body text that happens to contain "Agent: ".
    $lines = $content -split "`n"
    $lastBlankIdx = -1
    for ($i = $lines.Count - 1; $i -ge 0; $i--) {
        if ($lines[$i].Trim() -eq '') {
            $lastBlankIdx = $i
            break
        }
    }

    $existingTrailerBlock = @()
    if ($lastBlankIdx -ge 0) {
        $candidateTrailers = $lines[($lastBlankIdx + 1)..($lines.Count - 1)]
        $allAreTrailers = $true
        foreach ($line in $candidateTrailers) {
            if ($line.Trim() -ne '' -and $line -notmatch '^\S+:\s') {
                $allAreTrailers = $false
                break
            }
        }
        if ($allAreTrailers) {
            $existingTrailerBlock = $candidateTrailers
        }
    }

    # Check for valid existing agent trailers in the trailer block
    $hasAgent = $existingTrailerBlock | Where-Object { $_ -match '^Agent:\s' }
    $hasTrust = $existingTrailerBlock | Where-Object { $_ -match '^Agent-Trust-Level:\s' }
    $hasHash  = $existingTrailerBlock | Where-Object { $_ -match '^Instruction-Hash:\s' }

    if ($hasAgent -and $hasTrust -and $hasHash) {
        Write-Verbose "Agent provenance trailers already present with required fields; skipping."
        exit 0
    }

    if ($hasAgent -and (-not $hasTrust -or -not $hasHash)) {
        Write-Warning "Found partial agent trailers; replacing with complete set."
        $agentTrailerKeys = @('Agent:', 'Agent-Model:', 'Agent-Trust-Level:', 'Instruction-Hash:', 'Authorized-By:')
        $nonAgentTrailers = $existingTrailerBlock | Where-Object {
            $line = $_
            $isAgentTrailer = $false
            foreach ($key in $agentTrailerKeys) {
                if ($line -match "^$([regex]::Escape($key))\s") {
                    $isAgentTrailer = $true
                    break
                }
            }
            -not $isAgentTrailer
        }
        $bodyLines = $lines[0..$lastBlankIdx]
        $body = ($bodyLines -join "`n").TrimEnd()
        if ($nonAgentTrailers.Count -gt 0) {
            $content = "$body`n`n$($nonAgentTrailers -join "`n")`n$trailerBlock"
        } else {
            $content = "$body`n`n$trailerBlock"
        }
    } else {
        $content = "$content`n`n$trailerBlock"
    }

    $content = "$content`n"
    Set-Content -Path $CommitMsgFile -Value $content -NoNewline
    Write-Verbose "Appended agent provenance trailers to $CommitMsgFile"
}
else {
    Write-Output ""
    Write-Output $trailerBlock
}
