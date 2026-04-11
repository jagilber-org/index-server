<#!
.SYNOPSIS
  Restores a previously backed-up instructions directory.

.DESCRIPTION
  Restores instruction JSON files from either:
    - A backup folder (backups/instructions-<timestamp> or backups/auto-backup-<timestamp>)
    - A zip archive (backup-instructions-<timestamp>.zip)

  Without -Force, only missing files are restored (safety first).
  Supports both directory-based backups (from deploy-local.ps1 / auto-backup) and
  zip-based backups (from rename-server-in-instructions.ps1 / manual).

.PARAMETER Destination
  Root deployment directory containing backups/ and instructions/ (default C:\mcp\index-server)

.PARAMETER BackupName
  Specific backup folder or zip file name (e.g. 'instructions-20250828-153011' or
  'backup-instructions-20260330-215147.zip'). If omitted, the most recent backup is used.
  Searches both backups/ subdirectory and the Destination root for zip files.

.PARAMETER BackupPath
  Full absolute path to a backup zip file or directory. Use this to restore from an
  arbitrary location (e.g., a backup created in another repo by the rename script).

.PARAMETER Force
  Overwrite existing instruction files with versions from backup.

.PARAMETER WhatIf
  Preview what would be restored without writing any files.

.EXAMPLE
  # Restore latest backup (auto-detected):
  pwsh scripts/restore-instructions.ps1 -Destination C:\mcp\index-server

.EXAMPLE
  # Restore specific directory backup with overwrite:
  pwsh scripts/restore-instructions.ps1 -Destination C:\mcp\index-server -BackupName instructions-20250828-153011 -Force

.EXAMPLE
  # Restore from zip backup:
  pwsh scripts/restore-instructions.ps1 -Destination C:\mcp\index-server -BackupName backup-instructions-20260330-215147.zip

.EXAMPLE
  # Restore from external backup zip (e.g., rename script backup):
  pwsh scripts/restore-instructions.ps1 -Destination C:\mcp\index-server -BackupPath C:\github\jagilber-pr\Internal\backup-index-server-20260330.zip -Force

.EXAMPLE
  # Preview restore without writing:
  pwsh scripts/restore-instructions.ps1 -Destination C:\mcp\index-server -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Destination = 'C:\mcp\index-server',
  [string]$BackupName,
  [string]$BackupPath,
  [switch]$Force
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$backupRoot = Join-Path $Destination 'backups'
$instructionsDir = Join-Path $Destination 'instructions'
if(-not (Test-Path $instructionsDir)){ New-Item -ItemType Directory -Force -WhatIf:$false -Path $instructionsDir | Out-Null }

$isZip = $false
$selected = $null
$tempExtract = $null

if ($BackupPath) {
  # Absolute path provided
  if (-not (Test-Path $BackupPath)) { throw "Backup not found: $BackupPath" }
  $selected = Get-Item $BackupPath
  $isZip = $selected.Extension -eq '.zip'
} elseif ($BackupName) {
  # Search in backups/ subdir and Destination root
  $candidate = Join-Path $backupRoot $BackupName
  if (Test-Path $candidate) {
    $selected = Get-Item $candidate
  } else {
    $candidate = Join-Path $Destination $BackupName
    if (Test-Path $candidate) {
      $selected = Get-Item $candidate
    } else {
      throw "Specified backup not found: $BackupName (searched $backupRoot and $Destination)"
    }
  }
  $isZip = $selected.Extension -eq '.zip'
} else {
  # Auto-detect most recent backup (check directories first, then zips)
  $dirs = @()
  if (Test-Path $backupRoot) {
    $dirs = Get-ChildItem -Path $backupRoot -Directory | Where-Object { $_.Name -match '^(instructions-|auto-backup-)' } | Sort-Object Name -Descending
  }
  $zips = @()
  if (Test-Path $backupRoot) {
    $zips += Get-ChildItem -Path $backupRoot -Filter 'backup-*instructions*.zip' -File -ErrorAction SilentlyContinue
  }
  $zips += Get-ChildItem -Path $Destination -Filter 'backup-*instructions*.zip' -File -ErrorAction SilentlyContinue

  # Pick the newest across dirs and zips by LastWriteTime
  $allCandidates = @()
  if ($dirs) { $allCandidates += $dirs }
  if ($zips) { $allCandidates += $zips }
  if ($allCandidates.Count -eq 0) { throw "No instruction backups found in $backupRoot or $Destination" }

  $selected = $allCandidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $isZip = $selected.Extension -eq '.zip'
}

Write-Host "[restore] Using backup: $($selected.FullName)" -ForegroundColor Cyan
Write-Host "[restore] Type: $(if($isZip){'zip archive'}else{'directory'})" -ForegroundColor Cyan

# Extract zip to temp directory if needed
$sourceDir = $null
if ($isZip) {
  $tempExtract = Join-Path ([System.IO.Path]::GetTempPath()) "restore-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  New-Item -ItemType Directory -Path $tempExtract -Force -WhatIf:$false | Out-Null
  Write-Host "[restore] Extracting zip to temp: $tempExtract" -ForegroundColor DarkGray
  Expand-Archive -Path $selected.FullName -DestinationPath $tempExtract -Force -WhatIf:$false

  # Find the JSON files (may be in a subdirectory like 'instructions/')
  $jsonFiles = Get-ChildItem -Path $tempExtract -Filter '*.json' -Recurse -File
  if (-not $jsonFiles) { throw 'Backup zip contains no JSON files.' }

  # Use the directory containing the most JSON files
  $sourceDir = ($jsonFiles | Group-Object DirectoryName | Sort-Object Count -Descending | Select-Object -First 1).Name
} else {
  $sourceDir = $selected.FullName
}

$files = Get-ChildItem -Path $sourceDir -Filter '*.json' -File -ErrorAction SilentlyContinue
if (-not $files) { throw 'Backup contains no JSON files.' }

Write-Host "[restore] Found $($files.Count) JSON files in backup" -ForegroundColor Cyan

$restored = 0
$skipped = 0
foreach ($f in $files) {
  $target = Join-Path $instructionsDir $f.Name
  if ((Test-Path $target) -and -not $Force) {
    $skipped++
    continue
  }
  if ($PSCmdlet.ShouldProcess($f.Name, "Restore to $instructionsDir")) {
    Copy-Item $f.FullName $target -Force
    $restored++
  }
}

Write-Host "[restore] Restored=$restored Skipped=$skipped Target=$instructionsDir" -ForegroundColor Green

# Cleanup temp extraction
if ($tempExtract -and (Test-Path $tempExtract)) {
  Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "[restore] Cleaned up temp directory" -ForegroundColor DarkGray
}
