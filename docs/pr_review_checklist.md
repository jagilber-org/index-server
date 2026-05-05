# Mandatory PR Review Checklist — AI Agent-Generated Code & Tests

> Policy reference: internal policy tracker #152
>
> **Status:** Active — this document is the authoritative source for AI-agent PR review requirements.

## Purpose

AI agents (GitHub Copilot, squad agents, other LLM-based tooling) have repeatedly introduced defective code and tests that passed CI but delivered no real coverage. This checklist defines the **minimum verification a human reviewer must complete** before approving any PR that contains AI-generated or AI-edited code or tests.

This policy is enforceable under constitution rules TS-5 (all tests must pass before commit), TS-6 (new features must include test coverage), TS-10 (tests must exercise real production code), and AG-4 (agent attestation metadata required).

## Scope

Applies to **every PR where any code or test was generated or materially edited by an AI agent**, including:

- Copilot completions and suggestions accepted into committed code
- Squad agent (`Trinity`, `Tank`, `Mouse`, etc.) authored changes
- GitHub Copilot coding agent (`@copilot`) draft PRs
- Any other AI-assisted generation (ChatGPT, Cursor, etc.)

Does **not** apply to purely human-authored PRs (though reviewers may use any checklist item they find useful).

## The Checklist

### 1. No Placeholder Tests

Search the diff for these patterns — any match is a **blocking reject**:

| Pattern | Why it's banned |
|---------|----------------|
| `expect(true).toBe(true)` | Tautological — always passes, tests nothing |
| `expect(1).toBe(1)` | Tautological — same problem, different literal |
| `expect(true).toBeTruthy()` | Tautological variant |
| Empty `() => {}` test bodies | Placeholder — silently passes with zero coverage |
| `// placeholder` or `// TODO: implement` in test bodies | Agent left a stub instead of a real test |
| `it.todo(...)` without a linked issue | Untracked gap |

**How to check:**

```bash
# In the PR diff or full test tree:
grep -rn "expect(true)" tests/
grep -rn "expect(1).toBe(1)" tests/
grep -rn "\.toBeTruthy()" tests/ | grep "expect(true)"
grep -rn "() => {}" tests/ --include="*.spec.ts" --include="*.test.ts"
grep -rn "placeholder\|TODO.*implement" tests/
```

The `check-hallucinations` pre-commit hook (`hooks/check-hallucinations.ps1`) catches some of these patterns at commit time. Reviewers must still verify — the hook is a safety net, not a substitute for review.

**Constitution basis:** TS-10 — tests must exercise real production code; toy reimplementations and stub copies are prohibited.

### 2. No Untracked Skips

Every `it.skip()` or `describe.skip()` in the diff **must** include:

- A linked issue number (e.g., `// skip: see #129`)
- An inline justification explaining why the skip is necessary

PRs that add `it.skip()` without both are **blocking rejects**.

**Also reject:** Any new `SKIP_OK` markers. This pattern was used to normalize permanently skipped tests and is banned.

**How to check:**

```bash
# In the diff:
grep -n "it\.skip\|describe\.skip\|SKIP_OK" <changed-files>
# Each match must have an adjacent issue reference
```

**Constitution basis:** TS-5 — all tests must pass before commit. Skips are not passes.

### 3. Negative Tests Required

Any PR that changes a handler or API endpoint **must** include tests for:

- **Invalid input** — malformed payloads, wrong types, missing required fields
- **Missing resources** — operations on non-existent IDs, empty indexes
- **Boundary conditions** — empty strings, max-length fields, zero-count operations
- **Permission/auth failures** — if the handler has access controls
- **Error response shape** — error responses return the expected structure (error code, message, and any documented error metadata) rather than raw exceptions or empty bodies

A handler change PR with only happy-path tests is a **blocking reject**.

**Constitution basis:** TS-12 — bug-prone handlers must have ≥5 test cases covering normal, edge, error, boundary, and concurrent scenarios.

### 4. Disk-Truth Verification

Any mutation-handler test (add, import, remove, update, governance update) **must** independently verify the result on disk — not just trust the server response.

**Bad (trusts response only):**

```typescript
const result = await callTool('index_add', payload);
expect(result.verified).toBe(true); // ← trusts the server's claim
```

**Good (verifies disk independently):**

```typescript
const result = await callTool('index_add', payload);
// Option A: Read back through the server to verify round-trip
const stored = await callTool('index_dispatch', { action: 'get', id: payload.entry.id });
expect(stored.body).toBe(payload.entry.body);

// Option B (strongest): Read the raw filesystem directly
import { readFileSync } from 'fs';
import { join } from 'path';
const filePath = join(testDir, `${payload.entry.id}.json`);
const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
expect(raw.body).toBe(payload.entry.body);
```

Prefer Option B (raw filesystem) when testing mutation handlers where the server itself is the component under suspicion. Use Option A when testing higher-level workflows where a server read-back is sufficient.

**Context:** The `index_add` handler previously returned `verified: true` without actually checking disk (commit 65afc0d, issue #119). This pattern prevents recurrence.

**Constitution basis:** TS-7 — functional tests must validate full pipeline round-trips.

### 5. Test Count Matches Claimed Coverage

If the PR description or commit message claims "N tests added," the reviewer **must** verify:

- Exactly N `it(...)` or `test(...)` blocks exist in the added/changed files
- Each block contains at least one real assertion (`expect(...)` with a meaningful check)
- None are duplicates testing the same input/output with different names

**How to check:**

```bash
# Count test blocks in changed spec files:
grep -c "it(" <changed-spec-files>
grep -c "expect(" <changed-spec-files>
# Assertion count should be >= test count
```

### 6. No Hardcoded Success Values

Search the diff for success indicators that are assigned as literals rather than computed:

| Pattern | Why it's banned |
|---------|----------------|
| `verified: true` (literal) | Must be computed from an actual verification step |
| `created: true` (literal) | Must be computed from an actual creation check |
| `success: true` (literal in handler response) | Must reflect actual operation outcome |
| `return { ok: true }` without preceding validation | Unconditional success is a lie |

Literal success values are acceptable **only** when clearly downstream of a real check (e.g., after a successful `fs.writeFile` + `fs.readFile` round-trip).

**Constitution basis:** AG-1 — agents must prefer the narrowest local hypothesis and smallest testable edit.

### 7. Agent Attestation Metadata

Per constitution rule AG-4, every agent-authored commit **must** include structured attestation metadata identifying:

- The agent (name or identifier)
- Its trust level
- The authorizing human
- The guiding instruction hash

The `validate-agent-trailers` pre-commit hook (`hooks/validate-agent-trailers.ps1`) enforces this at commit-msg stage. Reviewers should verify the trailer is present and accurate.

### 8. Copilot Co-authored-by Trailer

Every commit produced by GitHub Copilot (CLI, coding agent, or IDE) **must** carry the canonical trailer at the end of the commit message:

```
Co-authored-by: Copilot <copilot-noreply-email>
```

**How to check:**

```bash
git log --format=%B <commit-range> | grep -c "Co-authored-by: Copilot <223556219"
# Count must equal the number of Copilot-authored commits in the range
```

A missing or malformed trailer on a Copilot commit is a **blocking reject**. The trailer is mandatory in addition to (not a replacement for) the AG-4 agent attestation metadata in §7.

### 9. Tests Added For Behavioral Changes

Any PR that changes runtime behavior **must** include:

- **Unit tests** exercising the changed function/module in isolation
- **Integration tests** when the change crosses a layer boundary (handler → service, registry → IndexContext, MCP transport → handler)

Doc-only PRs, type-only refactors, and changes guarded by an existing test that already fails-then-passes are exempt. Pure deletions must include a test demonstrating the removed behavior is no longer reachable.

**How to check:**

```bash
# Verify the diff touched both src/ and tests/ (or has a documented exemption):
git diff --name-only <base>..HEAD | grep -E "^(src|tests)/"
```

PRs that change `src/` without a corresponding `tests/` change are a **blocking reject** unless the reviewer documents the exemption in the PR conversation.

**Constitution basis:** TS-6 — new features must include test coverage.

### 10. No Hardcoded Paths Or Secrets — Use `runtimeConfig`

All runtime tunables (paths, timeouts, feature flags, log levels, mutation flags) **must** flow through `src/config/runtimeConfig.ts`. Direct `process.env.*` reads outside that module are blocked by `npm run guard:env`.

Reviewers must reject:

- New `process.env.X` reads in handlers, services, or tests outside `src/config/runtimeConfig.ts`
- Hardcoded absolute or repo-relative paths to instruction data, dashboards, logs, or feedback (use the `INDEX_SERVER_*` env vars surfaced via `runtimeConfig`)
- Inline secrets, tokens, internal hostnames, IPs, or email addresses (also blocked by `gitleaks` / `ggshield` / repo-local PII scanner)

**How to check:**

```bash
npm run guard:env
git diff <base>..HEAD -- src/ tests/ | grep -E "process\.env\.[A-Z_]+"
# Each match must be inside src/config/runtimeConfig.ts or an allowlisted bootstrap file
```

**Reference:** `CONTRIBUTING.md` § Configuration & Environment Variables.

### 11. `logAudit()` Called For Every Mutation

Every mutation handler (add, import, remove, governance update, repair, normalize, promote, feedback CRUD that writes) **must** call `logAudit()` from `src/services/auditLog.ts`. Missing audit calls are a **blocking reject**.

**How to check:**

```bash
# For each new/changed mutation handler:
grep -n "logAudit\|MUTATION" src/services/<changed-handler>.ts
# Confirm logAudit is invoked on every successful mutation path AND error paths that produce side effects
```

Reviewers should also confirm the audit payload includes the operation name, target id (if applicable), and outcome (`success` / `error` with reason). Truncated or `undefined`-only payloads are not acceptable.

### 12. `toolRegistry.ts` Updated For New Or Changed Tools

When adding a new MCP tool, modifying an existing tool's input schema, or changing mutation classification, the PR **must** update `src/services/toolRegistry.ts` in all of the following locations:

- [ ] `INPUT_SCHEMAS` — Zod/JSON schema entry for the tool's parameters
- [ ] `STABLE` set — include the tool name iff its surface is stable across versions
- [ ] `MUTATION` set — include the tool name iff it writes state (drives audit + read-only-mode enforcement)
- [ ] `describeTool(...)` — human-readable description used in MCP discovery
- [ ] Side-effect import in `src/services/toolHandlers.ts` so the handler registers at startup

A new tool that omits any of these is a **blocking reject** — it will either fail discovery, bypass audit, or break read-only mode.

**How to check:**

```bash
git diff <base>..HEAD -- src/services/toolRegistry.ts src/services/toolHandlers.ts
# Confirm all five points above are present for each new/changed tool
```

### 13. Conventional Commits

Every commit subject **must** follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `perf:`, `build:`, `ci:`, `style:`, `revert:`), optionally with a scope (`feat(handlers):`).

**How to check:**

```bash
git log --format=%s <base>..HEAD | \
  grep -vE "^(feat|fix|docs|test|refactor|chore|perf|build|ci|style|revert)(\([^)]+\))?(!)?: .+"
# Output must be empty
```

Squash-merging a non-conformant series is not a workaround — squash merging is prohibited per constitution GW-2 unless explicitly documented or user-requested.

### 14. Constitution Sync When `constitution.json` Changes

If the PR modifies `constitution.json`, the reviewer **must** verify:

- [ ] `constitution.md` and `.specify/memory/constitution.md` were regenerated via `pwsh -File scripts/sync-constitution.ps1`
- [ ] `pwsh -File scripts/sync-constitution.ps1 -Check` exits 0 (the `Check` mode confirms the rendered docs match the JSON source)
- [ ] Version, `Ratified` date, and any changed rule IDs are coherent across all three files

A `constitution.json` change with stale `.md` renderings is a **blocking reject**.

### 15. Security-Sensitive Changes Have Multi-Agent Consensus

Changes that touch any of the following surfaces require **explicit consensus from security and testing reviewers** before merge:

- Pre-commit, pre-push, or commit-msg hook logic (`hooks/`, `.pre-commit-config.yaml`, `scripts/test-hook-regressions.ps1`)
- Secret-scanning, PII, or env-leak rule sets and their allowlists
- Authentication, authorization, audit-log, or attestation code paths
- Forbidden-file blocklists and protected-remote enforcement
- Anything classified `security` or that modifies `SECURITY.md` / `CODE_SECURITY_REVIEW.md`

Consensus must be recorded as PR review approvals from both agents (or a `.squad/decisions/inbox/` decision record cross-linked from the PR description). A single-agent approval on a security-sensitive change is a **blocking reject**.

**Constitution basis:** SH-1 through SH-10 (security and secret hygiene).

### 16. Copyright / IP Review For Imported Code

Any code copied or adapted from outside this repository (Stack Overflow, blog posts, other open-source projects, vendor docs) **must** be reviewed for license compatibility before merge.

This repository is distributed under the **MIT License** (`LICENSE`). Every imported chunk must be compatible with that outbound license.

The reviewer must confirm:

- [ ] The source license is compatible with `LICENSE`. **Auto-allowed (with attribution):** MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unlicense, CC0-1.0. **Conditionally allowed (weak copyleft — requires maintainer sign-off and a `THIRD-PARTY-LICENSES.md` entry):** MPL-2.0 (file-level copyleft), EPL-2.0 (file-level copyleft), LGPL-2.1/3.0 (only when consumed via dynamic linkage and the LGPL exception conditions are met). **Blocked (require explicit maintainer approval; usually rejected):** GPL-2.0/3.0, AGPL-3.0, SSPL, BUSL, "source-available" / non-OSI licenses, and any code with no discoverable license.
- [ ] Required attribution is preserved verbatim:
    - For **MIT / BSD / ISC** copies: the original copyright line(s) **and** the full permission text travel with the code (in-file header for substantial copies, plus an entry in `THIRD-PARTY-LICENSES.md` for non-trivial inclusions).
    - For **Apache-2.0** copies: any upstream `NOTICE` content is preserved and reproduced in `THIRD-PARTY-LICENSES.md`; the Apache-2.0 license text is referenced.
    - A one-line `THIRD-PARTY-LICENSES.md` entry alone is **not sufficient** when the upstream license requires the license/permission text to accompany the code.
- [ ] No proprietary, leaked, or unlicensed code was imported. This includes AI-generated code (Copilot, ChatGPT, etc.) that closely reproduces a known copyrighted source — when an AI suggestion is non-trivial and stylistically distinctive, the reviewer must perform a public-code similarity check (e.g., Copilot's duplicate-detection filter, a search for a unique 6–10 token substring) and document the result in the PR conversation.
- [ ] The PR description identifies the source URL/repo, commit/version, and license SPDX identifier for each imported chunk.

Imports without a clear license trail are a **blocking reject**. When in doubt, rewrite the logic from the published behavior rather than copying — independently authored expression of a documented algorithm is not a derivative work.

## Pre-Commit & CI Alignment

These automated gates catch **some** checklist violations before code reaches PR review:

| Gate | Stage | What It Catches |
|------|-------|-----------------|
| `check-hallucinations` hook | pre-commit | Tautological assertions, phantom imports, fabricated dependencies |
| `validate-agent-trailers` hook | commit-msg | Missing agent attestation trailers (AG-4) |
| `check-prompt-injection` hook | pre-commit | Adversarial instructions in comments/docs (SH-10) |
| `repo-local-security-gates` hook | pre-commit | Forbidden files, PII, env-value leaks, secret patterns |
| `gitleaks` | pre-commit | Secret scanning |
| `semgrep-pre-push` | pre-push | SAST analysis |
| `ggshield` | pre-push | Secret scanning (layered) |
| CI enhanced workflow | PR | Full test suite, typecheck, lint |

**Hooks are a safety net, not a substitute for review.** The checklist items above target defect classes that automated tooling cannot fully catch (e.g., "tests exist but test nothing meaningful").

## Enforcement

- PRs failing any checklist item **must** be sent back for correction before merge.
- The no-push-without-approval policy (constitution GW-1, PB-2) means no code reaches the protected branch without passing this review.
- Reviewers who approve a PR without completing this checklist for AI-generated content are accepting responsibility for any resulting defects.

> **Disclaimer:** This checklist is a process control — it improves the likelihood of catching defective AI-generated code but does not guarantee the absence of defects. Human judgment remains the final quality gate. The checklist is maintained on a best-effort basis and may not cover every possible failure mode.

## Coordination Notes

- **Compliance wording** — coordinated with Briggs (Legal & Compliance) to ensure policy language is enforceable and aligned with the repo's contribution agreement.
- **Test policy implications** — coordinated with Tank (Tester) to ensure checklist items are compatible with the existing TDD red-green-refactor workflow (TS-8) and the layered testing strategy in `docs/testing_strategy.md`.
- **Security alignment** — checklist items reference and build on existing pre-commit/pre-push hooks documented in `docs/security_guards.md` and `.pre-commit-config.yaml`.

## Related Issues

- Internal tracker #147 — 18 placeholder test files that test nothing
- Internal tracker #148 — 12 tests skipped instead of reported
- Internal tracker #149 — `expect(true).toBe(true)` in 9+ files
- Internal tracker #150 — Zero negative tests in entire codebase
- Internal tracker #151 — No body size validation on core add handler
- Internal tracker #119 — `index_add` noop path returns `verified: true` without verifying
- Internal tracker #129 — 10+ skipped tests document known broken functionality
