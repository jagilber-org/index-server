<#
 Minimal PowerShell MCP Server (stdio JSON-RPC) for isolation handshake testing.
 Implements:
   - initialize (id:1) -> returns protocolVersion / serverInfo / capabilities
   - emits server/ready notification AFTER initialize result
   - emits notifications/tools/list_changed after ready
   - tools/list request handler
   - tools/call with a single demo tool (echo/upper)
   - ping request (latency / reachability)
 Exits automatically after 30s of inactivity or when INDEX_SERVER_PWS_EXIT_MS is set.
#>

param(
  [int] $IdleExitMs = [int]([Environment]::GetEnvironmentVariable('INDEX_SERVER_PWS_EXIT_MS') | ForEach-Object { if($_){$_} else {30000} })
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8

$start = Get-Date
$readyEmitted = $false
$tools = @(
  @{ name = 'echo/upper'; description = 'Uppercase a string'; inputSchema = @{ type='object'; properties = @{ text = @{ type='string'} }; required = @('text') } }
)

function Write-Json($obj){
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  [Console]::Out.WriteLine($json)
}

function Send-ReadyOnce {
  if(-not $script:readyEmitted){
    Write-Json @{ jsonrpc='2.0'; method='server/ready'; params=@{ version='0.1.0'; reason='pwsh-minimal' } }
    Write-Json @{ jsonrpc='2.0'; method='notifications/tools/list_changed'; params=@{} }
    $script:readyEmitted = $true
  }
}

$lastActivity = Get-Date

while($true){
  if([Console]::In.Peek() -lt 0){ Start-Sleep -Milliseconds 20 } else {
    $line = [Console]::In.ReadLine()
    if([string]::IsNullOrWhiteSpace($line)){ continue }
    $lastActivity = Get-Date
    try { $msg = $line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
    $id = $msg.id
    $method = $msg.method
    if($method -eq 'initialize'){
      $proto = if($msg.params.protocolVersion){ $msg.params.protocolVersion } else { '2025-06-18' }
      $result = @{ protocolVersion=$proto; serverInfo=@{ name='powershell-mcp-minimal'; version='0.1.0' }; capabilities=@{ tools=@{ listChanged=$true } } }
      Write-Json @{ jsonrpc='2.0'; id=$id; result=$result }
      Start-Sleep -Milliseconds 15
      Send-ReadyOnce
      continue
    }
    if($method -eq 'tools/list'){
      Write-Json @{ jsonrpc='2.0'; id=$id; result=@{ tools=$tools } }
      continue
    }
    if($method -eq 'tools/call'){
      $name = $msg.params.name
      if($name -eq 'echo/upper'){
        $text = $msg.params.arguments.text
        $out = [string]::IsNullOrEmpty($text) ? '' : $text.ToUpperInvariant()
        $payload = @{ content = @(@{ type='text'; text=$out }) }
        Write-Json @{ jsonrpc='2.0'; id=$id; result=$payload }
      } else {
        Write-Json @{ jsonrpc='2.0'; id=$id; error=@{ code=-32601; message='Unknown tool'; data=@{ tool=$name } } }
      }
      continue
    }
    if($method -eq 'ping'){
      Write-Json @{ jsonrpc='2.0'; id=$id; result=@{ timestamp=(Get-Date).ToString('o'); uptimeMs=([int]((Get-Date)-$start).TotalMilliseconds) } }
      continue
    }
    if($id){ Write-Json @{ jsonrpc='2.0'; id=$id; error=@{ code=-32601; message='Method not found'; data=@{ method=$method } } } }
  }
  if(((Get-Date)-$lastActivity).TotalMilliseconds -gt $IdleExitMs){ break }
}

exit 0
