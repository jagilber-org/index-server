<#
.SYNOPSIS
    Compare a target repository against the canonical template security surface.

.DESCRIPTION
    Reads the current template manifest and reports which files in a target
    repository should match the template exactly, which require merge review,
    and whether the target repo has recorded its adopted template version.

.EXAMPLE
    pwsh -File .\scripts\Compare-TemplateSpec.ps1 -TargetRepoPath C:\github\example-repo

.EXAMPLE
    pwsh -File .\scripts\Compare-TemplateSpec.ps1 -TargetRepoPath C:\github\example-repo -AsJson
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TargetRepoPath,

    [switch]$AsJson
)

$ErrorActionPreference = 'Stop'

function Get-TemplateFileComparison {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [hashtable]$Definition,

        [Parameter(Mandatory)]
        [string]$TemplateRoot,

        [Parameter(Mandatory)]
        [string]$ResolvedTargetRepoPath,

        [Parameter(Mandatory)]
        [string]$TemplateVersion,

        [hashtable[]]$LocalDeviations = @()
    )

    $templatePath = Join-Path $TemplateRoot $Definition.TemplatePath
    $targetRelativePath = if ($Definition.TargetPath) { $Definition.TargetPath } else { $Definition.TemplatePath }
    $targetPath = Join-Path $ResolvedTargetRepoPath $targetRelativePath

    $result = [ordered]@{
        Path = $targetRelativePath
        Strategy = $Definition.Strategy
        Reason = $Definition.Reason
        Exists = Test-Path $targetPath
        Status = $null
        Action = $null
        RecordedTemplateVersion = $null
    }

    # Template-source-only files are optional for adopters
    if ($Definition.TemplateSourceOnly -and -not $result.Exists) {
        $result.Status = 'TemplateSourceOnly'
        $result.Action = 'Optional — this surface is specific to the template source repo'
        return [pscustomobject]$result
    }

    if ($Definition.Strategy -eq 'AdoptionMarker') {
        if (-not $result.Exists) {
            $result.Status = 'Missing'
            $result.Action = 'Create .template-adoption.json from template-adoption.example.json'
            return [pscustomobject]$result
        }

        try {
            $adoption = Get-Content -Raw -Path $targetPath | ConvertFrom-Json
            $result.RecordedTemplateVersion = $adoption.templateVersion
            if ($adoption.templateVersion -eq $TemplateVersion) {
                $result.Status = 'MatchesTemplateVersion'
                $result.Action = 'None'
            }
            else {
                $result.Status = 'VersionMismatch'
                $result.Action = 'Review and update .template-adoption.json after the repo fully adopts the target template version'
            }
        }
        catch {
            $result.Status = 'Invalid'
            $result.Action = 'Fix malformed .template-adoption.json before updating the repo'
        }

        return [pscustomobject]$result
    }

    if (-not $result.Exists) {
        # Check if there is a recorded local deviation for this missing surface
        # Match against full path, filename, or path without leading dot-directory
        $fileName = Split-Path $targetRelativePath -Leaf
        $deviation = $LocalDeviations | Where-Object {
            $_.surface -eq $targetRelativePath -or
            $_.surface -eq $fileName -or
            $targetRelativePath -like "*/$($_.surface)" -or
            $targetRelativePath -like "*\$($_.surface)"
        } | Select-Object -First 1
        if ($deviation) {
            $result.Status = 'DeviationRecorded'
            $result.Action = "Deviation: $($deviation.deviation)"
        }
        else {
            $result.Status = 'Missing'
            $result.Action = if ($Definition.Strategy -eq 'ExactMatch') {
                'Copy from template'
            }
            elseif ($Definition.Strategy -eq 'MergeReview') {
                'Create file and then reconcile repo-specific behavior'
            }
            else {
                'Create a repo-specific version using the template as a starting point'
            }
        }

        return [pscustomobject]$result
    }

    if ($Definition.Strategy -eq 'RepoSpecific') {
        $result.Status = 'Review'
        $result.Action = 'Keep repo-specific content, but confirm the required sections still exist'
        return [pscustomobject]$result
    }

    $templateHash = (Get-FileHash -Path $templatePath -Algorithm SHA256).Hash
    $targetHash = (Get-FileHash -Path $targetPath -Algorithm SHA256).Hash

    if ($templateHash -eq $targetHash) {
        $result.Status = 'MatchesTemplate'
        $result.Action = 'None'
    }
    else {
        # Check if there is a recorded local deviation for this surface
        $fileName = Split-Path $targetRelativePath -Leaf
        $deviation = $LocalDeviations | Where-Object {
            $_.surface -eq $targetRelativePath -or
            $_.surface -eq $fileName -or
            $targetRelativePath -like "*/$($_.surface)" -or
            $targetRelativePath -like "*\$($_.surface)"
        } | Select-Object -First 1
        if ($deviation) {
            $result.Status = 'DeviationRecorded'
            $result.Action = "Deviation: $($deviation.deviation)"
        }
        else {
            $result.Status = 'Differs'
            $result.Action = if ($Definition.Strategy -eq 'ExactMatch') {
                'Review and align with the template'
            }
            else {
                'Review and merge the template delta without removing repo-specific behavior'
            }
        }
    }

    return [pscustomobject]$result
}

$templateRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $templateRoot 'template-manifest.json'

if (-not (Test-Path $TargetRepoPath)) {
    throw "TargetRepoPath does not exist: $TargetRepoPath"
}

$resolvedTargetRepoPath = (Resolve-Path -Path $TargetRepoPath).Path
$manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json

# Load local deviations from target repo's adoption file
$localDeviations = @()
$adoptionPath = Join-Path $resolvedTargetRepoPath '.template-adoption.json'
if (Test-Path $adoptionPath) {
    try {
        $adoption = Get-Content -Raw -Path $adoptionPath | ConvertFrom-Json
        if ($adoption.localDeviations -and $adoption.localDeviations -is [array]) {
            $localDeviations = @($adoption.localDeviations | ForEach-Object {
                if ($_ -is [string]) {
                    # Legacy string format: treat the string as both surface and deviation description
                    @{ surface = $_; deviation = $_ }
                } else {
                    # Current object format: { surface, deviation }
                    @{ surface = $_.surface; deviation = $_.deviation }
                }
            })
        }
    }
    catch {
        Write-Warning "Could not parse .template-adoption.json localDeviations: $_"
    }
}

$fileDefinitions = @(
    @{ TemplatePath = '.template-adoption.example.json'; TargetPath = '.template-adoption.json'; Strategy = 'AdoptionMarker'; Reason = 'Tracks which template version the target repo has adopted.' }
    @{ TemplatePath = '.pre-commit-config.yaml'; Strategy = 'ExactMatch'; Reason = 'Defines the canonical hook orchestration surface.' }
    @{ TemplatePath = '.gitleaks.toml'; Strategy = 'MergeReview'; Reason = 'Gitleaks defaults may need narrow repo-specific tuning while preserving the template baseline.' }
    @{ TemplatePath = '.ggshield.yml'; Strategy = 'MergeReview'; Reason = 'GGShield exclusions may need repo-specific tuning while preserving the template baseline.' }
    @{ TemplatePath = '.pii-allowlist'; Strategy = 'MergeReview'; Reason = 'Repos may add SHA-pin or domain allowlist entries beyond the canonical baseline.' }
    @{ TemplatePath = '.pii-file-allowlist'; Strategy = 'MergeReview'; Reason = 'Repos may add file-level PII scan exclusions for known false-positive sources.' }
    @{ TemplatePath = '.secrets.baseline'; Strategy = 'ExactMatch'; Reason = 'Carries the baseline secret scanner state.' }
    @{ TemplatePath = '.semgrep.yml'; Strategy = 'MergeReview'; Reason = 'Repos may add custom Semgrep rules while preserving the canonical security rules.' }
    @{ TemplatePath = '.instructions/README.md'; Strategy = 'ExactMatch'; Reason = 'Defines the canonical local-instructions layout and coexistence rules.' }
    @{ TemplatePath = '.instructions/shared/repository-security-hooks.md'; Strategy = 'ExactMatch'; Reason = 'Canonical shared hook guidance should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/template-adoption-workflow.md'; Strategy = 'ExactMatch'; Reason = 'Canonical template adoption workflow should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/index-server-bootstrap.md'; Strategy = 'ExactMatch'; Reason = 'Canonical index-server bootstrap guidance should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/squad-index-server-complement.md'; Strategy = 'ExactMatch'; Reason = 'Canonical squad and index-server complement guidance should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/git-workflow.md'; Strategy = 'ExactMatch'; Reason = 'Canonical git workflow spec should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/observability-logging.md'; Strategy = 'ExactMatch'; Reason = 'Canonical observability and logging defaults should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/codeql-configuration-patterns.md'; Strategy = 'ExactMatch'; Reason = 'Canonical CodeQL opt-in guidance should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/language-ecosystem-patterns.md'; Strategy = 'ExactMatch'; Reason = 'Canonical language ecosystem guidance covering dependency graph, Dependabot, audit, and SAST patterns.' }
    @{ TemplatePath = '.instructions/shared/adopter-hook-patterns.md'; Strategy = 'ExactMatch'; Reason = 'Canonical adopter hook wrapper guidance should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/public-mirror-guard.md'; Strategy = 'ExactMatch'; Reason = 'Canonical public-mirror push guard documentation should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/mirrored-release-workflow.md'; Strategy = 'ExactMatch'; Reason = 'Canonical mirrored-release workflow documentation should remain aligned with the template.' }
    @{ TemplatePath = '.instructions/shared/iac-patterns.md'; Strategy = 'ExactMatch'; Reason = 'Canonical IaC governance patterns should remain aligned with the template.' }
    @{ TemplatePath = 'hooks/block-dotenv.ps1'; Strategy = 'ExactMatch'; Reason = 'Canonical forbidden-file hook implementation.' }
    @{ TemplatePath = 'hooks/check-pii.ps1'; Strategy = 'ExactMatch'; Reason = 'Canonical curated PII hook implementation.' }
    @{ TemplatePath = 'hooks/check-env-leaks.ps1'; Strategy = 'ExactMatch'; Reason = 'Canonical exact environment leak hook implementation.' }
    @{ TemplatePath = 'hooks/pre-push-public-guard.ps1'; Strategy = 'ExactMatch'; Reason = 'Canonical protected-remote enforcement hook.' }
    @{ TemplatePath = 'hooks/run-semgrep-pre-push.ps1'; Strategy = 'ExactMatch'; Reason = 'Canonical Semgrep pre-push wrapper ensures cross-platform UTF-8 execution.' }
    @{ TemplatePath = 'scripts/validate-template-metadata.ps1'; Strategy = 'ExactMatch'; Reason = 'Canonical template metadata validation should stay aligned with the manifest contract.' }
    @{ TemplatePath = 'scripts/test-hook-regressions.ps1'; Strategy = 'ExactMatch'; Reason = 'Canonical hook regression coverage should stay aligned with the hook implementations.' }
    @{ TemplatePath = 'scripts/Publish-ToPublicRepo.ps1'; Strategy = 'MergeReview'; Reason = 'Deprecated wrapper — forwards to New-CleanRoomCopy.ps1. Kept for backward compatibility.' }
    @{ TemplatePath = 'scripts/New-CleanRoomCopy.ps1'; Strategy = 'MergeReview'; Reason = 'Safe clean-room content preparation script. Agent-invokable.' }
    @{ TemplatePath = 'scripts/Publish-ToMirror.ps1'; Strategy = 'MergeReview'; Reason = 'Human-supervised remote delivery with content-hash verification and sanctioned-remote enforcement.' }
    @{ TemplatePath = '.publish-config.json'; Strategy = 'MergeReview'; Reason = 'Sanctioned remote configuration for publish guard and mirror delivery.' }
    @{ TemplatePath = 'scripts/migrate-manifest-schema.ps1'; Strategy = 'ExactMatch'; Reason = 'Canonical manifest schema migration helper should stay aligned with the template.' }
    @{ TemplatePath = 'scripts/Compare-TemplateSpec.ps1'; Strategy = 'ExactMatch'; Reason = 'Canonical comparison helper should stay aligned with the template.' }
    @{ TemplatePath = 'scripts/setup-hooks.ps1'; Strategy = 'MergeReview'; Reason = 'Bootstrap script should adopt template behavior while preserving repo-specific setup guidance.' }
    @{ TemplatePath = 'scripts/sync-constitution.ps1'; Strategy = 'MergeReview'; Reason = 'Constitution sync script should stay aligned while allowing repo-specific constitution content.' }
    @{ TemplatePath = '.github/workflows/precommit.yml'; Strategy = 'MergeReview'; Reason = 'CI security workflow often needs repo-specific coexistence with other jobs.' }
    @{ TemplatePath = '.github/workflows/ggshield-secret-scans.yml'; Strategy = 'MergeReview'; Reason = 'Dedicated ggshield CI workflow may need to coexist with repo-specific CI and branch-protection settings.' }
    @{ TemplatePath = '.github/workflows/gitleaks-secret-scans.yml'; Strategy = 'MergeReview'; Reason = 'Dedicated gitleaks CI workflow may need to coexist with repo-specific CI and branch-protection settings.' }
    @{ TemplatePath = '.github/workflows/semgrep.yml'; Strategy = 'MergeReview'; Reason = 'Dedicated Semgrep CI workflow may need to coexist with repo-specific CI and branch-protection settings.' }
    @{ TemplatePath = '.github/workflows/auto-tag.yml'; Strategy = 'MergeReview'; TemplateSourceOnly = $true; Reason = 'Template-source-only: auto-tags templateVersion bumps. Adopters with their own tag strategy can skip this.' }
    @{ TemplatePath = '.github/workflows/promotion-freshness.yml'; Strategy = 'MergeReview'; TemplateSourceOnly = $true; Reason = 'Template-source-only: validates promotion-map source file presence. Adopters without index-server promotion can skip this.' }
    @{ TemplatePath = '.github/workflows/release.yml'; Strategy = 'MergeReview'; TemplateSourceOnly = $true; Reason = 'Template-source-only: creates GitHub Releases from CHANGELOG on tag push. Adopters with their own release workflow can skip this.' }
    @{ TemplatePath = '.github/ISSUE_TEMPLATE/bug_report.yml'; Strategy = 'MergeReview'; Reason = 'Issue template forms may need repo-specific fields or labels.' }
    @{ TemplatePath = '.github/ISSUE_TEMPLATE/feature_request.yml'; Strategy = 'MergeReview'; Reason = 'Issue template forms may need repo-specific fields or labels.' }
    @{ TemplatePath = '.github/ISSUE_TEMPLATE/template_change.yml'; Strategy = 'MergeReview'; Reason = 'Template-change issue form tracks upstream template issues.' }
    @{ TemplatePath = '.github/ISSUE_TEMPLATE/config.yml'; Strategy = 'ExactMatch'; Reason = 'Issue template chooser config should stay aligned.' }
    @{ TemplatePath = '.github/pull_request_template.md'; Strategy = 'MergeReview'; Reason = 'PR template may need repo-specific checklist items.' }
    @{ TemplatePath = '.github/dependabot.yml'; Strategy = 'MergeReview'; Reason = 'Dependabot config may need repo-specific ecosystem entries.' }
    @{ TemplatePath = '.github/CODEOWNERS'; Strategy = 'RepoSpecific'; Reason = 'Code ownership assignments are inherently repo-specific.' }
    @{ TemplatePath = '.gitignore'; Strategy = 'MergeReview'; Reason = 'Generated report paths and ignore rules must merge with repo-specific ignores.' }
    @{ TemplatePath = '.github/copilot-instructions.md'; Strategy = 'MergeReview'; Reason = 'Copilot instructions should adopt the template retrieval order while preserving repo-specific guidance.' }
    @{ TemplatePath = 'constitution.json'; Strategy = 'MergeReview'; Reason = 'Constitution source should adopt the template baseline while allowing repo-specific rules.' }
    @{ TemplatePath = 'constitution.md'; Strategy = 'MergeReview'; Reason = 'Generated constitution markdown should stay aligned with constitution.json.' }
    @{ TemplatePath = '.specify/config/promotion-map.json'; Strategy = 'MergeReview'; Reason = 'Promotion map should start from the template baseline and then reflect repo-specific sources.' }
    @{ TemplatePath = 'SECURITY.md'; Strategy = 'RepoSpecific'; Reason = 'Security policy should reflect the repo contact and disclosure process.' }
    @{ TemplatePath = 'CONTRIBUTING.md'; Strategy = 'RepoSpecific'; Reason = 'Contributing guidelines should reflect the repo development workflow.' }
    @{ TemplatePath = 'CODE_OF_CONDUCT.md'; Strategy = 'RepoSpecific'; Reason = 'Code of conduct should reflect the repo community standards.' }
    @{ TemplatePath = 'CHANGELOG.md'; Strategy = 'RepoSpecific'; Reason = 'Changelog content is inherently repo-specific.' }
    @{ TemplatePath = 'LICENSE'; Strategy = 'RepoSpecific'; Reason = 'Repository licensing should be explicit, but the chosen license text is intentionally repo-specific for adopters.' }
    @{ TemplatePath = 'README.md'; Strategy = 'RepoSpecific'; Reason = 'Top-level documentation should remain repo-specific.' }
    @{ TemplatePath = '.instructions/local/project-context.md'; Strategy = 'RepoSpecific'; Reason = 'Local project context is intentionally repo-specific.' }
    @{ TemplatePath = '.specify/README.md'; Strategy = 'RepoSpecific'; Reason = 'Optional spec-driven scaffolding guidance should be tailored to the repo.' }
)

$fileResults = foreach ($definition in $fileDefinitions) {
    Get-TemplateFileComparison -Definition $definition -TemplateRoot $templateRoot -ResolvedTargetRepoPath $resolvedTargetRepoPath -TemplateVersion $manifest.templateVersion -LocalDeviations $localDeviations
}

$adoptionMarker = $fileResults | Where-Object { $_.Strategy -eq 'AdoptionMarker' } | Select-Object -First 1
$adoptedTemplateVersion = if ($adoptionMarker -and $adoptionMarker.RecordedTemplateVersion) {
    $adoptionMarker.RecordedTemplateVersion
}
else {
    $null
}

$summary = [ordered]@{
    TargetRepoPath = $resolvedTargetRepoPath
    TemplateName = $manifest.templateName
    TemplateVersion = $manifest.templateVersion
    HookStandardVersion = $manifest.hookStandardVersion
    AdoptedTemplateVersion = $adoptedTemplateVersion
    ExactMatchFilesOutOfSync = @($fileResults | Where-Object { $_.Strategy -eq 'ExactMatch' -and $_.Status -ne 'MatchesTemplate' }).Count
    MergeReviewFilesNeedingAttention = @($fileResults | Where-Object { $_.Strategy -eq 'MergeReview' -and $_.Status -ne 'MatchesTemplate' }).Count
    RepoSpecificFilesToReview = @($fileResults | Where-Object { $_.Strategy -eq 'RepoSpecific' }).Count
}

$report = [ordered]@{
    Summary = [pscustomobject]$summary
    Files = $fileResults
}

if ($AsJson) {
    $report | ConvertTo-Json -Depth 5
    return
}

Write-Host ("Template: {0} {1}" -f $manifest.templateName, $manifest.templateVersion) -ForegroundColor Cyan
Write-Host ("Target repo: {0}" -f $resolvedTargetRepoPath) -ForegroundColor Cyan

if ($adoptedTemplateVersion) {
    Write-Host ("Recorded adopted version: {0}" -f $adoptedTemplateVersion) -ForegroundColor DarkGray
}
else {
    Write-Host 'Recorded adopted version: <missing>' -ForegroundColor Yellow
}

Write-Host ''
($fileResults | Select-Object Path, Strategy, Status, Action | Format-Table -AutoSize) | Out-String | Write-Host

Write-Host 'Recommended update order:' -ForegroundColor Cyan
Write-Host '1. Fix missing or divergent ExactMatch files.'
Write-Host '2. Reconcile MergeReview files without removing repo-specific behavior.'
Write-Host '3. Review RepoSpecific files manually.'
Write-Host '4. Run focused pre-commit validation on changed files, then pre-commit run --all-files.'
Write-Host '5. Update .template-adoption.json after the repo fully adopts the target template version.'
