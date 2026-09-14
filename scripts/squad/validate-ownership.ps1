<#
.SYNOPSIS
  Validates worktree ownership manifest against actual git worktrees and PR state.

.DESCRIPTION
  Detects three classes of inconsistency:
  1. Phantom worktrees — manifest entries whose paths are not in `git worktree list`
  2. Phantom claims — manifest entries for branches whose PRs are already merged
  3. Unmanaged worktrees — git worktrees with no corresponding manifest entry

  Local checks (1, 3) work offline. PR-merge check (2) degrades gracefully
  when `gh` CLI is unavailable.

.PARAMETER ManifestPath
  Path to the ownership manifest JSON file.
  Default: .squad/worktrees/ownership.json (relative to repo root).

.PARAMETER RepoRoot
  Path to the git repository root. Default: current directory.

.EXAMPLE
  pwsh scripts/squad/validate-ownership.ps1
  pwsh scripts/squad/validate-ownership.ps1 -ManifestPath .squad/worktrees/ownership.json
#>
[CmdletBinding()]
param(
    [string]$ManifestPath,
    [string]$RepoRoot = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Resolve paths ────────────────────────────────────────────────────────────

if (-not $ManifestPath) {
    $ManifestPath = Join-Path $RepoRoot '.squad/worktrees/ownership.json'
}

if (-not (Test-Path $ManifestPath)) {
    Write-Error "Manifest not found: $ManifestPath"
    exit 1
}

# ── Parse manifest ───────────────────────────────────────────────────────────

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$worktreeEntries = @()
if ($manifest.worktrees) {
    $worktreeEntries = @($manifest.worktrees)
}

# ── Collect git worktrees ────────────────────────────────────────────────────

$gitWorktreeRaw = & git -C $RepoRoot worktree list --porcelain 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "git worktree list failed: $gitWorktreeRaw"
    exit 1
}

$gitWorktrees = @{}
$currentPath = $null
foreach ($line in $gitWorktreeRaw -split "`n") {
    $line = $line.Trim()
    if ($line -match '^worktree (.+)$') {
        $currentPath = $Matches[1].Replace('\', '/')
    }
    elseif ($line -match '^branch refs/heads/(.+)$' -and $currentPath) {
        $gitWorktrees[$currentPath] = $Matches[1]
        $currentPath = $null
    }
    elseif ($line -eq '' -and $currentPath) {
        # Detached HEAD or bare — record path with no branch
        if (-not $gitWorktrees.ContainsKey($currentPath)) {
            $gitWorktrees[$currentPath] = $null
        }
        $currentPath = $null
    }
}

# ── Detect `gh` availability ────────────────────────────────────────────────

$hasGh = $false
try {
    $null = & gh --version 2>&1
    if ($LASTEXITCODE -eq 0) { $hasGh = $true }
} catch {
    # gh not installed
}

# ── Validation ───────────────────────────────────────────────────────────────

$failures = @()

# Normalize a path for comparison (forward slashes, no trailing slash)
function Normalize-PathForCompare {
    param([string]$Path)
    $Path.Replace('\', '/').TrimEnd('/')
}

# Main checkout path (skip it in unmanaged check)
$mainPath = $null
if ($manifest.mainCheckout -and $manifest.mainCheckout.path) {
    $mainPath = Normalize-PathForCompare $manifest.mainCheckout.path
}

foreach ($entry in $worktreeEntries) {
    $entryPath = Normalize-PathForCompare $entry.path
    $entryBranch = $entry.branch

    # ── Check 1: Phantom worktree (path not in git worktree list) ────────
    $found = $false
    foreach ($gp in $gitWorktrees.Keys) {
        if ((Normalize-PathForCompare $gp) -eq $entryPath) {
            $found = $true
            break
        }
    }
    if (-not $found) {
        $failures += [PSCustomObject]@{
            Check       = 'phantom-worktree'
            Entry       = $entry.owner ?? 'unknown'
            Branch      = $entryBranch
            Path        = $entry.path
            Remediation = "Remove manifest entry or run: git worktree add `"$($entry.path)`" $entryBranch"
        }
    }

    # ── Check 2: Phantom claim (branch PR already merged) ────────────────
    if ($hasGh -and $entryBranch) {
        try {
            $prJson = & gh pr list --head $entryBranch --state merged --json number,title --limit 1 2>&1
            if ($LASTEXITCODE -eq 0 -and $prJson) {
                $prs = $prJson | ConvertFrom-Json
                if ($prs -and $prs.Count -gt 0) {
                    $failures += [PSCustomObject]@{
                        Check       = 'phantom-claim'
                        Entry       = $entry.owner ?? 'unknown'
                        Branch      = $entryBranch
                        PR          = "#$($prs[0].number)"
                        Remediation = "Remove manifest entry and run: git worktree remove `"$($entry.path)`""
                    }
                }
            }
        } catch {
            # gh query failed — degrade gracefully
            Write-Warning "gh pr query failed for branch $entryBranch — skipping merge check"
        }
    }
}

# ── Check 3: Unmanaged worktrees (git worktree with no manifest entry) ───

$manifestPaths = @()
if ($mainPath) { $manifestPaths += $mainPath }
foreach ($entry in $worktreeEntries) {
    $manifestPaths += Normalize-PathForCompare $entry.path
}

foreach ($gp in $gitWorktrees.Keys) {
    $gpNorm = Normalize-PathForCompare $gp
    if ($gpNorm -notin $manifestPaths) {
        $branch = $gitWorktrees[$gp]
        $failures += [PSCustomObject]@{
            Check       = 'unmanaged-worktree'
            Branch      = $branch ?? '(detached)'
            Path        = $gp
            Remediation = "Add manifest entry or run: git worktree remove `"$gp`""
        }
    }
}

# ── Report ───────────────────────────────────────────────────────────────────

if ($failures.Count -eq 0) {
    Write-Host "validate-ownership: OK ($($worktreeEntries.Count) manifest entries, $($gitWorktrees.Count) git worktrees)" -ForegroundColor Green
    exit 0
}

Write-Host "validate-ownership: $($failures.Count) issue(s) found" -ForegroundColor Red
Write-Host ""

foreach ($f in $failures) {
    Write-Host "  [$($f.Check)]" -ForegroundColor Yellow -NoNewline
    Write-Host " branch=$($f.Branch)" -NoNewline
    if ($f.PSObject.Properties["Path"]) { Write-Host " path=$($f.Path)" -NoNewline }
    if ($f.PSObject.Properties["PR"]) { Write-Host " pr=$($f.PR)" -NoNewline }
    if ($f.PSObject.Properties["Entry"]) { Write-Host " agent=$($f.Entry)" -NoNewline }
    Write-Host ""
    Write-Host "    Remediation: $($f.Remediation)" -ForegroundColor Cyan
}

exit 1
