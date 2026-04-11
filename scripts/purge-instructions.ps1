param(
    [switch]$Force
)
$dir = Join-Path $PSScriptRoot '..' 'instructions'
Write-Host "[purge] target: $dir"
if(!(Test-Path $dir)){ Write-Host '[purge] instructions dir missing'; exit 0 }
$baseline = @('obfuscation-pattern-gaps-2025.json','gates.json')
$files = Get-ChildItem $dir -File -Filter '*.json' | Where-Object { $_.Name -ne '.index-version' -and ($baseline -notcontains $_.Name) }
if(-not $Force -and $files.Count -gt 0){
  Write-Host "[purge] preview (use -Force to delete):"; $files | ForEach-Object { Write-Host (' - ' + $_.Name) }; exit 0
}
if($files.Count -eq 0){ Write-Host '[purge] nothing to delete'; exit 0 }
$files | Remove-Item -Force
Write-Host ("[purge] deleted {0} files (preserved: {1})" -f $files.Count, ($baseline -join ','))
