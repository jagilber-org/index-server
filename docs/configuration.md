# Configuration Guide

Complete configuration and deployment reference for Index.

This guide covers:
- VS Code integration and troubleshooting
- **Agent Bootstrapping & P0 Instruction** (NEW)
- Local production deployment setup
- Security and mutation control
- Bootstrap confirmation workflow

---

## Agent Bootstrapping with P0 Instruction

### Overview

Index automatically seeds **canonical bootstrap-tier instructions** that provide comprehensive onboarding guidance for AI agents. These instructions are the foundation of the **knowledge flywheel** that enables agents to discover, learn, create, and share institutional knowledge.

The seeded set is:

| ID | Tier | Purpose |
|---|---|---|
| `000-bootstrapper` | P0 | Activation, essential tools, contribution workflow |
| `001-lifecycle-bootstrap` | P0 | Lifecycle handshake / index materialization |
| `002-content-model` | P1 | Required-field set, `contentType` decision matrix, pointer to `index_schema` (derived from `schemas/instruction.schema.json` at module load — single source of truth) |

### What is the P0 Bootstrap Instruction?

The bootstrap instruction (`id: "000-bootstrapper"`) is an auto-generated, comprehensive guide that teaches AI agents:

\u2705 **Activation** - How to verify Index is active and configure it if not  
\ud83c\udfaf **Essential Commands** - Core tools like `index_search`, `index_dispatch`, `health_check`  
\ud83d\udca1 **Real Examples** - Practical use cases with exact JSON-RPC commands  
\ud83d\udd04 **When to Use** - Clear guidance on when to query the index vs. other tools  
\ud83d\udce4 **Contributing Back** - How to promote validated local patterns to shared index  
\ud83c\udd98 **Troubleshooting** - Common issues and resolution steps  

### Auto-Seeding Process

**On First Launch:**
1. Server checks if `instructions/000-bootstrapper.json` exists
2. If missing (fresh install), auto-creates it with current best practices
3. Never overwrites existing file (preserves customizations)
4. Version field enables agents to detect updates

**Environment Control:**
- `INDEX_SERVER_AUTO_SEED=0` - Disables auto-seeding (default: enabled)
- Seed occurs only if directory is empty OR bootstrap files are missing

### How Agents Discover It

**Automatic Discovery:**
Agents working in any repository can query the production index:

```json
{"method": "index_dispatch", "params": {"action": "get", "id": "000-bootstrapper"}}
```

**Result:**
- Full, up-to-date bootstrap guide retrieved from shared index
- No need for per-repo copies
- Always reflects latest activation patterns and troubleshooting tips

**User Command:**
To direct an agent to bootstrap a new repository:

```
Get and follow the bootstrap guide: {"method": "index_dispatch", "params": {"action": "get", "id": "000-bootstrapper"}}. Then create proper .instructions/ directory with JSON files for this repo's architecture and patterns.
```

### Knowledge Flywheel Workflow

The bootstrap instruction establishes a **local-first, promote-when-proven** workflow:

**Phase 1: Local Creation**
1. Agent encounters problem or pattern in repository
2. Creates `.instructions/` directory in repo
3. Documents solution as JSON instruction file
4. Tests over multiple sessions

**Phase 2: Validation**
1. Agent uses instruction successfully across sessions
2. Pattern proves valuable and stable
3. No repo-specific hardcoded paths/credentials

**Phase 3: Promotion** (Optional)
1. Agent determines pattern applies organization-wide
2. Uses `index_add` to promote to shared index
3. Leave writes enabled for governed production workflows, or set `INDEX_SERVER_MUTATION=0` when you need an explicit read-only production runtime
4. Other teams immediately benefit

**Phase 4: Amplification**
1. Other agents discover shared instruction
2. They apply it in their repos
3. They contribute new patterns
4. Institutional knowledge compounds

### Local-First Strategy (P0 Priority)

**Keep Local (.instructions/ in repo):**
\u274c Repo-specific build commands  
\u274c Team-only conventions  
\u274c Experimental patterns  
\u274c Sensitive paths or credentials  
\u274c Project-specific file structures  

**Promote to Shared Index:**
\u2705 Architectural patterns (microservices, event-driven, etc.)  
\u2705 Coding standards (error handling, logging, testing)  
\u2705 Security policies (authentication, input validation)  
\u2705 API design guidelines  
\u2705 Common troubleshooting procedures  

### Version Management

**Current Version:** v2 (as of February 2026)

**Version History:**
- **v1** - Initial release (focused on mutation token workflow)
- **v2** - Added activation guide, real examples, troubleshooting, contribution workflow, periodic update reminders

**Update Process:**
1. Update canonical seed in `src/services/seedBootstrap.ts`
2. Increment `version` field
3. Deploy to production
4. Agents auto-discover updated version when they query

**Agent Update Check:**
Agents should periodically re-query the bootstrap instruction to get latest guidance, especially:
- When starting work in new repository
- After Index updates
- When troubleshooting connection issues
- Every few weeks for active projects

### Configuration Examples

**Production Server (Read-Only + Bootstrap):**
```json
{
  "mcpServers": {
    "mcp-index-production": {
      "command": "node",
      "args": ["<user-data-dir>/index-server/dist/server/index-server.js"],
      "env": {
        "INDEX_SERVER_DIR": "<user-data-dir>/index-server/instructions",
        "INDEX_SERVER_AUTO_SEED": "1"
      }
    }
  }
}
```

**Development Server (Mutation Enabled):**
```json
{
  "mcpServers": {
    "mcp-index-dev": {
      "command": "node",
      "args": ["C:/github/index-server/dist/server/index-server.js"],
      "env": {
        "INDEX_SERVER_DIR": "./instructions",
        "INDEX_SERVER_AUTO_SEED": "1"
      }
    }
  }
}
```

Use `INDEX_SERVER_DIR` for a stable data path outside editor or MCP client config/install folders so backups and reinstalls do not disturb your catalog.

Generated MCP configs also set `INDEX_SERVER_SEARCH_OMIT_ZERO_QUERY=1` so zero-result validation searches do not echo deleted test identifiers in the response metadata. Normal server configurations leave this unset and retain the standard `query` block in search responses.

### Related Documentation

- [Content Guidance](content_guidance.md) - Local-first P0 vs shared P1 strategy
- [Bootstrap Instruction Source](../src/services/seedBootstrap.ts) - Canonical seed definition
- [README](../README.md) - Knowledge flywheel overview
- [tools.md](tools.md) - Complete MCP tool reference

---
## Troubleshooting VS Code Connection

If VS Code shows "Configured but Not Connected":

1. **Build the server**: Ensure `dist/server/index-server.js` exists by running `npm run build`
2. **Check the path**: Use absolute path to the server executable in your `mcp.json`
3. **Restart VS Code**: MCP connections require a full VS Code restart after configuration changes
4. **Test manually**: Quick smoke (initialize then list tools):

  ```bash
  (echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"manual-test","version":"0.0.0"},"capabilities":{"tools":{}}}}; ^
   timeout /t 1 >NUL & echo {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}) | node dist/server/index-server.js
  ```

  (On PowerShell you can instead run two separate writes while the process is running.)

1. **Check logs**: Enable `INDEX_SERVER_VERBOSE_LOGGING=1` to see connection details in VS Code developer console

---

## Local Production Deployment

Quick script creates a trimmed runtime copy (dist + minimal package.json + seed instructions) at your configured production install root.
Existing runtime instructions are now ALWAYS preserved; before any overwrite a timestamped backup is created under `backups/` (unless `-NoBackup`).

Steps:

1. Build locally (if not already):

  ```powershell
  npm run build
  ```

1. Deploy (creates backup of existing instructions when present):

  ```powershell
  pwsh scripts/deploy-local.ps1 -Destination <production-install-root> -Rebuild -Overwrite
  ```

1. Install production deps (inside destination):

  ```powershell
  cd <production-install-root>
  npm install --production
  ```

1. (First-time only) Generate `.env` and MCP client config via the setup wizard:

  ```powershell
  node dist/server/index-server.js --setup
  ```

1. Start server (PowerShell):

  ```powershell
  pwsh .\start.ps1 -VerboseLogging -EnableMutation
  ```

  Or (cmd):

  ```cmd
  start.cmd
  ```

1. Configure global VS Code `mcp.json` to point `cwd` to your production install root and `args: ["dist/server/index-server.js"]`.

Notes:

* The deploy script skips copying transient or fuzz / concurrent temp instruction files.
* Re-run the deploy with `-Overwrite` to refresh dist/runtime files (instructions never deleted).
* Automatic backup: `backups/instructions-YYYYMMDD-HHMMSS/` (retention default 10; configure with `-BackupRetention N` or disable via `-NoBackup`).
* Restore latest backup:

  ```powershell
  pwsh scripts/restore-instructions.ps1 -Destination <production-install-root>
  ```
  
* Restore specific backup (overwriting existing):

  ```powershell
  pwsh scripts/restore-instructions.ps1 -Destination <production-install-root> -BackupName instructions-20250828-153011 -Force
  ```
  
* Fast code-only sync (no rebuild/tests, assumes local dist is current):

  ```powershell
  pwsh scripts/sync-dist.ps1 -Destination <production-install-root> -UpdatePackage
  ```
  
* Governance & usage data live inside the instruction JSON files; keeping backups provides full recoverability.

Optional: Create a scheduled task or Windows Service wrapper invoking `pwsh -File <production-install-root>\start.ps1 -EnableMutation` for auto-start.

### Deployment Manifest & Post-Deploy Smoke Test (1.5.x)

Every invocation of `scripts/deploy-local.ps1` now writes `deployment-manifest.json` at the deployment root.
This manifest is an immutable audit record of what was deployed, how, and with which core artifacts.

Manifest fields (stable, additive only):

| Field | Description |
|-------|-------------|
| `name` / `version` | Runtime package identity copied from trimmed `package.json` |
| `deployedAt` | ISO 8601 UTC timestamp of manifest creation |
| `destination` | Absolute deployment path |
| `gitCommit` | Source HEAD commit (or placeholder if no `.git` present) |
| `build.rebuild` / `overwrite` / `bundleDeps` | Flags passed to deploy script (`bundleDeps` is always true — production dependencies are always installed using the lock file) |
| `build.allowStaleDistOnRebuildFailure` | Indicates fallback to existing `dist/` was permitted |
| `build.forceSeed` / `emptyIndex` | Instruction seeding strategy captured for provenance |
| `build.backupRetention` | Retention limit applied to timestamped instruction backups |
| `environment.nodeVersion` | Node runtime version at deploy time (used for drift / repro) |
| `artifacts.serverIndex.sha256` | Hash of `dist/server/index-server.js` (deploy-time integrity anchor) |
| `artifacts.instructionSchema.sha256` | Hash of runtime schema file (if present) |
| `instructions.runtimeCount` | Count of non-template instruction JSON files deployed |
| `instructions.mode` | Derived classification of instruction seeding (`empty-index`, `force-seed`, etc.) |

Integrity Rationale:

* Guarantees reproducibility (exact server bundle + schema hash).
* Facilitates post-deploy diff checks (compare manifests across versions).
* Decouples operational drift detection from live filesystem state.

#### Smoke Validation

Use the new script `scripts/smoke-deploy.ps1` to verify a deployment quickly before pointing clients at it:

```powershell
pwsh scripts/smoke-deploy.ps1 -Path <production-install-root> -Json
```

Checks performed:

1. `dist/server/index-server.js` exists and its SHA256 matches the manifest.
2. `schemas/instruction.schema.json` presence + hash (soft-fail unless `-Strict`).
3. Instruction runtime count matches manifest record.
4. Derived instruction mode matches persisted `instructions.mode`.
5. Local `node -v` equals recorded `environment.nodeVersion` (drift detection).

Exit Codes:

* `0` – All required checks passed
* `1` – One or more integrity checks failed

Flags:

* `-Json` – Emit machine-readable summary (always safe for CI ingestion)
* `-Strict` – Treat missing optional artifacts (schema) as failures

Typical CI pattern after deployment:

```powershell
pwsh scripts/deploy-local.ps1 -Destination <production-install-root> -Rebuild -Overwrite
pwsh scripts/smoke-deploy.ps1 -Path <production-install-root> -Json
```

Manifest Comparison Example (PowerShell):

```powershell
Compare-Object \
  (Get-Content <production-install-root>\deployment-manifest.json | ConvertFrom-Json) \
  (Get-Content <previous-production-install-root>\deployment-manifest.json | ConvertFrom-Json) -Property version, gitCommit, artifacts
```

This surfaces version / commit / hash drift succinctly without scanning full directory trees.

Recommended Next Step (future enhancement): integrate a lightweight live tool probe (`health_check`, `meta_tools`) into an extended smoke script for end-to-end process validation after starting the server. The current script intentionally avoids starting processes to remain side-effect free.


### Admin Dashboard Usage (Optional)

```bash
# For administrators only - not for MCP clients
node dist/server/index-server.js --dashboard --dashboard-port=8787
# Dashboard accessible at http://localhost:8787
```

#### TLS Bootstrap (`--init-cert`)

To bootstrap a self-signed TLS certificate for the dashboard from the CLI (no
wizard required), use the `--init-cert` switch family. Requires `openssl` on
PATH.

```bash
# Generate cert+key under ~/.index-server/certs/, then exit
node dist/server/index-server.js --init-cert

# Generate AND continue startup with HTTPS auto-wired
node dist/server/index-server.js --init-cert --start --dashboard
```

Flag summary (`--init-cert`, `--cert-dir`, `--cert-file`, `--key-file`,
`--cn`, `--san`, `--days`, `--key-bits`, `--force`,
`--print-env[=posix|powershell|both|auto]`, `--start`). Path-traversal
guarded; private key permissions set to `0600` on POSIX. **No new
`INDEX_SERVER_*` env vars are introduced in v1** — the switch only writes
files and (with `--start`) feeds them into the running process. See
[`cert_init.md`](cert_init.md) for the full reference.

### Development

1. Install dependencies: `npm ci`
2. Build: `npm run build` (TypeScript -> `dist/`)
3. Test: `npm test`
4. Run: `npm start` (auto-builds first via `prestart`)

### Build & Scripts

| Script | Purpose |
|--------|---------|
| `npm run build` | One-shot TypeScript compile to `dist/` |
| `npm start` | Runs server after implicit build (`prestart`) |
| `npm run build:watch` | Continuous incremental compilation during development |
| `npm run dev` | Runs built server with Node's `--watch` (restarts on JS changes) |
| `npm run check:dist` | CI-friendly guard: fails if `dist/` changes after a fresh build (stale committed output) |

Recommended dev workflow (two terminals):

```pwsh
# Terminal 1 - compiler
npm run build:watch

# Terminal 2 - run server (restarts on new compiled output if using an external watcher like nodemon)
npm start
```

To enforce generated artifacts consistency in CI, add `npm run check:dist` before packaging or releasing.

#### Add / Remove Instructions (Mutation Examples)

```bash
node dist/server/index-server.js
# Remove via MCP tools/call:
# method: index_remove
# params: { "ids": ["obsolete-id-1", "deprecated-foo"] }

# Add (single entry) via MCP tools/call:
# method: index_add
# params: { "entry": { "id": "new-id", "body": "Instruction text" }, "lax": true }
```

#### Add Response Contract (1.0.7+)

`index_add` now enforces atomic visibility + readability before signaling success.

Success response (subset):

```jsonc
{
  "id": "example-id",
  "created": true,            // Only true if record was not pre-existing AND is now durably readable
  "overwritten": false,       // True only when overwrite path explicitly taken
  "skipped": false,           // True when duplicate without overwrite
  "hash": "<Index-hash>",
  "verified": true            // Additional guard: read-back + shape & non-empty title/body validated
}
```

Unified failure response:

```jsonc
{
  "created": false,
  "error": "mandatory/critical require owner",   // Stable machine-parsable reason
  "feedbackHint": "Submit feedback_submit with reproEntry to report add failure",
  "reproEntry": { "id": "bad-id", "title": "...", "body": "..." }
}
```

Failure reasons (non-exhaustive):

* `missing entry`
* `missing id`
* `missing required fields`
* `P1 requires category & owner`
* `mandatory/critical require owner`
* `write-failed`
* `atomic_readback_failed`
* `readback_invalid_shape`

Client guidance:

1. If `created:false`, inspect `error`.
2. Present human help text (map error → explanation) or prompt user to review governance requirements.
3. Offer one-click escalation: call `feedback_submit` including `reproEntry` + the server-reported `error` string.
4. Retry only after adjusting entry to satisfy governance or required field gaps.

Common troubleshooting:

* **"missing entry" error**: Ensure parameters are `{ "entry": { ... instruction ... } }`, not the instruction object directly
* **Backup restoration**: Extract individual instruction objects from backup files before calling add
* **Bulk import**: Use `index_import` for multiple entries, not repeated `index_add` calls

##### Schema-Aided Failure Guidance (1.1.0+)

For structural / shape errors (`missing entry`, `missing id`, `missing required fields`) the server now embeds the authoritative input schema directly in the failure response so clients can self-correct without an extra discovery round trip.

Example failure payload:

```jsonc
{
  "created": false,
  "error": "missing entry",
  "feedbackHint": "Submit feedback_submit with reproEntry to report add failure",
  "reproEntry": { "id": "bad-id", "body": "..." },
  "schemaRef": "index_add#input",          // Stable logical reference
  "inputSchema": {                                 // JSON Schema excerpt (may evolve additively)
    "type": "object",
    "required": ["entry"],
    "properties": {
      "entry": {
        "type": "object",
        "required": ["id", "body"],
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "body": { "type": "string", "minLength": 1 }
        }
      },
      "overwrite": { "type": "boolean" },
      "lax": { "type": "boolean" }
    }
  }
}


  ## 🖼️ UI Drift Detection & Snapshot Baseline

  Automated Playwright snapshot tests guard critical dashboard regions (system health card, instruction list + semantic summaries). The workflow `UI Drift Detection` runs on every push / PR and nightly to surface unintended structural or visual regressions.

  Maintenance:

  1. Intentional UI change -> run locally:

    ```bash
    npm run build
    npm run pw:baseline   # updates baseline snapshots
    git add tests/playwright/baseline.spec.ts-snapshots
    git commit -m "test: refresh playwright baseline after <reason>"
    ```
  2. CI failure triage:
    * Download `playwright-drift-artifacts` from the run
    * Open `playwright-report/index.html` for visual diffs
    * If change is expected, follow step (1); otherwise fix regression and re-run.

  Environment overrides:
  * `DASHBOARD_PORT` – choose port for local run-playwright server (default 8787)
  * `PLAYWRIGHT_UPDATE_SNAPSHOTS` / `--update` flag handled automatically by `pw:baseline` script

  Scope discipline keeps snapshots low-noise—avoid broad full-page screenshots unless necessary.

  ## 🐢 Slow Test Quarantine Strategy

  Some high-value regression tests are currently unstable (multi-client coordination & governance hash timing). They are quarantined from the default `test:slow` run to restore push velocity while stabilization work proceeds.

  Quarantined list lives in `scripts/test-slow.mjs` under `unstable`. Run them explicitly with:

  ```bash
  INCLUDE_UNSTABLE_SLOW=1 npm run test:slow
  ```

  Once stabilized, remove from `unstable` to reincorporate into regular slow gate.

### Slow Test Environment Flags

| Variable | Purpose | Typical Usage |
|----------|---------|---------------|
| `ALLOW_FAILING_SLOW=1` | Temporarily bypass failing slow suite in pre-push or CI gating while keeping visibility | Set locally to unblock while investigating failures |
| `INCLUDE_UNSTABLE_SLOW=1` | Force inclusion of quarantined unstable specs listed in `scripts/test-slow.mjs` | Periodic stabilization runs or targeted repro |

Governance: avoid committing code that permanently relies on these flags; they are short-term velocity aids. Document root cause and planned fix when using in PR descriptions.

Client remediation strategy:

1. If `schemaRef` present, prefer using `inputSchema` immediately for validation / UI hints.
2. If you had sent a flat object (e.g. `{ "id":"x", "body":"y" }`), wrap it: `{ "entry": { "id":"x", "body":"y" } }`.
3. Cache the schema per session (invalidate on `tools/list` change or version bump) rather than hard-coding shapes.
4. Continue to call `tools/list` for canonical schemas; the inline schema is a convenience, not a replacement for standard discovery.

Notes:

* Inline schema only appears for early shape gaps; governance / semantic failures (e.g. `mandatory/critical require owner`) do not echo the full schema.
* Fields may gain additive properties; treat unknown properties as forward-compatible.
* `schemaRef` is stable; you can key a local schema cache with it.

Backward compatibility: The additional fields (`verified`, `feedbackHint`, `reproEntry`) are additive; existing clients ignoring unknown keys continue working.

Process lifecycle: See `docs/feedback_defect_lifecycle.md` for the end-to-end feedback → red test → fix → verification workflow governing changes like this response contract hardening.

---

## Security & Mutation Control

* **INDEX_SERVER_MUTATION=0**: Forces read-only mode when you need to disable write operations explicitly
* **INDEX_SERVER_MAX_BULK_DELETE=N**: Caps bulk deletion at N IDs (default 5); exceeding requires `force: true` and triggers auto-backup
* **INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE=1**: Auto-snapshots instructions before forced bulk deletes (default on)
* **INDEX_SERVER_AUTO_BACKUP=1**: Enables automatic periodic backup of the instruction index (default on). Backups are written to `backups/auto-backup-{timestamp}/` and old snapshots are pruned to `INDEX_SERVER_AUTO_BACKUP_MAX_COUNT`.
* **INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS=3600000**: Interval between automatic backups in milliseconds (default 1 hour)
* **INDEX_SERVER_AUTO_BACKUP_MAX_COUNT=10**: Maximum number of auto-backup snapshots to retain (default 10)
* **INDEX_SERVER_VERBOSE_LOGGING=1**: Detailed logging for debugging
* **Input validation**: AJV-based schema validation with fail-open fallback

### Ownership Auto-Assignment

Provide an `owners.json` at repo root to auto-assign owners during add/import/bootstrap. Example:

```json
{
  "ownership": [
    { "pattern": "^auth_", "owner": "security-team" },
    { "pattern": "^db_", "owner": "data-team" },
    { "pattern": ".*", "owner": "unowned" }
  ]
}
```

First matching regex wins; fallback keeps `unowned`.

### Bootstrap Guard CI

Workflow `.github/workflows/instruction-bootstrap-guard.yml` runs Index enrichment (`node scripts/bootstrap-Index.mjs`) and fails if any normalized governance fields or canonical snapshot changes were not committed, preventing drift between PR content and canonical state.

### Tool Name Compatibility (1.0.0 Simplification)

All legacy underscore alias method names were removed in 1.0.0. Only canonical slash-form tool names are supported and must be invoked via `tools/call`.

Migration examples:

| Legacy (pre-1.0) direct call | 1.0+ Required Form |
|------------------------------|--------------------|
| `{ "method":"health_check" }` | `{ "method":"tools/call", "params": { "name":"health_check", "arguments":{} } }` |
| `{ "method":"health_check" }` | (unsupported) use canonical above |
| `{ "method":"metrics_snapshot" }` | `{ "method":"tools/call", "params": { "name":"metrics_snapshot" } }` |
| `{ "method":"usage_track" }` | `{ "method":"tools/call", "params": { "name":"usage_track", "arguments": { "id":"sample" } } }` |

Rationale: a single execution pathway (tools/call) eliminates duplicate validation, reduces races, and clarifies capability negotiation.

### Governance Validation Script

`node scripts/validate-governance.mjs` ensures all instruction JSON files include required governance + semantic fields. Added to bootstrap guard workflow.

* **Gated mutations**: Write operations are enabled by default, but bootstrap confirmation and reference mode still gate mutation flows
* **Process isolation**: MCP clients communicate via stdio only (no network access)

### Environment Flags

#### Core Configuration

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_DIR` | `./instructions` | runtime | Root directory containing instruction JSON files. |
| `INDEX_SERVER_CACHE_MODE` | `normal` | runtime | Index caching mode: `normal`, `memoize`, `memoize+hash`, `reload`, `reload+memo`. |
| `INDEX_SERVER_ALWAYS_RELOAD` | off | runtime | Force full reload on every Index access (disables caching). |
| `INDEX_SERVER_MEMOIZE` | off | runtime | Enable memoized Index caching (mtime/size heuristic). |
| `INDEX_SERVER_MEMOIZE_HASH` | off | runtime | Enable SHA-256 hash verification for memoized cache. |
| `INDEX_SERVER_WORKSPACE` | (none) | runtime | Workspace identifier for Index operations. Alt: `WORKSPACE_ID`. |
| `INDEX_SERVER_AGENT_ID` | (none) | runtime | Agent identifier for attribution tracking. |
| `INDEX_SERVER_PROFILE` | `default` | runtime | Runtime profile name. |
| `INDEX_SERVER_VALIDATION_MODE` | `zod` | runtime | Validation engine: `zod` or `ajv`. |
| `INDEX_SERVER_FEATURES` | (none) | runtime | Comma-separated feature flags: `usage`, `window`, `hotness`, `drift`, `risk`. |

#### Mutation Control

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_MUTATION` | on | runtime | Mutating tools are enabled by default. Set `0` to force read-only mode. |
| `INDEX_SERVER_STRICT_CREATE` | off | runtime | Require atomic visibility after create operations. |
| `INDEX_SERVER_STRICT_REMOVE` | off | runtime | Require atomic visibility after remove operations. |
| `INDEX_SERVER_REQUIRE_CATEGORY` | off | runtime | Require category field on new entries. |
| `INDEX_SERVER_CANONICAL_DISABLE` | off | runtime | Disable canonical ID enforcement. |
| `INDEX_SERVER_MAX_BULK_DELETE` | 5 | runtime | Maximum number of IDs `index_remove` deletes without `force: true`. |
| `INDEX_SERVER_BACKUP_BEFORE_BULK_DELETE` | on | runtime | Snapshot instruction files before forced bulk delete. Set `0` to disable. |
| `INDEX_SERVER_AUTO_SPLIT_OVERSIZED` | off | runtime | Auto-split oversized entries on startup instead of truncating. |
| `INDEX_SERVER_BODY_WARN_LENGTH` | 50000 | runtime | Body warn/truncate threshold for instruction entries. Range: 1000 to 1000000. |

#### Backup

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_AUTO_BACKUP` | on | runtime | Enable automatic periodic backup. Set `0` to disable. |
| `INDEX_SERVER_AUTO_BACKUP_INTERVAL_MS` | 3600000 | runtime | Interval between automatic backups in milliseconds (default 1 hour). |
| `INDEX_SERVER_AUTO_BACKUP_MAX_COUNT` | 10 | runtime | Maximum auto-backup snapshots to retain. |
| `INDEX_SERVER_BACKUPS_DIR` | `./backups` | runtime | Directory for backup snapshots. |

**Zip-based backups:** All backup operations (auto-backup, bulk-delete safety snapshots, admin panel exports) produce `.zip` archives via `adm-zip`. Backup files are named `auto-backup-{YYYYMMDD-HHMM}.zip` with a numeric suffix if a collision occurs.

* **JSON backend:** All `.json` instruction files are compressed into a single zip. Optionally includes a `manifest.json` entry with backup metadata.
* **SQLite backend:** Backups create a directory (not zip) containing the database file (`index.db`) plus WAL and SHM files (`index.db-wal`, `index.db-shm`) if they exist. This preserves the full database state including uncommitted WAL transactions.
* **Retention:** After each backup cycle, snapshots exceeding `INDEX_SERVER_AUTO_BACKUP_MAX_COUNT` are pruned oldest-first (lexicographic sort on ISO-timestamp filenames).
* **Timer behavior:** The backup timer is unreferenced (`unref()`) so it will not keep the Node.js process alive.

**Restore:** Use `extractZipBackup(zipPath, targetDir)` from `src/services/backupZip.ts` to extract `.json` files from a zip backup. Governance metadata (owner, status, sourceHash, changeLog) is preserved through the backup/restore cycle.

#### Dashboard

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_DASHBOARD` | off | runtime | Enable admin dashboard (0=disable, 1=enable). |
| `INDEX_SERVER_DASHBOARD_PORT` | 8787 | runtime | Dashboard HTTP port. |
| `INDEX_SERVER_DASHBOARD_HOST` | 127.0.0.1 | runtime | Dashboard bind address. |
| `INDEX_SERVER_DASHBOARD_TRIES` | 10 | runtime | Maximum port retry attempts when port is busy. |
| `INDEX_SERVER_DASHBOARD_GRAPH` | off | runtime | Enable graph visualization in dashboard. |
| `INDEX_SERVER_DASHBOARD_TLS` | off | runtime | Enable TLS for dashboard. |
| `INDEX_SERVER_DASHBOARD_TLS_CERT` | (none) | runtime | Path to TLS certificate file. |
| `INDEX_SERVER_DASHBOARD_TLS_KEY` | (none) | runtime | Path to TLS private key file. |
| `INDEX_SERVER_DASHBOARD_TLS_CA` | (none) | runtime | Path to TLS CA certificate file. |
| `INDEX_SERVER_HTTP_METRICS` | off | runtime | Enable HTTP request metrics collection. |

#### Logging & Tracing

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_LOG_LEVEL` | `info` | runtime | Log level: `error`, `warn`, `info`, `debug`, `trace`. |
| `INDEX_SERVER_VERBOSE_LOGGING` | off | runtime | Enables detailed diagnostic logging. |
| `INDEX_SERVER_FILE_TRACE` | off | runtime | Promote index file events to trace level. |
| `INDEX_SERVER_LOG_FILE` | (none) | runtime | Enable file-based logging. Set `1` for default path or a file path. |
| `INDEX_SERVER_LOG_JSON` | off | runtime | Emit logs in JSON format. |
| `INDEX_SERVER_LOG_SYNC` | off | runtime | Enable synchronous log writes. |
| `INDEX_SERVER_LOG_DIAG` | off | runtime | Enable runtime diagnostic logging. |
| `INDEX_SERVER_LOG_PROTOCOL` | off | runtime | Log protocol-level messages. |
| `INDEX_SERVER_LOG_MUTATION` | off | runtime | Emit mutation-specific verbose logs. |
| `INDEX_SERVER_NORMALIZATION_LOG` | (none) | runtime | Path for normalization audit log output. |
| `INDEX_SERVER_DEBUG` | off | runtime | Enable debug mode (sets log level to debug). |
| `INDEX_SERVER_TRACE` | (none) | runtime | Comma-separated trace categories to enable. |
| `INDEX_SERVER_TRACE_LEVEL` | (none) | runtime | Trace output level: `error`, `warn`, `info`, `debug`, `trace`, `verbose`. |
| `INDEX_SERVER_TRACE_FILE` | (none) | runtime | Trace output file path. |
| `INDEX_SERVER_TRACE_DIR` | `./logs/trace` | runtime | Directory for trace files. |
| `INDEX_SERVER_TRACE_PERSIST` | off | runtime | Persist trace data to disk. |
| `INDEX_SERVER_TRACE_FSYNC` | off | runtime | fsync trace writes for durability. |
| `INDEX_SERVER_TRACE_CALLSITE` | off | runtime | Include callsite information in traces. |
| `INDEX_SERVER_TRACE_CATEGORIES` | (none) | runtime | Comma-separated trace categories filter. |
| `INDEX_SERVER_TRACE_SESSION` | (none) | runtime | Trace session identifier. |
| `INDEX_SERVER_TRACE_BUFFER_FILE` | (none) | runtime | Trace ring buffer file path. |
| `INDEX_SERVER_TRACE_BUFFER_SIZE` | 1048576 | runtime | Trace ring buffer size in bytes. |
| `INDEX_SERVER_TRACE_BUFFER_DUMP_ON_EXIT` | off | runtime | Dump trace buffer on process exit. |
| `INDEX_SERVER_TRACE_MAX_FILE_SIZE` | (none) | runtime | Maximum trace file size before rotation. |
| `INDEX_SERVER_TRACE_QUERY_DIAG` | off | runtime | Enable query diagnostic tracing. |
| `INDEX_SERVER_TRACE_DISPATCH_DIAG` | off | runtime | Extra dispatcher timing/phase diagnostic logs. |
| `INDEX_SERVER_TRACE_ALL` | off | runtime | Enable all trace categories. |

#### Multi-Instance (Leader-Follower)

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_MODE` | `standalone` | runtime | Server instance mode: `standalone`, `leader`, `follower`, `auto`. |
| `INDEX_SERVER_LEADER_PORT` | 9100 | runtime | HTTP port for leader's MCP transport. |
| `INDEX_SERVER_LEADER_URL` | (none) | runtime | Follower: URL of the leader to connect to. |
| `INDEX_SERVER_HEARTBEAT_MS` | 5000 | runtime | Leader heartbeat broadcast interval (ms). |
| `INDEX_SERVER_STALE_THRESHOLD_MS` | 15000 | runtime | Follower stale leader threshold before promotion (ms). |
| `INDEX_SERVER_SHARED_SERVER_SENTINEL` | (none) | runtime | Shared server sentinel for leader-follower sync. |
| `INDEX_SERVER_IDLE_READY_SENTINEL` | (none) | runtime | Ready sentinel for idle shared server (requires SHARED_SERVER_SENTINEL). |

#### Metrics

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_METRICS_DIR` | `./metrics` | runtime | Directory for metrics files. |
| `INDEX_SERVER_METRICS_FILE_STORAGE` | off | runtime | Enable file-based metrics storage. |
| `INDEX_SERVER_METRICS_MAX_FILES` | (none) | runtime | Maximum metrics files to retain. |
| `INDEX_SERVER_TOOLCALL_CHUNK_SIZE` | (none) | runtime | Tool call metrics chunk size. |
| `INDEX_SERVER_TOOLCALL_FLUSH_MS` | (none) | runtime | Tool call metrics flush interval (ms). |
| `INDEX_SERVER_TOOLCALL_COMPACT_MS` | (none) | runtime | Tool call metrics compaction interval (ms). |
| `INDEX_SERVER_TOOLCALL_APPEND_LOG` | off | runtime | Enable tool call append log. |
| `INDEX_SERVER_RESOURCE_CAPACITY` | (none) | runtime | Resource capacity for metrics. |
| `INDEX_SERVER_RESOURCE_SAMPLE_INTERVAL_MS` | (none) | runtime | Resource sampling interval (ms). |
| `INDEX_SERVER_HEALTH_ERROR_THRESHOLD` | (none) | runtime | Error rate threshold for health checks. |
| `INDEX_SERVER_HEALTH_MEMORY_THRESHOLD` | (none) | runtime | Memory threshold for health checks. |
| `INDEX_SERVER_HEALTH_MIN_UPTIME` | (none) | runtime | Minimum uptime before health check is valid. |
| `INDEX_SERVER_MEMORY_MONITOR` | off | runtime | Enable memory usage monitoring. |

#### Semantic Search

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_SEMANTIC_ENABLED` | off | runtime | Enable semantic search with embeddings. |
| `INDEX_SERVER_SEMANTIC_MODEL` | `Xenova/all-MiniLM-L6-v2` | runtime | Embedding model name. |
| `INDEX_SERVER_SEMANTIC_CACHE_DIR` | `./data/models` | runtime | Local model cache directory. |
| `INDEX_SERVER_SEMANTIC_DEVICE` | `cpu` | runtime | Inference device: `cpu`, `cuda`, `dml`. |
| `INDEX_SERVER_SEMANTIC_LOCAL_ONLY` | off | runtime | Only use locally cached models (no downloads). |
| `INDEX_SERVER_EMBEDDING_PATH` | `./data/embeddings.json` | runtime | Path to embeddings data file. |

#### Governance

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_GOV_HASH_HARDENING` | on | runtime | Enable governance hash hardening. |
| `INDEX_SERVER_GOV_HASH_CANON_VARIANTS` | (none) | runtime | Number of canonical variants for hash computation. |
| `INDEX_SERVER_GOV_HASH_IMPORT_SET_SIZE` | (none) | runtime | Import set size for governance hash. |

#### Server

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_DISABLE_EARLY_STDIN_BUFFER` | off | runtime | Disable early stdin buffering. |
| `INDEX_SERVER_DISABLE_PPID_WATCHDOG` | off | runtime | Disable parent-process watchdog. Required for dev sandbox launchers that spawn through a transient shell. |
| `INDEX_SERVER_FATAL_EXIT_DELAY_MS` | (none) | runtime | Delay before process exit on fatal error (ms). |
| `INDEX_SERVER_IDLE_KEEPALIVE_MS` | 30000 | runtime | Keepalive echo interval for idle transports (ms). |
| `INDEX_SERVER_MAX_CONNECTIONS` | (none) | runtime | Maximum concurrent connections. |
| `INDEX_SERVER_REQUEST_TIMEOUT` | (none) | runtime | Request timeout (ms). |
| `INDEX_SERVER_PWS_EXIT_MS` | (none) | runtime | Graceful shutdown delay (ms). |

#### Bootstrap & Seed

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_AUTO_SEED` | on | runtime | Auto-seed bootstrap instruction on first launch. Set `0` to disable. |
| `INDEX_SERVER_SEED_VERBOSE` | off | runtime | Verbose seed logging. |
| `INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM` | off | runtime | Auto-confirm bootstrap operations. |
| `INDEX_SERVER_BOOTSTRAP_TOKEN_TTL_SEC` | (none) | runtime | Bootstrap token time-to-live in seconds. |
| `INDEX_SERVER_REFERENCE_MODE` | off | runtime | Run server in reference mode. |

#### Index Polling

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_ENABLE_INDEX_SERVER_POLLER` | off | runtime | Enable background Index directory polling. |
| `INDEX_SERVER_POLL_MS` | 10000 | runtime | Index polling interval (ms). |
| `INDEX_SERVER_POLL_PROACTIVE` | off | runtime | Enable proactive reload on poll detection. |

#### Feature Flags

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_FLAG_TOOLS_EXTENDED` | off | runtime | Enable extended tool tier. |
| `INDEX_SERVER_FLAG_TOOLS_ADMIN` | off | runtime | Enable admin tool tier. |
| `INDEX_SERVER_FLAGS_FILE` | `./flags.json` | runtime | Path to feature flags JSON file. |
| `INDEX_SERVER_INIT_FEATURES` | (none) | runtime | Comma-separated initialization features. |

#### Atomic File Operations

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_ATOMIC_WRITE_RETRIES` | 5 | runtime | Retry count for atomic file writes. |
| `INDEX_SERVER_ATOMIC_WRITE_BACKOFF_MS` | 10 | runtime | Backoff delay between atomic write retries (ms). |
| `INDEX_SERVER_READ_RETRIES` | (none) | runtime | Read retry count. |
| `INDEX_SERVER_READ_BACKOFF_MS` | (none) | runtime | Read retry backoff delay (ms). |

#### Usage Tracking

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_AUTO_USAGE_TRACK` | on | runtime | Auto-track usage on get/search responses. |
| `INDEX_SERVER_RATE_LIMIT` | `0` | runtime | Dashboard HTTP API and usage-tracking rate limit, in requests per minute. `0` (default) disables rate limiting; any positive integer N enforces N requests/minute (fixed 60-second window). Bulk import/export/backup/restore routes are unconditionally exempt — see issue #270. |
| `INDEX_SERVER_USAGE_FLUSH_MS` | (none) | runtime | Usage data flush interval (ms). |
| `INDEX_SERVER_DISABLE_USAGE_CLAMP` | off | runtime | Disable usage rate clamping. |
| `INDEX_SERVER_USAGE_SNAPSHOT_PATH` | (none) | runtime | Override path for usage snapshot file (used by tests for isolation). |

#### Storage Backend

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_STORAGE_BACKEND` | `json` | runtime | Storage backend: `json` (file-per-instruction) or `sqlite` (single-file database). |
| `INDEX_SERVER_SQLITE_PATH` | `data/index.db` | runtime | Path to SQLite database file (relative to CWD or absolute). |
| `INDEX_SERVER_SQLITE_WAL` | on | runtime | Enable WAL (Write-Ahead Logging) mode for concurrent read performance. |
| `INDEX_SERVER_SQLITE_MIGRATE_ON_START` | on | runtime | Auto-migrate JSON instructions into SQLite on startup when backend is `sqlite`. |
| `INDEX_SERVER_SQLITE_VEC_ENABLED` | on (sqlite backend) | runtime | Enable sqlite-vec extension for vector embedding storage. **Auto-enabled when `INDEX_SERVER_STORAGE_BACKEND=sqlite`**; set `0` to opt out. When enabled, embeddings are stored in a `vec0` virtual table with native KNN search. Requires Node.js ≥ 22.13.0 and `sqlite-vec` npm package. Falls back to JSON if initialization fails. |
| `INDEX_SERVER_SQLITE_VEC_PATH` | (empty) | runtime | Custom path to the sqlite-vec native binary. When empty (default), the path is auto-resolved from the `sqlite-vec` npm package via `getLoadablePath()`. Only set this if the auto-detection fails or you need a non-standard binary location. |

**Backend selection example:**

```jsonc
{
  "mcpServers": {
    "Index": {
      "command": "node",
      "args": ["<user-data-dir>/index-server/dist/server/index-server.js"],
      "env": {
        "INDEX_SERVER_STORAGE_BACKEND": "sqlite",
        "INDEX_SERVER_SQLITE_PATH": "C:/mcp/data/index.db",
        "INDEX_SERVER_SQLITE_WAL": "1",
        "INDEX_SERVER_SQLITE_MIGRATE_ON_START": "1",
        "INDEX_SERVER_DIR": "<user-data-dir>/index-server/instructions"
      }
    }
  }
}
```

**SQLite with vector embeddings example:**

```jsonc
{
  "mcpServers": {
    "Index": {
      "command": "node",
      "args": ["<user-data-dir>/index-server/dist/server/index-server.js"],
      "env": {
        "INDEX_SERVER_STORAGE_BACKEND": "sqlite",
        "INDEX_SERVER_SQLITE_PATH": "C:/mcp/data/index.db",
        "INDEX_SERVER_SQLITE_VEC_ENABLED": "1",
        "INDEX_SERVER_SEMANTIC_ENABLED": "1",
        "INDEX_SERVER_DIR": "<user-data-dir>/index-server/instructions"
      }
    }
  }
}
```

**Notes:**

* The `json` backend is the default and requires no additional configuration.
* The `sqlite` backend requires Node.js ≥ 22.5.0 (uses the built-in `node:sqlite` module).
* The `sqlite-vec` extension requires Node.js ≥ 22.13.0 (uses `DatabaseSync.loadExtension()`).
* When `INDEX_SERVER_SQLITE_VEC_ENABLED=1`, embeddings are stored in a separate SQLite database (`data/embeddings.db`) using a `vec0` virtual table for native KNN search. If sqlite-vec fails to load, embeddings fall back to JSON storage automatically.
* When `INDEX_SERVER_SQLITE_MIGRATE_ON_START=1` (default), existing JSON instructions from `INDEX_SERVER_DIR` are automatically imported into the SQLite database on first startup.
* SQLite backend stores instructions, messages, and usage data in a single `.db` file.
* WAL mode creates two companion files (`*.db-wal` and `*.db-shm`) alongside the database — include all three in backups.
* To migrate back from SQLite to JSON files, use the `migrateSqliteToJson()` function from `src/services/storage/migrationEngine.ts`.

**SQLite backup considerations:**

* With WAL enabled, the database consists of three files: `index.db`, `index.db-wal`, and `index.db-shm`.
* For consistent backups, either: (a) use SQLite's `.backup` command, (b) copy all three files atomically, or (c) run `PRAGMA wal_checkpoint(TRUNCATE)` before copying the main `.db` file.
* The auto-backup system (`INDEX_SERVER_AUTO_BACKUP`) handles JSON file backups; SQLite backups should be managed separately when using the `sqlite` backend.

#### Preflight

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_PREFLIGHT_MODULES` | `mime-db,ajv,ajv-formats` | runtime | Modules to verify during preflight. |
| `INDEX_SERVER_PREFLIGHT_STRICT` | off | runtime | Strict preflight mode (fail on missing modules). |

#### Diagnostic / Test Flags

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_STRESS_DIAG` | off | test harness | Activate heavy fuzz/fragmentation/stress tests. |
| `INDEX_SERVER_STRESS_MODE` | off | test harness | Enable stress mode (forces full list scan). |
| `INDEX_SERVER_VISIBILITY_DIAG` | off | diagnostic | Visibility verification diagnostic logging. |
| `INDEX_SERVER_MINIMAL_DEBUG` | off | diagnostic | Minimal debug mode. |
| `INDEX_SERVER_TEST_MODE` | (none) | test | Test mode: `coverage-fast`, `coverage-strict`, etc. |
| `INDEX_SERVER_TEST_STRICT_VISIBILITY` | off | test | Strict visibility checks in tests. |
| `INDEX_SERVER_ADD_TIMING` | off | test | Log timing for add operations. |
| `INDEX_SERVER_EVENT_SILENT` | off | runtime | Suppress Index event notifications. |
| `INDEX_SERVER_LOAD_WARN_MS` | (none) | runtime | Warn if index load exceeds this duration (ms). |
| `INDEX_SERVER_MAX_FILES` | (none) | runtime | Maximum Index files (performance limit). |

#### Session Persistence

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_SESSION_PERSISTENCE_ENABLED` | off | runtime | Enable session persistence to disk. |
| `INDEX_SERVER_SESSION_PERSISTENCE_DIR` | (none) | runtime | Session persistence directory. |
| `INDEX_SERVER_SESSION_PERSISTENCE_INTERVAL_MS` | (none) | runtime | Session save interval (ms). |
| `INDEX_SERVER_SESSION_DEDUPLICATION_ENABLED` | off | runtime | Enable session deduplication. |
| `INDEX_SERVER_SESSION_BACKUP_INTEGRATION` | off | runtime | Integrate sessions with backup system. |
| `INDEX_SERVER_SESSION_MAX_HISTORY_ENTRIES` | (none) | runtime | Max session history entries. |
| `INDEX_SERVER_SESSION_MAX_HISTORY_DAYS` | (none) | runtime | Max session history retention days. |
| `INDEX_SERVER_SESSION_MAX_CONNECTION_HISTORY_DAYS` | (none) | runtime | Max connection history days. |
| `INDEX_SERVER_ADMIN_MAX_SESSION_HISTORY` | (none) | runtime | Admin dashboard max session history. |

#### Miscellaneous

| Flag | Default | Scope | Description |
|------|---------|-------|-------------|
| `INDEX_SERVER_STATE_DIR` | `./data/state` | runtime | State directory for runtime data. |
| `INDEX_SERVER_TIMING_JSON` | (none) | runtime | Path to timing configuration JSON. |
| `INDEX_SERVER_FORCE_REBUILD` | off | runtime | Force Index rebuild on startup. |
| `INDEX_SERVER_REQUIRE_AUTH_ALL` | off | runtime | Require authentication for all operations. |
| `INDEX_SERVER_AUTH_KEY` | (none) | runtime | Authentication API key. |
| `INDEX_SERVER_ADMIN_API_KEY` | (none) | runtime | Admin API key for dashboard authentication. When set, all mutation endpoints (POST/PUT/DELETE) require `Authorization: Bearer <key>`. When unset, localhost requests pass through without auth; remote requests to mutation endpoints are blocked (403). GET routes are always open. |
| `INDEX_SERVER_LOG_SEARCH` | off | runtime | Log search operations. |
| `INDEX_SERVER_LOG_TOOLS` | off | runtime | Log tool invocations. |
| `INDEX_SERVER_FEEDBACK_DIR` | `./feedback` | runtime | Directory for feedback data storage. |
| `INDEX_SERVER_FEEDBACK_MAX_ENTRIES` | 1000 | runtime | Maximum feedback entries to store before rotation. |

Operational guidance:

* Keep all diagnostic flags OFF for production unless actively debugging an issue.
* Dashboard environment variables are overridden by command line arguments.
* For security, dashboard should only be enabled on localhost (127.0.0.1) for local administration.
* Enable `INDEX_SERVER_STRESS_DIAG=1` locally or in a dedicated CI job (e.g., nightly) to exercise adversarial workloads without destabilizing standard PR validations.
* Never enable `INDEX_SERVER_INIT_FEATURES=initFallback` in production; it is purely for reproducing initialize starvation scenarios and is guarded by compliance tests.

### Stress / Adversarial Test Suite

The following spec files (and selective cases inside some files) are gated behind `INDEX_SERVER_STRESS_DIAG=1` to keep the default test run deterministic and fast:

* `handshakeFlakeRepro.spec.ts`
* `healthMixedReproLoop.spec.ts`
* `healthHangExploration.spec.ts` (mixed workload + escalated scenarios only)
* `healthMultiProcessStress.spec.ts`
* `dispatcherStress.spec.ts`
* `dispatcherFlakeStress.spec.ts`
* `concurrencyFuzz.spec.ts`

Run only the core deterministic suite (default):

```pwsh
npm test
```

Run all tests including stress (local or nightly CI):

```pwsh
npm run test:stress
```

Focus just on the gated stress specs:

```pwsh
npm run test:stress:focus
```

Minimal diagnostic reproduction:

```pwsh
npm run test:diag
```

Rationale: Segregating heavy concurrency / fragmentation tests avoids intermittent initialize starvation or off-by-one health count flakes from masking real regressions in routine PR validation while retaining full reproduction power on-demand.

### Manifest & Opportunistic Materialization (1.4.x)

The server persists a lightweight Index manifest (`snapshots/index-manifest.json`) after Index‑mutating operations, maintained via a centralized helper (`attemptManifestUpdate()`). Opportunistic in-memory materialization ensures an immediately added instruction is visible without a forced reload, eliminating prior add→get race windows. A formal JSON Schema (`schemas/manifest.schema.json`) documents the manifest snapshot independently of the instruction schema (`schemas/instruction.schema.json`). See **[MANIFEST.md](./docs/MANIFEST.md)** for full lifecycle, invariants, drift categories, and fastload roadmap.

Counters (scrape via existing metrics interface):

* `manifest:write` – successful manifest persisted
* `manifest:writeFailed` – write attempt threw
* `manifest:hookError` – upstream hook invocation failed

Log Line (INFO):

```text
[manifest] wrote index-manifest.json count=<entries> ms=<latency>
```

Environment Flags:

* `INDEX_SERVER_MANIFEST_WRITE=0` – skip all writes (counters suppressed) but continue normal instruction functionality. Use for diagnostics or perf profiling only.
* `INDEX_SERVER_MANIFEST_FASTLOAD=1` – (preview) trust an up‑to‑date manifest on startup to short‑circuit full body re‑hash when computing drift. Falls back automatically to the normal path if the manifest is missing / invalid / drift > 0.

Design Rationale:

* Central helper `attemptManifestUpdate()` now performs an immediate synchronous manifest write (Phase F simplification). Previous debounce logic was removed to guarantee determinism and eliminate timing races. (A future high‑churn mode could reintroduce batching behind an env flag if needed.)
* Separation of concerns: instruction files validated by `instruction.schema.json` (schemaVersion `6`), manifest snapshot validated by its own schema (`manifest.schema.json`). No need to bump instruction `schemaVersion` when altering internal manifest representation.
* Additive only – no change in existing mutation semantics or instruction schema.

### Handshake Reliability (1.1.1)

All tests and clients MUST use the canonical MCP SDK initialize sequence:

1. Client spawns server process.
2. Server buffers early stdin until SDK ready (guards against dropped initialize in fast clients).
3. Client sends a single `initialize` (id=1). Helper may resend once if no frame observed (idempotent per spec).
4. Server responds with initialize result, then emits exactly one `server/ready`, optionally followed by `tools/list_changed`.

Test harness specs requiring direct process spawn MUST use the shared helper `performHandshake()` in `src/tests/util/handshakeHelper.ts` rather than bespoke timing loops. This ensures consistent startup behavior and eliminates intermittent initialize timeouts under parallel suite load.

Diagnostic flags affecting handshake (`INDEX_SERVER_INIT_FEATURES=initFallback`, `INDEX_SERVER_INIT_FEATURES=disableSniff`, `INDEX_SERVER_TRACE=handshake`) are for investigation only and MUST remain unset in production deployments.
