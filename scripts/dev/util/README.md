# scripts/dev/util

Thin CLI utilities called by `dev-server.ps1`. Not self-contained probes —
these are action wrappers that the orchestrator calls with pre-validated arguments.

## Scripts

| Script | Purpose |
|--------|---------|
| `io-helper.mjs` | Export all instructions to a JSON file, or import a JSON file via `index_import`. Verifies success by re-listing after the operation. |

## Usage

```pwsh
# Export
node scripts/dev/util/io-helper.mjs export \
     --env-file .devsandbox/json/server.env --out ./backup.json

# Import (skip duplicates)
node scripts/dev/util/io-helper.mjs import \
     --env-file .devsandbox/json/server.env --in ./backup.json --mode skip

# Import (overwrite existing)
node scripts/dev/util/io-helper.mjs import \
     --env-file .devsandbox/json/server.env --in ./backup.json --mode overwrite
```

Prefer calling via `dev-server.ps1 -Action export` / `-Action import` which
handles path validation and activity logging.
