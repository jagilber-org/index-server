# scripts/deploy

Deployment and production operations. These scripts manage the lifecycle of the
production server under `C:\mcp\`. They require explicit paths and `-Yes`
confirmation flags for destructive operations.

## Scripts

| Script | Purpose |
|--------|---------|
| `deploy-local.ps1` | Copy clean-room build artifacts to the local production path |
| `Load-RepoEnv.ps1` | Load production env vars from `server.json` into the shell |
| `New-CleanRoomCopy.ps1` | Produce a sanitized copy of the repo for safe publishing |
| `prod-health.ps1` | Run health checks against the live production server |
| `smoke-deploy.ps1` | Deploy + run a fast smoke test to verify the deployment succeeded |
| `start-monitoring.ps1` | Start background health-monitoring loop for the production server |

## Safety rules

- These scripts **write to `C:\mcp\`** — never run them from the dev sandbox.
- `New-CleanRoomCopy.ps1` runs the full PII/secret scan before any file copy.
- Destructive operations require `-Yes` confirmation.

> See `docs/deployment.md` for the full deployment runbook.
