# scripts/dist/

User-facing utility scripts bundled into the VSIX extension package.

These are copied from `scripts/` during the build. Edit the originals in `scripts/`, not here.

## Included Scripts

| Script | Purpose |
|--------|---------|
| `generate-certs.mjs` | Generate self-signed TLS certificates for HTTPS dashboard |
| `setup-wizard.mjs` | Interactive profile selection and config generation |
| `index-server-client.ps1` | PowerShell REST client for subagents without MCP access |
| `index-server-client.sh` | Bash REST client for subagents without MCP access |
| `health-check.mjs` | Lightweight JSON-RPC health check via stdio |
