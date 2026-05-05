<##
.SYNOPSIS
    Validate alignment between the template manifest and adoption metadata files.
    Also checks project-context.md for stale version references.
#>
[CmdletBinding()]
param(
    [switch]$RequireRepoAdoptionMatch
)

$ErrorActionPreference = 'Stop'

function Get-JsonDocument {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string]$Label
    )

    if (-not (Test-Path $Path)) {
        throw "$Label not found: $Path"
    }

    try {
        return Get-Content -Raw -Path $Path | ConvertFrom-Json
    }
    catch {
        throw "$Label could not be parsed: $Path`n$($_.Exception.Message)"
    }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$manifest = Get-JsonDocument -Path (Join-Path $repoRoot 'template-manifest.json') -Label 'template-manifest.json'

$documents = @(
    [PSCustomObject]@{
        Name = 'template-adoption.example.json'
        Data = Get-JsonDocument -Path (Join-Path $repoRoot 'template-adoption.example.json') -Label 'template-adoption.example.json'
    }
)

if ($RequireRepoAdoptionMatch) {
    $documents += [PSCustomObject]@{
        Name = '.template-adoption.json'
        Data = Get-JsonDocument -Path (Join-Path $repoRoot '.template-adoption.json') -Label '.template-adoption.json'
    }
}

$fields = @(
    'templateName',
    'templateVersion',
    'hookStandardInstruction',
    'hookStandardVersion'
)

$findings = @()
foreach ($document in $documents) {
    foreach ($field in $fields) {
        $expected = $manifest.$field
        $actual = $document.Data.$field

        if ($expected -ne $actual) {
            $findings += [PSCustomObject]@{
                Document = $document.Name
                Field = $field
                Expected = $expected
                Actual = $actual
            }
        }
    }
}

$projectContextPath = Join-Path $repoRoot '.instructions' 'local' 'project-context.md'
if (Test-Path $projectContextPath) {
    $contextContent = Get-Content -Raw -Path $projectContextPath
    $templateVersion = $manifest.templateVersion

    $versionPattern = '(?:version|records\s+version|template\s+version)\s*`(\d+\.\d+\.\d+)`'
    $versionMatches = [regex]::Matches($contextContent, $versionPattern, 'IgnoreCase')
    foreach ($match in $versionMatches) {
        $foundVersion = $match.Groups[1].Value
        if ($foundVersion -ne $templateVersion) {
            $findings += [PSCustomObject]@{
                Document = '.instructions/local/project-context.md'
                Field = 'templateVersion (inline reference)'
                Expected = $templateVersion
                Actual = $foundVersion
            }
        }
    }
}

if ($findings.Count -gt 0) {
    Write-Host 'ERROR: Template metadata files are out of alignment.' -ForegroundColor Red
    $findings | ForEach-Object {
        Write-Host "  $($_.Document) field $($_.Field) expected '$($_.Expected)' but found '$($_.Actual)'" -ForegroundColor Red
    }
    Write-Host ''
    Write-Host 'Update the adoption metadata files in the same change as the manifest bump.' -ForegroundColor Yellow
    exit 1
}

Write-Host 'Template metadata alignment check passed.' -ForegroundColor Green
exit 0
