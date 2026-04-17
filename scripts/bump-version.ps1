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

# Update CHANGELOG.md
$changelogPath = Join-Path $PSScriptRoot '..' 'CHANGELOG.md'
if(Test-Path $changelogPath){
  $date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
  $entry = "`n## [$next] - $date`n`n### Added`n`n- $ChangelogMessage".TrimEnd()
  if(-not $ChangelogMessage){ $entry = "`n## [$next] - $date`n" }
  Add-Content -Path $changelogPath -Value $entry
}

git add package.json CHANGELOG.md
git commit -m "chore(release): v$next" --author='mcp-bot <mcp-bot@example.local>' | Out-Null # pii-allowlist: bot placeholder
git tag "v$next"

Write-Host "Version bumped to $next and tagged. Push with: git push --follow-tags"
