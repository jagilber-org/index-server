#!/usr/bin/env pwsh
# Test script to verify contentType migration logic

$testFile = "C:\mcp\index-server-prod\instructions\test-contenttype-migration-temp.json"

# Create test instruction without contentType
$testInstruction = @{
    id = "test-migration-temp"
    title = "Test Migration"
    body = "Testing contentType migration"
    priority = 50
    audience = "all"
    requirement = "optional"
    categories = @("test")
    sourceHash = "0000000000000000000000000000000000000000000000000000000000000000"
    schemaVersion = "3"
    createdAt = "2026-01-27T00:00:00.000Z"
    updatedAt = "2026-01-27T00:00:00.000Z"
}

Write-Host "Creating test instruction without contentType..." -ForegroundColor Cyan
$testInstruction | ConvertTo-Json -Depth 10 | Out-File -FilePath $testFile -Encoding UTF8

# Load migration function from built code
Write-Host "Loading migration function..." -ForegroundColor Cyan
$migrationCode = Get-Content "C:\mcp\index-server-prod\dist\versioning\schemaVersion.js" -Raw

# Read back and verify
$json = Get-Content $testFile -Raw | ConvertFrom-Json
Write-Host "`nBefore migration:" -ForegroundColor Yellow
Write-Host "  Has contentType: $($json.PSObject.Properties.Name -contains 'contentType')"
Write-Host "  Has categories: $($json.PSObject.Properties.Name -contains 'categories')"
Write-Host "  Has priority: $($json.PSObject.Properties.Name -contains 'priority')"

# Test using Node.js directly
Write-Host "`nTesting migration using Node.js..." -ForegroundColor Cyan
$nodeTest = @"
const fs = require('fs');
const { migrateInstructionRecord } = require('C:/mcp/index-server-prod/dist/versioning/schemaVersion.js');
const data = JSON.parse(fs.readFileSync('$($testFile.Replace('\','\\'))', 'utf8'));
const result = migrateInstructionRecord(data);
console.log('Migration result:', JSON.stringify(result, null, 2));
console.log('Has contentType:', 'contentType' in data);
console.log('contentType value:', data.contentType);
fs.writeFileSync('$($testFile.Replace('\','\\'))', JSON.stringify(data, null, 2));
"@

$nodeTest | Out-File -FilePath "$env:TEMP\test-migration.js" -Encoding UTF8
node "$env:TEMP\test-migration.js"

# Verify after migration
$jsonAfter = Get-Content $testFile -Raw | ConvertFrom-Json
Write-Host "`nAfter migration:" -ForegroundColor Green
Write-Host "  Has contentType: $($jsonAfter.PSObject.Properties.Name -contains 'contentType')"
Write-Host "  contentType value: '$($jsonAfter.contentType)'"
Write-Host "  Has categories: $($jsonAfter.PSObject.Properties.Name -contains 'categories')"
Write-Host "  Has priority: $($jsonAfter.PSObject.Properties.Name -contains 'priority')"

# Cleanup
Remove-Item $testFile -Force -ErrorAction SilentlyContinue
Remove-Item "$env:TEMP\test-migration.js" -Force -ErrorAction SilentlyContinue

Write-Host "`n✅ Test completed!" -ForegroundColor Green
