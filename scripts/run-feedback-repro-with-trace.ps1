param(
  [string]$TestFile = 'src/tests/feedbackReproduction.multiClient.spec.ts'
)
Write-Host '== Setting environment trace flags for test server =='
$env:INDEX_SERVER_TRACE_LEVEL='core'
$env:INDEX_SERVER_FILE_TRACE='1'
$env:INDEX_SERVER_TRACE_PERSIST='1'
$env:INDEX_SERVER_TRACE_SESSION='feedback-repro'
$traceDir = Join-Path (Get-Location) 'logs/trace'
if(-not (Test-Path $traceDir)){ New-Item -ItemType Directory -Path $traceDir | Out-Null }
$env:INDEX_SERVER_TRACE_FILE = (Join-Path $traceDir 'feedback-repro-trace.jsonl')
$env:INDEX_SERVER_MUTATION='1'
$env:INDEX_SERVER_ALWAYS_RELOAD='1'
Write-Host 'Trace file:' $env:INDEX_SERVER_TRACE_FILE
Write-Host 'Running vitest on' $TestFile
npx vitest run $TestFile --reporter=dot
Write-Host '== Test complete =='
if(Test-Path $env:INDEX_SERVER_TRACE_FILE){
  Write-Host 'Trace file size:' (Get-Item $env:INDEX_SERVER_TRACE_FILE).Length 'bytes'
  Write-Host 'Last 5 trace lines:'
  Get-Content $env:INDEX_SERVER_TRACE_FILE -Tail 5
} else {
  Write-Warning 'Trace file not found.'
}
