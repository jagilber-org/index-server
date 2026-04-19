# Index Deployment & Troubleshooting Guide

> Purpose: Provide a single, opinionated, end-to-end reference for standing up, promoting, operating, and troubleshooting Index instances across development, staging, and production while preserving governance guarantees and observability.

---
## 1. Deployment Profiles


| Profile | Goal | Characteristics | Typical Settings |
|---------|------|-----------------|------------------|
| Dev (workbench) | Rapid iteration & feature validation | Local filesystem, verbose logs, mutation enabled | `INDEX_SERVER_MUTATION=1`, `INDEX_SERVER_VERBOSE_LOGGING=1`, `INDEX_SERVER_DEBUG=1`, `INDEX_SERVER_DASHBOARD=1` |
| Shared Dev / Integration | Cross-developer validation & test harness | Stable path, persistent metrics, controlled mutation | `INDEX_SERVER_METRICS_FILE_STORAGE=1`, optional `INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM=1` (tests) |
| Staging / Pre-Prod | Release candidate soak | Mirrors prod paths & policies, seeded baseline | Same as prod + extra diagnostics `INDEX_SERVER_LOG_DIAG=1` if needed |
| Production | Stable Index serving & governance | Locked paths, minimal verbosity, audit logging | `INDEX_SERVER_MUTATION=1` (if governed), no verbose/diag unless incident |
| Reference / Read-Only | Immutable published snapshot | All mutation permanently disabled | `INDEX_SERVER_REFERENCE_MODE=1` |

---
 
## 2. Filesystem Layout (Recommended)

```text
<mcp-root>/
  index-server/
    instructions/           # Production runtime Index (JSON files)
    dist/                   # Built server artifacts
    logs/ (optional)        # Central log aggregation target (if not using default)
    metrics/ (optional)     # If using file-backed metrics ring
  index-server-stage/   # Staging mirror
  index-server-archive/ # Historical snapshots (optional)
```

Keep dev working copy separate: e.g. `<root>/index-server` pointing `INDEX_SERVER_DIR` to a *dev* folder (`devinstructions/`) to avoid accidental mutation of production index during debugging.

---
 
## 3. Bootstrap & Auto-Seeding

On startup the server guarantees presence of two baseline governance instructions:

- `000-bootstrapper`
- `001-lifecycle-bootstrap`

They are auto-created (idempotent, non-destructive) if missing unless you set:

```bash
INDEX_SERVER_AUTO_SEED=0
```

Verbose seeding diagnostics:

```bash
INDEX_SERVER_SEED_VERBOSE=1
```
 
Structured log event: `seed_summary` with fields: `created`, `existing`, `disabled`, `hash` (deterministic canonical hash for auditing).

 
### When Copying Production Instructions to Dev

If you copy `instructions/` from production into a dev directory:

- The seeding system detects both seeds already exist and emits `seed_summary` with `created=[]`, `existing=[...]`.
- No overwrites occur.
- If you *only* copy a subset and omit a seed, the missing one will be recreated—this is safe and expected.

 
### Bootstrap Confirmation Flow Recap

1. Fresh workspace (only seeds) → mutation gated: `bootstrap_confirmation_required`.
2. Call `bootstrap_request` → get token.
3. Human approves; call `bootstrap_confirmFinalize`.
4. Confirmation artifact `bootstrap.confirmed.json` persists.
5. Any additional instruction beyond the seeds implicitly means existing workspace (confirmation optional).
6. `INDEX_SERVER_REFERENCE_MODE=1` short-circuits everything: Index immutable forever.

Test harness shortcut: `INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM=1` (never use in prod).

---
 
## 4. Environment Variable Matrix (Key Operational Controls)

| Variable | Purpose | Typical Prod | Typical Dev | Migration Notes |
|----------|---------|--------------|-------------|----------------|
| `INDEX_SERVER_DIR` | Index root | Stable prod path | `devinstructions/` | (Will be normalized to `INDEX_SERVER_DIR` alias internally) |
| `INDEX_SERVER_MUTATION` | Enable/disable write ops | `enabled` (if governed) | `enabled` | Replaces `INDEX_SERVER_MUTATION` (still accepted) |
| `INDEX_SERVER_MUTATION` | Legacy mutation flag | 1 | 1 | Deprecated (mapped to `INDEX_SERVER_MUTATION`) |
| `INDEX_SERVER_REFERENCE_MODE` | Force read-only | 0 | 0 or 1 (testing) | Unchanged |
| `INDEX_SERVER_AUTO_SEED` | Auto-create baseline seeds | 1 | 1 | Unchanged |
| `INDEX_SERVER_SEED_VERBOSE` | Extra stderr seed log | 0 | 1 | Unchanged |
| `INDEX_SERVER_LOG_LEVEL` | Unified log level | `info` | `debug` | Consolidates verbose/diag flags over time |
| `INDEX_SERVER_VERBOSE_LOGGING` | Legacy verbose toggle | 0 | 1 | Deprecated (maps to `INDEX_SERVER_LOG_LEVEL=debug`) |
| `INDEX_SERVER_LOG_DIAG` | Legacy diagnostic toggle | 0 | 1 | Deprecated (maps to `INDEX_SERVER_LOG_LEVEL=trace`) |
| `INDEX_SERVER_TRACE` | Fine-grained trace tokens | `manifest` selectively | `manifest,bootstrap` | Use tokens instead of new booleans |
| `INDEX_SERVER_TRACE_FILE` | Structured tracing file | 0 | 1 (targeted) | Unchanged |
| `INDEX_SERVER_METRICS_FILE_STORAGE` | Persist metrics ring | 1 | 1 or 0 | Unchanged |
| `INDEX_SERVER_METRICS_MAX_FILES` | Metrics rotation depth | 720 | 120 | Unchanged |
| `INDEX_SERVER_BOOTSTRAP_AUTOCONFIRM` | Test auto-confirm | 0 | 1 | Test only |
| `INDEX_SERVER_LOG_SYNC` | Synchronous log fsync (tests) | 0 | 1 | Test determinism only |
| `INDEX_SERVER_TIMING_JSON` | Structured timing overrides | Minimal | Rich (tests) | Replaces ad-hoc `MANIFEST_TEST_WAIT_*` vars |
| `INDEX_SERVER_TEST_MODE` | Test/coverage mode | (unset) | `coverage-fast` | Replaces `FAST_COVERAGE=1` |
| `COVERAGE_HARD_MIN` | Coverage gate (hard fail) | e.g. 50 | e.g. 50 | Accessed via runtime config |
| `COVERAGE_TARGET` | Advisory coverage target | e.g. 60 | e.g. 60 | Accessed via runtime config |

Consolidation Note: Introduce no new top-level environment variables without first attempting to express the need via `INDEX_SERVER_TIMING_JSON`, `INDEX_SERVER_TRACE`, or an extension of `runtimeConfig`. File `src/config/runtimeConfig.ts` is the single source of truth for mapping and deprecation warnings.

Example structured timing override (PowerShell):

```powershell
$env:INDEX_SERVER_TIMING_JSON = '{"manifest.waitDisabled":18000,"manifest.waitRepair":20000,"manifest.postKill":300}'
```

Then in tests/services:

```ts
import { getRuntimeConfig } from '../src/config/runtimeConfig';
const cfg = getRuntimeConfig();
const waitRepair = cfg.timing('manifest.waitRepair', 20000);
```

Legacy Timing Flags (still honored with one-time warnings):

- `MANIFEST_TEST_WAIT_DISABLED_MS` → `INDEX_SERVER_TIMING_JSON: manifest.waitDisabled`
- `MANIFEST_TEST_WAIT_REPAIR_MS` → `INDEX_SERVER_TIMING_JSON: manifest.waitRepair`

Fast coverage path migration:

- Old: `FAST_COVERAGE=1`
- New: `INDEX_SERVER_TEST_MODE=coverage-fast`

Mutation gating migration:

- Old: `INDEX_SERVER_MUTATION=1`
- New: `INDEX_SERVER_MUTATION=enabled`

---
 
## 5. Deployment Workflow

 
### 5.1 Build Artifact

 
```bash
npm ci
npm run build
```
Artifacts: `dist/server/index-server.js` plus dashboard assets (copied by `scripts/copy-dashboard-assets.mjs`).

 
### 5.2 Promote to Target

Use provided PowerShell script:

```powershell
pwsh -File scripts/deploy-local.ps1 -Rebuild -Overwrite -TargetDir C:\mcp\index-server
```
 
Flags:

- `-Rebuild` – runs `npm ci && npm run build` prior to copy
- `-Overwrite` – replaces existing target directory
- Production dependencies are always installed using `npm ci --production` (lock file ensures deterministic versions)

 
### Semantic Search

To enable embedding-based semantic search, set the environment variable before starting:

```bash
export INDEX_SERVER_SEMANTIC_ENABLED=1
```

```powershell
$env:INDEX_SERVER_SEMANTIC_ENABLED = '1'
```

The first search request downloads a ~90MB embedding model (one-time). Subsequent requests use the cached model.

### 5.3 First Start (Prod)

 
```bash
# Example (stdio integration client config points cwd here):
node dist/server/index-server.js --dashboard-port=8787
```
 
Verify logs (stderr) contain:

- `[startup] Dashboard server started successfully` (if dashboard enabled)
- `seed_summary` (first start or hash check) – confirm `existing` vs `created`
- `server_started`

 
### 5.4 Validation Checklist
 
| Item | Command / Tool | Expectation |
|------|----------------|-------------|
| Seed Summary | logs / `seed_summary` | created=2 (fresh) or created=0 (existing) |
| Mutation Gate | tools/call bootstrap_status | requireConfirmation=false (existing) or true (fresh) |
| Instructions Health | tools/call index_health | recursionRisk=none |
| Metrics Snapshot | tools/call metrics_snapshot | tool counts increment on calls |

---
 
## 6. Copying Production Instructions to Dev (Troubleshooting Scenario)

You mentioned copying production instructions into dev to reproduce an issue. Recommended steps:

1. Decide isolation path: create `devinstructions-prod-clone/`.
2. Copy: `robocopy C:\mcp\index-server\instructions <root>\index-server\devinstructions /E`
3. Point dev config (`.vscode/mcp.json`) `INDEX_SERVER_DIR` to cloned folder.
4. Start server with verbose flags: `INDEX_SERVER_VERBOSE_LOGGING=1 INDEX_SERVER_LOG_DIAG=1`.
5. Run targeted test or reproduce workflow.
6. Compare logs vs prod baseline. Key events: `Index-summary`, `tool_start/tool_end`, `seed_summary`, `bootstrap_status`.
7. After debugging, discard clone to avoid accidental mutation of real prod snapshot.

If you *only* copied some files and lost a seed, auto-seed reintroduces it—this is safe. To detect divergence, compare the `hash` in `seed_summary` between environments; mismatch after manual edits signals drift.

---
 
## 7. Troubleshooting Matrix

| Symptom | Likely Cause | Action |
|---------|--------------|-------|
| Mutation blocked unexpectedly | Missing confirmation or reference mode | Call `bootstrap_status`; if `requireConfirmation=true`, complete token flow. Check `INDEX_SERVER_REFERENCE_MODE`. |
| Seeds recreated on existing workspace | Seeds deleted manually | Accept recreation; investigate deletion; enable `INDEX_SERVER_SEED_VERBOSE=1` for audit timing. |
| No `seed_summary` line | Logging misconfigured or very early crash | Ensure `INDEX_SERVER_LOG_FILE=1`; confirm `autoSeedBootstrap()` runs before Index usage; inspect stderr for stack traces. |
| Tool calls lack `tool_end` | Asynchronous logging flush race in tests | Use `INDEX_SERVER_LOG_SYNC=1` (test only) or increase polling window. |
| Drift in governance hash | Manual edits without bumping version | Run `governanceHash` tests; re-export canonical spec; version increment. |
| Dashboard won’t start | Port in use / blocked | Use `--dashboard-port=<free>` or set `INDEX_SERVER_DASHBOARD_PORT`; check firewall. |
| Index shows zero instructions | Wrong `INDEX_SERVER_DIR` | Confirm path & permissions; check stderr `[startup] toolsRegistered... instructionsDir="..."`. |

---
 
## 8. Observability Signals

Key structured events (JSON logs):

- `logger_init` – file log path, size
- `seed_summary` – seeding outcome
- `Index-summary` – counts (scanned / accepted / skipped) + salvage
- `tool_start` / `tool_end` / `tool_error` – lifecycle timing + correlation
- `bootstrap_status` (via tool) – current gating state

Aggregate or forward these into your logging system for RUM or audit trails. Correlate by timestamp or add a future correlation ID if centralization requires cross-instance stitching.

---
 
## 9. Hardening Recommendations

| Area | Control |
|------|---------|
| Integrity | Periodic integrity job computes canonical seed hash & compares to `seed_summary.hash`. |
| Backup | Snapshot `instructions/` + `metrics/` nightly. |
| Promotion | Git-based PR review for instruction changes; promote via controlled import tool. |
| Drift Detection | Scheduled tool invoking `Index-summary` & diffing against last baseline snapshot. |
| Access | File ACL restrict write to service account; devs mutate via controlled workflow only. |

---
 
## 10. FAQ

**Q:** How do I fully reset a dev workspace?  
**A:** Delete the dev instructions directory contents; restart server. Seeds auto-reappear; confirmation gating re-engages (unless non-seed files added).

**Q:** How do I simulate production read-only mode?  
**A:** Set `INDEX_SERVER_REFERENCE_MODE=1`; seeds load but mutation tools return block reason `reference_mode_read_only`.

**Q:** Can I disable seeding for a forensic run?  
**A:** Yes: `INDEX_SERVER_AUTO_SEED=0`; if seeds absent you may hit gating conditions; manually copy seeds if needed for consistent bootstrap path.

---
 
## 11. Future Enhancements (Planned / Optional)

- Seed integrity enforcement: warn if on-disk seed differs from canonical JSON (without overwriting).
- Signed Index manifests for tamper detection.
- Distributed lock / notification for multi-node Index mutation coordination (post baseline).

---
 
## 12. Quick Reference Commands

 
```powershell
# Build & deploy (local prod)
pwsh -File scripts\deploy-local.ps1 -Rebuild -Overwrite -TargetDir C:\mcp\index-server

# Start dev with verbose logging
$env:INDEX_SERVER_DIR='<root>/index-server/devinstructions'; \
$env:INDEX_SERVER_VERBOSE_LOGGING='1'; $env:INDEX_SERVER_DASHBOARD='1'; node dist/server/index-server.js --dashboard-port=8787

# Check bootstrap status (example RPC via client tooling)
# tools/call name=bootstrap_status

# Metrics snapshot
# tools/call name=metrics_snapshot
```

---
 
## 13. Change Log (Document)

- v1.0: Initial creation with auto-seeding & troubleshooting guidance (2025-09-15)

---
Happy deploying – this guide should give you everything needed to reproduce prod locally, ensure seeds are present, and safely iterate.
