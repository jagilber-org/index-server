# Migration & Verification Guide

Version: 0.7.0 (updated with schema v4 notes – 2026-02-16)

This guide provides an upgrade path from earlier 0.x versions and a deterministic verification checklist suitable for automated tooling.

## 1. What Changed in 0.7.0

Added:

- New governance metadata projection + deterministic hash (`index_governanceHash`).
- Automatic enrichment persistence pass (fills placeholder governance fields on disk once).
- Stabilized usage tracking (atomic `firstSeenTs`, immediate flush on first usage).
- Governance field normalization (owner auto‑resolution, semantic summary hashing, review cadence fields derivation).
- Deterministic governance hash tests replacing flaky property fuzzing.

Optional:

- `GOV_HASH_TRAILING_NEWLINE=1` stabilization flag (adds a final newline sentinel for environments that historically serialized with a trailing newline).

## 2. Safe Upgrade Path

1. Stop any running prior server instance.
2. Pull / install new code, run build: `npm ci && npm run build`.
3. (Optional) Back up your `instructions/` and `data/usage-snapshot.json`.
4. Start server once (writes are enabled by default) to allow the enrichment rewrite pass.
5. Observe stderr logs for any enrichment rewrites (only first run should rewrite; subsequent runs should show stable governance hash).
6. (If you previously depended on a trailing newline in hash input) set `GOV_HASH_TRAILING_NEWLINE=1` consistently across all validating processes.

No manual data migrations are required: enrichment and normalization are automatic and idempotent.

### 2.1 Schema v3 Upgrade (primaryCategory introduction)

Applies when moving from any build that persisted instruction JSON with `schemaVersion` `1` or `2` to builds defining `SCHEMA_VERSION="3"`.

Summary:

- Adds optional `primaryCategory` field derived from the first element of `categories`.
- Ensures if `primaryCategory` exists it is a member of `categories` (injected if missing).
- Preserves backward compatibility for legacy instructions with empty `categories` by deferring injection unless runtime fallback supplies `['uncategorized']`.

Automatic Migration Behavior (one-time, per file):

1. Loader reads JSON; if `schemaVersion` < 3 it invokes `migrateInstructionRecord`.
2. For v1 records missing `reviewIntervalDays`, the v1→v2 logic fills it using tier + requirement.
3. For v2 records (or v1 upgraded to v2 inside the same pass):
	- If `primaryCategory` absent and `categories` non-empty → set `primaryCategory = categories[0]`.
	- If `primaryCategory` present but not in `categories` → it is unshifted into `categories` (deduplicated).
4. `schemaVersion` field rewritten to `"3"` and file persisted.

Fallback Category Injection:

- Authoring legacy instructions with an empty `categories` array remains tolerated for compatibility.
- At runtime, unless `INDEX_SERVER_REQUIRE_CATEGORY=1`, an empty array is normalized to `['uncategorized']` prior to persistence or further governance validation. With the flag set, empty categories cause a validation failure.

Verification Checklist (Schema v3 specific):

| Step | Action | Expectation |
|------|--------|-------------|
| 1 | Pick a legacy v2 instruction (no `primaryCategory`) | `schemaVersion` shows `2` on disk |
| 2 | Start server with mutation enabled | File rewritten with `schemaVersion: "3"` & `primaryCategory` present |
| 3 | Confirm categories membership | `primaryCategory` string is one of `categories` values |
| 4 | Create new instruction with empty categories (no env flag) | Stored with categories `["uncategorized"]` + `primaryCategory: "uncategorized"` |
| 5 | Repeat with `INDEX_SERVER_REQUIRE_CATEGORY=1` | Operation rejected (validation error) |

Rollback Safety:

- Older builds (expecting v2) ignore the extra `primaryCategory` field and higher enum value only if their schema validation is lax. Current project versions post-0.7.0 intentionally allow forward-compatible fields; rollback remains non-destructive (fields are simply ignored).

Client Impact:

- No tooling changes required; dispatcher responses now may include `primaryCategory` (treat as optional).
- Tool schemas updated where relevant to include field; Zod validation is permissive (extra field allowed).

Operational Recommendation:

- Roll out with soft mode first (omit `INDEX_SERVER_REQUIRE_CATEGORY`) to allow background migration; after Index reaches steady state enable the flag in controlled environments to enforce non-empty categorization.

### 2.2 Schema v4 Upgrade (sourceWorkspace & createdByAgent)

Applies when moving from v3 to builds defining `SCHEMA_VERSION="4"`.

Summary:

- Adds optional `sourceWorkspace` (string, max 200) — logical workspace or repository identifier from which the instruction was promoted.
- Adds optional `createdByAgent` (string, max 200) — identifier of the MCP agent or client that created or promoted the entry.
- These fields are populated by `promote_from_repo` and other agent-driven creation workflows.
- Previous schema v3 rejected entries with these fields due to `additionalProperties: false`, causing promoted entries to be skipped during index load.

Automatic Migration Behavior (one-time, per file):

1. Loader reads JSON; if `schemaVersion` < 4 it invokes `migrateInstructionRecord`.
2. No data transformation needed — both fields are optional with no defaults.
3. `schemaVersion` field rewritten to `"4"` and file persisted.

Verification Checklist (Schema v4 specific):

| Step | Action | Expectation |
|------|--------|-------------|
| 1 | Pick a v3 instruction | `schemaVersion` shows `3` on disk |
| 2 | Start server with mutation enabled | File rewritten with the current `schemaVersion` |
| 3 | Run `promote_from_repo` for any repo | Promoted entries include `sourceWorkspace` and `createdByAgent` fields |
| 4 | Run `index_diagnostics` | Previously skipped entries (extra properties) now load successfully |

Rollback Safety:

- Older builds (expecting v3) will reject entries containing `sourceWorkspace` or `createdByAgent` due to `additionalProperties: false`. Rollback requires stripping these fields or reverting schema.json.

### 2.3 Content type taxonomy update

Schema v6 uses the canonical eight-value `contentType` taxonomy:
`agent`, `skill`, `instruction`, `prompt`, `workflow`, `knowledge`, `template`,
and `integration`.

Current validation status:

- `schemas/instruction.schema.json`, runtime input validation, search filters,
  and tool schemas accept exactly the canonical eight values.
- Values outside the canonical taxonomy fail validation and are handled by the
  existing rejection/quarantine paths.
- Checked-in static instruction JSON uses `knowledge` for reference material,
  examples, concepts, and documentation while preserving free-form categories
  such as `example` or `reference`.

Operator migration:

1. Back up `instructions/` before loading or bulk-editing production catalogs.
2. Update records to one of the canonical eight values before startup or import.
3. After migration, run `index_reload` and `integrity_verify`; then use
   `index_dispatch` with `action: "query", contentType: "knowledge"` to confirm
   knowledge records are discoverable.

## 3. Verification Checklist (Automatable)

Run each tool via JSON-RPC; compare responses against expectations. Example pseudo sequence (IDs illustrative):

| Step | Action | Expectation |
|------|--------|-------------|
| 1 | `meta_tools` | Contains `index_governanceHash` marked `stable` |
| 2 | `index_governanceHash` | Returns `{ count>0, governanceHash, items[] }` |
| 3 | Hash Determinism | Call twice; hashes identical (no intervening mutations) |
| 4 | Invariance | Modify body-only of a test instruction (do NOT touch governance fields) → governance hash unchanged, but sourceHash changes (validate via diff) |
| 5 | Sensitivity | Change a governance field (e.g., owner) → governance hash changes |
| 6 | `integrity_verify` | `issueCount` == 0 after enrichment pass |
| 7 | Usage Tracking | Call `usage_track` twice on same id: `usageCount` increments; `firstSeenTs` stable, `lastUsedAt` advances |
| 8 | Persistence | Restart process; `usage_track` shows persisted `usageCount` (>= previous value) |
| 9 | Diff Consistency | `index_dispatch` with action `diff` and prior hash returns `upToDate:true` when no changes |
| 10 | Gates | `gates_evaluate` succeeds (even if zero gates) |

## 4. Hash Reproducibility Details

Projection fields per item (sorted by `id` then JSON stringified):

```json
{ id, title, version, owner, priorityTier, nextReviewDue, semanticSummarySha256, changeLogLength }
```

Joined with `\n` into a single string. If `GOV_HASH_TRAILING_NEWLINE=1`, a final empty line is appended before hashing (effectively adding a trailing `\n`). The SHA‑256 hex digest of that buffer is `governanceHash`.

Common failure sources:

- Non-deterministic file ordering (always sorted internally; external scripts must mimic if re-computing).
- Missing enrichment (run once with mutation enabled so placeholders persist).
- Inconsistent newline flag across processes.

## 5. Rollback Strategy

Because 0.7.0 only adds fields / tools and performs additive enrichment, rollback to an earlier version leaves extra governance fields in JSON. Older versions ignore unknown fields, so rollback is safe. Hash comparison features introduced in 0.7.0 will simply be unavailable.

## 6. CI Recommendations

- Add a contract test invoking `index_governanceHash`; persist the returned hash as a snapshot only when intentional governance edits are made.
- Run `integrity_verify` and assert zero issues.
- Execute the determinism check: call governanceHash twice in one process and once after a reload.
- Gate PRs on no unexpected governance hash drift.

## 7. Troubleshooting

| Symptom | Cause | Resolution |
|---------|-------|-----------|
| Governance hash changes on restart without edits | Enrichment not persisted yet or newline flag mismatch | Ensure first run completed with mutation enabled; set consistent `GOV_HASH_TRAILING_NEWLINE` |
| integrity_verify reports unexpected issues | Manual file edits left placeholders | Open & save files through grooming or rerun with mutation enabled |
| usage_track firstSeenTs missing | Very early crash before flush | Retry; first increment forces flush now |

## 8. Minimal Client Validation Flow

1. Fetch `meta_tools` (record registry version).
2. Fetch `index_governanceHash` (store hash).
3. Perform operations (optional mutation tests in staging).
4. Re-fetch governance hash; assert expected delta or stability.

## 9. Backward Compatibility Notes

- All prior read tools untouched.
- New tool is additive & marked stable; no breaking schema removals.
- Grooming continues to be idempotent; classification enhancements do not alter existing normalized categories.

## 10. Environment Variable Summary

| Variable | Purpose | Default |
|----------|---------|---------|
| INDEX_SERVER_MUTATION | Force read-only mode | unset (`true`) |
| INDEX_SERVER_VERBOSE_LOGGING | Verbose logging | unset |
| INDEX_SERVER_LOG_MUTATION | Mutation-only logs | unset |
| GOV_HASH_TRAILING_NEWLINE | Add trailing newline sentinel before hash | unset (off) |
| INDEX_SERVER_REQUIRE_CATEGORY | Enforce non-empty categories (reject empty) | unset (soft fallback injects `uncategorized`) |

---

Automated tooling can parse this file to drive end-to-end upgrade validation. Keep textual section headers stable for reliable anchor matching.
