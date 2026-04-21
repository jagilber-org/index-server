<#
.SYNOPSIS
    Pre-commit hook - Layer 6: Prompt-injection scanning.

.DESCRIPTION
    Scans staged text files for patterns commonly used in prompt-injection attacks
    against LLM-powered tools and AI coding assistants.

    Detection categories:
      1. System/role override directives
      2. Instruction-boundary manipulation
      3. Hidden Unicode control characters (zero-width, bidi controls, isolates)
      4. Suspicious base64-encoded directives (standard + base64url, >= 24 chars)
      5. Data exfiltration patterns
      6. Context manipulation / few-shot poisoning

    Security hardening (v2):
      - Inline allowlists are restricted to test, fixture, documentation, and hook
        files only. Production source files cannot self-allowlist.
      - Repo-level allowlist patterns are validated; overly broad patterns (e.g. '.*')
        are rejected with a warning.
      - NFKC normalization is applied before pattern matching to defeat homoglyph
        evasion.
      - Expanded Unicode detection covers bidi controls (U+202A-U+202E) and isolates
        (U+2066-U+2069).
      - Multi-line comment blocks are joined and scanned as a unit.

    Limitations:
      - Base64 detection uses a length heuristic (>= 24 chars). Shorter encoded
        payloads or non-standard encodings may evade detection.
      - NFKC normalization catches common homoglyphs but not all visual spoofing
        techniques (e.g. Cyrillic lookalikes that normalize to themselves).
      - Multi-line comment scanning only covers contiguous comment lines using
        common prefixes (# // /* * <!-- -->). Language-specific block comment
        syntaxes (e.g. Python triple-quotes) are not yet supported.

.PARAMETER Files
    One or more file paths passed by pre-commit (via pass_filenames).

.EXAMPLE
    pwsh -File hooks/check-prompt-injection.ps1 file1.txt file2.py
#>

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Files
)

$ErrorActionPreference = 'Stop'

# --- helpers ---

function Test-IsBinaryFile {
    param([string]$Path)
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        $count = [Math]::Min($bytes.Length, 8192)
        for ($i = 0; $i -lt $count; $i++) {
            if ($bytes[$i] -eq 0) { return $true }
        }
        return $false
    }
    catch { return $true }
}

function ConvertTo-NfkcNormalized {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return $Text }
    return $Text.Normalize([System.Text.NormalizationForm]::FormKC)
}
function Test-HasZeroWidthOrBidiCharacters {
    param([string]$Line)
    # Zero-width: U+200B-U+200F, U+FEFF
    # Bidi controls: U+202A-U+202E (LRE, RLE, PDF, LRO, RLO)
    # Bidi isolates: U+2066-U+2069 (LRI, RLI, FSI, PDI)
    return $Line -match '[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]' # prompt-injection-allowlist
}

function Test-HasBase64Directive {
    param([string]$Line)
    # Match base64 or base64url blobs >= 24 chars (standard: A-Za-z0-9+/ ; url-safe: A-Za-z0-9-_)
    if ($Line -match '[A-Za-z0-9+/\-_]{24,}={0,2}') { # prompt-injection-allowlist
        try {
            $match = $Matches[0]
            # Normalize base64url to standard base64
            $normalized = $match -replace '-', '+' -replace '_', '/'
            # Fix padding
            $padNeeded = $normalized.Length % 4
            if ($padNeeded -gt 0) { $normalized += ('=' * (4 - $padNeeded)) }
            $decoded = [System.Text.Encoding]::UTF8.GetString(
                [System.Convert]::FromBase64String($normalized)
            )
            $lowerDecoded = $decoded.ToLower()
            return ($lowerDecoded -match 'ignore|system|instruction|override|prompt|execute|eval|role|assistant')
        }
        catch { return $false }
    }
    return $false
}

# Inline allowlist is only honored in test, fixture, doc, and hook files
function Test-InlineAllowlistPermitted {
    param([string]$FilePath)
    $normalizedPath = $FilePath -replace '\\', '/'
    $allowedPatterns = @(
        '(?i)(^|[\\/])tests?[\\/]'
        '(?i)(^|[\\/])__tests__[\\/]'
        '(?i)(^|[\\/])fixtures?[\\/]'
        '(?i)(^|[\\/])test[-_]?data[\\/]'
        '(?i)(^|[\\/])hooks[\\/]'
        '(?i)(^|[\\/])scripts[\\/]'
        '(?i)(^|[\\/])\.instructions[\\/]'
        '(?i)(^|[\\/])docs?[\\/]'
        '(?i)\.md$'
        '(?i)\.Tests\.ps1$'
        '(?i)\.test\.[jt]sx?$'
        '(?i)\.spec\.[jt]sx?$'
        '(?i)(^|[\\/])\.prompt-injection-allowlist$'
    )
    foreach ($pattern in $allowedPatterns) {
        if ($normalizedPath -match $pattern) { return $true }
    }
    return $false
}

function Test-IsOverlyBroadPattern {
    param([string]$Pattern)
    if ([string]::IsNullOrWhiteSpace($Pattern)) { return $true }
    $broadPatterns = @('^\.[\*\+]$', '^\.\*$', '^\.\+$', '^\*$', '^\.\*\.\*$')
    foreach ($bp in $broadPatterns) {
        if ($Pattern -match $bp) { return $true }
    }
    $innocuousStrings = @('hello world', 'const x = 42', 'function main() {}', 'import os')
    $matchCount = 0
    foreach ($test in $innocuousStrings) {
        try {
            if ($test -match $Pattern) { $matchCount++ }
        }
        catch { return $true }
    }
    return ($matchCount -eq $innocuousStrings.Count)
}

function Get-CommentBody {
    param([string]$Line)
    $trimmed = $Line.TrimStart()
    if ($trimmed -match '^(#|//|/?\*+|<!--|-->)\s*(.*)') {
        return $Matches[2]
    }
    return $null
}
# --- load repo-level allowlist ---
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) { $repoRoot = (Get-Location).Path }

$allowlistFile = Join-Path $repoRoot '.prompt-injection-allowlist'
$allowlistPatterns = @()
if (Test-Path $allowlistFile) {
    $allowlistPatterns = Get-Content $allowlistFile -ErrorAction SilentlyContinue |
        Where-Object { $_ -and $_.Trim() -and -not $_.TrimStart().StartsWith('#') } |
        ForEach-Object {
            $pat = $_.Trim()
            if (Test-IsOverlyBroadPattern $pat) {
                Write-Host "  WARNING: Skipping overly broad allowlist pattern: '$pat'" -ForegroundColor Yellow
                return
            }
            $pat
        } |
        Where-Object { $_ }
}

# --- detection patterns ---
# NOTE: Pattern Name and Regex fields contain injection keywords by necessity.
# Lines are marked with inline allowlist comments to prevent self-detection.

$patterns = @(
    @{ Name = 'System/Role Override'; Regex = '(?i)(you\s+are\s+now|new\s+instructions?|ignore\s+(all\s+)?previous\s+instructions?|disregard\s+(all\s+)?(prior|previous|above)|override\s+system\s+prompt|you\s+must\s+obey)' } # prompt-injection-allowlist
    @{ Name = 'Instruction Boundary'; Regex = '(?i)(<\|?\s*(system|im_start|im_end|endoftext)\s*\|?>|\[INST\]|\[/INST\]|<<\s*SYS\s*>>|<</?\s*SYS\s*>>|BEGIN\s+INSTRUCTION|END\s+INSTRUCTION)' } # prompt-injection-allowlist
    @{ Name = 'Hidden Unicode'; Test = 'Test-HasZeroWidthOrBidiCharacters' }
    @{ Name = 'Base64 Directive'; Test = 'Test-HasBase64Directive' }
    @{ Name = 'Data Exfiltration'; Regex = '(?i)(fetch|curl|wget|invoke-webrequest|invoke-restmethod|new-object\s+net\.webclient|xhr|xmlhttprequest)\s*[\(\{]?\s*[''"](https?://|ftp://|\\\\)' } # prompt-injection-allowlist
    @{ Name = 'Context Manipulation'; Regex = '(?i)(IMPORTANT:\s*ignore|CRITICAL:\s*disregard|ADMIN\s+MODE|DEVELOPER\s+MODE|DAN\s+MODE|jailbreak|do\s+anything\s+now|act\s+as\s+(an?\s+)?unrestricted|pretend\s+you\s+(are|have)\s+no\s+(restrictions?|rules?|guidelines?|limitations?))' } # prompt-injection-allowlist
)
# --- main scan ---
$findings = [System.Collections.Generic.List[PSObject]]::new()

foreach ($file in $Files) {
    if (-not (Test-Path $file)) { continue }
    if (Test-IsBinaryFile $file) { continue }

    # Skip the allowlist config file itself — it contains pattern descriptions
    $normalizedFile = $file -replace '\\', '/'
    if ($normalizedFile -match '(^|/)\.prompt-injection-allowlist$') { continue }

    # Skip security config files that may reference patterns
    if ($normalizedFile -match '(^|/)\.gitleaks\.toml$') { continue }
    if ($normalizedFile -match '(^|/)\.secrets\.baseline$') { continue }

    # Skip vendor bundles and minified files
    if ($file -match '(\.bundled\.js|\.min\.js|\.min\.css|[/\\]vendor[/\\]|[/\\]node_modules[/\\]|[/\\]bower_components[/\\])') {
        continue
    }

    $inlineAllowed = Test-InlineAllowlistPermitted $file
    $lines = @(Get-Content $file -ErrorAction SilentlyContinue)
    if ($lines.Count -eq 0) { continue }

    $commentBuffer = @()
    $commentStartLine = 0

    for ($lineNum = 0; $lineNum -lt $lines.Count; $lineNum++) {
        $rawLine = $lines[$lineNum]
        $displayLineNum = $lineNum + 1

        # Check inline allowlist marker
        if ($rawLine -match '#\s*prompt-injection-allowlist|//\s*prompt-injection-allowlist|/\*\s*prompt-injection-allowlist|<!--\s*prompt-injection-allowlist') { # prompt-injection-allowlist
            if ($inlineAllowed) {
                $commentBuffer = @()
                continue
            }
        }

        # Check repo-level allowlist
        $allowlisted = $false
        foreach ($pattern in $allowlistPatterns) {
            try {
                if ($rawLine -match $pattern) { $allowlisted = $true; break }
            }
            catch { }
        }
        if ($allowlisted) { continue }

        # Apply NFKC normalization
        $normalizedLine = ConvertTo-NfkcNormalized $rawLine

        # Build multi-line comment buffer
        $commentBody = Get-CommentBody $rawLine
        if ($null -ne $commentBody) {
            if ($commentBuffer.Count -eq 0) {
                $commentStartLine = $displayLineNum
            }
            $commentBuffer += $commentBody
        }
        else {
            if ($commentBuffer.Count -gt 1) {
                $joinedComment = ($commentBuffer -join ' ')
                $normalizedComment = ConvertTo-NfkcNormalized $joinedComment
                foreach ($p in $patterns) {
                    if ($p.Regex) {
                        if ($normalizedComment -match $p.Regex) {
                            $findings.Add([PSCustomObject]@{
                                File = $file
                                Line = $commentStartLine
                                Type = "$($p.Name) (multi-line comment)"
                                Match = ($joinedComment.Substring(0, [Math]::Min($joinedComment.Length, 120)))
                            })
                        }
                    }
                }
            }
            $commentBuffer = @()
        }

        # Single-line pattern matching
        foreach ($p in $patterns) {
            $matched = $false
            $matchText = ''

            if ($p.Test) {
                $matched = & $p.Test -Line $normalizedLine
                if ($matched) { $matchText = $normalizedLine.Trim() }
            }
            elseif ($p.Regex) {
                if ($normalizedLine -match $p.Regex) {
                    $matched = $true
                    $matchText = $Matches[0]
                }
            }

            if ($matched) {
                $findings.Add([PSCustomObject]@{
                    File  = $file
                    Line  = $displayLineNum
                    Type  = $p.Name
                    Match = ($matchText.Substring(0, [Math]::Min($matchText.Length, 120)))
                })
            }
        }
    }

    # Flush trailing comment block
    if ($commentBuffer.Count -gt 1) {
        $joinedComment = ($commentBuffer -join ' ')
        $normalizedComment = ConvertTo-NfkcNormalized $joinedComment
        foreach ($p in $patterns) {
            if ($p.Regex) {
                if ($normalizedComment -match $p.Regex) {
                    $findings.Add([PSCustomObject]@{
                        File = $file
                        Line = $commentStartLine
                        Type = "$($p.Name) (multi-line comment)"
                        Match = ($joinedComment.Substring(0, [Math]::Min($joinedComment.Length, 120)))
                    })
                }
            }
        }
    }
}
# --- output ---
if ($findings.Count -gt 0) {
    $uniqueFindings = $findings | Sort-Object File, Line, Type -Unique

    Write-Host "`n[PROMPT-INJECTION SCAN] Found $($uniqueFindings.Count) potential prompt-injection pattern(s):" -ForegroundColor Red
    foreach ($f in $uniqueFindings) {
        $truncated = $f.Match
        Write-Host "  $($f.File):$($f.Line) [$($f.Type)] -> $truncated" -ForegroundColor Yellow
    }
    Write-Host ''
    Write-Host 'To suppress an intentional false positive:' -ForegroundColor Yellow
    Write-Host '  - In test/doc/hook files: add a prompt-injection-allowlist comment (# // /* or <!-- styles)' -ForegroundColor Yellow
    Write-Host '  - Or add a matching regex to .prompt-injection-allowlist (protected by CODEOWNERS)' -ForegroundColor Yellow
    Write-Host '  NOTE: Inline allowlists are ignored in production source files.' -ForegroundColor Yellow
    exit 1
}

exit 0
