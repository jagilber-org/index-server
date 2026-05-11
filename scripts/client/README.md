# scripts/client

Client-side CLI tools and templates for connecting to a running Index Server via
MCP. These are the scripts users run against a deployed server; they do not
require the source tree to be built.

## Scripts

| Script | Purpose |
|--------|---------|
| `index-server-client.ps1` | PowerShell MCP client: connect, call tools interactively |
| `index-server-client.sh` | Bash equivalent for Linux/macOS |
| `powershell-mcp-server.ps1` | Example PowerShell-hosted MCP server (reference implementation) |
| `powershell-mcp-template.ps1` | Template for building a custom PowerShell MCP server |

## Quick start

```pwsh
# Connect to a local dev server (stdio transport)
pwsh -File scripts/client/index-server-client.ps1

# Connect to a remote HTTP endpoint
pwsh -File scripts/client/index-server-client.ps1 -Uri http://localhost:9100
```

> See `docs/client_scripts.md` and `docs/powershell_mcp_guide.md` for full usage.
