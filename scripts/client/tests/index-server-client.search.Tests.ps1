# Pester tests for scripts/client/index-server-client.ps1 search action.
# Issue #385 — PowerShell client search-surface parity.
#
# RED tests: 8 new-parity assertions fail until Trinity adds the new
# parameters and merging logic. 1 regression-guard test PASSES today to
# prove existing behaviour stays intact.
#
# Strategy: shadow Invoke-RestMethod in the global scope BEFORE invoking
# the script so we can capture the outgoing request body without hitting
# a real server.
#
# Run with:  Invoke-Pester scripts/client/tests/index-server-client.search.Tests.ps1

#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }

BeforeAll {
    $script:ClientScript = (Resolve-Path (Join-Path $PSScriptRoot '..' 'index-server-client.ps1')).Path

    function script:Invoke-Client {
        param([hashtable]$Params)

        function global:Invoke-RestMethod {
            [CmdletBinding()]
            param(
                [Parameter(ValueFromPipelineByPropertyName=$true)][string]$Uri,
                [Parameter(ValueFromPipelineByPropertyName=$true)][string]$Method,
                [Parameter(ValueFromPipelineByPropertyName=$true)][string]$ContentType,
                [Parameter(ValueFromPipelineByPropertyName=$true)]$Body,
                [Parameter(ValueFromPipelineByPropertyName=$true)]$Headers,
                [Parameter(ValueFromPipelineByPropertyName=$true)][switch]$SkipCertificateCheck,
                [Parameter(ValueFromRemainingArguments=$true)]$RemainingArgs
            )
            $global:__CapturedUri  = $Uri
            $global:__CapturedBody = $Body
            return [pscustomobject]@{ results = @(); totalMatches = 0; hash = 'test' }
        }
        $global:__CapturedUri  = $null
        $global:__CapturedBody = $null

        try {
            & $script:ClientScript @Params -BaseUrl 'http://test.local' -ErrorAction SilentlyContinue | Out-Null
        } catch { }

        $bodyHash = $null
        if ($global:__CapturedBody) {
            $bodyHash = $global:__CapturedBody | ConvertFrom-Json -AsHashtable
        }
        $result = [pscustomobject]@{
            Uri  = $global:__CapturedUri
            Body = $bodyHash
        }
        Remove-Item Function:\Invoke-RestMethod -Force -ErrorAction SilentlyContinue
        return $result
    }
}

Describe '#385 — index-server-client.ps1 search action parity' {

    Context 'Existing behaviour (regression guards)' {

        It 'keywords + mode + limit still produces the legacy request body' {
            $r = Invoke-Client -Params @{
                Action = 'search'; Keywords = @('deploy','release'); Mode = 'regex'; Limit = 25
            }
            $r.Uri  | Should -Be 'http://test.local/api/tools/index_search'
            ($r.Body.keywords -join ',') | Should -Be 'deploy,release'
            $r.Body.mode  | Should -Be 'regex'
            $r.Body.limit | Should -Be 25
        }
    }

    Context 'New parity parameters' {

        It '-SearchString sends searchString and omits keywords' {
            $r = Invoke-Client -Params @{ Action='search'; SearchString='deploy phrase' }
            $r.Body.searchString | Should -Be 'deploy phrase'
            $r.Body.ContainsKey('keywords') | Should -BeFalse
        }

        It '-Fields hashtable is passed through verbatim' {
            $r = Invoke-Client -Params @{ Action='search'; Keywords=@('foo'); Fields=@{ status='approved' } }
            $r.Body.fields.status | Should -Be 'approved'
        }

        It '-IncludeCategories produces includeCategories:true' {
            $r = Invoke-Client -Params @{ Action='search'; Keywords=@('foo'); IncludeCategories=$true }
            $r.Body.includeCategories | Should -BeTrue
        }

        It '-CaseSensitive produces caseSensitive:true' {
            $r = Invoke-Client -Params @{ Action='search'; Keywords=@('foo'); CaseSensitive=$true }
            $r.Body.caseSensitive | Should -BeTrue
        }

        It '-Offset 50 produces offset:50' {
            $r = Invoke-Client -Params @{ Action='search'; Keywords=@('foo'); Offset=50 }
            $r.Body.offset | Should -Be 50
        }

        It '-CategoriesAny merges into fields.categoriesAny' {
            $r = Invoke-Client -Params @{ Action='search'; Keywords=@('foo'); CategoriesAny=@('devops','cloud') }
            ($r.Body.fields.categoriesAny -join ',') | Should -Be 'devops,cloud'
        }

        It 'explicit -Fields wins on collision with convenience params' {
            $r = Invoke-Client -Params @{
                Action='search'; Keywords=@('foo');
                CategoriesAny=@('devops');
                Fields=@{ categoriesAny=@('manual-wins') }
            }
            ($r.Body.fields.categoriesAny -join ',') | Should -Be 'manual-wins'
        }

        It 'structural-only (no Keywords/SearchString, only predicates) succeeds without "Keywords mandatory" error' {
            $r = Invoke-Client -Params @{ Action='search'; Fields=@{ status='approved' } }
            $r.Uri | Should -Be 'http://test.local/api/tools/index_search'
            $r.Body.fields.status               | Should -Be 'approved'
            $r.Body.ContainsKey('keywords')     | Should -BeFalse
            $r.Body.ContainsKey('searchString') | Should -BeFalse
        }
    }
}
