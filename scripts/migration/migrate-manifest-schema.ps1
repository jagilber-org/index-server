<#
.SYNOPSIS
    Migrate a template-manifest.json from schemaVersion 1 to schemaVersion 2.

.DESCRIPTION
    Reads a schemaVersion 1 template-manifest.json where managedFiles is an
    array of objects (each with a 'path' property and optional metadata), and
    converts it to schemaVersion 2 where managedFiles is an object map keyed
    by file path.

    Compare-TemplateSpec.ps1 uses its own internal file definitions rather than
    reading managedFiles from the manifest, so adopter repos do not strictly
    need schemaVersion 2 to function. This script is provided as a convenience
    for repos that want to align their manifest structure with the canonical
    template.

.PARAMETER Path
    Path to the template-manifest.json file to migrate. Defaults to
    template-manifest.json in the current directory.

.PARAMETER WhatIf
    Preview the migration without writing changes to disk.

.EXAMPLE
    pwsh -File scripts/migrate-manifest-schema.ps1

.EXAMPLE
    pwsh -File scripts/migrate-manifest-schema.ps1 -Path C:\repos\my-app\template-manifest.json

.EXAMPLE
    pwsh -File scripts/migrate-manifest-schema.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Path = (Join-Path $PWD 'template-manifest.json')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Path)) {
    Write-Host "ERROR: Manifest not found: $Path" -ForegroundColor Red
    exit 1
}

$resolvedPath = (Resolve-Path $Path).Path
$raw = Get-Content -Raw -Path $resolvedPath
$manifest = $raw | ConvertFrom-Json

# Validate current schema version
if ($null -eq $manifest.schemaVersion) {
    if ($null -eq $manifest.templateVersion) {
        Write-Host "ERROR: Manifest has neither schemaVersion nor templateVersion — cannot determine format." -ForegroundColor Red
        exit 1
    }
    Write-Host 'No schemaVersion field found — treating as schemaVersion 1.' -ForegroundColor Yellow
    $currentVersion = 1
}
else {
    $currentVersion = [int]$manifest.schemaVersion
}

if ($currentVersion -ge 2) {
    Write-Host "Manifest is already at schemaVersion $currentVersion — no migration needed." -ForegroundColor Green
    exit 0
}

# Validate managedFiles is an array (schemaVersion 1 format)
if ($null -eq $manifest.managedFiles) {
    Write-Host 'ERROR: Manifest has no managedFiles field — nothing to migrate.' -ForegroundColor Red
    exit 1
}

if ($manifest.managedFiles -isnot [array]) {
    Write-Host 'ERROR: managedFiles is not an array — unexpected format for schemaVersion 1.' -ForegroundColor Red
    exit 1
}

# Build the object map from the array
$managedFilesMap = [ordered]@{}
foreach ($entry in $manifest.managedFiles) {
    # Each array entry should have a 'path' property at minimum
    $filePath = $null
    if ($entry.path) {
        $filePath = $entry.path
    }
    elseif ($entry.PSObject.Properties.Name -contains 'file') {
        $filePath = $entry.file
    }
    else {
        Write-Host "ERROR: Array entry has no 'path' or 'file' property — cannot determine file path: $($entry | ConvertTo-Json -Compress)" -ForegroundColor Red
        exit 1
    }

    if (-not $filePath) {
        Write-Host "ERROR: Array entry has no identifiable path: $($entry | ConvertTo-Json -Compress)" -ForegroundColor Red
        exit 1
    }

    # Build the value object with all properties except the path key
    $valueObj = [ordered]@{}
    foreach ($prop in $entry.PSObject.Properties) {
        if ($prop.Name -in @('path', 'file')) { continue }
        $valueObj[$prop.Name] = $prop.Value
    }

    # Ensure at least a strategy field exists
    if (-not $valueObj.Contains('strategy') -and -not $valueObj.Contains('Strategy')) {
        $valueObj['strategy'] = 'MergeReview'
        Write-Warning "No strategy found for '$filePath' — defaulting to MergeReview."
    }

    $managedFilesMap[$filePath] = [pscustomobject]$valueObj
}

$migratedCount = $managedFilesMap.Count
Write-Host "Migrating $migratedCount managed file entries from array to object map." -ForegroundColor Cyan

# Build the output manifest preserving field order
$output = [ordered]@{}
foreach ($prop in $manifest.PSObject.Properties) {
    if ($prop.Name -eq 'schemaVersion') {
        $output['schemaVersion'] = 2
    }
    elseif ($prop.Name -eq 'managedFiles') {
        $output['managedFiles'] = $managedFilesMap
    }
    else {
        $output[$prop.Name] = $prop.Value
    }
}

# Ensure schemaVersion is present even if it was missing in v1
if (-not $output.Contains('schemaVersion')) {
    # Insert after templateVersion if possible
    $ordered = [ordered]@{}
    foreach ($key in $output.Keys) {
        $ordered[$key] = $output[$key]
        if ($key -eq 'templateVersion') {
            $ordered['schemaVersion'] = 2
        }
    }
    $output = $ordered
}

$json = $output | ConvertTo-Json -Depth 10

if ($PSCmdlet.ShouldProcess($resolvedPath, 'Write migrated schemaVersion 2 manifest')) {
    # Create a backup before overwriting
    $backupPath = "$resolvedPath.bak"
    Copy-Item -Path $resolvedPath -Destination $backupPath -Force
    Write-Host "Backup saved to: $backupPath" -ForegroundColor DarkGray
    Set-Content -Path $resolvedPath -Value $json -Encoding utf8
    Write-Host "Migration complete — wrote schemaVersion 2 manifest to: $resolvedPath" -ForegroundColor Green
}
else {
    Write-Host "`n--- Preview of migrated manifest ---" -ForegroundColor Yellow
    Write-Host $json
    Write-Host "--- End preview ---`n" -ForegroundColor Yellow
    Write-Host "No changes written. Remove -WhatIf to apply the migration." -ForegroundColor Cyan
}
