<#
.SYNOPSIS
  Adhoc test for Index Server backup/export/import/restore lifecycle.

.DESCRIPTION
  Exercises the dashboard admin maintenance REST endpoints:
    - POST   /api/admin/maintenance/backup          (create)
    - GET    /api/admin/maintenance/backups          (list)
    - GET    /api/admin/maintenance/backup/:id/export (download zip)
    - POST   /api/admin/maintenance/backup/import    (upload zip or JSON)
    - POST   /api/admin/maintenance/restore          (restore by ID)
    - DELETE /api/admin/maintenance/backup/:id       (delete)
    - POST   /api/admin/maintenance/backups/prune    (retain newest N)

  The script seeds test instructions, performs a full backup lifecycle, and
  validates each step with response validators from crud-response-validation.ps1.

  Prerequisites:
    - A running Index Server with dashboard (default: http://localhost:4600)
    - scripts/client/index-server-client.ps1 for CRUD seeding
    - PowerShell 7+ recommended

.PARAMETER BaseUrl
  Dashboard/server URL (default: $env:INDEX_SERVER_URL or http://localhost:4600)

.PARAMETER SeedCount
  Number of test instructions to create for backup testing (default: 5)

.PARAMETER Prefix
  ID prefix for test instructions (default: backup-test)

.PARAMETER SkipCertCheck
  Skip TLS certificate validation

.PARAMETER AdminKey
  Bearer token for admin endpoints (default: $env:INDEX_SERVER_ADMIN_API_KEY)

.PARAMETER CleanupOnly
  Only remove leftover test instructions and backups

.EXAMPLE
  .\stress-test-backup.ps1
  .\stress-test-backup.ps1 -BaseUrl https://localhost:8687 -SkipCertCheck
  .\stress-test-backup.ps1 -SeedCount 10 -AdminKey my-secret
  .\stress-test-backup.ps1 -CleanupOnly
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = ($env:INDEX_SERVER_URL ?? 'http://localhost:4600'),
    [int]$SeedCount = 5,
    [string]$Prefix = 'backup-test',
    [switch]$SkipCertCheck,
    [string]$AdminKey = $env:INDEX_SERVER_ADMIN_API_KEY,
    [switch]$CleanupOnly
)

$ErrorActionPreference = 'Continue'
$scriptDir = $PSScriptRoot
$client = Join-Path $scriptDir '..\client\index-server-client.ps1'
$validation = Join-Path $scriptDir '..\testing\crud-response-validation.ps1'

if (-not (Test-Path $client)) {
    Write-Error "Client script not found: $client"
    exit 1
}
if (-not (Test-Path $validation)) {
    Write-Error "Validation helper not found: $validation"
    exit 1
}
. $validation

$BaseUrl = $BaseUrl.TrimEnd('/')
$commonArgs = @{ BaseUrl = $BaseUrl }
if ($SkipCertCheck) { $commonArgs['SkipCertCheck'] = $true }
if ($AdminKey) { $commonArgs['AdminKey'] = $AdminKey }

# ── Helpers ──────────────────────────────────────────────────────────────

function Invoke-Client {
    param([hashtable]$Params)
    $merged = $commonArgs.Clone()
    foreach ($k in $Params.Keys) { $merged[$k] = $Params[$k] }
    ConvertFrom-ClientOutput (& $client @merged 2>&1)
}

function Invoke-Admin {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body,
        [int]$TimeoutSec = 60
    )
    $url = "$BaseUrl/api$Path"
    $splat = @{ Uri = $url; Method = $Method; TimeoutSec = $TimeoutSec }
    if ($SkipCertCheck -and $PSVersionTable.PSVersion.Major -ge 7) {
        $splat['SkipCertificateCheck'] = $true
    }
    $headers = @{}
    if ($AdminKey) { $headers['Authorization'] = "Bearer $AdminKey" }
    if ($Body -and $Method -in @('POST','PUT','PATCH')) {
        $splat['ContentType'] = 'application/json'
        $splat['Body'] = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }
    if ($headers.Count -gt 0) { $splat['Headers'] = $headers }
    try {
        $resp = Invoke-RestMethod @splat
        return $resp
    } catch {
        $msg = $_.Exception.Message
        try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch {}
        return [PSCustomObject]@{ success = $false; error = $msg }
    }
}

function Invoke-AdminRaw {
    param(
        [string]$Method,
        [string]$Path,
        [byte[]]$RawBody,
        [string]$ContentType = 'application/zip',
        [string]$Query = '',
        [int]$TimeoutSec = 120
    )
    $url = "$BaseUrl/api$Path"
    if ($Query) { $url += "?$Query" }
    $splat = @{
        Uri         = $url
        Method      = $Method
        TimeoutSec  = $TimeoutSec
        ContentType = $ContentType
        Body        = $RawBody
    }
    if ($SkipCertCheck -and $PSVersionTable.PSVersion.Major -ge 7) {
        $splat['SkipCertificateCheck'] = $true
    }
    $headers = @{}
    if ($AdminKey) { $headers['Authorization'] = "Bearer $AdminKey" }
    if ($headers.Count -gt 0) { $splat['Headers'] = $headers }
    try {
        $resp = Invoke-RestMethod @splat
        return $resp
    } catch {
        $msg = $_.Exception.Message
        try { $msg = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch {}
        return [PSCustomObject]@{ success = $false; error = $msg }
    }
}

function Invoke-AdminDownload {
    param(
        [string]$Path,
        [string]$OutFile,
        [int]$TimeoutSec = 60
    )
    $url = "$BaseUrl/api$Path"
    $splat = @{ Uri = $url; Method = 'GET'; OutFile = $OutFile; TimeoutSec = $TimeoutSec }
    if ($SkipCertCheck -and $PSVersionTable.PSVersion.Major -ge 7) {
        $splat['SkipCertificateCheck'] = $true
    }
    $headers = @{}
    if ($AdminKey) { $headers['Authorization'] = "Bearer $AdminKey" }
    if ($headers.Count -gt 0) { $splat['Headers'] = $headers }
    try {
        Invoke-WebRequest @splat -ErrorAction Stop | Out-Null
        return $true
    } catch {
        Write-Warning "Download failed: $($_.Exception.Message)"
        return $false
    }
}

function Add-Errors {
    param(
        [ref]$Errors,
        [string]$Operation,
        [string[]]$ValidationErrors
    )
    foreach ($e in @($ValidationErrors)) {
        $Errors.Value += "${Operation}: $e"
    }
}

# ── Stats ────────────────────────────────────────────────────────────────
$stats = @{
    TotalOps  = 0
    Succeeded = 0
    Failed    = 0
    Errors    = [System.Collections.ArrayList]::new()
}
$createdBackupIds = [System.Collections.ArrayList]::new()

function Record-Op {
    param(
        [string]$Phase,
        [string[]]$ValidationErrors = @()
    )
    $stats.TotalOps++
    if ($ValidationErrors.Count -eq 0) {
        $stats.Succeeded++
    } else {
        $stats.Failed++
        foreach ($e in $ValidationErrors) {
            [void]$stats.Errors.Add("[$Phase] $e")
        }
    }
}

# ── Pre-flight ───────────────────────────────────────────────────────────
Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "║  Index Server Backup Lifecycle Test                         ║" -ForegroundColor Yellow
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host "  Target:     $BaseUrl"
Write-Host "  SeedCount:  $SeedCount"
Write-Host "  Prefix:     $Prefix"
Write-Host "  Auth:       $(if ($AdminKey) { 'Bearer token' } else { 'none' })"
Write-Host ""

Write-Host "── Pre-flight health check ──" -ForegroundColor Green
$health = Invoke-Client @{ Action = 'health' }
$healthErrors = @(Test-HealthResponse -Response $health)
if ($healthErrors.Count -gt 0) {
    Write-Error "Health check failed: $($healthErrors -join '; ')"
    exit 1
}
Write-Host "  Server is healthy" -ForegroundColor Green
Write-Host ""

# ── Cleanup mode ─────────────────────────────────────────────────────────
if ($CleanupOnly) {
    Write-Host "── Cleanup mode ──" -ForegroundColor Yellow

    # Remove test instructions
    $list = Invoke-Client @{ Action = 'search'; Keywords = @($Prefix); Limit = 500 }
    $ids = @()
    $rawResults = Get-ObjectProperty (Get-ClientResult $list) 'results'
    if ($rawResults) {
        $ids = @($rawResults) | ForEach-Object {
            $candidate = Get-ObjectProperty $_ 'instructionId'
            if (-not $candidate) { $candidate = Get-ObjectProperty $_ 'id' }
            $candidate
        } | Where-Object { $_ -like "$Prefix-*" }
    }
    foreach ($id in $ids) {
        Invoke-Client @{ Action = 'remove'; Id = $id } | Out-Null
        Write-Host "  Removed instruction: $id"
    }

    # Prune test backups
    $backups = Invoke-Admin -Method GET -Path '/admin/maintenance/backups'
    $rawBackups = Get-ObjectProperty $backups 'backups'
    if ($rawBackups) {
        foreach ($b in @($rawBackups)) {
            $bid = Get-ObjectProperty $b 'id'
            if ($bid -like "backup_*") {
                Invoke-Admin -Method DELETE -Path "/admin/maintenance/backup/$bid" | Out-Null
                Write-Host "  Removed backup: $bid"
            }
        }
    }
    Write-Host "Cleanup done." -ForegroundColor Green
    exit 0
}

# ── Phase 1: Seed test instructions ──────────────────────────────────────
Write-Host "── Phase 1: Seed $SeedCount test instructions ──" -ForegroundColor Cyan
$seedIds = @()
for ($i = 1; $i -le $SeedCount; $i++) {
    $id = "$Prefix-$('{0:D4}' -f $i)"
    $seedIds += $id
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $addResult = Invoke-Client @{
        Action = 'add'
        Id     = $id
        Title  = "Backup Test Instruction $i"
        Body   = "This is backup test instruction $id. Created at $(Get-Date -Format o). Content for backup lifecycle validation."
    }
    $sw.Stop()
    $addErrors = @(Test-AddResponse -Response $addResult -Id $id -ExpectedMutation createdOrOverwritten)
    Record-Op "SEED" $addErrors
    $status = if ($addErrors.Count -eq 0) { 'OK' } else { 'FAIL' }
    $color = if ($status -eq 'OK') { 'Green' } else { 'Red' }
    Write-Host ("  [{0}/{1}] {2} {3} ({4}ms)" -f $i, $SeedCount, $status, $id, $sw.ElapsedMilliseconds) -ForegroundColor $color
}
Write-Host ""

# ── Phase 2: Create backup ──────────────────────────────────────────────
Write-Host "── Phase 2: Create backup ──" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$backupResult = Invoke-Admin -Method POST -Path '/admin/maintenance/backup'
$sw.Stop()
$backupErrors = @(Test-BackupCreateResponse -Response $backupResult)
Record-Op "BACKUP_CREATE" $backupErrors
$mainBackupId = Get-ObjectProperty $backupResult 'backupId'
if ($mainBackupId) { [void]$createdBackupIds.Add($mainBackupId) }
if ($backupErrors.Count -eq 0) {
    Write-Host ("  OK: backupId={0} ({1}ms)" -f $mainBackupId, $sw.ElapsedMilliseconds) -ForegroundColor Green
} else {
    Write-Host ("  FAIL: {0}" -f ($backupErrors -join '; ')) -ForegroundColor Red
}
Write-Host ""

# ── Phase 3: List backups ───────────────────────────────────────────────
Write-Host "── Phase 3: List backups ──" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$listResult = Invoke-Admin -Method GET -Path '/admin/maintenance/backups'
$sw.Stop()
$listErrors = @(Test-BackupListResponse -Response $listResult -ExpectBackupId $mainBackupId)
Record-Op "BACKUP_LIST" $listErrors
$backupCount = Get-ObjectProperty $listResult 'count'
if ($listErrors.Count -eq 0) {
    Write-Host ("  OK: {0} backup(s), includes {1} ({2}ms)" -f $backupCount, $mainBackupId, $sw.ElapsedMilliseconds) -ForegroundColor Green
} else {
    Write-Host ("  FAIL: {0}" -f ($listErrors -join '; ')) -ForegroundColor Red
}
Write-Host ""

# ── Phase 4: Export backup as zip ────────────────────────────────────────
Write-Host "── Phase 4: Export backup ──" -ForegroundColor Cyan
$exportErrors = @()
$exportFile = Join-Path ([System.IO.Path]::GetTempPath()) "$mainBackupId-export.zip"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$downloaded = Invoke-AdminDownload -Path "/admin/maintenance/backup/$mainBackupId/export" -OutFile $exportFile
$sw.Stop()
if ($downloaded -and (Test-Path $exportFile)) {
    $zipSize = (Get-Item $exportFile).Length
    if ($zipSize -lt 100) {
        $exportErrors += "Exported zip is suspiciously small ($zipSize bytes)"
    } else {
        Write-Host ("  OK: exported {0} ({1:N0} bytes, {2}ms)" -f $mainBackupId, $zipSize, $sw.ElapsedMilliseconds) -ForegroundColor Green
    }
} else {
    $exportErrors += "Failed to download backup zip"
}
Record-Op "BACKUP_EXPORT" $exportErrors
if ($exportErrors.Count -gt 0) {
    Write-Host ("  FAIL: {0}" -f ($exportErrors -join '; ')) -ForegroundColor Red
}
Write-Host ""

# ── Phase 5: Delete seed instructions (simulate data loss) ──────────────
Write-Host "── Phase 5: Delete seed instructions (simulate data loss) ──" -ForegroundColor Cyan
$deleteCount = 0
foreach ($id in $seedIds) {
    $removeResult = Invoke-Client @{ Action = 'remove'; Id = $id }
    $removeErrors = @(Test-RemoveResponse -Response $removeResult -Id $id)
    Record-Op "DELETE_SEED" $removeErrors
    if ($removeErrors.Count -eq 0) { $deleteCount++ }
}
Write-Host "  Deleted $deleteCount / $SeedCount seed instructions" -ForegroundColor $(if ($deleteCount -eq $SeedCount) { 'Green' } else { 'Yellow' })

# Verify they are gone
$verifyGoneCount = 0
foreach ($id in ($seedIds | Get-Random -Count ([Math]::Min(3, $SeedCount)))) {
    $getResult = Invoke-Client @{ Action = 'get'; Id = $id }
    $goneErrors = @(Test-DeletedResponse -Response $getResult -Id $id)
    if ($goneErrors.Count -eq 0) { $verifyGoneCount++ }
}
Write-Host "  Verified $verifyGoneCount sample(s) are gone" -ForegroundColor Green
Write-Host ""

# ── Phase 6: Import exported zip ─────────────────────────────────────────
Write-Host "── Phase 6: Import backup zip ──" -ForegroundColor Cyan
$importErrors = @()
if (-not (Test-Path $exportFile)) {
    $importErrors += "Export file not found — skipping import"
    Record-Op "BACKUP_IMPORT" $importErrors
    Write-Host ("  SKIP: {0}" -f ($importErrors -join '; ')) -ForegroundColor Yellow
} else {
    $zipBytes = [System.IO.File]::ReadAllBytes($exportFile)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $importResult = Invoke-AdminRaw -Method POST -Path '/admin/maintenance/backup/import' -RawBody $zipBytes
    $sw.Stop()
    $importErrors = @(Test-BackupImportResponse -Response $importResult)
    Record-Op "BACKUP_IMPORT" $importErrors
    $importedBackupId = Get-ObjectProperty $importResult 'backupId'
    if ($importedBackupId) { [void]$createdBackupIds.Add($importedBackupId) }
    if ($importErrors.Count -eq 0) {
        Write-Host ("  OK: imported as {0}, files={1} ({2}ms)" -f $importedBackupId, (Get-ObjectProperty $importResult 'files'), $sw.ElapsedMilliseconds) -ForegroundColor Green
    } else {
        Write-Host ("  FAIL: {0}" -f ($importErrors -join '; ')) -ForegroundColor Red
    }
}
Write-Host ""

# ── Phase 7: Restore imported backup ────────────────────────────────────
Write-Host "── Phase 7: Restore imported backup ──" -ForegroundColor Cyan
if ($importedBackupId) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $restoreResult = Invoke-Admin -Method POST -Path '/admin/maintenance/restore' -Body @{ backupId = $importedBackupId }
    $sw.Stop()
    $restoreErrors = @(Test-BackupRestoreResponse -Response $restoreResult -MinRestored $SeedCount)
    Record-Op "BACKUP_RESTORE" $restoreErrors
    if ($restoreErrors.Count -eq 0) {
        Write-Host ("  OK: restored {0} files ({1}ms)" -f (Get-ObjectProperty $restoreResult 'restored'), $sw.ElapsedMilliseconds) -ForegroundColor Green
    } else {
        Write-Host ("  FAIL: {0}" -f ($restoreErrors -join '; ')) -ForegroundColor Red
    }

    # Verify seeds are back
    Start-Sleep -Seconds 1
    $verifyRestoreCount = 0
    foreach ($id in ($seedIds | Get-Random -Count ([Math]::Min(3, $SeedCount)))) {
        $getResult = Invoke-Client @{ Action = 'get'; Id = $id }
        $getErrors = @(Test-GetResponse -Response $getResult -Id $id -ExpectedBodyContains 'backup lifecycle validation')
        Record-Op "VERIFY_RESTORE" $getErrors
        if ($getErrors.Count -eq 0) { $verifyRestoreCount++ }
    }
    Write-Host "  Verified $verifyRestoreCount / $([Math]::Min(3, $SeedCount)) seed(s) restored" -ForegroundColor $(if ($verifyRestoreCount -gt 0) { 'Green' } else { 'Red' })
} else {
    Write-Host "  SKIP: no imported backup ID" -ForegroundColor Yellow
}
Write-Host ""

# ── Phase 8: Import-with-restore (one-click) ────────────────────────────
Write-Host "── Phase 8: Import-with-restore (?restore=1) ──" -ForegroundColor Cyan

# Seed a second unique dataset
$restorePrefix = "$Prefix-r2"
$seed2Ids = @()
for ($i = 1; $i -le ([Math]::Min(3, $SeedCount)); $i++) {
    $id = "$restorePrefix-$('{0:D4}' -f $i)"
    $seed2Ids += $id
    $addResult2 = Invoke-Client @{
        Action = 'add'
        Id     = $id
        Title  = "Import-Restore Test $i"
        Body   = "Import-restore test instruction $id for one-click backup validation."
    }
    $addErrors2 = @(Test-AddResponse -Response $addResult2 -Id $id -ExpectedMutation createdOrOverwritten)
    Record-Op "SEED2" $addErrors2
}

# Create backup, then delete seeds
$backup2 = Invoke-Admin -Method POST -Path '/admin/maintenance/backup'
$backup2Id = Get-ObjectProperty $backup2 'backupId'
if ($backup2Id) { [void]$createdBackupIds.Add($backup2Id) }

foreach ($id in $seed2Ids) {
    Invoke-Client @{ Action = 'remove'; Id = $id } | Out-Null
}

# Export and import-with-restore
if ($backup2Id) {
    $export2File = Join-Path ([System.IO.Path]::GetTempPath()) "$backup2Id-export.zip"
    $dl2 = Invoke-AdminDownload -Path "/admin/maintenance/backup/$backup2Id/export" -OutFile $export2File
    if ($dl2 -and (Test-Path $export2File)) {
        $zip2Bytes = [System.IO.File]::ReadAllBytes($export2File)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $importRestore = Invoke-AdminRaw -Method POST -Path '/admin/maintenance/backup/import' -RawBody $zip2Bytes -Query 'restore=1'
        $sw.Stop()
        $irErrors = @(Test-BackupImportResponse -Response $importRestore -ExpectRestore)
        Record-Op "IMPORT_RESTORE" $irErrors
        $irBackupId = Get-ObjectProperty $importRestore 'backupId'
        if ($irBackupId) { [void]$createdBackupIds.Add($irBackupId) }
        if ($irErrors.Count -eq 0) {
            Write-Host ("  OK: imported+restored as {0}, files={1}, restored={2} ({3}ms)" -f
                $irBackupId,
                (Get-ObjectProperty $importRestore 'files'),
                (Get-ObjectProperty $importRestore 'restored'),
                $sw.ElapsedMilliseconds) -ForegroundColor Green
        } else {
            Write-Host ("  FAIL: {0}" -f ($irErrors -join '; ')) -ForegroundColor Red
        }
        # cleanup temp
        if (Test-Path $export2File) { Remove-Item $export2File -Force }
    } else {
        Write-Host "  SKIP: export for import-restore failed" -ForegroundColor Yellow
    }
} else {
    Write-Host "  SKIP: backup2 creation failed" -ForegroundColor Yellow
}
Write-Host ""

# ── Phase 9: Prune backups ──────────────────────────────────────────────
Write-Host "── Phase 9: Prune backups (retain=1) ──" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$pruneResult = Invoke-Admin -Method POST -Path '/admin/maintenance/backups/prune' -Body @{ retain = 1 }
$sw.Stop()
$pruneErrors = @(Test-BackupPruneResponse -Response $pruneResult)
Record-Op "BACKUP_PRUNE" $pruneErrors
if ($pruneErrors.Count -eq 0) {
    Write-Host ("  OK: pruned {0} backup(s) ({1}ms)" -f (Get-ObjectProperty $pruneResult 'pruned'), $sw.ElapsedMilliseconds) -ForegroundColor Green
} else {
    Write-Host ("  FAIL: {0}" -f ($pruneErrors -join '; ')) -ForegroundColor Red
}
Write-Host ""

# ── Phase 10: Delete remaining test backup ──────────────────────────────
Write-Host "── Phase 10: Delete remaining backups ──" -ForegroundColor Cyan
$remainingBackups = Invoke-Admin -Method GET -Path '/admin/maintenance/backups'
$rawRemaining = Get-ObjectProperty $remainingBackups 'backups'
$deletedCount = 0
if ($rawRemaining) {
    foreach ($b in @($rawRemaining)) {
        $bid = Get-ObjectProperty $b 'id'
        if ($bid -and $createdBackupIds -contains $bid) {
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $delResult = Invoke-Admin -Method DELETE -Path "/admin/maintenance/backup/$bid"
            $sw.Stop()
            $delErrors = @(Test-BackupDeleteResponse -Response $delResult)
            Record-Op "BACKUP_DELETE" $delErrors
            if ($delErrors.Count -eq 0) {
                $deletedCount++
                Write-Host ("  Deleted {0} ({1}ms)" -f $bid, $sw.ElapsedMilliseconds) -ForegroundColor Green
            } else {
                Write-Host ("  FAIL deleting {0}: {1}" -f $bid, ($delErrors -join '; ')) -ForegroundColor Red
            }
        }
    }
}
if ($deletedCount -eq 0) {
    Write-Host "  No test backups remaining to delete" -ForegroundColor DarkGray
}
Write-Host ""

# ── Cleanup: Remove test instructions ────────────────────────────────────
Write-Host "── Cleanup: Remove test instructions ──" -ForegroundColor Cyan
$allTestIds = $seedIds + $seed2Ids
$cleanedCount = 0
foreach ($id in $allTestIds) {
    $removeResult = Invoke-Client @{ Action = 'remove'; Id = $id }
    # Ignore errors for already-deleted instructions
    $cleanedCount++
}
Write-Host "  Cleaned up $cleanedCount instruction ID(s)" -ForegroundColor Green

# Cleanup temp files
if (Test-Path $exportFile) { Remove-Item $exportFile -Force }

# ── Post-flight health check ────────────────────────────────────────────
Write-Host ""
Write-Host "── Post-flight health check ──" -ForegroundColor Green
$postHealth = Invoke-Client @{ Action = 'health' }
$postHealthErrors = @(Test-HealthResponse -Response $postHealth)
Record-Op "POST_HEALTH" $postHealthErrors
if ($postHealthErrors.Count -gt 0) {
    Write-Host ("  FAIL: {0}" -f ($postHealthErrors -join '; ')) -ForegroundColor Red
} else {
    Write-Host "  Server is healthy" -ForegroundColor Green
}

# ── Summary ──────────────────────────────────────────────────────────────
Write-Host "`n╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Yellow
Write-Host "║  Results                                                    ║" -ForegroundColor Yellow
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Yellow
Write-Host ("  Total operations:  {0}" -f $stats.TotalOps)
Write-Host ("  Succeeded:         {0}" -f $stats.Succeeded) -ForegroundColor Green
Write-Host ("  Failed:            {0}" -f $stats.Failed) -ForegroundColor $(if ($stats.Failed -gt 0) { 'Red' } else { 'Green' })
Write-Host ("  Success rate:      {0:P1}" -f $(if ($stats.TotalOps -gt 0) { $stats.Succeeded / $stats.TotalOps } else { 0 }))

if ($stats.Errors.Count -gt 0) {
    Write-Host "`n── Errors ──" -ForegroundColor Red
    $stats.Errors | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
}

Write-Host ""
if ($stats.Failed -gt 0) {
    exit 1
}
Write-Host "All backup lifecycle tests passed." -ForegroundColor Green
exit 0
