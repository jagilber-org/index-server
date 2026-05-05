# Index Server Client Scripts

REST client scripts for agents and users that lack MCP tool access. These scripts communicate with the Index Server dashboard REST bridge (`POST /api/tools/:name`) over HTTP/HTTPS.

## Available Scripts

| Script | Platform | Description |
|--------|----------|-------------|
| `index-server-client.ps1` | PowerShell 5.1+ / 7+ | Full-featured client with named parameters |
| `index-server-client.sh` | Bash (Linux/macOS/WSL) | POSIX-compatible client with positional args |

## Quick Start

### Download from a Running Server

If you have a running Index Server with the dashboard enabled:

```bash
# List available scripts
curl http://localhost:8787/api/scripts

# Download PowerShell script
curl -O http://localhost:8787/api/scripts/index-server-client.ps1

# Download Bash script
curl -O http://localhost:8787/api/scripts/index-server-client.sh
chmod +x index-server-client.sh
```

### Use from Repository

The scripts are in the `scripts/client/` directory of the repository:

```bash
# PowerShell
pwsh scripts/client/index-server-client.ps1 -Action health

# Bash
bash scripts/client/index-server-client.sh health
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEX_SERVER_URL` | `http://localhost:8787` | Base URL of the Index Server dashboard |
| `INDEX_SERVER_SKIP_CERT` | _(unset)_ | Set to `1` to skip TLS cert validation (Bash only) |

### PowerShell Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `-BaseUrl` | string | Server URL (overrides `INDEX_SERVER_URL`) |
| `-Action` | string | **Required.** One of: `search`, `get`, `list`, `add`, `remove`, `groom`, `health`, `track`, `hotset` |
| `-Id` | string | Instruction ID (for `get`, `remove`, `track`) |
| `-Keywords` | string[] | Search keywords (for `search`) |
| `-Mode` | string | Search mode: `keyword`, `regex`, `semantic` (default: `keyword`) |
| `-Body` | string | Instruction body (for `add`) |
| `-Title` | string | Instruction title (for `add`) |
| `-Priority` | int | Priority 1–100 (for `add`, default: 50) |
| `-Signal` | string | Usage signal: `helpful`, `not-relevant`, `outdated`, `applied` (for `track`) |
| `-Overwrite` | switch | Allow overwriting existing instruction (for `add`) |
| `-DryRun` | switch | Preview groom changes without writing (for `groom`) |
| `-Limit` | int | Max results (default: 50) |
| `-SkipCertCheck` | switch | Skip TLS certificate validation |

## Actions Reference

### health — Server Health Check

```powershell
# PowerShell
.\index-server-client.ps1 -Action health

# Bash
./index-server-client.sh health
```

**Returns:** Server status, uptime, version, catalog stats.

### search — Find Instructions

```powershell
# PowerShell
.\index-server-client.ps1 -Action search -Keywords deploy,release

# Bash
./index-server-client.sh search "deploy release"
./index-server-client.sh search "deploy release" semantic 10
```

**Modes:** `keyword` (default), `regex`, `semantic`

### get — Retrieve Instruction by ID

```powershell
# PowerShell
.\index-server-client.ps1 -Action get -Id "my-instruction-id"

# Bash
./index-server-client.sh get my-instruction-id
```

### list — Enumerate Instructions

```powershell
# PowerShell
.\index-server-client.ps1 -Action list -Limit 20
.\index-server-client.ps1 -Action list -Limit 20 -ExpectId "my-instruction-id"

# Bash
./index-server-client.sh list 20
```

Use `-ExpectId` in PowerShell validation or smoke tests to ask the server to prioritize a known instruction in list results.

### add — Create Instruction

```powershell
# PowerShell
.\index-server-client.ps1 -Action add -Id "new-inst" -Title "My Instruction" -Body "Content here" -Priority 60

# Bash
./index-server-client.sh add new-inst "My Instruction" "Content here" 60
```

**Note:** Works with the default runtime. Set `INDEX_SERVER_MUTATION=0` on the server if you intentionally want these write operations disabled.

### remove — Delete Instruction

```powershell
# PowerShell
.\index-server-client.ps1 -Action remove -Id "old-inst"

# Bash
./index-server-client.sh remove old-inst
```

**Note:** Works with the default runtime. Set `INDEX_SERVER_MUTATION=0` on the server if you intentionally want these write operations disabled.

### track — Record Usage Signal

```powershell
# PowerShell
.\index-server-client.ps1 -Action track -Id "some-inst" -Signal helpful

# Bash
./index-server-client.sh track some-inst helpful
```

**Signals:** `helpful`, `not-relevant`, `outdated`, `applied`

### hotset — Top-N Used Instructions

```powershell
# PowerShell
.\index-server-client.ps1 -Action hotset -Limit 10

# Bash
./index-server-client.sh hotset 10
```

### groom — Cleanup & Normalize

```powershell
# PowerShell
.\index-server-client.ps1 -Action groom -DryRun

# Bash
./index-server-client.sh groom --dry-run
```

## Output Format

Both scripts output structured JSON to stdout:

```json
{
  "success": true,
  "result": { /* tool response */ }
}
```

On error:

```json
{
  "success": false,
  "error": "Description of what went wrong",
  "status": 404
}
```

## For AI Agents

### When to Use These Scripts

Use these scripts when your agent runtime does **not** have native MCP tool access (e.g., subagents spawned without MCP, CI/CD pipelines, external automation).

If you have MCP tool access, prefer the native tools (`index_search`, `index_dispatch`, etc.) — they are faster and don't require a running dashboard.

### Agent Workflow Example

```bash
# 1. Check server health
result=$(./index-server-client.sh health)
echo "$result" | jq '.result'

# 2. Search for relevant instructions
result=$(./index-server-client.sh search "deployment kubernetes" keyword 10)
echo "$result" | jq '.result'

# 3. Get full instruction content
result=$(./index-server-client.sh get "k8s-deployment-guide")
echo "$result" | jq '.result'

# 4. Track what was useful
./index-server-client.sh track "k8s-deployment-guide" helpful
```

### Downloading in Automation

```bash
# Download script from Index Server, then use it
curl -sO http://your-index-server:8787/api/scripts/index-server-client.sh
chmod +x index-server-client.sh
./index-server-client.sh health
```

### HTTPS with Self-Signed Certificates

```powershell
# PowerShell
.\index-server-client.ps1 -BaseUrl https://localhost:8787 -Action health -SkipCertCheck

# Bash
INDEX_SERVER_SKIP_CERT=1 ./index-server-client.sh health
```

## Script Download API

The dashboard serves client scripts via HTTP for easy distribution:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scripts` | GET | List available scripts with metadata |
| `/api/scripts/:name` | GET | Download a specific script |

### Example: List Scripts

```bash
curl http://localhost:8787/api/scripts | jq
```

```json
{
  "scripts": [
    {
      "name": "index-server-client.ps1",
      "description": "PowerShell REST client for Index Server (agents without MCP)",
      "downloadUrl": "/api/scripts/index-server-client.ps1"
    },
    {
      "name": "index-server-client.sh",
      "description": "Bash REST client for Index Server (agents without MCP)",
      "downloadUrl": "/api/scripts/index-server-client.sh"
    }
  ]
}
```

## Testing

The client scripts have comprehensive E2E tests:

```bash
# Run all client script tests
npx vitest run src/tests/clientScriptsE2e.spec.ts

# Run with verbose output
npx vitest run src/tests/clientScriptsE2e.spec.ts --reporter=verbose
```

### Test Coverage

- **Download endpoint tests**: List scripts, download PS1/Bash, 404 handling, path traversal rejection, content integrity
- **PowerShell E2E**: health, search, list, get-without-id (error), search-without-keywords (error), hotset
- **Bash E2E**: health, search, list, unknown-action (error), hotset
- **Nmap security scans**: Port scan, service detection, adjacent port scan, TLS verification, HTTP method scan
- **Security header tests**: Cache-Control, X-Content-Type-Options, X-Powered-By suppression

Tests auto-skip when prerequisites aren't available (e.g., `pwsh` not installed, `nmap` not available).

### CI Pipeline

The `client-scripts-e2e.yml` workflow runs on:
- Push/PR to `main` when script files change
- Manual dispatch
- Both Ubuntu (Bash + nmap focused) and Windows (PowerShell focused) runners

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Connection refused" | Ensure the Index Server dashboard is running on the expected port |
| "Tool not found" | The handler may not be registered. Check `GET /api/tools` for available tools |
| TLS errors | Use `-SkipCertCheck` (PS1) or `INDEX_SERVER_SKIP_CERT=1` (Bash) for self-signed certs |
| Permission denied (Bash) | Run `chmod +x index-server-client.sh` |
| "Execution policy" (PS1) | Run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |
| Empty results | Verify the instruction catalog has entries: `./index-server-client.sh list 1` |
