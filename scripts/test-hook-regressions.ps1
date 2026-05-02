<##
.SYNOPSIS
    Run focused regression checks for the repository's consolidated pre-commit hook script.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Invoke-PreCommitScript {
    param(
        [Parameter(Mandatory)]
        [string]$ScriptPath,

        [string[]]$Arguments
    )

    $pwsh = (Get-Command pwsh -ErrorAction Stop).Source
    $output = & $pwsh -NoProfile -NonInteractive -File $ScriptPath @Arguments 2>&1
    $exitCode = $LASTEXITCODE

    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output = ($output | Out-String).Trim()
    }
}

function Assert-ExitCode {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [int]$Expected,

        [Parameter(Mandatory)]
        [pscustomobject]$Result
    )

    if ($Result.ExitCode -ne $Expected) {
        throw "$Name expected exit code $Expected but got $($Result.ExitCode).`n$($Result.Output)"
    }
}

function Assert-OutputContains {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$Needle,

        [Parameter(Mandatory)]
        [pscustomobject]$Result
    )

    if ($Result.Output -notmatch [regex]::Escape($Needle)) {
        throw "$Name expected output to contain '$Needle'.`n$($Result.Output)"
    }
}

function New-TestFile {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string[]]$Lines
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    Set-Content -Path $Path -Value $Lines
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$preCommitScript = Join-Path $repoRoot 'scripts/pre-commit.ps1'

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("index-server-hook-tests-" + [guid]::NewGuid().ToString('N'))
$managedEnv = @(
    'UNIT_TEST_SECRET_TOKEN', 'GITHUB_WORKFLOW', 'GITHUB_TOKEN',
    'INDEX_SERVER_PRECOMMIT_DOTENV', 'INDEX_SERVER_PRECOMMIT_ENVLEAK_ALLOWLIST'
)
$originalEnv = @{}

foreach ($name in $managedEnv) {
    $existing = Get-Item -Path "env:$name" -ErrorAction SilentlyContinue
    $originalEnv[$name] = if ($existing) { $existing.Value } else { $null }
}

New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    $dotenvPath = Join-Path $tempRoot '.env'
    New-TestFile -Path $dotenvPath -Lines @('SECRET=1')
    $dotenvBlocked = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($dotenvPath)
    Assert-ExitCode -Name 'pre-commit rejects .env' -Expected 1 -Result $dotenvBlocked
    Assert-OutputContains -Name 'pre-commit rejects .env' -Needle '.env' -Result $dotenvBlocked
    Write-Host 'PASS: pre-commit rejects .env files.' -ForegroundColor Green

    $dotenvExamplePath = Join-Path $tempRoot '.env.example'
    New-TestFile -Path $dotenvExamplePath -Lines @('EXAMPLE=1')
    $dotenvExampleAllowed = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($dotenvExamplePath)
    Assert-ExitCode -Name 'pre-commit allows .env.example' -Expected 0 -Result $dotenvExampleAllowed
    Write-Host 'PASS: pre-commit allows .env.example files.' -ForegroundColor Green

    $piiHitPath = Join-Path $tempRoot 'pii-hit.txt'
    New-TestFile -Path $piiHitPath -Lines @('DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=abc123') # pii-allowlist
    $piiHit = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($piiHitPath)
    Assert-ExitCode -Name 'pre-commit flags Azure connection strings' -Expected 1 -Result $piiHit
    Assert-OutputContains -Name 'pre-commit flags Azure connection strings' -Needle 'Azure connection string' -Result $piiHit
    Write-Host 'PASS: pre-commit flags Azure connection strings.' -ForegroundColor Green

    $piiAllowlistedPath = Join-Path $tempRoot 'pii-allowlisted.txt'
    New-TestFile -Path $piiAllowlistedPath -Lines @("Regex = '(?:SharedAccessSignature=[^;\s]+|[?&]sig=[A-Za-z0-9%+/=]+)' # pii-allowlist")
    $piiAllowlisted = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($piiAllowlistedPath)
    Assert-ExitCode -Name 'pre-commit respects inline PII allowlists' -Expected 0 -Result $piiAllowlisted
    Write-Host 'PASS: pre-commit respects inline PII allowlists.' -ForegroundColor Green

    Set-Item -Path env:UNIT_TEST_SECRET_TOKEN -Value 'unit-secret-12345'
    $envLeakPath = Join-Path $tempRoot 'env-hit.txt'
    New-TestFile -Path $envLeakPath -Lines @('token=unit-secret-12345')
    $envLeakHit = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($envLeakPath)
    Assert-ExitCode -Name 'pre-commit flags copied secret values' -Expected 1 -Result $envLeakHit
    Assert-OutputContains -Name 'pre-commit flags copied secret values' -Needle 'UNIT_TEST_SECRET_TOKEN' -Result $envLeakHit
    Write-Host 'PASS: pre-commit flags copied secret values.' -ForegroundColor Green

    $envLeakAllowlistedPath = Join-Path $tempRoot 'env-allowlisted.txt'
    New-TestFile -Path $envLeakAllowlistedPath -Lines @('token=unit-secret-12345 <!-- env-leak-allowlist -->')
    $envLeakAllowlisted = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($envLeakAllowlistedPath)
    Assert-ExitCode -Name 'pre-commit respects env leak allowlists' -Expected 0 -Result $envLeakAllowlisted
    Write-Host 'PASS: pre-commit respects env leak allowlists.' -ForegroundColor Green

    Set-Item -Path env:GITHUB_WORKFLOW -Value 'Template Regression Workflow'
    $githubMetadataPath = Join-Path $tempRoot 'github-metadata.txt'
    New-TestFile -Path $githubMetadataPath -Lines @('workflow=Template Regression Workflow')
    $githubMetadataAllowed = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($githubMetadataPath)
    Assert-ExitCode -Name 'pre-commit ignores generic GitHub metadata values' -Expected 0 -Result $githubMetadataAllowed
    Write-Host 'PASS: pre-commit ignores generic GitHub metadata values.' -ForegroundColor Green

    Set-Item -Path env:GITHUB_TOKEN -Value 'ghs_1234567890_test'
    $githubTokenPath = Join-Path $tempRoot 'github-token.txt'
    New-TestFile -Path $githubTokenPath -Lines @('token=ghs_1234567890_test #gitleaks:allow')
    $githubTokenHit = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($githubTokenPath)
    Assert-ExitCode -Name 'pre-commit still protects GITHUB_TOKEN' -Expected 1 -Result $githubTokenHit
    Assert-OutputContains -Name 'pre-commit still protects GITHUB_TOKEN' -Needle 'GITHUB_TOKEN' -Result $githubTokenHit
    Write-Host 'PASS: pre-commit still protects GITHUB_TOKEN.' -ForegroundColor Green

    # ── Dotenv-derived env-leak detection ──────────────────────────────────
    # Verifies that values copied from a local .env into tracked files are
    # caught even if the value is not present in process environment.
    $fixtureDotenv = Join-Path $tempRoot '.env.fixture'
    $fixtureAllow = Join-Path $tempRoot '.env-leak-allowlist.fixture'
    Set-Content -Path $fixtureDotenv -Value @(
        'CLEANROOM_PATH=C:\Users\hookfixture\private\machine\specific\path',
        'DEPLOY_ROOT=C:\disjoint-allowlisted-path-12345',
        'TINY=ok'
    )
    Set-Content -Path $fixtureAllow -Value @(
        '# fixture allowlist',
        'literal:C:\disjoint-allowlisted-path-12345'
    )
    Set-Item -Path env:INDEX_SERVER_PRECOMMIT_DOTENV -Value $fixtureDotenv
    Set-Item -Path env:INDEX_SERVER_PRECOMMIT_ENVLEAK_ALLOWLIST -Value $fixtureAllow

    # Red: a tracked file containing the dotenv value must fail.
    $dotenvLeakHitPath = Join-Path $tempRoot 'dotenv-leak-hit.txt'
    New-TestFile -Path $dotenvLeakHitPath -Lines @('cleanroom: C:\Users\hookfixture\private\machine\specific\path')
    $dotenvLeakHit = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($dotenvLeakHitPath)
    Assert-ExitCode -Name 'pre-commit flags dotenv-derived value leak' -Expected 1 -Result $dotenvLeakHit
    Assert-OutputContains -Name 'pre-commit flags dotenv-derived value leak' -Needle 'CLEANROOM_PATH (.env)' -Result $dotenvLeakHit
    Write-Host 'PASS: pre-commit flags dotenv-derived value leak.' -ForegroundColor Green

    # Red: dotenv user-segment token is also flagged.
    $userSegLeakPath = Join-Path $tempRoot 'dotenv-userseg-leak.txt'
    New-TestFile -Path $userSegLeakPath -Lines @('owner=hookfixture')
    $userSegLeak = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($userSegLeakPath)
    Assert-ExitCode -Name 'pre-commit flags dotenv user-segment token' -Expected 1 -Result $userSegLeak
    Assert-OutputContains -Name 'pre-commit flags dotenv user-segment token' -Needle 'CLEANROOM_PATH (.env user-segment)' -Result $userSegLeak
    Write-Host 'PASS: pre-commit flags dotenv user-segment token.' -ForegroundColor Green

    # Green: the same file with `# env-leak-allowlist` inline marker passes.
    $dotenvLeakAllowedInlinePath = Join-Path $tempRoot 'dotenv-leak-inline.txt'
    New-TestFile -Path $dotenvLeakAllowedInlinePath -Lines @('cleanroom: C:\Users\hookfixture\private\machine\specific\path # env-leak-allowlist')
    $dotenvLeakInline = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($dotenvLeakAllowedInlinePath)
    Assert-ExitCode -Name 'pre-commit respects inline env-leak-allowlist for dotenv' -Expected 0 -Result $dotenvLeakInline
    Write-Host 'PASS: pre-commit respects inline env-leak-allowlist for dotenv.' -ForegroundColor Green

    # Green: a value in the allowlist FILE (literal:...) passes.
    $dotenvLeakAllowFilePath = Join-Path $tempRoot 'dotenv-leak-file.txt'
    New-TestFile -Path $dotenvLeakAllowFilePath -Lines @('deploy: C:\disjoint-allowlisted-path-12345')
    $dotenvLeakFile = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($dotenvLeakAllowFilePath)
    Assert-ExitCode -Name 'pre-commit respects literal: in .env-leak-allowlist' -Expected 0 -Result $dotenvLeakFile
    Write-Host 'PASS: pre-commit respects literal: in .env-leak-allowlist.' -ForegroundColor Green

    # Green: short dotenv values (<16 chars) are not promoted to leak tokens.
    $tinyValueLeakPath = Join-Path $tempRoot 'tiny-value.txt'
    New-TestFile -Path $tinyValueLeakPath -Lines @('value=ok')
    $tinyValueLeak = Invoke-PreCommitScript -ScriptPath $preCommitScript -Arguments @($tinyValueLeakPath)
    Assert-ExitCode -Name 'pre-commit ignores tiny dotenv values' -Expected 0 -Result $tinyValueLeak
    Write-Host 'PASS: pre-commit ignores tiny dotenv values.' -ForegroundColor Green
}
finally {
    foreach ($name in $managedEnv) {
        if ($null -eq $originalEnv[$name]) {
            Remove-Item -Path "env:$name" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item -Path "env:$name" -Value $originalEnv[$name]
        }
    }

    Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Hook regression checks passed.' -ForegroundColor Green
exit 0
