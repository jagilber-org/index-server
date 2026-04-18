# Index Normalization & Migration Reference

Version: 1.0.0  
Applies to: `schemaVersion` v3+ (server version >= 1.5.0)  
Status: Authoritative specification for always-on ingestion normalization.

## Executive Summary

The index loader performs *idempotent*, *always-on* normalization of legacy or inconsistent instruction JSON files **without requiring a grooming tool run**. It rewrites only when a semantic delta is detected, guaranteeing a canonical on-disk shape that is stable across restarts and deployments.

Goals:

- Eliminate drift between historical variants and the current schema vocabulary.
- Reduce ingestion rejections due to harmless casing / punctuation / legacy enum usage.
- Provide deterministic hashing by making logically equivalent documents byte-stable after the first normalization pass.
- Offer optional forensic visibility (JSONL audit) *without* expanding the MCP tool surface.

Non-Goals:

- Content editing (no paraphrasing or body/title mutation).
- Auto-filling governance fields (that is handled by enrichment scripts where desired).
- Introducing configuration knobs for each rule (simplicity & safety > micro control).

## Rewrite Triggers

A file is rewritten only if at least one of the following conditions is true:

1. `schemaVersion` missing or differs from current `SCHEMA_VERSION` (migration applied)
2. Legacy enum value mapped (audience / requirement)
3. Categories sanitized (token normalization, de-dupe, truncation)
4. `primaryCategory` sanitized or injected into `categories` for membership guarantee
5. `id` becomes valid only after sanitization (invalid → valid transformation)
6. Added / patched fields from migration pipeline (e.g., newly introduced required fields with default derivation)

If *no* rule alters the in-memory representation → no rewrite, no audit record.

## Field Normalization Rules

### Audience Mapping

| Legacy Input (case-insensitive) | Canonical Output |
|---------------------------------|------------------|
| system                          | all              |
| developers, devs                | group            |
| developer, dev                  | individual       |
| team, users, testers, admins, administrators, agents | group |
| powershell script authors, author*/script author* (pattern) | individual |

Fallback: If unmapped and not pattern-matched → value left as-is (validated against schema if required).

### Requirement Mapping

| Legacy Input (any case) | Canonical Output |
|-------------------------|------------------|
| MUST, REQUIRED, MANDATORY | mandatory |
| SHOULD                   | recommended |
| MAY, OPTIONAL            | optional |
| CRITICAL                 | critical |
| DEPRECATED               | deprecated |
| Free-form short sentence (< 300 chars, contains whitespace) | recommended |

### Category & Primary Category Sanitization

Rules applied to each category token:

1. Lowercase
2. Trim
3. Replace any char not in `[a-z0-9-_]` with `-`
4. Collapse consecutive `-` and `_`
5. Strip leading/trailing `-`
6. Truncate to 49 chars
7. Ensure starts & ends with `[a-z0-9]`; if not possible → fallback `uncategorized`
8. De-duplicate preserving first occurrence
9. Limit total category list to 25 entries

`primaryCategory` undergoes identical sanitization. If present and not already in `categories`, it is appended (after sanitization). If `primaryCategory` becomes empty after sanitization, it is dropped.

### ID Sanitization (Conservative)

Applied only if the existing id fails the validity regex:

```regex
^[a-z0-9](?:[a-z0-9-_]{0,118}[a-z0-9])?$
```

Steps:

1. Lowercase
2. Trim
3. Replace invalid chars with `-`
4. Collapse `-` or `_` runs
5. Strip leading/trailing `-`
6. Truncate to 120 chars total
7. Require start & end alphanumeric

If resulting candidate satisfies the regex → accept and rewrite. Otherwise original id is retained (file NOT rewritten for id alone; other rules may still trigger).

### Schema Migration

If `schemaVersion` absent or outdated, `migrateInstructionRecord` executes. Migration may add or rename fields; if it changes anything it triggers rewrite. Migration logic is versioned separately; this document governs *post-migration* normalization only.

## Idempotence Guarantee

Running loader normalization repeatedly over already-normalized files causes **zero additional rewrites**. This protects against:

- Build pipelines that re-run ingestion many times
- Concurrent test processes observing the same directory

## Audit Logging (Optional)

Environment variable: `INDEX_SERVER_NORMALIZATION_LOG`

| Value | Behavior |
|-------|----------|
| (unset) | Disabled (no overhead except trivial empty array creation) |
| `1` | Writes to `./logs/normalization-audit.jsonl` (cwd relative) |
| `<path>` | Writes to explicit file path |

Each JSONL record:

```json
{
  "ts": "2025-09-15T01:23:45.678Z",
  "file": "instruction-name.json",
  "originalId": "Legacy ID 01",
  "finalId": "legacy-id-01",
  "changes": {
    "id": { "before": "Legacy ID 01", "after": "legacy-id-01" },
    "audience": { "before": "Developers", "after": "group" },
    "requirement": { "before": "MUST", "after": "mandatory" },
    "categories": { "before": ["UI/Flow"], "after": ["ui-flow"] }
  }
}
  ```

  Only mutated keys included. Silent failure (logging never blocks ingestion).

## Safety Considerations

- Rewrites are atomic via single `writeFileSync` (no partial write buffering occurs at this layer; external FS constraints still apply).
- On Windows transient sharing violations are handled during *read* with retry logic; write failures are ignored to prioritize availability (file stays loadable in its pre-normalized form next cycle).
- Normalization avoids introducing new required semantic fields to keep backward compatibility with older deployments that may still read data.

## Interaction With Other Processes

| Process / Tool | Interaction |
|----------------|------------|
| Groom / Enrich scripts | Still useful for higher-order enrichment (governance metadata population) but no longer required for baseline canonical shape. |
| Hash-based Index integrity | Normalization ensures stable hash after first load; subsequent loads should keep index hash unchanged unless real content changes. |
| Graph export | Category sanitization improves deterministic node grouping and prevents orphaned style classes. |
| Governance hash drift tests | Benefit from reduced spurious drift due to inconsequential token differences. |

## Operational Guidelines

- Enable audit logging only during migrations or after upgrading to a version with expanded normalization rules.
- Periodically diff new audit lines; unexpected volume indicates upstream content generation issues.
- If a future rule expansion is planned, bump this document version and list the added rule set in a Change Log section.

## Change Log (Doc)

| Doc Version | Date | Summary |
|-------------|------|---------|
| 1.0.0 | 2025-09-14 | Initial publication (audience, requirement, category, primaryCategory, id, migration triggers, audit log). |

## Future Extensions (Planned / Considerations)

- Optional normalization severity stats surfaced through existing diagnostics handler (no new tool method).
- Safe collapse of near-duplicate category tokens via Levenshtein threshold (opt-in; not implemented; would need explicit gating to avoid false merges).
- Structured normalization profile hash to detect rule drift across versions.

## Appendix A: Rationale for Always-On Approach

Historically, missing grooming allowed silent drift and test brittleness. Embedding normalization inside ingestion ensures:

- No reliance on external scheduling.
- Deterministic developer onboarding (clone → run, no prep script).
- Lower cognitive load for authors contributing instructions.

## Appendix B: Quick Verification Checklist

| Scenario | Expected Outcome |
|----------|------------------|
| Add file with audience:"Developers" | Loads; rewritten with audience:"group"; audit line if logging enabled |
| Add invalid id with spaces | Sanitized to kebab form if regex satisfied; else original retained (may still pass if now valid) |
| Add category "UI Flow/Graph" | Stored as `ui-flow-graph` (punctuation collapsed) |
| Add primaryCategory not in categories | Added to categories post-sanitization |
| Re-run server with no file edits | Zero new audit records |

---
If you need more detail or want to extend rules, update this file first, then implement – documentation is the contract.
