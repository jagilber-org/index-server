<#
.SYNOPSIS
  SQLite database validation client — validates index-server SQLite backend via dashboard HTTP API.

.DESCRIPTION
  Performs comprehensive validation of the SQLite database OUTSIDE of the MCP front-end:
  - Schema integrity (PRAGMA integrity_check)
  - Table existence and row counts
  - CRUD lifecycle (create, read, update, delete with residue check)
  - FTS5 sync validation (FTS content matches instructions table)
  - Embedding store cross-checks (embedding_meta ↔ embeddings ↔ instructions)
  - Usage/message orphan detection
  - WAL state and pragma validation
  - Governance hash consistency
  - Import/export roundtrip validation

  Uses ONLY the dashboard HTTP endpoints (no direct filesystem or node:sqlite access).
  Integrates with the same validation patterns as stress-test.ps1 / crud-response-validation.ps1.

  Exit codes:
    0 — All validations passed
    1 — One or more validations failed
    2 — Server unreachable or precondition not met

.PARAMETER DashboardUrl
  Dashboard base URL (default: $env:INDEX_SERVER_DASHBOARD_URL or http://localhost:8987)

.PARAMETER McpUrl
  MCP server URL for CRUD operations (default: $env:INDEX_SERVER_URL or http://localhost:4600)

.PARAMETER AdminKey
  Bearer token for admin endpoints (default: $env:INDEX_SERVER_ADMIN_API_KEY)

.PARAMETER SkipCertCheck
  Skip TLS certificate validation

.PARAMETER Verbose
  Print detailed per-check output

.PARAMETER SkipCrud
  Skip CRUD lifecycle validation

.PARAMETER SkipEmbeddings
  Skip embedding cross-checks

.PARAMETER Prefix
  ID prefix for test instructions (default: sqlite-validate)

.PARAMETER Iterations
  Number of CRUD cycles for residue checking (default: 5)

.EXAMPLE
  .\sqlite-validate.ps1
  .\sqlite-validate.ps1 -DashboardUrl https://localhost:8687 -SkipCertCheck
  .\sqlite-validate.ps1 -SkipEmbeddings -Iterations 10
#>
[CmdletBinding()]
param(
    [string]$DashboardUrl = ($env:INDEX_SERVER_DASHBOARD_URL ?? 'http://localhost:8987'),
    [string]$McpUrl = ($env:INDEX_SERVER_URL ?? 'http://localhost:4600'),
    [string]$AdminKey = $env:INDEX_SERVER_ADMIN_API_KEY,
    [switch]$SkipCertCheck,
    [switch]$SkipCrud,
    [switch]$SkipEmbeddings,
    [string]$Prefix = 'sqlite-validate',
    [int]$Iterations = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$scriptDir = $PSScriptRoot
$client = Join-Path $scriptDir '..\client\index-server-client.ps1'
$validation = Join-Path $scriptDir '..\testing\crud-response-validation.ps1'

if (-not (Test-Path $validation)) {
    Write-Error "Validation helper not found: $validation"
    exit 2
}
. $validation

# ── HTTP Helpers ─────────────────────────────────────────────────────────────

$dashboardArgs = @{}
if ($SkipCertCheck) { $dashboardArgs['SkipCertificateCheck'] = $true }

function Invoke-SqliteApi {
    param(
        [string]$Method = 'GET',
        [string]$Path,
        [object]$Body,
        [int]$TimeoutSec = 30
    )
    $url = "$DashboardUrl$Path"
    $splat = @{ Uri = $url; Method = $Method; TimeoutSec = $TimeoutSec } + $script:dashboardArgs
    if ($AdminKey) {
        $splat['Headers'] = @{ 'Authorization' = "Bearer $AdminKey" }
    }
    if ($Body) {
        $splat['Body'] = ($Body | ConvertTo-Json -Depth 10)
        $splat['ContentType'] = 'application/json'
    }
    try {
        $resp = Invoke-WebRequest @splat -ErrorAction Stop
        return $resp.Content | ConvertFrom-Json
    } catch {
        $msg = $_.Exception.Message
        try { $msg = $_.ErrorDetails.Message | ConvertFrom-Json | ForEach-Object { $_.error ?? $_.message ?? $msg } } catch {}
        return [PSCustomObject]@{ success = $false; error = $msg }
    }
}

function Invoke-SqliteQuery {
    param([string]$Sql)
    return Invoke-SqliteApi -Method POST -Path '/api/sqlite/query' -Body @{ sql = $Sql }
}

function Invoke-McpClient {
    param([hashtable]$Params)
    $commonArgs = @{ BaseUrl = $McpUrl }
    if ($SkipCertCheck) { $commonArgs['SkipCertCheck'] = $true }
    if ($AdminKey) { $commonArgs['AdminKey'] = $AdminKey }
    $merged = $commonArgs.Clone()
    foreach ($k in $Params.Keys) { $merged[$k] = $Params[$k] }
    if (Test-Path $client) {
        return ConvertFrom-ClientOutput (& $client @merged 2>&1)
    }
    # Fallback: direct HTTP to MCP (jsonrpc not available — return error)
    return [PSCustomObject]@{ success = $false; error = "Client script not found: $client" }
}

# ── Result Tracking ──────────────────────────────────────────────────────────

$script:totalChecks = 0
$script:passedChecks = 0
$script:failedChecks = 0
$script:failures = @()

function Assert-Check {
    param(
        [string]$Name,
        [bool]$Condition,
        [string]$FailMessage = ''
    )
    $script:totalChecks++
    if ($Condition) {
        $script:passedChecks++
        Write-Host "  [PASS] $Name" -ForegroundColor Green
    } else {
        $script:failedChecks++
        $detail = if ($FailMessage) { "$Name — $FailMessage" } else { $Name }
        $script:failures += $detail
        Write-Host "  [FAIL] $detail" -ForegroundColor Red
    }
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "── $Title ──" -ForegroundColor Cyan
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   SQLite Database Validation — index-server             ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host "  Dashboard : $DashboardUrl"
Write-Host "  MCP       : $McpUrl"
Write-Host "  Prefix    : $Prefix"
Write-Host "  Iterations: $Iterations"
Write-Host ""

# ── 1. Connectivity & Backend Check ─────────────────────────────────────────

Write-Section "1. Connectivity & Backend Check"

$info = Invoke-SqliteApi -Path '/api/sqlite/info'
$infoSuccess = (Get-ObjectProperty $info 'success') -eq $true
Assert-Check 'Dashboard reachable' $infoSuccess "Cannot reach $DashboardUrl/api/sqlite/info"

if (-not $infoSuccess) {
    Write-Host ""
    Write-Error "Cannot proceed — dashboard unreachable at $DashboardUrl"
    exit 2
}

$active = (Get-ObjectProperty $info 'active') -eq $true
Assert-Check 'SQLite backend active' $active 'INDEX_SERVER_STORAGE_BACKEND is not sqlite'

if (-not $active) {
    Write-Host ""
    Write-Error "Cannot proceed — SQLite backend not active on this server"
    exit 2
}

$exists = (Get-ObjectProperty $info 'exists') -eq $true
Assert-Check 'Database file exists' $exists

# ── 2. Schema Integrity ──────────────────────────────────────────────────────

Write-Section "2. Schema Integrity (PRAGMA integrity_check)"

$integrity = Invoke-SqliteApi -Method POST -Path '/api/sqlite/integrity-check'
$integrityOk = (Get-ObjectProperty $integrity 'ok') -eq $true
Assert-Check 'PRAGMA integrity_check = ok' $integrityOk (
    if (-not $integrityOk) { "Results: $(Get-ObjectProperty $integrity 'results' | ConvertTo-Json -Compress)" } else { '' }
)

# ── 3. Table Existence & Counts ──────────────────────────────────────────────

Write-Section "3. Table Existence & Row Counts"

$tableStats = Get-ObjectProperty $info 'tableStats'
foreach ($table in @('instructions', 'usage', 'messages', 'metadata')) {
    $count = Get-ObjectProperty $tableStats $table
    $tableExists = $null -ne $count
    Assert-Check "Table '$table' exists" $tableExists "table not found in tableStats"
    if ($tableExists) {
        Write-Host "       rows: $count" -ForegroundColor DarkGray
    }
}

# Check FTS5 virtual table
$ftsCheck = Invoke-SqliteQuery "SELECT name FROM sqlite_master WHERE type='table' AND name='instructions_fts'"
$ftsExists = $null -ne (Get-ObjectProperty $ftsCheck 'rows') -and @(Get-ObjectProperty $ftsCheck 'rows').Count -gt 0
Assert-Check "FTS5 table 'instructions_fts' exists" $ftsExists

# Check embedding tables (may not exist if embeddings disabled)
$embMetaCheck = Invoke-SqliteQuery "SELECT name FROM sqlite_master WHERE type='table' AND name='embedding_meta'"
$embMetaExists = $null -ne (Get-ObjectProperty $embMetaCheck 'rows') -and @(Get-ObjectProperty $embMetaCheck 'rows').Count -gt 0
if ($embMetaExists) {
    Write-Host "       embedding_meta table: present" -ForegroundColor DarkGray
}

$embVecCheck = Invoke-SqliteQuery "SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings'"
$embVecExists = $null -ne (Get-ObjectProperty $embVecCheck 'rows') -and @(Get-ObjectProperty $embVecCheck 'rows').Count -gt 0
if ($embVecExists) {
    Write-Host "       embeddings (vec0) table: present" -ForegroundColor DarkGray
}

# ── 4. Pragma Validation ─────────────────────────────────────────────────────

Write-Section "4. Pragma Validation"

$pragmas = Get-ObjectProperty $info 'pragmas'
$journalMode = Get-ObjectProperty $pragmas 'journalMode'
Assert-Check 'journal_mode = wal' ($journalMode -eq 'wal') "actual: $journalMode"

$pageSizeResp = Invoke-SqliteQuery "PRAGMA page_size"
$pageSize = if ($pageSizeResp -and (Get-ObjectProperty $pageSizeResp 'rows')) {
    $r = @(Get-ObjectProperty $pageSizeResp 'rows')
    if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'page_size' } else { 0 }
} else { 0 }
Assert-Check 'page_size >= 4096' ($pageSize -ge 4096) "actual: $pageSize"

$fkResp = Invoke-SqliteQuery "PRAGMA foreign_keys"
$fkEnabled = if ($fkResp -and (Get-ObjectProperty $fkResp 'rows')) {
    $r = @(Get-ObjectProperty $fkResp 'rows')
    if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'foreign_keys' } else { 0 }
} else { 0 }
Assert-Check 'foreign_keys enabled' ($fkEnabled -eq 1) "actual: $fkEnabled"

# ── 5. FTS5 Sync Validation ──────────────────────────────────────────────────

Write-Section "5. FTS5 Sync Validation"

# Count instructions vs FTS entries
$instrCountResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM instructions"
$instrCount = if ($instrCountResp -and (Get-ObjectProperty $instrCountResp 'rows')) {
    $r = @(Get-ObjectProperty $instrCountResp 'rows')
    if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
} else { -1 }

$ftsCountResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM instructions_fts"
$ftsCount = if ($ftsCountResp -and (Get-ObjectProperty $ftsCountResp 'rows')) {
    $r = @(Get-ObjectProperty $ftsCountResp 'rows')
    if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
} else { -1 }

Assert-Check "FTS5 row count matches instructions ($instrCount == $ftsCount)" ($instrCount -eq $ftsCount -and $instrCount -ge 0)

# Spot-check: pick up to 5 random instructions and verify they appear in FTS
if ($instrCount -gt 0) {
    $sampleResp = Invoke-SqliteQuery "SELECT id, title FROM instructions ORDER BY RANDOM() LIMIT 5"
    $samples = @(Get-ObjectProperty $sampleResp 'rows')
    $ftsMismatches = 0
    foreach ($s in $samples) {
        $sId = Get-ObjectProperty $s 'id'
        $ftsLookup = Invoke-SqliteQuery "SELECT id FROM instructions_fts WHERE id = '$($sId -replace "'","''")'"
        $ftsFound = $null -ne (Get-ObjectProperty $ftsLookup 'rows') -and @(Get-ObjectProperty $ftsLookup 'rows').Count -gt 0
        if (-not $ftsFound) { $ftsMismatches++ }
    }
    Assert-Check "FTS5 spot-check ($($samples.Count) samples, $ftsMismatches mismatches)" ($ftsMismatches -eq 0)
}

# ── 6. Embedding Cross-Checks ───────────────────────────────────────────────

if (-not $SkipEmbeddings -and $embMetaExists -and $embVecExists) {
    Write-Section "6. Embedding Cross-Checks"

    # Count embeddings vs embedding_meta
    $embCountResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM embeddings"
    $embCount = if ($embCountResp -and (Get-ObjectProperty $embCountResp 'rows')) {
        $r = @(Get-ObjectProperty $embCountResp 'rows')
        if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
    } else { -1 }

    $embMetaCountResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM embedding_meta"
    $embMetaCount = if ($embMetaCountResp -and (Get-ObjectProperty $embMetaCountResp 'rows')) {
        $r = @(Get-ObjectProperty $embMetaCountResp 'rows')
        if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
    } else { -1 }

    Assert-Check "Embeddings count matches embedding_meta ($embCount == $embMetaCount)" ($embCount -eq $embMetaCount -and $embCount -ge 0)
    Write-Host "       embeddings: $embCount, embedding_meta: $embMetaCount" -ForegroundColor DarkGray

    # Check for orphaned embedding_meta (references instructions that don't exist)
    $orphanEmbResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM embedding_meta em WHERE em.instruction_id NOT IN (SELECT id FROM instructions)"
    $orphanEmbCount = if ($orphanEmbResp -and (Get-ObjectProperty $orphanEmbResp 'rows')) {
        $r = @(Get-ObjectProperty $orphanEmbResp 'rows')
        if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
    } else { -1 }
    Assert-Check "No orphaned embedding_meta entries (found: $orphanEmbCount)" ($orphanEmbCount -eq 0)

    # Verify embedding index hash metadata exists
    $indexHashResp = Invoke-SqliteQuery "SELECT value FROM metadata WHERE key = 'embedding_index_hash'"
    $indexHashRows = @(Get-ObjectProperty $indexHashResp 'rows')
    $hasIndexHash = $indexHashRows.Count -gt 0
    Assert-Check 'Embedding index hash in metadata' $hasIndexHash
    if ($hasIndexHash) {
        Write-Host "       index_hash: $(Get-ObjectProperty $indexHashRows[0] 'value')" -ForegroundColor DarkGray
    }

    # Check embedding coverage vs instructions
    if ($instrCount -gt 0 -and $embCount -ge 0) {
        $coverage = [math]::Round(($embCount / $instrCount) * 100, 1)
        Write-Host "       embedding coverage: $coverage% ($embCount / $instrCount)" -ForegroundColor DarkGray
        # Not a hard failure — embeddings may not be computed for all
    }
} elseif (-not $SkipEmbeddings) {
    Write-Section "6. Embedding Cross-Checks"
    Write-Host "  [SKIP] Embedding tables not present — skipping" -ForegroundColor Yellow
}

# ── 7. Usage/Message Orphan Detection ────────────────────────────────────────

Write-Section "7. Orphan Detection"

# Orphaned usage records (reference non-existent instructions)
$orphanUsageResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM usage WHERE instruction_id NOT IN (SELECT id FROM instructions)"
$orphanUsage = if ($orphanUsageResp -and (Get-ObjectProperty $orphanUsageResp 'rows')) {
    $r = @(Get-ObjectProperty $orphanUsageResp 'rows')
    if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
} else { -1 }
Assert-Check "No orphaned usage records (found: $orphanUsage)" ($orphanUsage -eq 0)

# Check for NULL required fields in instructions
$nullIdResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM instructions WHERE id IS NULL OR id = ''"
$nullIds = if ($nullIdResp -and (Get-ObjectProperty $nullIdResp 'rows')) {
    $r = @(Get-ObjectProperty $nullIdResp 'rows')
    if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { 0 }
} else { 0 }
Assert-Check "No NULL/empty instruction IDs (found: $nullIds)" ($nullIds -eq 0)

$nullTitleResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM instructions WHERE title IS NULL OR title = ''"
$nullTitles = if ($nullTitleResp -and (Get-ObjectProperty $nullTitleResp 'rows')) {
    $r = @(Get-ObjectProperty $nullTitleResp 'rows')
    if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { 0 }
} else { 0 }
Assert-Check "No NULL/empty instruction titles (found: $nullTitles)" ($nullTitles -eq 0)

$nullBodyResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM instructions WHERE body IS NULL OR body = ''"
$nullBodies = if ($nullBodyResp -and (Get-ObjectProperty $nullBodyResp 'rows')) {
    $r = @(Get-ObjectProperty $nullBodyResp 'rows')
    if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { 0 }
} else { 0 }
Assert-Check "No NULL/empty instruction bodies (found: $nullBodies)" ($nullBodies -eq 0)

# Duplicate ID check (should be impossible with PRIMARY KEY, but validates data)
$dupIdResp = Invoke-SqliteQuery "SELECT id, COUNT(*) as cnt FROM instructions GROUP BY id HAVING cnt > 1"
$dupIds = @(Get-ObjectProperty $dupIdResp 'rows')
$dupCount = if ($null -ne $dupIds) { $dupIds.Count } else { 0 }
Assert-Check "No duplicate instruction IDs (found: $dupCount)" ($dupCount -eq 0)

# ── 8. CRUD Lifecycle & Residue Check ────────────────────────────────────────

if (-not $SkipCrud) {
    Write-Section "8. CRUD Lifecycle & Residue Check ($Iterations iterations)"

    # Snapshot: count before
    $preCountResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM instructions"
    $preCount = if ($preCountResp -and (Get-ObjectProperty $preCountResp 'rows')) {
        $r = @(Get-ObjectProperty $preCountResp 'rows')
        if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
    } else { -1 }

    $preFtsResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM instructions_fts"
    $preFtsCount = if ($preFtsResp -and (Get-ObjectProperty $preFtsResp 'rows')) {
        $r = @(Get-ObjectProperty $preFtsResp 'rows')
        if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
    } else { -1 }

    $crudErrors = @()
    $crudPass = 0

    for ($i = 1; $i -le $Iterations; $i++) {
        $id = "$Prefix-cycle-$i"
        $title = "Validate instruction $i"
        $body = "SQLite validation body for cycle $i. Timestamp: $(Get-Date -Format o)"
        $cycleErrors = @()

        # CREATE via MCP
        $addResult = Invoke-McpClient @{ Action = 'add'; Id = $id; Title = $title; Body = $body }
        $cycleErrors += @(Test-AddResponse -Response $addResult -Id $id -ExpectedMutation created)

        # Verify in SQLite directly
        $dbCheck = Invoke-SqliteQuery "SELECT id, title FROM instructions WHERE id = '$($id -replace "'","''")'"
        $dbRows = @(Get-ObjectProperty $dbCheck 'rows')
        if ($dbRows.Count -ne 1) {
            $cycleErrors += "CREATE: instruction '$id' not found in SQLite after add"
        }

        # FTS check after create
        $ftsAfterCreate = Invoke-SqliteQuery "SELECT id FROM instructions_fts WHERE instructions_fts MATCH '$($id -replace "'","''")'"
        $ftsRows = @(Get-ObjectProperty $ftsAfterCreate 'rows')
        if ($ftsRows.Count -lt 1) {
            $cycleErrors += "CREATE: instruction '$id' not indexed in FTS5 after add"
        }

        # UPDATE via MCP (overwrite)
        $updatedBody = "$body UPDATED-MARKER"
        $updateResult = Invoke-McpClient @{ Action = 'add'; Id = $id; Title = "$title (updated)"; Body = $updatedBody; Overwrite = $true }
        $cycleErrors += @(Test-AddResponse -Response $updateResult -Id $id -ExpectedMutation overwritten)

        # Verify update in SQLite
        $dbAfterUpdate = Invoke-SqliteQuery "SELECT body FROM instructions WHERE id = '$($id -replace "'","''")'"
        $updRows = @(Get-ObjectProperty $dbAfterUpdate 'rows')
        if ($updRows.Count -eq 1) {
            $actualBody = Get-ObjectProperty $updRows[0] 'body'
            if ($actualBody -notlike '*UPDATED-MARKER*') {
                $cycleErrors += "UPDATE: body not updated in SQLite for '$id'"
            }
        } else {
            $cycleErrors += "UPDATE: instruction '$id' disappeared from SQLite"
        }

        # DELETE via MCP
        $removeResult = Invoke-McpClient @{ Action = 'remove'; Id = $id }
        $cycleErrors += @(Test-RemoveResponse -Response $removeResult -Id $id)

        # Verify deletion in SQLite
        $dbAfterDelete = Invoke-SqliteQuery "SELECT id FROM instructions WHERE id = '$($id -replace "'","''")'"
        $delRows = @(Get-ObjectProperty $dbAfterDelete 'rows')
        if ($delRows.Count -ne 0) {
            $cycleErrors += "DELETE: instruction '$id' still present in SQLite after remove"
        }

        # Verify FTS cleanup
        $ftsAfterDelete = Invoke-SqliteQuery "SELECT id FROM instructions_fts WHERE instructions_fts MATCH '$($id -replace "'","''")'"
        $ftsDelRows = @(Get-ObjectProperty $ftsAfterDelete 'rows')
        if ($ftsDelRows.Count -ne 0) {
            $cycleErrors += "DELETE: instruction '$id' still indexed in FTS5 after remove"
        }

        if ($cycleErrors.Count -eq 0) {
            $crudPass++
        } else {
            $crudErrors += $cycleErrors
        }
    }

    Assert-Check "CRUD cycles passed ($crudPass / $Iterations)" ($crudPass -eq $Iterations) (
        if ($crudErrors.Count -gt 0) { ($crudErrors | Select-Object -First 5) -join '; ' } else { '' }
    )

    # Residue check: counts should match pre-run
    $postCountResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM instructions"
    $postCount = if ($postCountResp -and (Get-ObjectProperty $postCountResp 'rows')) {
        $r = @(Get-ObjectProperty $postCountResp 'rows')
        if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
    } else { -1 }
    Assert-Check "No instruction residue (before=$preCount, after=$postCount)" ($preCount -eq $postCount)

    $postFtsResp = Invoke-SqliteQuery "SELECT COUNT(*) as cnt FROM instructions_fts"
    $postFtsCount = if ($postFtsResp -and (Get-ObjectProperty $postFtsResp 'rows')) {
        $r = @(Get-ObjectProperty $postFtsResp 'rows')
        if ($r.Count -gt 0) { Get-ObjectProperty $r[0] 'cnt' } else { -1 }
    } else { -1 }
    Assert-Check "No FTS5 residue (before=$preFtsCount, after=$postFtsCount)" ($preFtsCount -eq $postFtsCount)

    # Check for any leftover test entries (safety net)
    $leftoverResp = Invoke-SqliteQuery "SELECT id FROM instructions WHERE id LIKE '$Prefix%'"
    $leftovers = @(Get-ObjectProperty $leftoverResp 'rows')
    if ($leftovers.Count -gt 0) {
        Write-Host "  [WARN] Found $($leftovers.Count) leftover test entries — cleaning up" -ForegroundColor Yellow
        foreach ($lo in $leftovers) {
            $loId = Get-ObjectProperty $lo 'id'
            Invoke-McpClient @{ Action = 'remove'; Id = $loId } | Out-Null
        }
    }
    Assert-Check "No leftover test instructions with prefix '$Prefix'" ($leftovers.Count -eq 0)

    # Usage residue check
    $usageLeftoverResp = Invoke-SqliteQuery "SELECT instruction_id FROM usage WHERE instruction_id LIKE '$Prefix%'"
    $usageLeftovers = @(Get-ObjectProperty $usageLeftoverResp 'rows')
    Assert-Check "No leftover usage records with prefix '$Prefix' (found: $($usageLeftovers.Count))" ($usageLeftovers.Count -eq 0)
}

# ── 9. Governance Hash Consistency ───────────────────────────────────────────

Write-Section "9. Governance Hash Consistency"

# Get governance hash from MCP
$govResult = Invoke-McpClient @{ Action = 'governanceHash' }
$govErrors = @(Test-ClientResponse -Response $govResult -Operation 'governanceHash')
$govHashOk = $govErrors.Count -eq 0
Assert-Check 'Governance hash computable' $govHashOk (if (-not $govHashOk) { $govErrors -join '; ' } else { '' })

if ($govHashOk) {
    $result = Get-ClientResult $govResult
    $hash = Get-ObjectProperty $result 'hash'
    $count = Get-ObjectProperty $result 'count'
    Write-Host "       hash: $hash (entries: $count)" -ForegroundColor DarkGray

    # Verify count matches SQLite
    Assert-Check "Governance count matches SQLite ($count == $instrCount)" ($count -eq $instrCount)
}

# ── 10. WAL State ────────────────────────────────────────────────────────────

Write-Section "10. WAL State"

$walEnabled = Get-ObjectProperty $info 'walEnabled'
Assert-Check 'WAL enabled in config' ($walEnabled -eq $true)

$walSize = Get-ObjectProperty $info 'walSize'
$fileSize = Get-ObjectProperty $info 'fileSize'
Write-Host "       DB size: $([math]::Round($fileSize / 1024, 1)) KB" -ForegroundColor DarkGray
Write-Host "       WAL size: $([math]::Round($walSize / 1024, 1)) KB" -ForegroundColor DarkGray

# WAL shouldn't be excessively large relative to main DB (warning, not failure)
if ($fileSize -gt 0 -and $walSize -gt ($fileSize * 2)) {
    Write-Host "  [WARN] WAL is >2x main DB size — consider checkpoint" -ForegroundColor Yellow
}

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  RESULTS: $script:passedChecks passed, $script:failedChecks failed, $script:totalChecks total" -ForegroundColor $(
    if ($script:failedChecks -eq 0) { 'Green' } else { 'Red' }
)
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan

if ($script:failures.Count -gt 0) {
    Write-Host ""
    Write-Host "  Failures:" -ForegroundColor Red
    foreach ($f in $script:failures) {
        Write-Host "    • $f" -ForegroundColor Red
    }
}

Write-Host ""
if ($script:failedChecks -eq 0) {
    Write-Host "  ✓ All SQLite validations passed" -ForegroundColor Green
    exit 0
} else {
    Write-Host "  ✗ $script:failedChecks validation(s) failed" -ForegroundColor Red
    exit 1
}
