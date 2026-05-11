# Dev server orchestrator

Profile-sandboxed wrapper around the Index Server stdio MCP build for local
development. Each profile gets its own scratch directory under
`.devsandbox/<profile>/` (gitignored) so you can flip backends and embedding
configs without polluting the real `instructions/`, `data/`, or `feedback/`
trees.

> Important: This script is **dev-only**. It never reads or writes `c:\mcp\`
> and refuses to run if any computed path falls under it.

## Profiles

| Profile        | Storage backend | Embeddings | Default port base |
|----------------|-----------------|------------|-------------------|
| `json`         | JSON            | off        | 9100              |
| `sqlite`       | SQLite          | off        | 9110              |
| `json-embed`   | JSON            | on         | 9120              |
| `sqlite-embed` | SQLite          | on         | 9130              |

`dashboard = base`, `leader = base + 1`. Override with `-PortBase <n>`.

## Quick start

```pwsh
# Start, see the URL banner
pwsh -File scripts/dev/dev-server.ps1 -Action start  -Profile json

# List sandboxes / running PIDs
pwsh -File scripts/dev/dev-server.ps1 -Action list

# Verify a profile end-to-end (CRUD + keyword + semantic + verify-after-mutation)
pwsh -File scripts/dev/dev-server.ps1 -Action crud   -Profile sqlite-embed

# Leave the entries in place to simulate a richer dataset
pwsh -File scripts/dev/dev-server.ps1 -Action crud   -Profile json -Keep

# Skip the semantic-mode step (handy for non-embed profiles or when the model is unavailable)
pwsh -File scripts/dev/dev-server.ps1 -Action crud   -Profile sqlite -SkipSemantic

# Exercise all 8 contentType values: add → filter-search → filter-query → export round-trip → rejection
pwsh -File scripts/dev/dev-server.ps1 -Action contenttypes -Profile json
pwsh -File scripts/dev/dev-server.ps1 -Action contenttypes -Profile json -Keep

# Validate field-level boundaries: required fields, enums, priority bounds, lax mode, overwrite,
# non-existent resources, coercible values, governance fields, categories, unexpected properties
pwsh -File scripts/dev/dev-server.ps1 -Action validation -Profile json

# Export / import
pwsh -File scripts/dev/dev-server.ps1 -Action export -Profile json -OutFile .\dump.json
pwsh -File scripts/dev/dev-server.ps1 -Action import -Profile sqlite -InFile .\dump.json -Mode overwrite

# Restart
pwsh -File scripts/dev/dev-server.ps1 -Action restart -Profile json-embed

# Reset
pwsh -File scripts/dev/dev-server.ps1 -Action reset-flags    -Profile sqlite-embed
pwsh -File scripts/dev/dev-server.ps1 -Action reset-storage  -Profile sqlite-embed -Yes
pwsh -File scripts/dev/dev-server.ps1 -Action reset-all      -Profile sqlite-embed -Yes

# Stop
pwsh -File scripts/dev/dev-server.ps1 -Action stop -Profile json
```

## What gets logged

Every action and every result is written to:

- `.devsandbox/<profile>/dev-server.log` — orchestrator activity (start, stop, crud,
  import, export) and probe step pass/fail.
- `.devsandbox/<profile>/logs/stdout.log` and `stderr.log` — raw server output.
- The server itself also writes structured logs to its `INDEX_SERVER_LOG_DIR`
  (set per profile to the same `logs/` directory).

## How CRUD verification works

`scripts/dev/integrity/crud-probe.mjs` runs against a per-profile env file:

1. Adds three distinctive entries (hummingbird / sonar / espresso).
2. Reads each one back via `index_dispatch action=get` and asserts body length.
3. Updates one and verifies the new body is persisted.
4. Keyword search for `hummingbird` and `sonar` — must each return their entry.
5. Semantic search for `coffee brewing` (only when `INDEX_SERVER_SEMANTIC_ENABLED=1`)
   — must include the espresso entry.
6. Removes all three (unless `-Keep`) and verifies each is gone.

The probe writes a machine-readable JSON summary to stdout, the per-step
pass/fail to the activity log, and exits non-zero if any step fails.

## Script layout

```
scripts/dev/
  dev-server.ps1      # orchestrator (start/stop/crud/import/export/reset)
  transport/
    mcp-stdio.mjs     # shared MCP stdio harness; all probes import this
  diagnostic/
    info-probe.mjs    # read-only: report server config + instruction count
    shape-probe.mjs   # inline smoke test of list/export/import/remove
  integrity/
    crud-probe.mjs    # full CRUD + keyword/semantic search with read-back
    disk-server-consistency.mjs  # assert disk file count == server list count
    io-matrix.mjs     # exhaustive import/export round-trip matrix
  util/
    io-helper.mjs     # thin export/import CLI; called by dev-server.ps1
```

## Per-invocation overrides

```pwsh
pwsh -File scripts/dev/dev-server.ps1 -Action start -Profile json `
  -Override @{ INDEX_SERVER_LOG_LEVEL = 'debug'; INDEX_SERVER_AUTO_BACKUP = '1' }
```

Overrides are persisted to `.devsandbox/<profile>/overrides.env` so subsequent
starts inherit them. Clear with `-Action reset-flags`.

## Safety

- Refuses any operation whose computed path falls under `c:\mcp\`.
- `reset-storage` requires `-Yes` and refuses to wipe paths outside the
  profile sandbox.
- `start` is idempotent — re-running on a live profile logs a warning and
  reuses the existing PID.
