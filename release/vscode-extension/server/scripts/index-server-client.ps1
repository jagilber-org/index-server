<#
.SYNOPSIS
  Index Server REST client for subagents without MCP tool access.

.DESCRIPTION
  Provides CRUD operations against the Index Server dashboard REST bridge
  (POST /api/tools/:name). Works with both HTTP and HTTPS endpoints.
  Returns structured JSON to stdout for machine consumption.

.PARAMETER BaseUrl
  Server URL, e.g. http://localhost:8787 or https://localhost:8787

.PARAMETER Action
  One of: search, get, list, add, remove, groom, health, track, hotset

.PARAMETER Id
  Instruction ID (for get, remove, track)

.PARAMETER Keywords
  Search keywords array (for search)

.PARAMETER Mode
  Search mode: keyword, regex, semantic (default: keyword)

.PARAMETER Body
  Instruction body text (for add)

.PARAMETER Title
  Instruction title (for add)

.PARAMETER Priority
  Instruction priority 1-100 (for add, default: 50)

.PARAMETER Signal
  Usage signal: helpful, not-relevant, outdated, applied (for track)

.PARAMETER Overwrite
  Allow overwriting existing instruction (for add)

.PARAMETER DryRun
  Preview groom changes without writing (for groom)

.PARAMETER Limit
  Max results (for search, list, hotset)

.PARAMETER SkipCertCheck
  Skip TLS certificate validation (self-signed certs)

.EXAMPLE
  .\index-server-client.ps1 -BaseUrl http://localhost:8787 -Action health
  .\index-server-client.ps1 -BaseUrl http://localhost:8787 -Action search -Keywords deploy,release
  .\index-server-client.ps1 -BaseUrl http://localhost:8787 -Action get -Id my-instruction-id
  .\index-server-client.ps1 -BaseUrl http://localhost:8787 -Action list -Limit 20
  .\index-server-client.ps1 -BaseUrl http://localhost:8787 -Action add -Id new-inst -Title "My Instruction" -Body "Content here"
  .\index-server-client.ps1 -BaseUrl http://localhost:8787 -Action remove -Id old-inst
  .\index-server-client.ps1 -BaseUrl http://localhost:8787 -Action track -Id some-inst -Signal helpful
  .\index-server-client.ps1 -BaseUrl http://localhost:8787 -Action groom -DryRun
  .\index-server-client.ps1 -BaseUrl https://localhost:8787 -Action health -SkipCertCheck
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = $env:INDEX_SERVER_URL,
    [Parameter(Mandatory)]
    [ValidateSet('search','get','list','add','remove','groom','health','track','hotset')]
    [string]$Action,
    [string]$Id,
    [string[]]$Keywords,
    [ValidateSet('keyword','regex','semantic')]
    [string]$Mode = 'keyword',
    [string]$Body,
    [string]$Title,
    [int]$Priority = 50,
    [ValidateSet('helpful','not-relevant','outdated','applied')]
    [string]$Signal,
    [switch]$Overwrite,
    [switch]$DryRun,
    [int]$Limit = 50,
    [switch]$SkipCertCheck,
    [string]$AdminKey = $env:INDEX_SERVER_ADMIN_API_KEY
)

$ErrorActionPreference = 'Stop'
if (-not $BaseUrl) {
    $BaseUrl = 'http://localhost:8787'
}
$BaseUrl = $BaseUrl.TrimEnd('/')

function Invoke-Tool {
    param([string]$Tool, [hashtable]$Params)
    $uri = "$BaseUrl/api/tools/$Tool"
    $jsonBody = $Params | ConvertTo-Json -Depth 10 -Compress
    $splat = @{
        Uri         = $uri
        Method      = 'POST'
        ContentType = 'application/json'
        Body        = $jsonBody
    }
    if ($AdminKey) {
        $splat.Headers = @{ Authorization = "Bearer $AdminKey" }
    }
    if ($SkipCertCheck) {
        if ($PSVersionTable.PSVersion.Major -ge 7) {
            $splat.SkipCertificateCheck = $true
        } else {
            # PS 5.1 workaround
            if (-not ([System.Management.Automation.PSTypeName]'TrustAll').Type) {
                Add-Type @"
using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
public class TrustAll {
    public static void Enable() {
        ServicePointManager.ServerCertificateValidationCallback =
            delegate { return true; };
    }
}
"@
            }
            [TrustAll]::Enable()
        }
    }
    try {
        $resp = Invoke-RestMethod @splat
        return @{ success = $true; result = $resp }
    } catch {
        $msg = $_.Exception.Message
        $status = $null
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            try {
                $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
                $errBody = $reader.ReadToEnd() | ConvertFrom-Json
                $msg = $errBody.error
            } catch { }
        }
        return @{ success = $false; error = $msg; status = $status }
    }
}

$output = switch ($Action) {
    'health' {
        Invoke-Tool 'health_check' @{}
    }
    'search' {
        if (-not $Keywords -or $Keywords.Count -eq 0) {
            @{ success = $false; error = 'Keywords required for search' }
        } else {
            Invoke-Tool 'index_search' @{ keywords = $Keywords; mode = $Mode; limit = $Limit }
        }
    }
    'get' {
        if (-not $Id) { @{ success = $false; error = 'Id required for get' } }
        else { Invoke-Tool 'index_dispatch' @{ action = 'get'; id = $Id } }
    }
    'list' {
        Invoke-Tool 'index_dispatch' @{ action = 'list'; limit = $Limit }
    }
    'add' {
        if (-not $Id) { @{ success = $false; error = 'Id required for add' } }
        elseif (-not $Body) { @{ success = $false; error = 'Body required for add' } }
        else {
            $entry = @{
                id          = $Id
                title       = if ($Title) { $Title } else { $Id }
                body        = $Body
                priority    = $Priority
                audience    = 'all'
                requirement = 'optional'
                categories  = @('general')
                contentType = 'instruction'
            }
            $params = @{ entry = $entry; lax = $true }
            if ($Overwrite) { $params.overwrite = $true }
            Invoke-Tool 'index_add' $params
        }
    }
    'remove' {
        if (-not $Id) { @{ success = $false; error = 'Id required for remove' } }
        else { Invoke-Tool 'index_remove' @{ ids = @($Id) } }
    }
    'track' {
        if (-not $Id) { @{ success = $false; error = 'Id required for track' } }
        else {
            $p = @{ id = $Id }
            if ($Signal) { $p.signal = $Signal }
            Invoke-Tool 'usage_track' $p
        }
    }
    'hotset' {
        Invoke-Tool 'usage_hotset' @{ limit = $Limit }
    }
    'groom' {
        Invoke-Tool 'index_groom' @{ mode = @{ dryRun = [bool]$DryRun } }
    }
}

$output | ConvertTo-Json -Depth 10
