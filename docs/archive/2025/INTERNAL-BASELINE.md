# Authoritative Baseline Recovery Execution Plan (ONLY PLAN IN FORCE)

> This document is the single source of truth for the current recovery operation. Any prior plans, options, or exploratory efforts are **revoked**. Changes require an explicit written "CHANGE REQUEST" referencing this file.

## 0. Declaration (No Deviation Charter)

No unapproved deviation, scope creep, parallel experiments, or "quick fixes" are allowed until Phase 8 (Governance & Protection) is complete. Any new request that is not an explicit amendment to THIS plan is out-of-scope and rejected.

## 1. Objective

Restore a trustworthy, minimal, reproducible baseline for the index by:

- Eliminating historical noise / churn.
- Verifying core atomic persistence invariants deterministically.
- Establishing a clean, documented foundation for controlled incremental re-expansion.

## 2. Non-Objectives (Explicitly Out of Scope Now)

- Broad test suite resurrection.
- Performance / enrichment / search relevance optimization.
- Debugging flaky ancillary or exploratory tests.
- Architectural refactors.
- Feature expansion (beyond minimal selective reintroductions listed here).

## 3. Success Criteria (ALL MUST PASS)

1. Fresh clone builds ( `npm ci` + `npm run build` ) with exit code 0.
2. Minimal invariant test set passes **3 consecutive cycles** with zero failures:
   - `scripts/repro-add-get.js` (run 3x per cycle)
   - `createReadSmoke.spec.ts`
   - `mcpTestClient.spec.ts`
   - `instructionsAddPersistence.spec.ts`
3. No unexpected file churn: `git status` clean post-run.
4. Instruction add → immediate get → list visibility succeeds every attempt (no polling/backoff).
5. No mid-run auto-redeploy / drift triggers (deployment stability).
6. One consolidated commit: `baseline-restore` (tight diff).
7. This document + CHANGELOG entry updated to reflect baseline restoration.
8. (If CI available) Protection rules / status check use only minimal invariant suite.

## 4. Hard Failure Criteria (Abort & Reassess)

- Irrecoverable `npm ci` failure after lock remediation + single reboot attempt.
- Repro script fails deterministically after clean reset.
- Minimal tests now *require* churned changes (unresolvable without reinstating noise).

## 5. Key Artifacts

- Baseline commit (hash TBD upon completion).
- `INTERNAL-BASELINE.md` (this file).
- Minimal test files (3) + `scripts/repro-add-get.js`.
- Optional: Tag `baseline-<YYYY-MM-DD>-v1`.

## 6. Minimal Invariant Suite

| Component | Purpose |
|----------|---------|
| `scripts/repro-add-get.js` | Atomic add→get→list sentinel (fast, no harness overhead) |
| `createReadSmoke.spec.ts` | Basic CRUD smoke across canonical path |
| `mcpTestClient.spec.ts` | SDK-based MCP client atomicity validation |
| `instructionsAddPersistence.spec.ts` | Persistence durability + restart semantics |
| `governanceHashIntegrity.spec.ts` | Governance hash stability & drift scenarios (Added via BASELINE-CR 2025-08-30) |

## 7. Selective Reintroduction Set (Allowed After Phase 5 Passes)

- Deploy lock mechanism (single file diff) – resiliency improvement.
- `.gitignore` enhancements for generated artifacts – noise suppression.
- Repro script (if missing) – always retained.
- (Feedback system deferred: not a core invariant dependency.)

## 8. Phases (Strict Sequential Execution)

### Phase 0. Safety Snapshot

1. `git branch backup/churn-full || true`
2. `git add -A && git commit -m "churn snapshot (pre-baseline reset)" || true`
3. Archive: `Compress-Archive -Path . -DestinationPath ../index-server-churn-snapshot.zip -Force`
   - Gate: Snapshot branch + archive exist.

### Phase 1. Hard Reset

1. Record `HASH_HEAD=$(git rev-parse HEAD)`.
2. `git reset --hard HEAD`
3. `git clean -fdx`
   - Gate: `git status` clean.

### Phase 2. Fresh Clone Environment

1. `git clone <origin-url> C:\github\mcp-index-clean`
2. `cd C:\github\mcp-index-clean`
3. `git checkout <HASH_HEAD>`
   - Gate: HEAD matches recorded hash.

### Phase 3. Dependency & Build

1. `taskkill /IM node.exe /F 2>NUL || cmd /c exit 0`
2. `npm ci`
3. `npm run build`
   - Gate: Build success, `dist/server/index-server.js` present.
   - Retry Policy: Single reboot if EPERM persists. Then Hard Failure.

### Phase 4. Minimal Suite Isolation

1. Ensure `scripts/repro-add-get.js` present (cherry-pick if needed).
2. Move ALL other `src/tests/*.spec.ts` out except minimal three.
3. Environment: only necessary vars (`INDEX_SERVER_MUTATION=1`).
   - Gate: Only minimal test specs remain.

### Phase 5. Deterministic Validation

Commands per cycle:

```bash
node scripts/repro-add-get.js
node scripts/repro-add-get.js
node scripts/repro-add-get.js
npx vitest run src/tests/createReadSmoke.spec.ts
npx vitest run src/tests/mcpTestClient.spec.ts
npx vitest run src/tests/instructionsAddPersistence.spec.ts
```

Repeat cycle x3.

Gate: 0 failures across all 9 script runs + 9 test executions.

### Phase 6. Selective Reintroduction

1. Apply deploy lock diff (cherry-pick or manual patch).
2. Apply `.gitignore` enhancements (if absent).
3. Re-run one full Phase 5 cycle (single iteration).
   - Gate: Still 0 failures.

### Phase 7. Consolidated Baseline Commit

1. Add: repro script, modified tests (minimal), deploy lock file, `.gitignore`, this doc, CHANGELOG.
2. `git commit -m "baseline-restore: establish clean minimal invariant suite and deploy lock"`
3. Optional tag push.
   - Gate: Single, tight diff commit.

### Phase 8. Governance & Protection

1. CI pipeline config: run only minimal suite.
2. Enforce status checks.
3. Tag baseline.
   - Gate: Policy active; documentation updated.

### Phase 9. Controlled Expansion (Deferred – Requires Change Request)

Rules:

- <=2 new test files per expansion PR.
- Each test annotated with its invariant.
- 3-run flake check mandatory.
- Failing or flaky additions blocked.

## 9. Risk Register & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Locked esbuild.exe | Blocks build | Medium | Fresh clone + pre-kill node + single reboot fallback |
| Lost necessary hidden fix | Regression | Low-Med | Snapshot branch + archive before reset |
| Minimal tests secretly depend on churn code | Delays baseline | Low | Fast detection in Phase 5; selectively cherry-pick only truly needed bits |
| Human reintroduces noise prematurely | Signal dilution | Medium | Governance gate (Phase 8) + documented restrictions |
| Flaky invariant mask | False green | Low | Triple-cycle deterministic validation |

## 10. Verification Matrix

| Criterion | Phase | Artifact |
|----------|-------|----------|
| Clean build | 3 | Build log |
| Atomic add/get/list | 5 | Repro script output |
| Determinism (3 cycles) | 5 | Test logs |
| Minimal diff | 7 | Git diff before commit |
| Documentation present | 7 | This file + CHANGELOG |
| Governance enforced | 8 | CI config/status check |

## 11. Prohibitions During Phases 0–7

- No new feature code unrelated to deploy lock or baseline doc.
- No reintroduction of broad test suites.
- No logging verbosity escalation unless needed for a failing invariant.
- No partial commits (single baseline commit only).

## 12. Monitoring Signals

- Unexpected file creation under `instructions/` (beyond expected minimal) → investigate immed.
- Redeploy logs or stamp churn mid-tests → stop & examine deploy lock logic.
- Test runtime doubling between cycles (>100% variance) → potential race.

## 13. Completion Declaration

Plan considered COMPLETE only when Phase 8 gates pass and Success Criteria §3 are met; recorded here with timestamp & commit hash.

Completion Record (to fill upon success):

```text
Baseline Commit: <hash>
Timestamp (UTC): <datetime>
Repro Runs: 9/9 PASS
Test Cycles: 3 PASS (0 failures)
Diff Size: <insert stats>
Tag: baseline-<date>-v1 (yes/no)
```

## 14. Change Control

Any requester must submit:

```text
CHANGE REQUEST: <summary>
Justification: <why>
Phase Impacted: <phase number or post-baseline>
Rollback Plan: <steps>
```

No execution until explicitly approved.

### 14.1 Sentinel & Commit Marker Enforcement

- A SHA256 sentinel file `.baseline.sentinel` MUST match `INTERNAL-BASELINE.md` contents.
- Any modification to this file requires commit message marker: `BASELINE-CR:` (enforced by `commit-msg` hook).
- After an approved change merges: run `npm run baseline:sentinel:update` in a clean working tree and commit the updated sentinel in the same change request.

### 14.2 Approved Change Request (2025-08-30) – Baseline Expansion

```text
CHANGE REQUEST: Expand minimal invariant suite with parameterized CRUD, harness lifecycle, and governance hash stability tests.
Justification: Core deterministic behaviors (parameterized variations, harness orchestration, governance hash invariants) now considered foundational and low‑risk; improves early regression detection without introducing flake.
Phase Impacted: Post-baseline (Controlled Expansion §9).
Rollback Plan: Remove the three added spec files + revert table in §6 + update sentinel.
Approval: Maintainers consensus (documented inline).
```

Status: ACTIVE. Table in §6 updated; sentinel hash updated accordingly.

<!-- Pre-commit runs: `guard:baseline` + sentinel verify under `BASELINE_ENFORCE=1`. -->
- Pre-commit runs: `guard:baseline` + sentinel verify under `BASELINE_ENFORCE=1`.
- CI MUST execute: `BASELINE_ENFORCE=1 npm run guard:baseline && npm run baseline:sentinel:verify`.
- A mismatch = hard failure; no silent drift accepted.

### 14.2 Agent Execution Directive (Non-Negotiable)

- All baseline operations (phases, guard runs, sentinel verify/update, minimal test cycles) MUST be executed through MCP protocol tool `run-powershell` (server: `powershell-mcp-server`).
- AI agent usage of raw VS Code terminals for these actions constitutes a governance breach.
- Justification: Ensures reproducibility, timeouts, working directory control, auditability, and zero interactive prompts.
- Enforcement: `mcpConfigImperativeDirective.spec.ts` + documentation cross-links + commit-msg & pre-commit policies. Future enhancement (optional): CI pipeline denies passing status if logs reveal non-MCP invocation patterns.

---

**Status:** INITIAL AUTHORING – Awaiting execution ACK.

**Do not modify outside defined process.**

### 14.3 Approved Change Request (2025-09-06) – Noise Suppression Allow‑List (BufferRing + Governance Hardening)

```text
CHANGE REQUEST: Allow-list BufferRing focused test trio + governance hash hardening suite (non-minimal) to suppress baseline guard noise.
Justification: These tests provide:
   • BufferRing operational + persistence verification (core observability substrate now stable).
   • MetricsCollector integration validation (ensures ring-backed telemetry paths remain intact during refactors).
   • Governance hash extended regression scenarios (canonicalization, semanticSummary/changeLog/governance batch, import order invariance) executed with SOFT assertions pending future hardening.
Scope Clarification: This does NOT expand the Minimal Invariant Suite (§6). Entries are strictly noise-suppression allow‑list additions. Failure of any of these tests does not (yet) constitute baseline break; they are early warning signals.
Tests Added To Allow-List:
   - bufferRing.spec.ts (legacy placeholder to block monolith resurrection)
   - bufferRingSimple.spec.ts (core ring behaviors & persistence)
   - bufferRingMetricsIntegration.spec.ts (MetricsCollector integration)
   - governanceHashHardening.spec.ts (extended hash regression – soft expectations)
Risk: Soft assertions could mask emerging semanticSummary/changeLog drift; tracked for future tightening via separate BASELINE-CR.
Rollback Plan: Delete the four spec files (or park), remove their entries from scripts/guard-baseline.mjs allowedAdditional array, remove this §14.3 block, run `npm run baseline:sentinel:update` to refresh sentinel, commit with BASELINE-CR marker.
Approval: Maintainers consensus (inline documentation suffices per §14.1 policy for low-risk noise suppression CRs).
Status: ACTIVE – Sentinel updated in this commit.
```

### 14.4 Approved Change Request (2025-09-11) – Noise Suppression Allow‑List (Graph Export Determinism)

```text
CHANGE REQUEST: Allow-list `graphExport.spec.ts` (deterministic graph export validation) without expanding minimal invariant suite.
Justification: Provides early warning for regressions in upcoming instruction relationship visualization feature set. Validates:
   • Deterministic node ordering and edge capping logic.
   • `meta.graphSchemaVersion` placement and stability.
   • Cache invalidation on mutation operations.
   • Performance regression detection (runtime budget <2s isolated).
Scope Clarification: This addition is strictly a noise-suppression allow‑list entry. Failures do not constitute baseline break; they inform Phase 9 controlled expansion readiness.
Risk: Potential false positives if future graph feature flags alter structure; mitigated by isolation (temp INDEX_SERVER_DIR) and explicit cache invalidation.
Rollback Plan: Remove `graphExport.spec.ts` from repository (or park), delete its entry from `scripts/guard-baseline.mjs` allow-list, remove this §14.4 block, run `npm run baseline:sentinel:update`, commit with BASELINE-CR marker.
Approval: Maintainers consensus (inline doc). Sentinel updated in this commit.
Status: ACTIVE.
```

### 14.5 Approved Change Request (2025-09-14) – Noise Suppression Allow‑List (Bootstrap Gating, Manifest Lifecycle, Search & Governance Recursion Guards)

```text
CHANGE REQUEST: Allow-list additional deterministic, low‑risk diagnostic and governance coverage specs (bootstrap gating, manifest lifecycle & schema validation, search & versioning governance, recursion guard, onboarding help, graph export visualization variants) to suppress baseline guard noise while preserving strict minimal invariant scope.
Justification:
   • `bootstrapGating.spec.ts` – Verifies human confirmation token flow (request → finalize) + negative mutation gating; essential safety signal but not yet a Phase 6 minimal invariant (human step dependency).
   • `addVisibilityInvariant.spec.ts` – Strengthens immediate add→list visibility regression detection beyond minimal smoke; kept as early warning only.
   • Manifest suite (`manifestEdgeCases.spec.ts`, `manifestFastload.spec.ts`, `manifestLifecycle.spec.ts`, `manifestSchemaValidation.spec.ts`, `manifestSkip.spec.ts`) – Validates emerging manifest observability & fastload roadmap; currently evolving, not frozen enough for minimal set.
   • Governance & versioning (`instructionsGovernanceVersion.spec.ts`, `instructionsVersionChangeLog.spec.ts`) – Tracks version bump semantics & change log emission; still iterating on format stability.
   • Search & relevance (`instructionsSearch.spec.ts`) – Functional correctness + ranking heuristics subject to near‑term refinement.
   • Recursion / self‑reference guard (`governanceRecursionGuard.spec.ts`) – Ensures instruction self-referential recursion leakage is blocked; early warning only while policy stabilizes.
   • Graph export enriched & mermaid variants (`graphExport.enriched.spec.ts`, `graphExport.mermaid.spec.ts`) – Visualization serialization formats (extended metadata + Mermaid DSL) are experimental; deterministic assertions may tighten later.
   • Onboarding helper (`onboardingHelp.spec.ts`) – Validates curated onboarding / help Index presence; content still iterative.
Scope Clarification: NONE of these expand §6 Minimal Invariant Suite. They are noise‑suppression allow‑list additions whose failure does NOT constitute a baseline break; they serve as proactive regression detectors and feed future hardening CRs.
Risk: Mild risk of brittle assertions amidst rapid manifest & visualization iteration; mitigated by isolation (temp directories) and soft‑scoped allow‑list (removable without destabilizing baseline invariants).
Rollback Plan: Remove spec files (or park), delete their entries from `scripts/guard-baseline.mjs` allow-list, excise this §14.5 block, run `npm run baseline:sentinel:update`, commit with `BASELINE-CR:` marker.
Approval: Maintainers consensus (inline per §14.1 process for low‑risk noise suppression).
Status: ACTIVE – Sentinel updated in this commit.
```

NOTE: Future hardening will introduce a follow-up BASELINE-CR converting soft expectations in `governanceHashHardening.spec.ts` to strict invariants once semanticSummary + changeLog hash transitions are deterministic across all execution modes.

## 15. Execution Log (Authoritative)

| Timestamp (UTC) | Phase | Action | Result | Hash / Notes |
|-----------------|-------|--------|--------|--------------|
| PENDING | 0 | Snapshot branch + archive | PENDING | Will record HASH_HEAD |
| 2025-08-30 09:58:15Z | 0 | Snapshot commit + archive | CREATED | 89b6938f16ef03923b4cea2f4272d589a9748bb5 snapshot-20250830-095815-89b6938f16ef03923b4cea2f4272d589a9748bb5.zip |
| 2025-08-30 10:00:10Z | 1 | Hard reset & clean | CLEAN | 3583ad46d135fd8730b0590668262b00b8a19be4 |
| 2025-08-30 10:05:45Z | 2 | Fresh clone environment | CLONED | C:\github\mcp-index-clean-20250830100222 @ 3583ad46d135fd8730b0590668262b00b8a19be4 |
| 2025-08-30 14:29:49Z | 3 | build | FAIL | exit 2 |
| 2025-08-30 14:31:10Z | 3 | build retry | FAIL | exit 2 |
| 2025-08-30 14:32:05Z | 3 | dependency install + build | OK | 7721136 dist/server/index-server.js present |
| 2025-08-30 14:37:20Z | 4 | minimal suite isolation prep | OK | tsconfig excludes tests._park + vitest config |
| 2025-08-30 10:49:55Z | 4 | isolation hardened (runner filtered) | OK | vitest include src/tests only; dist & node_modules excluded; minimal trio pass |
| 2025-08-30 11:04:55Z | 5 | deterministic validation cycles (3x) | OK | 9/9 repro + 9/9 tests pass (0 failures) |

Logging Rules:

- Every phase step produces a table row immediately after completion (no batching).
- If a step fails, record failure row before any remediation.
- Remediation attempts get separate rows (suffix Action with `-retry#`).
- No row deletion; corrections use an added row referencing the earlier row.

Initial pending entries inserted. Will begin population only after explicit user ACK ("ACK EXECUTE").
