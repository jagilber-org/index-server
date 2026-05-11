# scripts/dev/diagnostic

Read-only probes that inspect a sandbox profile without mutating state.
Safe to run against any profile at any time.

## Scripts

| Script | Purpose |
|--------|---------|
| `info-probe.mjs` | Report server config and instruction count from a profile env file |
| `shape-probe.mjs` | Quick inline smoke test: list → export → import → remove, verifying response shapes |

## Usage

```pwsh
# Invoked by dev-server.ps1 (status action) or directly:
node scripts/dev/diagnostic/info-probe.mjs --env-file .devsandbox/json/server.env

node scripts/dev/diagnostic/shape-probe.mjs .devsandbox/json/server.env
```

Both scripts use `../transport/mcp-stdio.mjs` and exit non-zero on failure.
