# scripts/dev/integrity

Probes that assert correctness by mutating sandbox state and verifying
every step. All exit non-zero on any verification failure.

## Scripts

| Script | What it verifies |
|--------|-----------------|
| `validation-probe.mjs` | Field-validation boundary probe — 12 phases: required field rejections, enum bounds, priority range (1–100), lax-mode auto-fill, overwrite semantics, non-existent resource behavior, coercible/legacy values, governance field round-trip, valid enum coverage, categories edge cases (gap-probe steps surface known server gaps), unexpected property rejection. Invoked by `dev-server.ps1 -Action validation`. |
| `contenttype-probe.mjs` | All 8 canonical `contentType` values (agent, skill, instruction, prompt, workflow, knowledge, template, integration): add → read-back (type preserved) → omit-contentType defaults to instruction → overwrite changes contentType → `index_search` filter → `index_dispatch` query+list filters → export round-trip → rejection of removed type → cleanup. Invoked by `dev-server.ps1 -Action contenttypes`. |
| `crud-probe.mjs` | Full CRUD lifecycle: add (4 corpus entries) → read-back → update → keyword search → multi-keyword AND semantics → semantic search → remove → post-delete search absence. Invoked by `dev-server.ps1 -Action crud`. |
| `disk-server-consistency.mjs` | Disk `.json` file count matches `index_dispatch list` count before and after N synthetic insertions. |
| `io-matrix.mjs` | Exhaustive import/export matrix: add N → export → remove → import → re-import (no-op). Asserts disk and server stay in lockstep across all 11 steps. |

## Usage

```pwsh
# Via orchestrator (preferred)
pwsh -File scripts/dev/dev-server.ps1 -Action validation -Profile json

pwsh -File scripts/dev/dev-server.ps1 -Action contenttypes -Profile json
pwsh -File scripts/dev/dev-server.ps1 -Action contenttypes -Profile json -Keep

pwsh -File scripts/dev/dev-server.ps1 -Action crud -Profile json
pwsh -File scripts/dev/dev-server.ps1 -Action crud -Profile json -Keep -SkipSemantic

# Directly
node scripts/dev/integrity/validation-probe.mjs \
     --env-file .devsandbox/json/server.env \
     --log-file .devsandbox/json/validation-probe.log

node scripts/dev/integrity/contenttype-probe.mjs \
     --env-file .devsandbox/json/server.env \
     --log-file .devsandbox/json/dev-server.log

node scripts/dev/integrity/crud-probe.mjs \
     --env-file .devsandbox/json/server.env \
     --log-file .devsandbox/json/dev-server.log

node scripts/dev/integrity/disk-server-consistency.mjs \
     --env-file .devsandbox/json/server.env --count 3

node scripts/dev/integrity/io-matrix.mjs \
     --env-file .devsandbox/json/server.env --count 3 --id-prefix iom
```

All probes use `../transport/mcp-stdio.mjs` and output a machine-readable JSON
summary to stdout.
