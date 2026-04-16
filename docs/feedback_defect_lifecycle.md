# Feedback → Defect → Red/Green → Fix → Coverage Lifecycle

Date: 2025-08-30
Current package version: 1.0.7
Current instruction schemaVersion: 2 (no change in this cycle)

## 1. Intake (Feedback Submission)

- Source: MCP client invokes `feedback_submit` with a structured payload (type, severity, description, context, optional tags).
- Server persists entry (JSON store) and returns an ID.
- Trigger: Presence of actionable reproduction clues (instruction IDs, operation sequence, observed vs expected behavior).

## 2. Triage & Classification

- AI / agent retrieves entry via `feedback_get` (or filters with `feedback_list`).
- Classify: (a) Alleged persistence failure, (b) Search mismatch, (c) Governance enforcement, etc.
- Determine initial severity & scope (does it threaten durability guarantees? only discoverability? security?).
- Decide required artifact set: analysis report + red tests.

## 3. Analysis Report Creation

- File produced (example: `docs/FEEDBACK-ANALYSIS-bulk-import-failures.md`).
- Contents: Summary, contradicted vs reproduced claims, hypothesis, next steps.
- Links observed instruction IDs and raw attempted payloads where available.

## 4. Red Test Authoring (Reproduction Phase)

- Create focused Vitest spec (e.g. `src/tests/feedbackReproduction.spec.ts`).
- Encode each alleged symptom as a RED test that should initially fail if defect is real OR pass if allegation is contradicted.
- Use original instruction blobs (embedded or imported) to minimize drift; name constants after feedback ID or reported instruction ID.
 
### ABSOLUTE DATA FIDELITY REQUIREMENT (MANDATORY)

You stated policy: ALWAYS use the provided data. This section codifies that requirement:

1. Every reproduction test MUST embed or import the exact reporter-supplied payload (IDs, title, body markdown including whitespace/newlines, rationale, requirement, audience, priority, categories, tags, overwrite flags, etc.).
2. No paraphrasing, trimming, normalization, or synthetic alteration (including random suffixes) is permitted unless an explicit written waiver is added as a comment directly above the modified value with the tag `DATA-FIDELITY-WAIVER` and a justification.
3. Large payloads: If performance is a concern, store the full original in a fixture file (`src/tests/fixtures/<feedbackId>.json` or `devinstructions/`) and load it verbatim; derive any reduced form only after documenting rationale and securing a waiver comment.
4. Whitespace, ordering, and markdown structure are treated as semantically significant for reproduction until disproven; do not collapse or reflow.
5. Review checklist MUST include “Exact payload fidelity preserved?”; PRs failing this are rejected.
6. Future enforcement: linter rule to diff payload constants against archived feedback JSON and fail on mismatch.

Violation of data fidelity is a policy breach and invalidates the RED→GREEN chain for that defect.

- Categories inside spec:
  - Persistence Validation (RED) – reported broken paths.
  - GREEN Baselines – expected healthy behavior (acts as control group).
  - Integration / Workflow – end‑to‑end backup/restore or restart durability.

## 5. Execute & Record Outcomes

- Run `npm test` (or focused run). Capture: which reports reproduce vs contradict.
- Update analysis doc with PASS/FAIL matrix (contradicted vs confirmed issues).

## 6. Root Cause Isolation

- For reproduced failures: inspect handler / service layers (e.g. instructions add pipeline, search indexing logic, governance checks).
- For contradicted failures: verify no silent flakiness (repeat runs) and annotate as “not reproduced”.

## 7. Fix Implementation

- Apply minimal, well-scoped code changes (atomic visibility checks, governance rule correction, search normalization, etc.).
- Introduce unified failure contract if missing (this cycle: `{ created:false, error, feedbackHint, reproEntry }`).
- Harden success semantics (this cycle: `created:true` only after read-back + shape validation; `verified:true` gating).

## 8. Green Test Evolution

- Re-run RED tests; they turn GREEN once fix is in place.
- Add new GREEN tests to lock in invariants (e.g. restart durability, hash stability).
- Add explicit failure-path tests for new contract fields (created/verified/error/feedbackHint/reproEntry).

## 9. Coverage Completion

- Identify untested edge paths (atomic read-back failure, invalid shape, governance edge cases).
- Add supplementary specs (e.g. `instructionsAddCreatedFlag.spec.ts`).
- Ensure no “false positive” tests (remove expectations depending on deprecated behavior like search-by-id if not supported).

## 10. Versioning Decision

- Change set in this cycle: Added optional response fields (`feedbackHint`, `reproEntry`) & refined success semantics (still backward-compatible for clients tolerant of extra fields).
- Per `docs/VERSIONING.md` policy: Adding optional response fields after 1.0 warrants a MINOR bump (feature addition) if surfaced as stable contract.
- Current state: package.json at 1.0.7 (patch growth). If we treat the enriched add response as a documented, stable contract, next release should bump to 1.1.0.
- Instruction on-disk schema (`schemas/instruction.schema.json`) unchanged (schemaVersion stays `2`): no migration; therefore no schema version bump.

### When to Bump Instruction `schemaVersion`

| Change Type | Action |
|-------------|-------|
| Add optional metadata field (ignored by old readers) | No bump (document) |
| Change required field set / constraints | Increment schemaVersion + provide migration path |
| Rename / remove field | Increment schemaVersion (breaking) |
| Add derived read-only field (non-required) | No bump |

## 11. Changelog & Tagging

- Prepare CHANGELOG entry under next version (recommend: 1.1.0):
  - Added: Unified add failure contract (feedbackHint, reproEntry), creation verification semantics.
  - Fixed: Misinterpretation of search reliability (documented clarification) or actual code fix if applied.
- Run: `node scripts/bump-version.mjs minor` (after tree clean & tests green) → commit + tag.

## 12. Post-Fix Feedback Loop

- Optionally auto-comment / respond to original feedback with resolution summary & new version number.
- Encourage submitter to retest; if still failing, new feedback entry referencing version.

## 13. Governance & Quality Gates

- Confirm: typecheck, lint, tests (including skip guard), declaration guard all pass (`npm run build:verify`).
- Deployment dry-run (local prod script) before tagging.

## 14. Documentation Update

- README: Add note describing new add response contract (fields + semantics) and guidance to use `feedback_submit` with supplied `reproEntry` on failure.
- Tool docs: Update any examples referencing add result shape.

## 15. Archival Artifacts

- Keep analysis checkpoint file (immutable historical context).
- Tests referencing feedback ID act as living regression sentinel.

---

## Quick Reference Checklist (Repeatable Template)

1. Capture feedback ID and payload.
2. Draft analysis doc (claims vs evidence).
3. Author RED tests reproducing each claim.
4. Add GREEN baseline tests (control).
5. Run & classify (contradicted / reproduced).
6. Fix root cause (minimally, with invariants).
7. Enrich contracts (optional, backward-compatible) as needed.
8. Add / extend tests (failure & success paths).
9. Decide version bump (patch vs minor) per policy.
10. Update CHANGELOG + bump + tag.
11. Update docs (README, tool contracts).
12. Notify originator / close feedback.
13. Archive analysis + keep tests.

---
 
## Current Cycle Outcome Summary

| Aspect | Result |
|--------|--------|
| Feedback processed | Yes (multiple entries) |
| Analysis doc | Generated (`FEEDBACK-ANALYSIS-*.md`) |
| RED tests added | Yes (`feedbackReproduction.spec.ts`) |
| GREEN baselines | Yes (persistence & backup/restore) |
| Fixes applied | Creation verification + failure contract; search behavior clarified / stabilized |
| Additional coverage | `instructionsAddCreatedFlag.spec.ts` + portable CRUD suites |
| Package version bumped | To 1.0.7 (patch so far) |
| Recommended next bump | 1.1.0 (due to new optional response fields) |
| Schema version change | None (remains 2) |
| Docs pending | Need add-response contract section in README & TOOLS docs |

---
 
## Action Items (Open)

| Item | Priority |
|------|----------|
| Bump to 1.1.0 & update CHANGELOG for add contract enrichment | High |

| Document add response (created, verified, feedbackHint, reproEntry) in README / TOOLS | High |
| Fault-injection tests for atomic read-back failure paths | Medium |
| Annotate governance rationale for skipped tests (if any remain) | Medium |
| Auto-feedback loop (close original with resolution note) | Low |

---
Prepared to institutionalize feedback-driven hardening. Adopt this file as the canonical playbook for future cycles.

---

## Mandatory CRUD Feedback Red/Green Workflow (Critical Policy)

This policy was established after reproducing a production persistence divergence where multiple `add` operations reported success yet Index `list` count and `get` visibility (plus hash) remained unchanged for some IDs. To prevent ANY speculative or premature fixes that could mask root causes, the following workflow is now mandatory for ALL feedback reports alleging CRUD or persistence anomalies (visibility, phantom writes, skipped vs notFound contradictions, multi‑client divergence):

1. **Freeze Code Paths**

- Absolutely no handler / service modifications (instructions add/get/list/remove, indexing, hashing) until a deterministic RED test exists.
- Only permitted pre‑fix changes: adding test files, adding documentation of the issue, adding diagnostic NON-MUTATING logging (guarded behind env flags if noisy).

1. **Author Deterministic RED Test**

- File must carry `.red.spec.ts` suffix while failing (e.g. `instructionsPersistenceDivergence.red.spec.ts`).
- Use ONLY reporter‑supplied IDs and bodies (or a constant minimal body if body content is irrelevant) – never generate synthetic random IDs unless explicitly part of the repro.
- Preserve the ENTIRE provided payload verbatim (see ABSOLUTE DATA FIDELITY REQUIREMENT). Any deviation requires `DATA-FIDELITY-WAIVER` inline annotation.
- Assertions MUST cover: (a) add result contract (created / overwritten / skipped), (b) subsequent list inclusion, (c) direct read success, (d) index hash change (or synthetic hash surrogate) when new logical entries are added.
- Failure message text should clearly encode the invariant ("Post-add count should increase by N", "Read should succeed for \<id\>").

1. **Evidence Lock**

- Run the RED test in isolation and capture: initial count/hash, per‑ID add results, post‑list count/hash, which IDs are missing.
- If only a subset materializes (e.g. 4/5), record the exact missing ID(s) in a checkpoint doc (`docs/FEEDBACK-ANALYSIS-*.md`) BEFORE any code change.

1. **Minimal Fix Cycle**

- Implement smallest change set to guarantee atomic, durable, and visible Index mutation (write → fsync/close → in‑memory index update → read-back verify).
- If write or verify fails, surface explicit error (do NOT claim created/skipped) and DO NOT mutate in‑memory index.
- Re-run the RED test; upon passing, rename file (drop `.red`) or duplicate into a GREEN regression spec if historical naming required.

1. **Post-Fix Hardening**

- Add a companion negative test (e.g. forced simulated write failure → expect error path, no partial visibility).
- Add multi‑client visibility test ensuring second client observes the new IDs without restart.

1. **Documentation & Governance**

- Update this lifecycle file and `testing_strategy.md` (policy section) with any nuance discovered (e.g. need for synthetic hash due to absence of exposed server hash API).
- Append CHANGELOG entry referencing the RED test filename to provide forensic linkage.

1. **Enforcement Gate**

- CI should fail if a feedback-labeled issue (type CRUD) is closed without a corresponding RED→GREEN test pair or documented rationale for contradiction.
- Lint/Future: optional script scans for `.red.spec.ts` still passing (should fail intentionally or be renamed once green).

### Invariants Locked by Policy

| Invariant | Rationale | Detection Vector |
|-----------|-----------|------------------|
| add success must increase list count (unless overwriting existing ID) | Prevent phantom writes | RED test count delta |
| add success + !skipped implies readable via get | Eliminate skip/notFound contradiction | RED test read loop |
| batch of unique new IDs changes index hash | Ensures hash reflects logical state | Synthetic hash comparison (until native exposed) |
| multi-client sees new instruction within bounded delay | Confirms synchronization/visibility | Multi-client RED/Green spec |

### Synthetic Hash Justification

Until a stable public tool returns index hash for external tests, a deterministic synthetic hash (sorted IDs FNV-1a) is permissible solely for detecting absence of ID deltas. Replace with real hash once exposed to avoid drift between representations.

---
