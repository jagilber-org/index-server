<#
.SYNOPSIS
  Rename strings across all instruction JSON files with -WhatIf support.

.DESCRIPTION
  Applies one or more old->new string replacements to all JSON files in the
  instruction directories, then optionally renames files whose names match.

  Three input modes:
    1. Simple:      -OldName / -NewName  (single pair, also renames files)
    2. Bulk:        -Replacements @{ old1=new1; old2=new2 }
    3. MappingFile: -MappingFile path/to/mapping.json

  Use -Verify to run a standalone post-check (works alone or after replace).
  Use -WhatIf to preview without writing.

  Targets: instructions/, devinstructions/, .private/instructions/,
           .private/devinstructions/

.PARAMETER OldName
  Single old string to replace. Also used as the file-rename prefix.

.PARAMETER NewName
  Single new string to replace with.

.PARAMETER Replacements
  Hashtable of old->new string pairs for bulk replacement.

.PARAMETER MappingFile
  Path to a JSON mapping file. Expected format:
  {
    "replacements": { "old-name": "new-name", "old_tool": "new_tool" },
    "fileRename": { "old": "old-prefix", "new": "new-prefix" }
  }
  The "fileRename" key is optional.

.PARAMETER FileRenameOld
  Prefix to match for file renames (e.g. 'mcp-index-server').
  Defaults to $OldName in simple mode, or from mapping file.

.PARAMETER FileRenameNew
  Replacement prefix for file renames.

.PARAMETER Verify
  Run verification scan for old strings. Can be combined with replace
  (runs after) or used standalone (-Verify without -OldName/-Replacements).

.PARAMETER TargetDirs
  Override instruction directories to scan. Accepts absolute paths.
  When set, -RepoRoot is ignored for directory resolution.

.PARAMETER EnumEnvVars
  Enumerate all INDEX_SERVER_* env vars from runtimeConfig.ts and current tool names
  from toolRegistry.ts. Outputs a table and optionally a JSON file.
  When combined with -MappingFile, also shows which env vars are in the mapping.

.PARAMETER NoBackup
  Skip the pre-modify zip backup. By default, all target directories are backed
  up to a timestamped zip before any changes are written.
  Example: -TargetDirs 'C:\github\jagilber-pr\Internal\index-server'

.PARAMETER RepoRoot
  Path to the repo root. Defaults to the script's parent directory.
  Ignored when -TargetDirs is specified.

.EXAMPLE
  # Simple rename (preview):
  .\rename-server-in-instructions.ps1 -OldName 'mcp-index-server' -NewName 'index-server' -WhatIf

  # Simple rename (apply + verify):
  .\rename-server-in-instructions.ps1 -OldName 'mcp-index-server' -NewName 'index-server' -Verify

  # Mapping file (preview):
  .\rename-server-in-instructions.ps1 -MappingFile .\mappings\index-server.json -WhatIf

  # Mapping file (apply + verify):
  .\rename-server-in-instructions.ps1 -MappingFile .\mappings\index-server.json -Verify

  # Verify-only (no replacement, just scan):
  .\rename-server-in-instructions.ps1 -MappingFile .\mappings\index-server.json -Verify -WhatIf

  # Bulk hashtable:
  .\rename-server-in-instructions.ps1 -Replacements @{
      'mcp-index-server' = 'index-server'
      'instructions_search' = 'index_search'
  } -FileRenameOld 'mcp-index-server' -FileRenameNew 'index-server' -Verify

.EXAMPLE
  # Mapping file format (mappings/index-server.json):
  # {
  #   "replacements": {
  #     "mcp-index-server": "index-server",
  #     "instructions_search": "index_search",
  #     "instructions_dispatch": "index_dispatch"
  #   },
  #   "fileRename": { "old": "mcp-index-server", "new": "index-server" }
  # }
#>
[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Simple')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Simple', Position = 0)]
    [string]$OldName,

    [Parameter(Mandatory, ParameterSetName = 'Simple', Position = 1)]
    [string]$NewName,

    [Parameter(Mandatory, ParameterSetName = 'Bulk')]
    [hashtable]$Replacements,

    [Parameter(Mandatory, ParameterSetName = 'MappingFile', Position = 0)]
    [ValidateScript({ Test-Path $_ -PathType Leaf })]
    [string]$MappingFile,

    [Parameter(ParameterSetName = 'Bulk')]
    [Parameter(ParameterSetName = 'MappingFile')]
    [string]$FileRenameOld,

    [Parameter(ParameterSetName = 'Bulk')]
    [Parameter(ParameterSetName = 'MappingFile')]
    [string]$FileRenameNew,

    [switch]$Verify,

    [string[]]$TargetDirs,

    [Parameter(ParameterSetName = 'EnumEnvVars')]
    [switch]$EnumEnvVars,

    [switch]$NoBackup,

    [string]$RepoRoot = (Split-Path $PSScriptRoot -Parent)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── EnumEnvVars mode: extract env vars and tool names, then exit ──
if ($EnumEnvVars) {
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host " Server Environment & Tool Enumeration" -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan

    $runtimeConfigPath = Join-Path $RepoRoot 'src/config/runtimeConfig.ts'
    $toolRegistryPath  = Join-Path $RepoRoot 'src/services/toolRegistry.ts'

    # --- Extract INDEX_SERVER_* env vars from runtimeConfig.ts ---
    $envVars = @()
    if (Test-Path $runtimeConfigPath) {
        $rcContent = [IO.File]::ReadAllText($runtimeConfigPath)
        $envVars = @([regex]::Matches($rcContent, 'INDEX_SERVER_[A-Z_]+') | ForEach-Object { $_.Value } | Sort-Object -Unique)
        Write-Host "`n--- INDEX_SERVER_* Environment Variables ($($envVars.Count)) ---" -ForegroundColor Yellow
        foreach ($v in $envVars) { Write-Host "  $v" }
    } else {
        Write-Host "  runtimeConfig.ts not found at: $runtimeConfigPath" -ForegroundColor Red
    }

    # --- Extract tool names from toolRegistry.ts STABLE + MUTATION sets ---
    $toolNames = @()
    if (Test-Path $toolRegistryPath) {
        $trContent = [IO.File]::ReadAllText($toolRegistryPath)
        # Extract from STABLE and MUTATION Set declarations
        $stableMatch = [regex]::Match($trContent, "STABLE\s*=\s*new\s+Set\(\[([^\]]+)\]")
        $mutationMatch = [regex]::Match($trContent, "MUTATION\s*=\s*new\s+Set\(\[([^\]]+)\]")
        $allToolStr = ''
        if ($stableMatch.Success) { $allToolStr += $stableMatch.Groups[1].Value }
        if ($mutationMatch.Success) { $allToolStr += ',' + $mutationMatch.Groups[1].Value }
        $toolNames = @([regex]::Matches($allToolStr, "'([^']+)'") | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
        Write-Host "`n--- Tool Names ($($toolNames.Count)) ---" -ForegroundColor Yellow
        foreach ($t in $toolNames) { Write-Host "  $t" }
    } else {
        Write-Host "  toolRegistry.ts not found at: $toolRegistryPath" -ForegroundColor Red
    }

    # --- If a mapping file was also provided, show coverage ---
    $mappingPath = $null
    if ($MappingFile -and (Test-Path $MappingFile)) { $mappingPath = $MappingFile }
    elseif (Test-Path (Join-Path $PSScriptRoot 'mappings/index-server-rename.json')) {
        $mappingPath = Join-Path $PSScriptRoot 'mappings/index-server-rename.json'
    }

    if ($mappingPath) {
        $mapData = Get-Content $mappingPath -Raw | ConvertFrom-Json
        $mapKeys = @($mapData.replacements.PSObject.Properties.Name)
        $mapValues = @($mapData.replacements.PSObject.Properties.Value)

        Write-Host "`n--- Mapping Coverage ($mappingPath) ---" -ForegroundColor Yellow
        Write-Host "  Mapping entries: $($mapKeys.Count)"

        # Check which env vars are in mapping (as old or new)
        $envMapped = @($envVars | Where-Object { $_ -in $mapKeys -or $_ -in $mapValues })
        $envNotMapped = @($envVars | Where-Object { $_ -notin $mapKeys -and $_ -notin $mapValues })
        Write-Host "  Env vars in mapping: $($envMapped.Count) / $($envVars.Count)"

        # Check which tool names are in mapping (as old or new)
        $toolsMapped = @($toolNames | Where-Object { $_ -in $mapKeys -or $_ -in $mapValues })
        $toolsNotInMapping = @($toolNames | Where-Object { $_ -notin $mapKeys -and $_ -notin $mapValues })
        Write-Host "  Tools in mapping: $($toolsMapped.Count) / $($toolNames.Count)"

        if ($toolsNotInMapping.Count -gt 0) {
            Write-Host "`n  Tools NOT in mapping (already have new names or belong to other subsystems):" -ForegroundColor DarkGray
            foreach ($t in $toolsNotInMapping) { Write-Host "    $t" -ForegroundColor DarkGray }
        }
    }

    # --- Output JSON summary ---
    $summary = [ordered]@{
        generatedAt = (Get-Date -Format 'o')
        repoRoot    = $RepoRoot
        envVars     = $envVars
        toolNames   = $toolNames
    }
    $jsonOut = Join-Path $RepoRoot 'scripts/mappings/server-env-tools.json'
    $summary | ConvertTo-Json -Depth 3 | Set-Content $jsonOut -Encoding UTF8
    Write-Host "`n  Written to: $jsonOut" -ForegroundColor Green

    Write-Host "`n============================================" -ForegroundColor Cyan
    Write-Host " Done (enum only)." -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    return
}

# ── Normalize parameters ──
if ($PSCmdlet.ParameterSetName -eq 'Simple') {
    $Replacements = @{ $OldName = $NewName }
    if (-not $FileRenameOld) { $FileRenameOld = $OldName }
    if (-not $FileRenameNew) { $FileRenameNew = $NewName }
}
elseif ($PSCmdlet.ParameterSetName -eq 'MappingFile') {
    $mapping = Get-Content $MappingFile -Raw | ConvertFrom-Json
    if (-not $mapping.replacements) {
        throw "Mapping file must have a 'replacements' object: $MappingFile"
    }
    $Replacements = @{}
    $mapping.replacements.PSObject.Properties | ForEach-Object {
        $Replacements[$_.Name] = $_.Value
    }
    if ($mapping.fileRename -and -not $FileRenameOld) {
        $FileRenameOld = $mapping.fileRename.old
        $FileRenameNew = $mapping.fileRename.new
    }
}

# ── Target directories ──
if ($TargetDirs) {
    # Absolute paths provided -- use directly
    $resolvedDirs = @($TargetDirs)
    $displayRoot = $resolvedDirs[0]
} else {
    # Default: relative to repo root
    $resolvedDirs = @(
        'instructions',
        'devinstructions',
        '.private\instructions',
        '.private\devinstructions'
    ) | ForEach-Object { Join-Path $RepoRoot $_ }
    $displayRoot = $RepoRoot
}

# Pre-sort keys longest-first to avoid partial-match collisions
$sortedKeys = @($Replacements.Keys | Sort-Object { $_.Length } -Descending)

# ── Banner ──
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Instruction Rename Tool" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Root/Target : $(if($TargetDirs){ $TargetDirs -join '; ' } else { $RepoRoot })"
if ($MappingFile) { Write-Host "  Mapping file: $MappingFile" }
Write-Host "  Replacements: $($Replacements.Count) pair(s)"
foreach ($key in $sortedKeys) {
    Write-Host "    '$key' -> '$($Replacements[$key])'" -ForegroundColor DarkCyan
}
if ($FileRenameOld) {
    Write-Host "  File rename : '$FileRenameOld-*' -> '$FileRenameNew-*'"
}
Write-Host "  Verify      : $Verify"
Write-Host ""

# ── Phase 0: Backup ──
if (-not $NoBackup -and -not $WhatIfPreference) {
    Write-Host "--- Phase 0: Backup ---" -ForegroundColor Yellow
    foreach ($fullDir in $resolvedDirs) {
        if (-not (Test-Path $fullDir)) { continue }
        $dirName = Split-Path $fullDir -Leaf
        $parentDir = Split-Path $fullDir -Parent
        $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $zipName = "backup-${dirName}-${timestamp}.zip"
        $zipPath = Join-Path $parentDir $zipName

        if ($PSCmdlet.ShouldProcess($fullDir, "Backup to $zipPath")) {
            Compress-Archive -Path $fullDir -DestinationPath $zipPath -Force
            $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
            Write-Host "  BACKUP: $zipPath ($sizeMB MB)" -ForegroundColor Green
        }
    }
    Write-Host ""
} elseif ($WhatIfPreference -and -not $NoBackup) {
    Write-Host "--- Phase 0: Backup (skipped in WhatIf) ---" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Helper: scan for remaining old-string references ──
function Invoke-VerifyScan {
    param([string]$Label)
    Write-Host "--- $Label ---" -ForegroundColor Yellow
    $remaining = 0

    foreach ($fullDir in $resolvedDirs) {
        if (-not (Test-Path $fullDir)) { continue }

        Get-ChildItem -Path $fullDir -Filter '*.json' -File | ForEach-Object {
            $content = [IO.File]::ReadAllText($_.FullName)
            foreach ($old in $sortedKeys) {
                $hits = ([regex]::Matches($content, [regex]::Escape($old))).Count
                if ($hits -gt 0) {
                    Write-Host "  FOUND [$hits '$old']: $($_.FullName)" -ForegroundColor Red
                    $remaining += $hits
                }
            }
        }

        if ($FileRenameOld) {
            Get-ChildItem -Path $fullDir -Filter "$FileRenameOld-*.json" -File | ForEach-Object {
                Write-Host "  UNRENAMED FILE: $($_.FullName)" -ForegroundColor Red
                $remaining++
            }
        }
    }

    if ($remaining -eq 0) {
        Write-Host "  VERIFIED: Zero remaining references" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: $remaining remaining references found!" -ForegroundColor Red
    }
    Write-Host ""
    return $remaining
}

# ── Verify-only mode: scan and exit ──
if ($Verify -and $WhatIfPreference) {
    $null = Invoke-VerifyScan -Label 'Verification Scan (read-only)'
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host " Done (verify-only)." -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    return
}

# ── Phase 1: Content replacement ──
Write-Host "--- Phase 1: Content Replacement ---" -ForegroundColor Yellow
$contentFilesChanged = 0
$totalMatches = 0

foreach ($fullDir in $resolvedDirs) {
    if (-not (Test-Path $fullDir)) {
        Write-Host "  SKIP dir (missing): $fullDir" -ForegroundColor DarkGray
        continue
    }

    Get-ChildItem -Path $fullDir -Filter '*.json' -File | ForEach-Object {
        $content = [IO.File]::ReadAllText($_.FullName)
        $fileMatches = 0
        $fileDetail = @()

        foreach ($old in $sortedKeys) {
            $hits = ([regex]::Matches($content, [regex]::Escape($old))).Count
            if ($hits -gt 0) {
                $fileMatches += $hits
                $fileDetail += "  $old ($hits)"
            }
        }

        if ($fileMatches -gt 0) {
            Write-Host "  CONTENT [$fileMatches matches]: $($_.FullName)" -ForegroundColor Green
            foreach ($line in $fileDetail) { Write-Host "    $line" -ForegroundColor DarkGray }
            $contentFilesChanged++
            $totalMatches += $fileMatches

            if ($PSCmdlet.ShouldProcess($_.FullName, "Replace $fileMatches matches")) {
                $newContent = $content
                foreach ($old in $sortedKeys) {
                    $newContent = $newContent.Replace($old, $Replacements[$old])
                }
                [IO.File]::WriteAllText($_.FullName, $newContent)
                Write-Host "    -> WRITTEN" -ForegroundColor DarkGreen
            }
        }
    }
}
Write-Host ""
Write-Host "  Content summary: $contentFilesChanged files, $totalMatches total matches"
Write-Host ""

# ── Phase 2: File renames ──
if ($FileRenameOld) {
    Write-Host "--- Phase 2: File Renames ---" -ForegroundColor Yellow
    $renameCount = 0

    foreach ($fullDir in $resolvedDirs) {
        if (-not (Test-Path $fullDir)) { continue }

        Get-ChildItem -Path $fullDir -Filter "$FileRenameOld-*.json" -File | ForEach-Object {
            $newFileName = $_.Name.Replace($FileRenameOld, $FileRenameNew)
            $newPath = Join-Path $_.DirectoryName $newFileName

            if ($PSCmdlet.ShouldProcess("$($_.FullName) -> $newPath", "Rename file")) {
                Move-Item -Path $_.FullName -Destination $newPath -Force
                # Update the "id" field inside the renamed file to match new filename
                $renamedContent = [IO.File]::ReadAllText($newPath)
                $newId = [IO.Path]::GetFileNameWithoutExtension($newFileName)
                $oldId = [IO.Path]::GetFileNameWithoutExtension($_.Name)
                $renamedContent = $renamedContent.Replace("`"$oldId`"", "`"$newId`"")
                [IO.File]::WriteAllText($newPath, $renamedContent)
                Write-Host "  RENAMED: $($_.FullName) -> $newPath" -ForegroundColor Magenta
                Write-Host "    -> id updated: '$oldId' -> '$newId'" -ForegroundColor DarkGreen
            } else {
                Write-Host "  RENAME: $($_.FullName)" -ForegroundColor Magenta
                Write-Host "      ->  $newPath" -ForegroundColor Magenta
            }
            $renameCount++
        }
    }
    Write-Host ""
    Write-Host "  Rename summary: $renameCount files"
    Write-Host ""
}

# ── Phase 3: JSON Validation ──
Write-Host "--- Phase 3: JSON Validation ---" -ForegroundColor Yellow
$jsonErrors = 0
$jsonChecked = 0
$requiredFields = @('id', 'title', 'body')

foreach ($fullDir in $resolvedDirs) {
    if (-not (Test-Path $fullDir)) { continue }

    Get-ChildItem -Path $fullDir -Filter '*.json' -File | ForEach-Object {
        # Skip auto-generated tracking files
        if ($_.Name -match '^(_manifest|_skipped|\.index-version|usage-buckets)') { return }

        $jsonChecked++
        $filePath = $_.FullName

        # 1. Valid JSON parse
        try {
            $raw = [IO.File]::ReadAllText($filePath)
            $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            Write-Host "  JSON PARSE ERROR: $filePath" -ForegroundColor Red
            Write-Host "    $($_.Exception.Message)" -ForegroundColor Red
            $jsonErrors++
            return
        }

        # 2. Required fields check (instruction files only, not manifests)
        $props = @($parsed.PSObject.Properties.Name)
        if ($props -contains 'id') {
            foreach ($field in $requiredFields) {
                if ($field -notin $props) {
                    Write-Host "  MISSING FIELD '$field': $filePath" -ForegroundColor Red
                    $jsonErrors++
                }
            }

            # 3. ID matches filename (convention: filename = id + .json)
            $expectedId = [IO.Path]::GetFileNameWithoutExtension($_.Name)
            if ($parsed.id -ne $expectedId) {
                Write-Host "  ID/FILENAME MISMATCH: $filePath" -ForegroundColor Red
                Write-Host "    id='$($parsed.id)' but filename='$expectedId'" -ForegroundColor Red
                $jsonErrors++
            }
        }
    }
}

if ($jsonErrors -eq 0) {
    Write-Host "  PASSED: $jsonChecked files validated, 0 errors" -ForegroundColor Green
} else {
    Write-Host "  FAILED: $jsonErrors error(s) in $jsonChecked files" -ForegroundColor Red
}
Write-Host ""

# ── Phase 4: Manifest & Tracking File Updates ──
Write-Host "--- Phase 4: Manifest & Tracking Updates ---" -ForegroundColor Yellow
$manifestUpdates = 0

foreach ($fullDir in $resolvedDirs) {
    if (-not (Test-Path $fullDir)) { continue }

    $manifestPath = Join-Path $fullDir '_manifest.json'
    if (-not (Test-Path $manifestPath)) {
        Write-Host "  No _manifest.json in: $fullDir" -ForegroundColor DarkGray
        continue
    }

    $raw = [IO.File]::ReadAllText($manifestPath)
    $changed = $false

    # Replace old strings in manifest content (IDs, titles, etc.)
    foreach ($old in $sortedKeys) {
        if ($raw.Contains($old)) {
            $changed = $true
        }
    }

    if ($changed) {
        $hits = 0
        foreach ($old in $sortedKeys) {
            $hits += ([regex]::Matches($raw, [regex]::Escape($old))).Count
        }
        Write-Host "  _manifest.json [$hits matches]: $manifestPath" -ForegroundColor Green

        if ($PSCmdlet.ShouldProcess($manifestPath, "Update _manifest.json ($hits matches)")) {
            $newRaw = $raw
            foreach ($old in $sortedKeys) {
                $newRaw = $newRaw.Replace($old, $Replacements[$old])
            }
            [IO.File]::WriteAllText($manifestPath, $newRaw)
            Write-Host "    -> WRITTEN" -ForegroundColor DarkGreen
        }
        $manifestUpdates++
    } else {
        Write-Host "  _manifest.json (clean): $manifestPath" -ForegroundColor DarkGray
    }

    # Also check _skipped.json
    $skippedPath = Join-Path $fullDir '_skipped.json'
    if (Test-Path $skippedPath) {
        $skippedRaw = [IO.File]::ReadAllText($skippedPath)
        $skippedChanged = $false
        foreach ($old in $sortedKeys) {
            if ($skippedRaw.Contains($old)) { $skippedChanged = $true }
        }
        if ($skippedChanged) {
            $skippedHits = 0
            foreach ($old in $sortedKeys) {
                $skippedHits += ([regex]::Matches($skippedRaw, [regex]::Escape($old))).Count
            }
            Write-Host "  _skipped.json [$skippedHits matches]: $skippedPath" -ForegroundColor Green
            if ($PSCmdlet.ShouldProcess($skippedPath, "Update _skipped.json ($skippedHits matches)")) {
                $newSkipped = $skippedRaw
                foreach ($old in $sortedKeys) {
                    $newSkipped = $newSkipped.Replace($old, $Replacements[$old])
                }
                [IO.File]::WriteAllText($skippedPath, $newSkipped)
                Write-Host "    -> WRITTEN" -ForegroundColor DarkGreen
            }
            $manifestUpdates++
        }
    }
}

Write-Host "  Manifest summary: $manifestUpdates file(s) updated"
Write-Host ""

# ── Phase 5: Verification (when -Verify is set or after live apply) ──
if ($Verify -and -not $WhatIfPreference) {
    $null = Invoke-VerifyScan -Label 'Phase 5: Post-Replace Verification'
}

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Done." -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
