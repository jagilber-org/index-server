Set-StrictMode -Version Latest

function Get-ObjectProperty {
    param(
        [Parameter(Mandatory = $false)]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name
    )
    if ($null -eq $InputObject) { return $null }
    if ($InputObject -is [hashtable]) {
        if ($InputObject.ContainsKey($Name)) { return $InputObject[$Name] }
        return $null
    }
    $prop = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

function ConvertFrom-ClientOutput {
    param([Parameter(Mandatory = $false)]$Output)
    $text = ($Output | Out-String).Trim()
    if (-not $text) {
        return [PSCustomObject]@{ success = $false; error = 'Empty response' }
    }
    try {
        return $text | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return [PSCustomObject]@{
            success = $false
            error   = "Invalid JSON response: $($_.Exception.Message)"
            raw     = $text
        }
    }
}

function Get-ClientResult {
    param([Parameter(Mandatory = $false)]$Response)
    return Get-ObjectProperty $Response 'result'
}

function Test-ClientResponse {
    param(
        [Parameter(Mandatory = $false)]$Response,
        [Parameter(Mandatory = $true)][string]$Operation
    )
    $errors = @()
    if ($null -eq $Response) {
        return @("$Operation returned no response")
    }

    $success = Get-ObjectProperty $Response 'success'
    if ($success -ne $true) {
        $clientError = Get-ObjectProperty $Response 'error'
        if (-not $clientError) { $clientError = 'client wrapper did not report success' }
        $errors += "$Operation client failure: $clientError"
        return $errors
    }

    $result = Get-ClientResult $Response
    if ($null -eq $result) {
        $errors += "$Operation did not return a result payload"
        return $errors
    }

    $resultError = Get-ObjectProperty $result 'error'
    if ($resultError) { $errors += "$Operation result error: $resultError" }

    $resultSuccess = Get-ObjectProperty $result 'success'
    if ($null -ne $resultSuccess -and $resultSuccess -eq $false) {
        $errors += "$Operation result success=false"
    }

    $isError = Get-ObjectProperty $result 'isError'
    if ($isError -eq $true) { $errors += "$Operation result isError=true" }

    return $errors
}

function Test-AddResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$Id,
        [ValidateSet('created','overwritten','createdOrOverwritten')]
        [string]$ExpectedMutation = 'created'
    )
    $errors = @(Test-ClientResponse -Response $Response -Operation 'add')
    if ($errors.Count -gt 0) { return $errors }

    $result = Get-ClientResult $Response
    $actualId = Get-ObjectProperty $result 'id'
    if ($actualId -ne $Id) { $errors += "add returned id '$actualId', expected '$Id'" }

    $created = Get-ObjectProperty $result 'created'
    $overwritten = Get-ObjectProperty $result 'overwritten'
    $skipped = Get-ObjectProperty $result 'skipped'
    if ($skipped -eq $true) { $errors += "add skipped '$Id' instead of mutating it" }
    if ($ExpectedMutation -eq 'created' -and $created -ne $true) {
        $errors += "add did not report created=true for '$Id'"
    }
    if ($ExpectedMutation -eq 'overwritten' -and $overwritten -ne $true) {
        $errors += "add did not report overwritten=true for '$Id'"
    }
    if ($ExpectedMutation -eq 'createdOrOverwritten' -and $created -ne $true -and $overwritten -ne $true) {
        $errors += "add did not report created=true or overwritten=true for '$Id'"
    }

    return $errors
}

function Test-GetResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$Id,
        [string]$ExpectedTitle,
        [string]$ExpectedBodyContains
    )
    $errors = @(Test-ClientResponse -Response $Response -Operation 'get')
    if ($errors.Count -gt 0) { return $errors }

    $result = Get-ClientResult $Response
    $item = Get-ObjectProperty $result 'item'
    if ($null -eq $item) {
        $errors += "get result did not include item for '$Id'"
        return $errors
    }

    $actualId = Get-ObjectProperty $item 'id'
    if ($actualId -ne $Id) { $errors += "get returned id '$actualId', expected '$Id'" }

    if ($ExpectedTitle) {
        $title = Get-ObjectProperty $item 'title'
        if ($title -ne $ExpectedTitle) { $errors += "get returned title '$title', expected '$ExpectedTitle'" }
    }

    if ($ExpectedBodyContains) {
        $body = Get-ObjectProperty $item 'body'
        if (-not $body -or "$body" -notlike "*$ExpectedBodyContains*") {
            $errors += "get body did not contain expected text '$ExpectedBodyContains'"
        }
    }

    return $errors
}

function Test-DeletedResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$Id
    )
    $errors = @(Test-ClientResponse -Response $Response -Operation 'verify_deleted')
    if ($errors.Count -gt 0) { return $errors }

    $result = Get-ClientResult $Response
    $notFound = Get-ObjectProperty $result 'notFound'
    $item = Get-ObjectProperty $result 'item'
    if ($notFound -ne $true -or $null -ne $item) {
        $errors += "get after delete did not report notFound=true for '$Id'"
    }

    return $errors
}

function Test-SearchResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [string]$Id,
        [int]$MinMatches = 1
    )
    $errors = @(Test-ClientResponse -Response $Response -Operation 'search')
    if ($errors.Count -gt 0) { return $errors }

    $result = Get-ClientResult $Response
    $rawResults = Get-ObjectProperty $result 'results'
    if ($null -eq $rawResults) {
        $errors += 'search response did not include results'
        $results = @()
    } else {
        $results = @($rawResults)
    }
    $totalMatches = Get-ObjectProperty $result 'totalMatches'
    if ($null -eq $totalMatches) { $totalMatches = $results.Count }
    if ($totalMatches -lt $MinMatches) {
        $errors += "search returned $totalMatches matches, expected at least $MinMatches"
    }

    if ($Id) {
        $found = $false
        foreach ($entry in $results) {
            $candidate = Get-ObjectProperty $entry 'instructionId'
            if (-not $candidate) { $candidate = Get-ObjectProperty $entry 'id' }
            if ($candidate -eq $Id) {
                $found = $true
                break
            }
        }
        if (-not $found) { $errors += "search results did not include '$Id'" }
    }

    return $errors
}

function Test-ListResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [string]$Id
    )
    $errors = @(Test-ClientResponse -Response $Response -Operation 'list')
    if ($errors.Count -gt 0) { return $errors }

    $result = Get-ClientResult $Response
    $rawItems = Get-ObjectProperty $result 'items'
    if ($null -eq $rawItems) {
        $errors += 'list response did not include items'
        $items = @()
    } else {
        $items = @($rawItems)
    }
    $count = Get-ObjectProperty $result 'count'
    if ($null -eq $count) { $count = $items.Count }
    if ($count -lt $items.Count) {
        $errors += "list count '$count' is smaller than returned items '$($items.Count)'"
    }

    if ($Id) {
        $found = $false
        foreach ($item in $items) {
            if ((Get-ObjectProperty $item 'id') -eq $Id) {
                $found = $true
                break
            }
        }
        if (-not $found) { $errors += "list results did not include '$Id'" }
    }

    return $errors
}

function Test-RemoveResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$Id
    )
    $errors = @(Test-ClientResponse -Response $Response -Operation 'remove')
    if ($errors.Count -gt 0) { return $errors }

    $result = Get-ClientResult $Response
    $removed = Get-ObjectProperty $result 'removed'
    $rawRemovedIds = Get-ObjectProperty $result 'removedIds'
    if ($null -eq $rawRemovedIds) {
        $errors += 'remove response did not include removedIds'
        $removedIds = @()
    } else {
        $removedIds = @($rawRemovedIds)
    }
    $errorCount = Get-ObjectProperty $result 'errorCount'
    if ($removed -lt 1) { $errors += "remove did not remove '$Id'" }
    if ($removedIds -notcontains $Id) { $errors += "remove response did not include '$Id' in removedIds" }
    if ($errorCount -gt 0) { $errors += "remove reported errorCount=$errorCount" }

    return $errors
}

function Test-UsageResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [Parameter(Mandatory = $true)][string]$Id
    )
    $errors = @(Test-ClientResponse -Response $Response -Operation 'track')
    if ($errors.Count -gt 0) { return $errors }

    $result = Get-ClientResult $Response
    $notFound = Get-ObjectProperty $result 'notFound'
    if ($notFound -eq $true) { $errors += "track reported notFound=true for '$Id'" }

    return $errors
}

function Test-HotsetResponse {
    param([Parameter(Mandatory = $true)]$Response)
    $errors = @(Test-ClientResponse -Response $Response -Operation 'hotset')
    if ($errors.Count -gt 0) { return $errors }

    $result = Get-ClientResult $Response
    $rawItems = Get-ObjectProperty $result 'items'
    if ($null -eq $rawItems) {
        $errors += 'hotset response did not include items'
        $items = @()
    } else {
        $items = @($rawItems)
    }
    $count = Get-ObjectProperty $result 'count'
    if ($null -eq $count) { $count = $items.Count }
    if ($count -ne $items.Count) {
        $errors += "hotset count '$count' did not match returned items '$($items.Count)'"
    }

    return $errors
}

function Test-HealthResponse {
    param([Parameter(Mandatory = $true)]$Response)
    $errors = @(Test-ClientResponse -Response $Response -Operation 'health')
    if ($errors.Count -gt 0) { return $errors }

    $result = Get-ClientResult $Response
    $status = Get-ObjectProperty $result 'status'
    $healthy = Get-ObjectProperty $result 'healthy'
    if ($status -and "$status" -notin @('ok','healthy')) {
        $errors += "health status was '$status'"
    }
    if ($null -ne $healthy -and $healthy -ne $true) {
        $errors += "health healthy flag was not true"
    }

    return $errors
}

function Test-EmbeddingComputeResponse {
    param([Parameter(Mandatory = $true)]$Response)
    $errors = @()
    $success = Get-ObjectProperty $Response 'success'
    if ($success -ne $true) {
        $errorMessage = Get-ObjectProperty $Response 'error'
        if (-not $errorMessage) { $errorMessage = 'embedding compute did not report success' }
        $errors += $errorMessage
    }
    $count = Get-ObjectProperty $Response 'count'
    if ($null -eq $count) { $errors += 'embedding compute response did not include count' }
    return $errors
}

function Test-EmbeddingProjectionResponse {
    param([Parameter(Mandatory = $true)]$Response)
    $errors = @()
    $success = Get-ObjectProperty $Response 'success'
    if ($success -ne $true) {
        $errorMessage = Get-ObjectProperty $Response 'error'
        if (-not $errorMessage) { $errorMessage = 'embedding projection did not report success' }
        $errors += $errorMessage
    }
    $count = Get-ObjectProperty $Response 'count'
    if ($null -eq $count) { $errors += 'embedding projection response did not include count' }
    return $errors
}

# ── Dashboard Admin Backup Validators ────────────────────────────────────
# Dashboard endpoints return raw JSON (not wrapped in { success, result }).

function Test-DashboardResponse {
    param(
        [Parameter(Mandatory = $false)]$Response,
        [Parameter(Mandatory = $true)][string]$Operation
    )
    $errors = @()
    if ($null -eq $Response) {
        return @("$Operation returned no response")
    }
    $success = Get-ObjectProperty $Response 'success'
    if ($success -ne $true) {
        $errMsg = Get-ObjectProperty $Response 'error'
        if (-not $errMsg) { $errMsg = 'dashboard did not report success' }
        $errors += "$Operation failure: $errMsg"
    }
    return $errors
}

function Test-BackupCreateResponse {
    param([Parameter(Mandatory = $true)]$Response)
    $errors = @(Test-DashboardResponse -Response $Response -Operation 'backup/create')
    if ($errors.Count -gt 0) { return $errors }

    $backupId = Get-ObjectProperty $Response 'backupId'
    if (-not $backupId) { $errors += 'backup/create did not return backupId' }
    return $errors
}

function Test-BackupListResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [string]$ExpectBackupId
    )
    $errors = @(Test-DashboardResponse -Response $Response -Operation 'backup/list')
    if ($errors.Count -gt 0) { return $errors }

    $rawBackups = Get-ObjectProperty $Response 'backups'
    if ($null -eq $rawBackups) {
        $errors += 'backup/list did not include backups array'
        return $errors
    }
    $backups = @($rawBackups)
    $count = Get-ObjectProperty $Response 'count'
    if ($null -ne $count -and $count -ne $backups.Count) {
        $errors += "backup/list count=$count but returned $($backups.Count) items"
    }

    if ($ExpectBackupId) {
        $found = $false
        foreach ($b in $backups) {
            if ((Get-ObjectProperty $b 'id') -eq $ExpectBackupId) {
                $found = $true
                break
            }
        }
        if (-not $found) { $errors += "backup/list did not include '$ExpectBackupId'" }
    }
    return $errors
}

function Test-BackupRestoreResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [int]$MinRestored = 0
    )
    $errors = @(Test-DashboardResponse -Response $Response -Operation 'backup/restore')
    if ($errors.Count -gt 0) { return $errors }

    $restored = Get-ObjectProperty $Response 'restored'
    if ($null -eq $restored) {
        $errors += 'backup/restore did not include restored count'
    } elseif ($MinRestored -gt 0 -and $restored -lt $MinRestored) {
        $errors += "backup/restore restored=$restored, expected at least $MinRestored"
    }
    return $errors
}

function Test-BackupImportResponse {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [switch]$ExpectRestore
    )
    $errors = @(Test-DashboardResponse -Response $Response -Operation 'backup/import')
    if ($errors.Count -gt 0) { return $errors }

    $backupId = Get-ObjectProperty $Response 'backupId'
    if (-not $backupId) { $errors += 'backup/import did not return backupId' }

    $files = Get-ObjectProperty $Response 'files'
    if ($null -eq $files -or $files -lt 1) {
        $errors += 'backup/import did not report any files'
    }

    if ($ExpectRestore) {
        $restoredApplied = Get-ObjectProperty $Response 'restored_applied'
        if ($restoredApplied -ne $true) {
            $errors += 'backup/import did not report restored_applied=true'
        }
        $restored = Get-ObjectProperty $Response 'restored'
        if ($null -eq $restored -or $restored -lt 1) {
            $errors += 'backup/import did not report restored count'
        }
    }
    return $errors
}

function Test-BackupPruneResponse {
    param([Parameter(Mandatory = $true)]$Response)
    $errors = @(Test-DashboardResponse -Response $Response -Operation 'backup/prune')
    if ($errors.Count -gt 0) { return $errors }

    $pruned = Get-ObjectProperty $Response 'pruned'
    if ($null -eq $pruned) { $errors += 'backup/prune did not include pruned count' }
    return $errors
}

function Test-BackupDeleteResponse {
    param([Parameter(Mandatory = $true)]$Response)
    $errors = @(Test-DashboardResponse -Response $Response -Operation 'backup/delete')
    if ($errors.Count -gt 0) { return $errors }

    $removed = Get-ObjectProperty $Response 'removed'
    if ($removed -ne $true) { $errors += 'backup/delete did not report removed=true' }
    return $errors
}
