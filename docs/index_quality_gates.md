# Index Quality Gates

This document defines enforceable quality gates for the instruction index and the remediation / salvage rules that keep
acceptance rates high while maintaining governance integrity.

## Objectives

- Prevent silent erosion of Index acceptance (target > 95% acceptance excluding intentional governance/config skips)
- Ensure deterministic skip reasons: every skipped file must have a reason bucket
- Provide controlled salvage for common authoring drift (enum typos, slight body overages) without masking systemic issues

## Reason Buckets (Stable API Surface)

| Bucket | Meaning | Action |
|--------|---------|--------|
| ignored:governance-denylist | Governance seed / bootstrap file intentionally excluded | No change; document or relocate if accidental |
| ignored:non-instruction-config | Operational JSON not shaped like an instruction | Optionally relocate to a `config/` or `_state/` subfolder |
| ignored:template | `_templates` placeholder file | Leave excluded |
| schema | Failed JSON schema validation (post-salvage) | Fix source or (rare) extend salvage rules |
| classification | Failed classificationService.validate | Author fix (missing deprecatedBy etc.) |
| error | Exception during load | Investigate root cause |

## Salvage Strategy

Salvage converts otherwise hard rejects into normalized, traceable acceptances with counters in `summary.salvage`.

| Rule | Before | After | Salvage Counter |
|------|--------|-------|-----------------|
| Missing audience | undefined / null | `all` | `audienceMissing` |
| Invalid audience enum | e.g. "teams", "everyone" | `all` | `audienceInvalid` |
| Missing requirement | undefined / null | `recommended` | `requirementMissing` |
| Invalid requirement enum | e.g. "MUST_HAVE" | `recommended` | `requirementInvalid` |
| Out-of-range priority | <1 or >100 or non-numeric | `50` | `priorityInvalid` |
| Invalid priorityTier | Non P1–P4 value | removed → recomputed | `priorityTierInvalid` |
| Body oversize | exceeds `bodyWarnLength` | truncated to limit | `bodyTruncated` + soft warning |

Salvage never masks severe structural issues (missing core required fields after minimal inference). If salvage fires, the
original raw value is intentionally not persisted back to disk automatically (avoids churn) unless existing normalization already rewrites.

## Hard Limits & Warnings

Body size enforcement is configurable via `INDEX_SERVER_BODY_WARN_LENGTH` (default: 100000, range: 1000–1000000).
The JSON schema hard ceiling is 1MB (`bodyMaxLength`); `bodyWarnLength` controls the effective enforcement limit.

| Path | Limit | Enforcement | Counter |
|------|-------|-------------|---------|
| `index_add` / `index_import` | Body > `bodyWarnLength` | **Rejected** with guidance | `body_too_large` error |
| Loader / normalization | Body > `bodyWarnLength` | **Truncated** to limit | `body:truncated` (plus salvage) |
| Loader (auto-split enabled) | Body > `bodyWarnLength` | **Split** into cross-linked parts | `autoSplitParts` |
| Any path | Body 90–100% of limit | Accept | `body:near-limit` |

## Acceptance Targets

| Category | Target |
|----------|--------|
| Overall acceptance (devinstructions) | >= 95% |
| Schema rejects for enum drift | 0 (should be salvaged) |
| Large body rejects | 0 (should be truncated or edited) |
| Governance / config intentional skips | Stable / documented |

## Test Coverage

The regression tests in `src/tests/IndexQuality.spec.ts` assert:

- scanned == accepted + skipped
- No audience/requirement schema rejects remain
- Salvage counters appear when invalid inputs existed
- No body exceeds hard limit

## Operational Checklist (When Adding New Instructions)

1. Ensure `audience` in {individual, group, all} (missing values are auto-salvaged to `all`)
2. Ensure `requirement` in {mandatory, critical, recommended, optional, deprecated} (missing values are auto-salvaged to `recommended`)
3. Keep `body` under 90% of configured limit ideally (default: <90k, absolute max configurable via `INDEX_SERVER_BODY_WARN_LENGTH`)
4. Provide `priority` 1–100 (lower = more important)
5. Avoid adding governance bootstrap files into runtime Index directory

## Extending Salvage

When recurring benign errors appear:

1. Add a narrowly-scoped salvage transformation before validation
2. Increment a distinct salvage counter key
3. Update this document and add/adjust tests to assert new salvage behavior

## Transparency & Trace

Set `INDEX_SERVER_FILE_TRACE=1` to emit per-file decisions:

```text
[trace:Index:file-end] { file: "example.json", accepted: false, reason: "schema: /audience: must be equal ..." }
```

Schema and classification rejections are also logged to stderr at info level:

```text
[Index:skip] example.json: schema: /body: must NOT have more than 100000 characters
```

This trace plus the JSON `Index-summary` log event enables external dashboards & health endpoints.

## Future Improvements

## Manifest

The loader now generates `_manifest.json` each load:

| Field | Description |
|-------|-------------|
| version | Manifest schema version (1) |
| generatedAt | ISO8601 timestamp when manifest built |
| count | Number of accepted instruction entries |
| hash | Aggregate index hash (id:sourceHash stable ordering) |
| summary | Copy of index load summary (acceptance, salvage, reasons) |
| entries[] | Slim records: id, title, priority, priorityTier, audience, requirement, sourceHash, bodyHash |

Schema: `schemas/manifest.schema.json` (extended to allow hash/summary & richer entry fields). Tests: `src/tests/manifest.spec.ts`.

Guarantees:
 
1. Written atomically (tmp + rename) after successful load.
2. Excluded from subsequent scans.
3. Validated against schema (warnings logged on mismatch, never blocks load).
4. `count == entries.length == accepted`.
5. Hash matches `computeIndexHash` aggregate.
6. Body hash is SHA-256 of stored `body` post-normalization.

- Optional endpoint `/instructions/skipped` enumerating skipped file + reason
- Dashboard panel showing salvage trend over time (detect rising drift)
- Adaptive author feedback: surface salvage corrections as suggestions in tooling

---
Maintainer Note: updating salvage rules requires updating both code and this document. Treat salvage keys as part of the
observability contract consumed by monitoring/tests.
