# Testing Strategy

This document describes the layered test approach to continuously expand coverage without exploding maintenance cost.

## Layers

1. Unit (pure logic)  
   - Classification normalization invariants (property-based).  
   - Governance hash projection & risk scoring.
2. Service (in-process)  
   - Handlers: add/import/get/list/remove/enrich/groom/governance-update.  
   - Error surfacing (loader errors, schema failures).
3. Protocol (black-box)  
   - JSON-RPC lifecycle: initialize -> tool calls -> graceful shutdown.  
   - Persistence across restart (round-trip) & disappearance regression.
4. Concurrency / Stress  
   - Rapid duplicate adds / overwrites (deterministic end state, no crashes).  
   - Interleaved add + groom (future).  
   - Simulated partial write (future when atomicity gaps removed) -> ensure loader error not disappearance.
5. Property-Based / Fuzz  
   - Instruction generation explores category normalization, priority tier derivation, deterministic hashing.  
   - Future: corpus of malformed JSON, truncated files, schema edge cases to assert they surface in `loadErrors` not silent skip.
6. Governance Drift / Integrity  
   - Hash stability tests assert no change when unrelated fields mutate.  
   - Drift detection only when governance projection changes.

## Expansion Playbook
 
For every new defect class discovered:

1. Reproduce minimal failing scenario manually or via script.  
2. Add failing test in the lowest viable layer (unit < service < protocol).  
3. Fix the code.  
4. Add a regression guard at protocol layer if issue originated from cross-layer interaction.

## Automation Cadence

- All tests: `npm test` (CI).  
- Contract / schema-only quick check: `npm run test:contracts`.  
- Coverage gate: `npm run coverage:ci` (threshold lines / branches).
- Fast feedback (default build): `npm run test:fast` – excludes high-cost reproduction / RED suites.
- Pre-push extended regression: `npm run test:slow` (or automatic via git pre-push hook) – runs multi-client + persistence divergence reproductions.

### Fast vs Slow Suite Classification (2025-09-05)

Rationale: Keep `build:verify` wall-clock low while preserving deep regression signal before code leaves the workstation.

Fast suite (executed in `build:verify`):

- All stable/unit/service/protocol tests excluding explicitly listed slow/RED files.

Slow / Pre-Push suite (`scripts/test-slow.mjs`):

- `feedbackReproduction.multiClient.spec.ts`
- `feedbackReproduction.crudConsistency.spec.ts`
- `instructionsPersistenceDivergence.red.spec.ts`
- `instructionsPersistenceIsolated.red.spec.ts`
- `importDuplicateAddVisibility.red.spec.ts`

Selection Criteria:

1. Runtime > ~10s or high I/O amplification (large Index sampling, multi-client coordination).
2. RED / reproduction tests intentionally exercising known gaps (may fail intermittently while diagnosing).
3. Adds marginal coverage beyond fast suite invariants (list/get atomicity, persistence divergence) not needed every build.

Governance:

- New slow candidates must document: estimated runtime, unique invariant covered, why not enforce in fast path.
- Periodically re-evaluate: if a slow test becomes fast (<5s), migrate back to fast suite.
- If a RED test turns GREEN (fixed), consider refactoring a minimal deterministic version into fast suite.

Developer Workflow:

1. During inner-loop: rely on `npm run build:verify` (fast tests) for quick signal.
2. Before push: allow pre-push hook to run (or manually `npm run test:slow`).
3. CI can optionally add a scheduled job executing both suites + stress (`test:stress`).

Bypass (emergency only): set `BYPASS_PRE_PUSH=1` env var before `git push` (future enhancement) – not yet implemented; intentional friction maintained.

### Environment-Gated RED Reproductions (Since 1.3.1)

Some RED tests are high-friction (intermittent timeouts, deep diagnostics) and can block routine pushes while an upstream anomaly is under investigation. To preserve signal without halting velocity, we gate specific reproductions behind explicit environment variables. Current gating:

| Test File | Env Var | Default Behavior | Rationale |
|-----------|---------|------------------|-----------|
| `importDuplicateAddVisibility.red.spec.ts` | `INDEX_SERVER_RUN_RED_IMPORT_DUP_ADD` | Skipped unless set truthy (`1/true/yes/on`) | Intermittent visibility timing anomaly; heavy diagnostics & 25s timeout |
| `instructionsAddSkipVisibility.spec.ts` | `INDEX_SERVER_RUN_SKIP_VISIBILITY_RELIABILITY` | Skipped unless set truthy (`1/true/yes/on`) | Occasional 35s timeout in production-dir handshake path; under active investigation |

Guidelines:

1. Gating is temporary; remove once anomaly either (a) fixed and converted to deterministic GREEN test, or (b) re-characterized as obsolete.
2. Gated tests MUST clearly document activation variable at file top.
3. Do NOT gate a RED test preemptively—only after repeated blocking incidents (>=2 aborted pushes) and documented in commit message.
4. CI full runs (scheduled or manual deep diagnostics) should set the env var to avoid silent regression masking.

Activation Example:

```powershell
$env:INDEX_SERVER_RUN_RED_IMPORT_DUP_ADD='1'; npm run test:slow -- src/tests/importDuplicateAddVisibility.red.spec.ts
```

This strategy keeps RED artifacts present (preventing knowledge drift) while eliminating routine friction for unrelated doc or governance changes.

## Property-Based Guidance

- Keep each property < 100 runs for CI speed; add nightly job (future) with >1000 runs.  
- Shrink failure outputs to produce minimal counter-example (default fast-check behavior).  
- Prefer focused arbitraries: supply only valid characters to avoid noisy schema rejections.

<!-- Historical parked property-based backlog removed as part of plan reset (see new Implementation Plan). -->

## Pending Enhancements

- Add `loadErrors` tool and tests: assert no silent skips.  
- Atomic write enforcement test: inject crash between write & fsync (requires harness).  
- Path pinning test after directory resolution refactor.  
- Fuzz loader with truncated JSON files, expect surfaced errors.

## Principles

- Each new bug gets a test before a fix.  
- Never broaden a property until it finds at least one real issue historically (evidence-driven expansion).  
- Keep protocol tests deterministic (avoid racey timing; prefer polling wait utilities).  
- Fast feedback: majority of suite under 10s local.

## Mandatory CRUD Feedback Red/Green Workflow (Mirrored Policy)

This section mirrors the authoritative policy in `feedback_defect_lifecycle.md` and is included here so test authors have zero ambiguity when confronted with CRUD / persistence anomalies (phantom writes, visibility gaps, inconsistent list vs get, multi-client divergence).

High-level enforcement (concise):

1. RED test first (`*.red.spec.ts`) using ONLY reporter-provided IDs.
2. No handler/service code changes until RED test committed & failing in CI.
3. RED test MUST assert: add contract, list inclusion, per-ID get visibility, index hash (or synthetic surrogate) mutation.
4. Capture evidence (counts, missing IDs) in an analysis doc before any fix.
5. Apply minimal atomic persistence fix (write → verify → index update) then convert RED to GREEN (rename/duplicate).
6. Add negative + multi-client visibility regression tests post-fix.
7. CI guard: CRUD issue closure requires RED→GREEN pair reference.

### Data Fidelity Enforcement (ALWAYS Use Provided Data)

ALL reproduction tests MUST embed or import the exact reporter-supplied payload (every field & original whitespace). No trimming, reformatting, synthesized IDs, or markdown reflow unless an inline `DATA-FIDELITY-WAIVER` comment references explicit approval & rationale. Reviewers reject any PR that paraphrases payload content. Future automation will lint for divergence against archived feedback JSON.

Refer to the lifecycle doc for the detailed invariant table and justification. Any deviation requires explicit documented waiver in both docs.
