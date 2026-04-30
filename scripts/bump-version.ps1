Param(
  [Parameter(Mandatory=$true)][ValidateSet('major','minor','patch')] [string]$Type,
  [string]$ChangelogMessage
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PackageVersion {
  $pkg = Get-Content -Raw -Path (Join-Path $PSScriptRoot '..' 'package.json') | ConvertFrom-Json
  return $pkg.version
}

function Set-PackageVersion($newVersion) {
  $path = Join-Path $PSScriptRoot '..' 'package.json'
  $json = Get-Content -Raw -Path $path | ConvertFrom-Json
  $json.version = $newVersion
  ($json | ConvertTo-Json -Depth 10) | Out-File -Encoding UTF8 $path
}

function Set-ServerManifestVersion($newVersion) {
  $path = Join-Path $PSScriptRoot '..' 'server.json'
  if (-not (Test-Path $path)) { return }
  $json = Get-Content -Raw -Path $path | ConvertFrom-Json
  $json.version = $newVersion
  if ($json.PSObject.Properties.Name -contains 'packages' -and $json.packages) {
    foreach ($pkg in $json.packages) { $pkg.version = $newVersion }
  }
  $serialized = ($json | ConvertTo-Json -Depth 20).TrimEnd("`r","`n") + "`n"
  [System.IO.File]::WriteAllText($path, $serialized, [System.Text.UTF8Encoding]::new($false))
}

function Write-ChangelogEntryNormalized($changelogPath, $entryText) {
  # Append entry then rewrite the whole file with LF endings + exactly one trailing newline
  # so end-of-file-fixer (Linux CI) does not flag the file.
  $existing = if (Test-Path $changelogPath) { [System.IO.File]::ReadAllText($changelogPath) } else { '' }
  $combined = ($existing -replace "`r`n","`n").TrimEnd("`n") + "`n" + ($entryText -replace "`r`n","`n").TrimEnd("`n") + "`n"
  [System.IO.File]::WriteAllText($changelogPath, $combined, [System.Text.UTF8Encoding]::new($false))
}

function Increment-Version($version, $type){
  $parts = $version.Split('.')
  if($parts.Length -ne 3){ throw "Unexpected version format: $version" }
  [int]$maj = $parts[0]; [int]$min = $parts[1]; [int]$pat = $parts[2]
  switch($type){
    'major' { $maj++; $min=0; $pat=0 }
    'minor' { $min++; $pat=0 }
    'patch' { $pat++ }
  }
  return "$maj.$min.$pat"
}

# Guard: clean working tree
$status = git status --porcelain
if($status){ throw 'Working tree not clean. Commit or stash before bumping version.' }

$current = Get-PackageVersion
$next = Increment-Version $current $Type
Write-Host "Current version: $current -> Next: $next"

Set-PackageVersion $next
Set-ServerManifestVersion $next

# Update CHANGELOG.md
$changelogPath = Join-Path $PSScriptRoot '..' 'CHANGELOG.md'
if(Test-Path $changelogPath){
  $date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
  if($ChangelogMessage){
    $entry = "## [$next] - $date`n`n### Added`n`n- $ChangelogMessage"
  } else {
    $entry = "## [$next] - $date"
  }
  Write-ChangelogEntryNormalized $changelogPath $entry
}

git add package.json server.json CHANGELOG.md
# `--no-gpg-sign` / `--no-sign` prevent GPG passphrase prompts from hanging
# release scripts on Windows where pinentry may pop a TTY-only dialog.
# See issue #235.
git commit --no-gpg-sign -m "chore(release): v$next" --author='mcp-bot <mcp-bot@example.local>' | Out-Null # pii-allowlist: bot placeholder
git tag --no-sign -a "v$next" -m "v$next"

Write-Host "Version bumped to $next and tagged. Push with: git push --follow-tags"
