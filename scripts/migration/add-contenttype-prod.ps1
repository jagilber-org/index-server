#!/usr/bin/env pwsh
# Script to add contentType field to all production instructions

$localMachineRoot = Join-Path ([System.IO.Path]::GetPathRoot((Get-Location).Path)) 'mcp'
$prodRoot = if ($env:DEPLOY_PROD_PATH) { $env:DEPLOY_PROD_PATH } else { Join-Path $localMachineRoot 'index-server' }
$prodDir = Join-Path $prodRoot 'instructions'
if (-not (Test-Path $prodDir)) {
    Write-Error "Production instructions directory not found: $prodDir"
    exit 1
}

$files = Get-ChildItem -Path $prodDir -Filter "*.json" | Where-Object { $_.Name -notmatch '^_' }
$updated = 0
$skipped = 0

foreach ($file in $files) {
    try {
        $content = Get-Content -Path $file.FullName -Raw
        $json = $content | ConvertFrom-Json

        $needsUpdate = $false

        # Add contentType if missing or empty
        if (-not $json.PSObject.Properties['contentType'] -or [string]::IsNullOrEmpty($json.contentType)) {
            $json | Add-Member -NotePropertyName 'contentType' -NotePropertyValue 'instruction' -Force
            $needsUpdate = $true
        }

        # Ensure other required fields have defaults
        if (-not $json.PSObject.Properties['categories']) {
            $json | Add-Member -NotePropertyName 'categories' -NotePropertyValue @() -Force
            $needsUpdate = $true
        }
        if (-not $json.PSObject.Properties['priority']) {
            $json | Add-Member -NotePropertyName 'priority' -NotePropertyValue 50 -Force
            $needsUpdate = $true
        }
        if (-not $json.PSObject.Properties['audience']) {
            $json | Add-Member -NotePropertyName 'audience' -NotePropertyValue 'all' -Force
            $needsUpdate = $true
        }
        if (-not $json.PSObject.Properties['requirement']) {
            $json | Add-Member -NotePropertyName 'requirement' -NotePropertyValue 'optional' -Force
            $needsUpdate = $true
        }

        if ($needsUpdate) {
            # Update or add timestamp
            if (-not $json.PSObject.Properties['updatedAt']) {
                $json | Add-Member -NotePropertyName 'updatedAt' -NotePropertyValue (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") -Force
            } else {
                $json.updatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            }

            # Write back to file with proper formatting
            $json | ConvertTo-Json -Depth 100 | Set-Content -Path $file.FullName -Encoding UTF8
            Write-Host "Updated: $($file.Name)" -ForegroundColor Green
            $updated++
        } else {
            Write-Host "Skipped: $($file.Name) (already has contentType)" -ForegroundColor Gray
            $skipped++
        }
    } catch {
        Write-Warning "Failed to process $($file.Name): $_"
    }
}

Write-Host "`nSummary:" -ForegroundColor Cyan
Write-Host "  Updated: $updated files"
Write-Host "  Skipped: $skipped files"
Write-Host "  Total:   $($files.Count) files"
